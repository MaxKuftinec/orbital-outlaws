"""Lazy query API: checkpoint + event source, with radial coarse filtering

Collision graph / active thrusters are not yet authoritative. The safe role of this
first API is durable snapshots, impulsive manoeuvre events and Kepler coasts
"""
from __future__ import annotations
import math, time, json, copy, secrets
from sqlalchemy import create_engine, select, and_, or_
from sqlalchemy.orm import sessionmaker
from .models import Base, World, Entity, Event, FlightControl, AutoBurn, PlayerProgress, PlayerSettings, SalvageClaim, EncounterSnapshot
from .physics import State, propagate, orbital_envelope, apply_impulse
from .flight import advance, LEASE_S
from .auto_burn import (advance_guided, validate_plan, initial_progress,
                        public_status, ACTIVE_STATES)
from .star_system import propagate_local, system_info
from .universe import new_sector, advance_sector, player_fire as fire_projectile, incoming_ship, event as sector_event
from .arrival_guidance import ACTIVE_ARRIVAL


class WorldStore:
    def __init__(self, database_url: str):
        self.engine=create_engine(database_url)
        self.sessions=sessionmaker(self.engine,expire_on_commit=False)
        Base.metadata.create_all(self.engine)

    def ensure_world(self,world_id: str='kestrel',mu: float=310000):
        with self.sessions.begin() as db:
            world=db.get(World,world_id)
            if not world:
                world=World(id=world_id,mu=mu,epoch_utc=time.time())
                db.add(world)
            return {'id':world.id,'mu':world.mu,'epoch_utc':world.epoch_utc}

    def now(self,world: World) -> float:
        return max(0.,time.time()-world.epoch_utc)

    def system_view(self):
        """Live primary-star and planet ephemeris in star-centered coordinates."""
        with self.sessions() as db:
            world=db.get(World,'kestrel')
            if not world:raise LookupError('World not found')
            return system_info(self.now(world))

    def seed_entity(self,world_id: str,entity_id: str,state: State,kind: str='ship'):
        with self.sessions.begin() as db:
            world=db.get(World,world_id)
            if not world:raise LookupError('World not found')
            if db.get(Entity,entity_id):raise ValueError('Entity already exists')
            peri,apo=orbital_envelope(state,world.mu)
            entity=Entity(id=entity_id,world_id=world_id,kind=kind,
                          checkpoint_s=self.now(world),checkpoint=state.as_dict(),
                          periapsis_km=peri,apoapsis_km=apo)
            db.add(entity);db.flush()
            db.add(Event(world_id=world_id,entity_id=entity_id,at_s=entity.checkpoint_s,
                         kind='spawn',payload={},after=state.as_dict(),idempotency_key=f'spawn:{entity_id}'))
            return entity.id


    @staticmethod
    def _controls(flight):
        return {'thrust':flight.thrust,'turn':flight.turn,
                'stabilize':flight.stabilize,'gimbal':flight.gimbal}

    @staticmethod
    def _auto_event_payload(db, entity_id: str):
        active = db.get(AutoBurn, entity_id)
        if active and active.progress['status'] in ACTIVE_STATES:
            return {'auto_plan':active.plan, 'auto_progress':active.progress}
        return {}

    def _settle_auto(self, db, entity: Entity, world: World, at_s: float):
        """Atomically checkpoint guidance before any change to the spacecraft.

        The optional plan is reused across disconnects and server restarts.
        Every active integration is bounded to the remaining alignment/burn
        window; coasting beyond that uses the existing Kepler/tide propagator.
        """
        auto = db.get(AutoBurn, entity.id)
        if not auto or auto.progress['status'] not in ACTIVE_STATES:
            flight = db.get(FlightControl, entity.id)
            control = self._controls(flight) if flight else None
            return advance(State(**entity.checkpoint), entity.checkpoint_s, at_s,
                           world.mu, control, flight.expires_s if flight else 0,
                           system=world.id == 'kestrel')
        before = State(**entity.checkpoint)
        after, progress = advance_guided(before, entity.checkpoint_s, at_s,
                                         world.mu, auto.plan, auto.progress,
                                         system=world.id == 'kestrel')
        if at_s > entity.checkpoint_s:
            peri, apo = orbital_envelope(after, world.mu)
            entity.checkpoint_s = at_s
            entity.checkpoint = after.as_dict()
            entity.periapsis_km, entity.apoapsis_km = peri, apo
            entity.version += 1
            auto.progress = progress
            auto.updated_s = at_s
            if progress['status'] not in ACTIVE_STATES:
                db.add(Event(world_id=world.id, entity_id=entity.id, at_s=at_s,
                             kind='auto_finish',
                             payload={'auto_status': public_status(auto.plan, progress)},
                             after=after.as_dict(),
                             idempotency_key='auto-finish:'+secrets.token_hex(16)))
        return after

    def player_auto_start(self, pilot_id: str, *, direction: str,
                          reference: str, cutoff: str,
                          duration_s: float | None = None,
                          fuel_floor_kg: float | None = None,
                          angle_deg: float | None = None):
        self.player_encounter(pilot_id)
        entity_id = 'pilot-' + pilot_id
        with self.sessions.begin() as db:
            world = db.get(World, 'kestrel')
            entity = db.scalars(select(Entity).where(
                Entity.id == entity_id).with_for_update()).first()
            if not entity or entity.kind != 'player':
                raise LookupError('Unknown pilot')
            saved = db.get(EncounterSnapshot, entity_id)
            if not saved or not saved.snapshot.get('player', {}).get('alive', False):
                raise ValueError('Destroyed spacecraft cannot engage automated thrust')
            existing = db.get(AutoBurn, entity_id)
            if existing and existing.progress['status'] in ACTIVE_STATES:
                raise ValueError('An automated burn is already active; abort it first')
            flight = db.get(FlightControl, entity_id)
            now = max(self.now(world), entity.checkpoint_s)
            current = advance(State(**entity.checkpoint), entity.checkpoint_s, now,
                              world.mu, self._controls(flight), flight.expires_s, system=True)
            reserve_row = db.get(PlayerSettings, entity_id)
            reserve = reserve_row.reserve_kg if reserve_row else 36.
            plan = validate_plan(direction, reference, cutoff, duration_s,
                                 fuel_floor_kg, angle_deg, reserve,
                                 current.fuel_kg, current.heading)
            progress = initial_progress()
            peri, apo = orbital_envelope(current, world.mu)
            entity.checkpoint_s = now
            entity.checkpoint = current.as_dict()
            entity.periapsis_km, entity.apoapsis_km = peri, apo
            entity.version += 1
            # Any previous manual lease is cancelled before authority changes.
            flight.thrust = False
            flight.turn = 0
            flight.stabilize = False
            flight.gimbal = 0.
            flight.expires_s = 0.
            if existing:
                existing.plan = plan
                existing.progress = progress
                existing.started_s = now
                existing.updated_s = now
            else:
                db.add(AutoBurn(entity_id=entity_id, plan=plan, progress=progress,
                                started_s=now, updated_s=now))
            db.add(Event(world_id='kestrel', entity_id=entity_id, at_s=now,
                         kind='auto_start', payload={'auto_plan': plan,
                                                     'auto_progress': progress},
                         after=current.as_dict(),
                         idempotency_key='auto-start:'+secrets.token_hex(16)))
            return {'pilot_id':pilot_id, 'auto_burn':public_status(plan,progress),
                    'state':current.as_dict(), 'at_s':now}

    def player_auto_abort(self, pilot_id: str, reason: str = 'Pilot aborted burn'):
        self.player_encounter(pilot_id)
        entity_id = 'pilot-' + pilot_id
        with self.sessions.begin() as db:
            world = db.get(World, 'kestrel')
            entity = db.scalars(select(Entity).where(
                Entity.id == entity_id).with_for_update()).first()
            if not entity:raise LookupError('Unknown pilot')
            auto = db.get(AutoBurn, entity_id)
            if not auto or auto.progress['status'] not in ACTIVE_STATES:
                raise ValueError('No active automated burn to abort')
            now = max(self.now(world), entity.checkpoint_s)
            current = self._settle_auto(db, entity, world, now)
            if auto.progress['status'] in ACTIVE_STATES:
                progress = {**auto.progress, 'status':'aborted', 'reason':reason}
                auto.progress = progress
                auto.updated_s = now
                db.add(Event(world_id='kestrel', entity_id=entity_id, at_s=now,
                             kind='auto_abort', payload={'reason':reason},
                             after=current.as_dict(),
                             idempotency_key='auto-abort:'+secrets.token_hex(16)))
            return {'pilot_id':pilot_id,
                    'auto_burn':public_status(auto.plan, auto.progress),
                    'state':current.as_dict(), 'at_s':now}

    def connect_player(self, pilot_id: str):
        """Single browser pilot: create once, then always resume the stored ship."""
        entity_id = 'pilot-' + pilot_id
        with self.sessions.begin() as db:
            world = db.get(World, 'kestrel')
            entity = db.get(Entity, entity_id)
            if not entity:
                angle = 2 * math.pi * secrets.randbits(53) / 2**53
                launch = incoming_ship('pilot-01', angle, 'flyby', mu=world.mu)
                state = State(launch['x'], launch['y'],
                              launch['vx'], launch['vy'], 1110, 200,
                              launch['heading'], 0)
                peri, apo = orbital_envelope(state, world.mu)
                entity = Entity(id=entity_id, world_id='kestrel', kind='player',
                                checkpoint_s=self.now(world), checkpoint=state.as_dict(),
                                periapsis_km=peri, apoapsis_km=apo)
                db.add(entity)
                db.add(FlightControl(entity_id=entity_id))
                db.add(PlayerProgress(entity_id=entity_id,credits=65,upgrades={}))
                db.add(PlayerSettings(entity_id=entity_id,reserve_kg=36.))
                db.add(Event(world_id='kestrel', entity_id=entity_id,
                             at_s=entity.checkpoint_s, kind='spawn', payload={},
                             after=state.as_dict(), idempotency_key='spawn:'+entity_id))
            elif entity.kind != 'player':
                raise ValueError('Not a player entity')
            elif not db.get(PlayerProgress,entity_id):
                db.add(PlayerProgress(entity_id=entity_id,credits=65,upgrades={}))
            if entity and not db.get(PlayerSettings,entity_id) and not any(
                    isinstance(obj,PlayerSettings) and obj.entity_id==entity_id for obj in db.new):
                db.add(PlayerSettings(entity_id=entity_id,reserve_kg=36.))
        return self.get_entity('kestrel', entity_id)

    def player_encounter(self, pilot_id: str):
        """Advance a sector through every elapsed second, even if no client was online."""
        entity_id = 'pilot-' + pilot_id
        with self.sessions.begin() as db:
            world = db.get(World, 'kestrel')
            entity = db.scalars(select(Entity).where(Entity.id == entity_id).with_for_update()).one()
            saved = db.scalars(select(EncounterSnapshot).where(
                EncounterSnapshot.entity_id == entity_id).with_for_update()).first()
            now = time.time()
            current_world_s = max(0., now - world.epoch_utc)
            if not saved:
                saved = EncounterSnapshot(entity_id=entity_id, saved_at_utc=now,
                                          snapshot=new_sector(current_world_s, world.mu))
                db.add(saved)
            elif saved.snapshot.get('version') != 3:
                # Transition the previous v0.10 pilot checkpoint once. From this
                # point forward only the backend writes encounters.
                old = saved.snapshot
                new = new_sector(current_world_s, world.mu)
                new['enemies'] = old.get('enemies', new['enemies'])
                new['ally'] = old.get('ally', new['ally'])
                new['pickups'] = old.get('pickups', new['pickups'])
                new['reinforcements'] = old.get('reinforcements', False)
                new['playerKills'] = old.get('playerKills', 0)
                saved.snapshot = new
                saved.saved_at_utc = now
            elapsed = max(0., now - saved.saved_at_utc)
            if elapsed >= .05:
                start_s = max(0., saved.saved_at_utc - world.epoch_utc)
                _, _, _, start_player = self._at(db, 'kestrel', entity_id, start_s)
                snapshot, effects = advance_sector(
                    copy.deepcopy(saved.snapshot), elapsed, start_player, world.mu,
                    upgrades=(db.get(PlayerProgress, entity_id).upgrades or {}))
                if effects['credits']:
                    progress = db.scalars(select(PlayerProgress).where(
                        PlayerProgress.entity_id == entity_id).with_for_update()).one()
                    progress.credits += effects['credits']
                if (effects['fuel'] or effects.get('capture_cargo_mass') or
                        effects['player_dvx'] or effects['player_dvy']):
                    # Integrate the active guidance before applying physical
                    # salvage/grapple impulses, so new fuel and mass are never
                    # accidentally replayed through an earlier burn interval.
                    active_auto = db.get(AutoBurn, entity_id)
                    if active_auto and active_auto.progress['status'] in ACTIVE_STATES:
                        end_player = self._settle_auto(db, entity, world, current_world_s)
                    else:
                        _, _, _, end_player = self._at(db, 'kestrel', entity_id, current_world_s)
                    added_fuel = effects['fuel']
                    new_state = State(
                        end_player.x, end_player.y,
                        end_player.vx + effects['player_dvx'],
                        end_player.vy + effects['player_dvy'],
                        end_player.mass_kg + added_fuel + effects.get('capture_cargo_mass',0.),
                        end_player.fuel_kg + added_fuel,
                        end_player.heading, end_player.omega)
                    peri, apo = orbital_envelope(new_state, world.mu)
                    entity.checkpoint_s = current_world_s
                    entity.checkpoint = new_state.as_dict()
                    entity.periapsis_km, entity.apoapsis_km = peri, apo
                    entity.version += 1
                    db.add(Event(world_id='kestrel', entity_id=entity_id,
                                 at_s=current_world_s, kind='sector_interaction',
                                 payload={**effects, **self._auto_event_payload(db,entity_id)},
                                 after=new_state.as_dict(),
                                 idempotency_key='sector:'+str(__import__('uuid').uuid4())))
                saved.snapshot = snapshot
                saved.saved_at_utc = now
            # Guidance is lazily materialized at the same authoritative world
            # time as the NPC encounter. Do this AFTER obtaining the historical
            # start state, preserving the encounter's pre-integration timestamp.
            auto = db.get(AutoBurn, entity_id)
            if auto and auto.progress['status'] in ACTIVE_STATES:
                self._settle_auto(db, entity, world, current_world_s)
            return {'saved_at_utc':saved.saved_at_utc,
                    'snapshot':copy.deepcopy(saved.snapshot)}


    def spawn_ship(self, pilot_id: str, faction: str) -> dict:
        """Server-authoritative inbound visitor; one call creates one spacecraft."""
        if faction not in ('raider', 'ally'):
            raise ValueError('Unknown spacecraft faction')
        entity_id = 'pilot-' + pilot_id
        with self.sessions() as db:
            if db.get(Entity, entity_id) is None:
                raise LookupError('Unknown pilot')
        self.player_encounter(pilot_id)
        with self.sessions.begin() as db:
            saved = db.scalars(select(EncounterSnapshot).where(
                EncounterSnapshot.entity_id == entity_id).with_for_update()).one()
            sector = copy.deepcopy(saved.snapshot)
            is_ally = faction == 'ally'
            collection = sector.setdefault('allies', []) if is_ally else sector['enemies']
            counter = 'nextAllyId' if is_ally else 'nextRaiderId'
            number = int(sector.get(counter, 2 if is_ally else 3))
            prefix = 'ally' if is_ally else 'raider'
            existing = {body['id'] for body in collection}
            if is_ally:
                existing.add(sector['ally']['id'])
            while f'{prefix}-{number:02d}' in existing:
                number += 1
            sector[counter] = number + 1
            angle = (number * 2.399963229728653) % (2 * math.pi) - math.pi
            intent = ('flyby', 'orbit')[secrets.randbelow(2)]
            world = db.get(World, 'kestrel')
            vessel = incoming_ship(f'{prefix}-{number:02d}', angle, intent,
                                   is_ally, world.mu)
            vessel['nextDecision'] = sector['t'] + 4
            vessel['courseBurnAt'] = sector['t'] + 2.5
            collection.append(vessel)
            sector_event(sector, sector['t'], f"{vessel['name']} approaching Kestrel "
                         f"on a {intent} mission.", 'good' if is_ally else 'danger')
            saved.snapshot = sector
            saved.saved_at_utc = time.time()
            return {
                'ship': {'id': vessel['id'], 'name': vessel['name'],
                         'x': vessel['x'], 'y': vessel['y']},
                'intent': intent,
                'faction': faction,
                'initial_heading_deg': math.degrees(vessel['launchDirection']) % 360,
                'orbit_direction': 'clockwise' if vessel['orbitDirection'] > 0 else 'counterclockwise',
                'ship_count': len(collection)
            }

    def spawn_raider(self, pilot_id: str) -> dict:
        return self.spawn_ship(pilot_id, 'raider')

    def spawn_ally(self, pilot_id: str) -> dict:
        return self.spawn_ship(pilot_id, 'ally')

    def request_assistance(self, pilot_id: str, recipient_id: str = 'player',
                           donor_id: str | None = None):
        """Queue automatic assistance or safely assign a user-selected NPC donor."""
        self.player_encounter(pilot_id)
        entity_id = 'pilot-' + pilot_id
        with self.sessions.begin() as db:
            saved = db.scalars(select(EncounterSnapshot).where(
                EncounterSnapshot.entity_id == entity_id).with_for_update()).one()
            sector = copy.deepcopy(saved.snapshot)
            recipients = {'player': sector['player'],
                          **{a['id']: a for a in [sector['ally'], *sector.get('allies', [])]}}
            recipient = recipients.get(recipient_id)
            if not recipient or not recipient.get('alive', True):
                raise ValueError('Recipient not active')
            if recipient_id == 'player':
                _, _, _, flight = self._at(db, 'kestrel', entity_id)
                if flight.fuel_kg >= 199.9: raise ValueError('Tank already full')
            elif recipient['fuel'] >= recipient.get('fuelMax', 170)-.1:
                raise ValueError('Tank already full')
            orders=sector.setdefault('assistance', [])
            existing=next((o for o in orders if o['recipient']==recipient_id),None)
            if donor_id is not None:
                allies=[sector['ally'],*sector.get('allies',[])]
                donor=next((a for a in allies if a['id']==donor_id),None)
                if donor is None or not donor.get('alive',True):
                    raise ValueError('Selected fuel donor is not a living friendly spacecraft')
                if donor_id==recipient_id:
                    raise ValueError('A spacecraft cannot donate fuel to itself')
                if donor.get('arrivalPhase') in ACTIVE_ARRIVAL:
                    raise ValueError('Selected ally is still arriving; wait for orbital insertion')
                if donor.get('fuel',0.)<=55.:
                    raise ValueError('Selected ally needs more than 55 kg fuel to attempt a rescue')
                if any(o is not existing and (o.get('donor')==donor_id or o.get('recipient')==donor_id)
                       for o in orders):
                    raise ValueError('Selected ally is already assigned to another rescue')
                if existing and existing.get('donor')==donor_id:
                    raise ValueError('This ally is already assigned to your rescue')
            elif existing:
                raise ValueError('Assistance already requested')
            if existing:
                previous=next((a for a in [sector['ally'],*sector.get('allies',[])]
                               if a['id']==existing.get('donor')),None)
                if previous:
                    previous.pop('burn',None)
                orders.remove(existing)
            order={'recipient':recipient_id,'donor':donor_id,
                   'faction':'friendly','createdAt':sector['t'],
                   'nextDecision':sector['t']}
            if donor_id is not None:
                order['manualDonor']=True
            orders.append(order)
            if donor_id:
                sector_event(sector,sector['t'],
                             f"Selected {donor['name']} to deliver fuel to {recipient_id}.")
            else:
                sector_event(sector,sector['t'],f"Fuel assistance requested for {recipient_id}.")
            saved.snapshot=sector
            saved.saved_at_utc=time.time()
            return {'status':'queued','recipient':recipient_id,
                    **({'donor':donor_id} if donor_id is not None else {})}

    def offer_fuel(self, pilot_id: str, target_id: str, requested_kg: float = 20.):
        """Safe player-to-ally delivery debits real player mass/fuel."""
        if not math.isfinite(requested_kg) or not 0 < requested_kg <= 35:
            raise ValueError('Transfer must be >0 and <=35 kg')
        self.player_encounter(pilot_id)
        entity_id = 'pilot-' + pilot_id
        with self.sessions.begin() as db:
            world = db.get(World, 'kestrel')
            entity = db.scalars(select(Entity).where(
                Entity.id == entity_id).with_for_update()).one()
            saved = db.scalars(select(EncounterSnapshot).where(
                EncounterSnapshot.entity_id == entity_id).with_for_update()).one()
            sector = copy.deepcopy(saved.snapshot)
            if not sector['player']['alive']:
                raise ValueError('Destroyed ships cannot transfer fuel')
            ally = next((a for a in [sector['ally'], *sector.get('allies', [])]
                         if a['id'] == target_id and a.get('alive', True)), None)
            if not ally: raise ValueError('Select an active allied craft')
            now = self.now(world)
            active_auto = db.get(AutoBurn, entity_id)
            if active_auto and active_auto.progress['status'] in ACTIVE_STATES:
                current = self._settle_auto(db, entity, world, now)
            else:
                _, _, _, current = self._at(db, 'kestrel', entity_id, now)
            separation = math.hypot(current.x-ally['x'], current.y-ally['y'])
            relative = math.hypot(current.vx-ally['vx'], current.vy-ally['vy'])
            if separation > 18 or relative >= 2.5:
                raise ValueError(f'Rendezvous required: {separation:.1f} km and {relative:.1f} km/s '
                                 '(limits: 18 km and 2.5 km/s)')
            settings = db.get(PlayerSettings, entity_id)
            reserve = settings.reserve_kg if settings else 36.
            moved = min(requested_kg, max(0., current.fuel_kg-reserve),
                        max(0., ally.get('fuelMax', 170.)-ally['fuel']))
            if moved < .1: raise ValueError('No surplus fuel or recipient tank full')
            state = State(current.x, current.y, current.vx, current.vy,
                          current.mass_kg-moved, current.fuel_kg-moved,
                          current.heading, current.omega)
            peri, apo = orbital_envelope(state, world.mu)
            entity.checkpoint_s = now
            entity.checkpoint = state.as_dict()
            entity.periapsis_km, entity.apoapsis_km = peri, apo
            entity.version += 1
            receiver_mass=ally.get('dryMass',1050.)+ally['fuel']
            ratio=moved/(receiver_mass+moved)
            dvx=ratio*(current.vx-ally['vx'])
            dvy=ratio*(current.vy-ally['vy'])
            thermal_mj=.5*receiver_mass*moved/(receiver_mass+moved)*relative**2
            ally['vx']+=dvx
            ally['vy']+=dvy
            ally['fuel'] += moved
            ally['transferHeatMJ']=ally.get('transferHeatMJ',0.)+thermal_mj
            sector_event(sector, sector['t'],
                         f"KESTREL-7 delivered {moved:.1f} kg propellant to {ally['name']} "
                         f"(momentum-adjusted, {thermal_mj:.1f} MJ damped).", 'good')
            saved.snapshot = sector
            saved.saved_at_utc = time.time()
            db.add(Event(world_id='kestrel', entity_id=entity_id, at_s=now,
                         kind='fuel_transfer', payload={'target': target_id, 'kg': moved,
                                 'recipient_dvx':dvx,'recipient_dvy':dvy,
                                 'thermal_mj':thermal_mj,
                                  **self._auto_event_payload(db,entity_id)},
                         after=state.as_dict(),
                         idempotency_key='fuel:'+str(__import__('uuid').uuid4())))
            return {'target': target_id, 'transferred_kg': moved,
                    'remaining_fuel_kg': state.fuel_kg}

    def refuel_player(self, pilot_id: str, requested_kg: float | None = None) -> dict:
        """Add dev-only propellant without exceeding the player's 200 kg tank.

        Refueling adds the same mass as fuel; it never changes dry mass,
        orbital velocity, progression, or the surrounding NPC sector.
        """
        if requested_kg is not None and (
                not math.isfinite(requested_kg) or requested_kg <= 0):
            raise ValueError('Refuel amount must be finite and greater than zero')
        entity_id = 'pilot-' + pilot_id
        with self.sessions() as db:
            entity = db.get(Entity, entity_id)
            if not entity or entity.kind != 'player':
                raise LookupError('Unknown pilot')

        # Resolve elapsed flight/encounter activity before applying the refill.
        self.player_encounter(pilot_id)
        with self.sessions.begin() as db:
            world = db.get(World, 'kestrel')
            entity = db.scalars(select(Entity).where(
                Entity.id == entity_id).with_for_update()).one()
            saved = db.scalars(select(EncounterSnapshot).where(
                EncounterSnapshot.entity_id == entity_id).with_for_update()).one()
            if not saved.snapshot['player']['alive']:
                raise ValueError('Destroyed pilot ship must respawn before refueling')
            flight = db.get(FlightControl, entity_id)
            at = max(self.now(world), entity.checkpoint_s)
            active_auto = db.get(AutoBurn, entity_id)
            if active_auto and active_auto.progress['status'] in ACTIVE_STATES:
                current = self._settle_auto(db, entity, world, at)
            else:
                current = advance(State(**entity.checkpoint), entity.checkpoint_s, at,
                                  world.mu, self._controls(flight), flight.expires_s,
                                  system=True)
            capacity_kg = 200.0
            room_kg = max(0.0, capacity_kg - current.fuel_kg)
            added_kg = min(room_kg, requested_kg) if requested_kg is not None else room_kg
            if added_kg <= 0:
                return {'pilot_id': pilot_id, 'added_kg': 0.0,
                        'fuel_kg': current.fuel_kg, 'fuel_capacity_kg': capacity_kg,
                        'state': current.as_dict(), 'version': entity.version}

            refueled = State(current.x, current.y, current.vx, current.vy,
                             current.mass_kg + added_kg, current.fuel_kg + added_kg,
                             current.heading, current.omega)
            peri, apo = orbital_envelope(refueled, world.mu)
            entity.checkpoint_s = at
            entity.checkpoint = refueled.as_dict()
            entity.periapsis_km, entity.apoapsis_km = peri, apo
            entity.version += 1
            db.add(Event(world_id='kestrel', entity_id=entity_id, at_s=at,
                         kind='dev_refuel',
                         payload={'added_kg': added_kg, 'control': self._controls(flight),
                                  'expires_s': flight.expires_s,
                                   **self._auto_event_payload(db,entity_id)},
                         after=refueled.as_dict(),
                         idempotency_key='dev-refuel:' + secrets.token_hex(16)))
            return {'pilot_id': pilot_id, 'added_kg': added_kg,
                    'fuel_kg': refueled.fuel_kg, 'fuel_capacity_kg': capacity_kg,
                    'state': refueled.as_dict(), 'version': entity.version}

    def respawn_player(self, pilot_id: str) -> dict:
        """Begin a new run from an active or destroyed pilot, preserving the sector."""
        entity_id = 'pilot-' + pilot_id
        with self.sessions() as db:
            if db.get(Entity, entity_id) is None:
                raise LookupError('Unknown pilot')
        self.player_encounter(pilot_id)
        with self.sessions.begin() as db:
            world = db.get(World, 'kestrel')
            entity = db.scalars(select(Entity).where(
                Entity.id == entity_id).with_for_update()).one()
            saved = db.scalars(select(EncounterSnapshot).where(
                EncounterSnapshot.entity_id == entity_id).with_for_update()).one()
            snapshot = copy.deepcopy(saved.snapshot)
            # Preserve the previous controllable ship in the immutable event
            # history; a new run resets only this pilot and its progression.
            previous_alive=bool(snapshot['player'].get('alive'))
            previous_state=copy.deepcopy(entity.checkpoint)
            angle = 2 * math.pi * secrets.randbits(53) / 2**53
            # Reuse the NPC's outer launch geometry and independent 360° velocity.
            # Unlike an NPC, a player chooses their own burn/arrival intention.
            launch = incoming_ship('pilot-01', angle, 'flyby', mu=world.mu)
            now = self.now(world)
            state = State(launch['x'], launch['y'],
                          launch['vx'], launch['vy'], 1110., 200.,
                          launch['heading'], 0.)
            peri, apo = orbital_envelope(state, world.mu)
            entity.checkpoint_s = now
            entity.checkpoint = state.as_dict()
            entity.periapsis_km, entity.apoapsis_km = peri, apo
            entity.version += 1

            flight = db.get(FlightControl, entity_id)
            flight.thrust = False
            flight.turn = 0
            flight.stabilize = False
            flight.gimbal = 0.
            flight.expires_s = 0.
            auto = db.get(AutoBurn, entity_id)
            if auto:
                auto.progress = {**auto.progress, 'status':'aborted',
                                 'reason':'Spacecraft respawned'}
                auto.updated_s = now

            previous = snapshot['player']
            snapshot['player'] = {
                'hp':100., 'ammo':36, 'repairParts':10.,
                'cargoKg':0.,'captureHeatMJ':0.,'captureRadiatedMJ':0.,
                'captureHeatProducedMJ':0.,'transferHeatMJ':0.,
                'alive':True, 'gunReady':now,
                'respawnCount':previous.get('respawnCount',0)+1
            }
            sector_event(snapshot, snapshot['t'],
                         'KESTREL-7 replacement ship launched beyond Kestrel; '
                         'manual course control online.','good')
            saved.snapshot = snapshot
            saved.saved_at_utc = time.time()
            progress = db.get(PlayerProgress, entity_id)
            progress.credits = 65
            progress.upgrades = {}

            db.add(Event(world_id='kestrel', entity_id=entity_id,
                         at_s=now,kind='respawn',payload={
                           'reason':'dev-abandon' if previous_alive else 'dev-respawn',
                           'previous_ship':previous_state, 'previous_alive':previous_alive},
                         after=state.as_dict(),
                         idempotency_key='respawn:'+str(__import__('uuid').uuid4())))
            return {
                'pilot_id':pilot_id,
                'state':state.as_dict(),
                'hp':snapshot['player']['hp'],
                'spawn_radius_km':math.hypot(state.x,state.y),
                'initial_heading_deg':math.degrees(launch['launchDirection']) % 360,
                'arrival_control':'manual',
                'progress_preserved':False,
                'starter_credits':65,
                'sector_preserved':True,
                'previous_ship_abandoned':previous_alive,
                'previous_ship_state':previous_state
            }

    def player_fire(self, pilot_id: str, dx: float, dy: float):
        self.player_encounter(pilot_id)
        entity_id='pilot-'+pilot_id
        with self.sessions.begin() as db:
            world=db.get(World,'kestrel')
            saved=db.scalars(select(EncounterSnapshot).where(
                EncounterSnapshot.entity_id == entity_id).with_for_update()).one()
            _,_,_,player=self._at(db,'kestrel',entity_id,self.now(world))
            snapshot=copy.deepcopy(saved.snapshot)
            fired=fire_projectile(snapshot,player,self.now(world),dx,dy)
            if fired:
                saved.snapshot=snapshot
                saved.saved_at_utc=time.time()
            return fired

    def player_repair(self, pilot_id: str):
        self.player_encounter(pilot_id)
        entity_id='pilot-'+pilot_id
        with self.sessions.begin() as db:
            saved=db.scalars(select(EncounterSnapshot).where(
                EncounterSnapshot.entity_id == entity_id).with_for_update()).one()
            snapshot=copy.deepcopy(saved.snapshot)
            p=snapshot['player']
            if p['hp']>=100 or p['repairParts']<=0 or not p['alive']:
                return False
            hp=min(1.,100-p['hp'],5*p['repairParts'])
            p['hp']+=hp
            p['repairParts']-=hp/5
            saved.snapshot=snapshot
            saved.saved_at_utc=time.time()
            return True

    def save_encounter(self, pilot_id: str, snapshot: dict):
        raise ValueError('Client-owned NPC snapshots are disabled; FastAPI owns sector state')

    PRICES={'predictive':40,'trajectory':25,'nav':60,'ephemeris':45,'capture':55}

    def player_progress(self,pilot_id: str):
        with self.sessions() as db:
            progress=db.get(PlayerProgress,'pilot-'+pilot_id)
            if not progress:raise LookupError('Unknown pilot')
            settings=db.get(PlayerSettings,'pilot-'+pilot_id)
            return {'credits':progress.credits,'upgrades':progress.upgrades,
                    'reserve_kg':settings.reserve_kg if settings else 36.}

    def set_player_reserve(self, pilot_id: str, reserve_kg: float):
        """User-configured protection for autopilot and outgoing donations."""
        if not math.isfinite(reserve_kg) or not 0 <= reserve_kg <= 200:
            raise ValueError('Fuel reserve must be between 0 and 200 kg')
        entity_id='pilot-'+pilot_id
        with self.sessions.begin() as db:
            if not db.get(Entity,entity_id):
                raise LookupError('Unknown pilot')
            auto=db.get(AutoBurn,entity_id)
            if auto and auto.progress['status'] in ACTIVE_STATES:
                raise ValueError('Abort automated thrust before changing the protected reserve')
            settings=db.scalars(select(PlayerSettings).where(
                PlayerSettings.entity_id==entity_id).with_for_update()).first()
            if not settings:
                settings=PlayerSettings(entity_id=entity_id,reserve_kg=reserve_kg)
                db.add(settings)
            else:
                settings.reserve_kg=reserve_kg
        return self.player_progress(pilot_id)

    def player_purchase(self,pilot_id: str,upgrade: str):
        if upgrade not in self.PRICES:raise ValueError('Unknown upgrade')
        with self.sessions.begin() as db:
            progress=db.scalars(select(PlayerProgress).where(
                PlayerProgress.entity_id=='pilot-'+pilot_id).with_for_update()).one()
            owned=dict(progress.upgrades)
            if not owned.get(upgrade):
                price=self.PRICES[upgrade]
                if progress.credits<price:raise ValueError('Insufficient credits')
                progress.credits-=price
                owned[upgrade]=True
                progress.upgrades=owned
            result={'credits':progress.credits,'upgrades':dict(progress.upgrades)}
        return self.player_progress(pilot_id)

    def player_salvage(self,pilot_id: str,claim_id: str,amount: int):
        # DEVELOPMENT ONLY: client reports pickups until server controls salvage.
        if not 1<=len(claim_id)<=128 or not 1<=amount<=50:
            raise ValueError('Invalid salvage claim')
        entity_id='pilot-'+pilot_id
        with self.sessions.begin() as db:
            progress=db.scalars(select(PlayerProgress).where(
                PlayerProgress.entity_id==entity_id).with_for_update()).one()
            if not db.get(SalvageClaim,(entity_id,claim_id)):
                db.add(SalvageClaim(entity_id=entity_id,claim_id=claim_id,amount=amount))
                progress.credits+=amount
            result={'credits':progress.credits,'upgrades':dict(progress.upgrades)}
        return self.player_progress(pilot_id)

    def player_input(self, pilot_id: str, thrust: bool, turn: int, stabilize: bool, gimbal: float):
        """Manual attitude/throttle overrides active server guidance immediately.

        Neutral input packets still carry gun/fire/recovery via the WebSocket,
        but they never cancel or renew a server-side automated burn.
        """
        self.player_encounter(pilot_id)
        entity_id = 'pilot-' + pilot_id
        with self.sessions.begin() as db:
            entity = db.scalars(select(Entity).where(Entity.id==entity_id).with_for_update()).one()
            world = db.get(World, 'kestrel')
            flight = db.get(FlightControl, entity_id)
            auto = db.get(AutoBurn, entity_id)
            active = auto and auto.progress['status'] in ACTIVE_STATES
            if active and not (thrust or turn or stabilize):
                # Do not create flight lease/events for regular neutral cockpit
                # polling. Guidance remains server-owned across disconnects.
                pass
            else:
                now = max(self.now(world), entity.checkpoint_s)
                if active:
                    current = self._settle_auto(db, entity, world, now)
                    if auto.progress['status'] in ACTIVE_STATES:
                        auto.progress = {**auto.progress, 'status':'aborted',
                                         'reason':'Manual flight control override'}
                        auto.updated_s = now
                        db.add(Event(world_id='kestrel', entity_id=entity_id, at_s=now,
                                     kind='auto_abort', payload={'reason':'manual override'},
                                     after=current.as_dict(),
                                     idempotency_key='auto-abort:'+secrets.token_hex(16)))
                else:
                    current = advance(State(**entity.checkpoint),entity.checkpoint_s,now,
                                      world.mu,self._controls(flight),flight.expires_s,
                                      system=True)
                peri,apo = orbital_envelope(current,world.mu)
                entity.checkpoint_s=now
                entity.checkpoint=current.as_dict()
                entity.periapsis_km=peri
                entity.apoapsis_km=apo
                entity.version+=1
                flight.thrust=thrust
                flight.turn=turn
                flight.stabilize=stabilize
                flight.gimbal=gimbal
                flight.expires_s=now+LEASE_S
                db.add(Event(world_id='kestrel', entity_id=entity_id, at_s=now,kind='control',
                             payload={'control':self._controls(flight),'expires_s':flight.expires_s},
                             after=current.as_dict(),idempotency_key='control:'+secrets.token_hex(16)))
        return self.get_entity('kestrel', entity_id)

    def _at(self,db,world_id,entity_id,at_s: float|None=None):
        world=db.get(World,world_id)
        if not world:raise LookupError('World not found')
        entity=db.get(Entity,entity_id)
        if not entity or entity.world_id!=world_id:raise LookupError('Entity not found')
        at=self.now(world) if at_s is None else float(at_s)
        if at<0:raise ValueError('Negative world time')
        if at>=entity.checkpoint_s:
            base=State(**entity.checkpoint);base_t=entity.checkpoint_s
            flight=db.get(FlightControl,entity_id) if entity.kind=='player' else None
            control=self._controls(flight) if flight else None
            expires=flight.expires_s if flight else 0
            auto=db.get(AutoBurn,entity_id) if entity.kind=='player' else None
            if auto and auto.progress['status'] in ACTIVE_STATES:
                result,_=advance_guided(base,base_t,at,world.mu,auto.plan,
                                        auto.progress,system=world_id=='kestrel')
                return world,entity,at,result
        else:
            event=db.scalars(select(Event).where(and_(Event.entity_id==entity_id,Event.at_s<=at)).order_by(Event.at_s.desc(),Event.id.desc()).limit(1)).first()
            if not event:raise ValueError('Entity did not exist at this time')
            base=State(**event.after);base_t=event.at_s
            historical_plan=event.payload.get('auto_plan')
            historical_progress=event.payload.get('auto_progress')
            if historical_plan and historical_progress and historical_progress['status'] in ACTIVE_STATES:
                projected,_=advance_guided(base,base_t,at,world.mu,
                                           historical_plan,historical_progress,
                                           system=world_id=='kestrel')
                return world,entity,at,projected
            control=event.payload.get('control')
            expires=event.payload.get('expires_s',0)
        return world,entity,at,advance(base,base_t,at,world.mu,control,expires,
                                       system=world_id=='kestrel')

    def get_entity(self,world_id: str,entity_id: str,at_s: float|None=None):
        with self.sessions() as db:
            world,ent,at,s=self._at(db,world_id,entity_id,at_s)
            result={'id':ent.id,'kind':ent.kind,'state':s.as_dict(),'at_s':at,
                    'version':ent.version,'predicted':at>self.now(world)+.005}
            if ent.kind=='player':
                auto=db.get(AutoBurn,ent.id)
                if auto:
                    if auto.progress['status'] in ACTIVE_STATES and at>=ent.checkpoint_s:
                        _,projected=advance_guided(State(**ent.checkpoint),
                                                   ent.checkpoint_s,at,world.mu,
                                                   auto.plan,auto.progress,
                                                   system=world_id=='kestrel')
                    else:
                        projected=auto.progress
                    result['auto_burn']=public_status(auto.plan,projected)
            return result

    def viewport(self,world_id: str,cx: float,cy: float,radius_km: float,at_s: float|None=None):
        if not 0<radius_km<=100000:raise ValueError('Invalid viewport radius')
        with self.sessions() as db:
            world=db.get(World,world_id)
            if not world:raise LookupError('World not found')
            at=self.now(world) if at_s is None else float(at_s)
            if at<0:raise ValueError('Negative world time')
            cr=math.hypot(cx,cy)
            # Radial envelopes are conservative for the CURRENT osculating orbit
            # Historical viewport queries use all entities (older events may change envelopes)
            past=at<self.now(world)-1.0
            q=select(Entity).where(Entity.world_id==world_id)
            if not past:
                q=q.where(and_(Entity.periapsis_km<=cr+radius_km,
                               or_(Entity.apoapsis_km==None,Entity.apoapsis_km>=max(0,cr-radius_km))))
            rows=db.scalars(q).all()
            found=[]
            for entity in rows:
                try:
                    _,_,_,s=self._at(db,world_id,entity.id,at)
                except ValueError:
                    continue
                if math.hypot(s.x-cx,s.y-cy)<=radius_km:
                    found.append({'id':entity.id,'kind':entity.kind,'state':s.as_dict()})
            return {'world_id':world_id,'at_s':at,'entities':found,'candidate_count':len(rows),
                    'predicted':at>self.now(world)+.005}

    def apply_impulse(self,world_id: str,entity_id: str,dvx: float,dvy: float,key: str,reserve_kg: float=0):
        """Authoritative development command using server time (never client-supplied time)."""
        if not key or len(key)>128:raise ValueError('Invalid idempotency key')
        with self.sessions.begin() as db:
            previous=db.scalars(select(Event).where(and_(Event.world_id==world_id,Event.idempotency_key==key))).first()
            if previous:
                if previous.entity_id!=entity_id:raise ValueError('Duplicate command key belongs to another entity')
                return {'at_s':previous.at_s,'state':previous.after,'replayed':True}
            world=db.get(World,world_id)
            if not world:raise LookupError('World not found')
            entity=db.scalars(select(Entity).where(and_(Entity.id==entity_id,Entity.world_id==world_id)).with_for_update()).first()
            if not entity:raise LookupError('Entity not found')
            at=max(self.now(world),entity.checkpoint_s)
            before=(propagate_local(State(**entity.checkpoint),at-entity.checkpoint_s,
                                     world.mu,entity.checkpoint_s) if world_id=='kestrel' else
                    propagate(State(**entity.checkpoint),at-entity.checkpoint_s,world.mu))
            after=apply_impulse(before,dvx,dvy,320.,reserve_kg)
            peri,apo=orbital_envelope(after,world.mu)
            entity.checkpoint_s=at
            entity.checkpoint=after.as_dict()
            entity.periapsis_km=peri;entity.apoapsis_km=apo
            entity.version+=1
            db.add(Event(world_id=world_id,entity_id=entity_id,at_s=at,
                         kind='impulse',payload={'dvx':dvx,'dvy':dvy,'reserve_kg':reserve_kg},
                         after=after.as_dict(),idempotency_key=key))
            return {'at_s':at,'state':after.as_dict(),'replayed':False}
