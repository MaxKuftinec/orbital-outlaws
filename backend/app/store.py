"""Lazy query API: checkpoint + event source, with radial coarse filtering

Collision graph / active thrusters are not yet authoritative. The safe role of this
first API is durable snapshots, impulsive manoeuvre events and Kepler coasts
"""
from __future__ import annotations
import math, time, json, copy, secrets
from sqlalchemy import create_engine, select, and_, or_
from sqlalchemy.orm import sessionmaker
from .models import Base, World, Entity, Event, FlightControl, PlayerProgress, SalvageClaim, EncounterSnapshot
from .physics import State, propagate, orbital_envelope, apply_impulse
from .flight import advance, LEASE_S
from .universe import new_sector, advance_sector, player_fire as fire_projectile, incoming_ship, event as sector_event


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

    def connect_player(self, pilot_id: str):
        """Single browser pilot: create once, then always resume the stored ship."""
        entity_id = 'pilot-' + pilot_id
        with self.sessions.begin() as db:
            world = db.get(World, 'kestrel')
            entity = db.get(Entity, entity_id)
            if not entity:
                angle = -.67
                radius = 260
                speed = math.sqrt(world.mu/radius)
                state = State(radius*math.cos(angle), radius*math.sin(angle),
                              -speed*math.sin(angle), speed*math.cos(angle),
                              1110, 200, angle+math.pi/2, 0)
                peri, apo = orbital_envelope(state, world.mu)
                entity = Entity(id=entity_id, world_id='kestrel', kind='player',
                                checkpoint_s=self.now(world), checkpoint=state.as_dict(),
                                periapsis_km=peri, apoapsis_km=apo)
                db.add(entity)
                db.add(FlightControl(entity_id=entity_id))
                db.add(PlayerProgress(entity_id=entity_id,credits=65,upgrades={}))
                db.add(Event(world_id='kestrel', entity_id=entity_id,
                             at_s=entity.checkpoint_s, kind='spawn', payload={},
                             after=state.as_dict(), idempotency_key='spawn:'+entity_id))
            elif entity.kind != 'player':
                raise ValueError('Not a player entity')
            elif not db.get(PlayerProgress,entity_id):
                db.add(PlayerProgress(entity_id=entity_id,credits=65,upgrades={}))
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
                    copy.deepcopy(saved.snapshot), elapsed, start_player, world.mu)
                if effects['credits']:
                    progress = db.scalars(select(PlayerProgress).where(
                        PlayerProgress.entity_id == entity_id).with_for_update()).one()
                    progress.credits += effects['credits']
                if effects['fuel'] or effects['player_dvx'] or effects['player_dvy']:
                    _, _, _, end_player = self._at(db, 'kestrel', entity_id, current_world_s)
                    added_fuel = effects['fuel']
                    new_state = State(
                        end_player.x, end_player.y,
                        end_player.vx + effects['player_dvx'],
                        end_player.vy + effects['player_dvy'],
                        end_player.mass_kg + added_fuel,
                        end_player.fuel_kg + added_fuel,
                        end_player.heading, end_player.omega)
                    peri, apo = orbital_envelope(new_state, world.mu)
                    entity.checkpoint_s = current_world_s
                    entity.checkpoint = new_state.as_dict()
                    entity.periapsis_km, entity.apoapsis_km = peri, apo
                    entity.version += 1
                    db.add(Event(world_id='kestrel', entity_id=entity_id,
                                 at_s=current_world_s, kind='sector_interaction',
                                 payload=effects, after=new_state.as_dict(),
                                 idempotency_key='sector:'+str(__import__('uuid').uuid4())))
                saved.snapshot = snapshot
                saved.saved_at_utc = now
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
                'orbit_direction': 'counterclockwise' if vessel['orbitDirection'] > 0 else 'clockwise',
                'ship_count': len(collection)
            }

    def spawn_raider(self, pilot_id: str) -> dict:
        return self.spawn_ship(pilot_id, 'raider')

    def spawn_ally(self, pilot_id: str) -> dict:
        return self.spawn_ship(pilot_id, 'ally')

    def respawn_player(self, pilot_id: str) -> dict:
        """Replace a destroyed ship without resetting the persistent sector or economy."""
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
            if snapshot['player']['alive']:
                raise ValueError('Ship is still alive; respawn only follows destruction')

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

            previous = snapshot['player']
            snapshot['player'] = {
                'hp':100., 'ammo':36, 'repairParts':10.,
                'alive':True, 'gunReady':now,
                'respawnCount':previous.get('respawnCount',0)+1
            }
            sector_event(snapshot, snapshot['t'],
                         'KESTREL-7 replacement ship launched beyond Kestrel; '
                         'manual course control online.','good')
            saved.snapshot = snapshot
            saved.saved_at_utc = time.time()

            db.add(Event(world_id='kestrel', entity_id=entity_id,
                         at_s=now,kind='respawn',payload={'reason':'dev-respawn'},
                         after=state.as_dict(),
                         idempotency_key='respawn:'+str(__import__('uuid').uuid4())))
            return {
                'pilot_id':pilot_id,
                'state':state.as_dict(),
                'hp':snapshot['player']['hp'],
                'spawn_radius_km':math.hypot(state.x,state.y),
                'initial_heading_deg':math.degrees(launch['launchDirection']) % 360,
                'arrival_control':'manual',
                'progress_preserved':True,
                'sector_preserved':True
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

    PRICES={'predictive':40,'trajectory':25,'nav':60,'ephemeris':45}

    def player_progress(self,pilot_id: str):
        with self.sessions() as db:
            progress=db.get(PlayerProgress,'pilot-'+pilot_id)
            if not progress:raise LookupError('Unknown pilot')
            return {'credits':progress.credits,'upgrades':progress.upgrades}

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
        return result

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
        return result

    def player_input(self, pilot_id: str, thrust: bool, turn: int, stabilize: bool, gimbal: float):
        """Advance using the previous leased input, then atomically set the next input."""
        self.player_encounter(pilot_id)
        entity_id = 'pilot-' + pilot_id
        with self.sessions.begin() as db:
            entity = db.scalars(select(Entity).where(Entity.id==entity_id).with_for_update()).one()
            world = db.get(World,'kestrel')
            flight = db.get(FlightControl,entity_id)
            now = max(self.now(world),entity.checkpoint_s)
            current = advance(State(**entity.checkpoint),entity.checkpoint_s,now,
                              world.mu,self._controls(flight),flight.expires_s)
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
                         after=current.as_dict(),idempotency_key='control:'+str(__import__('uuid').uuid4())))
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
        else:
            event=db.scalars(select(Event).where(and_(Event.entity_id==entity_id,Event.at_s<=at)).order_by(Event.at_s.desc(),Event.id.desc()).limit(1)).first()
            if not event:raise ValueError('Entity did not exist at this time')
            base=State(**event.after);base_t=event.at_s
            control=event.payload.get('control')
            expires=event.payload.get('expires_s',0)
        return world,entity,at,advance(base,base_t,at,world.mu,control,expires)

    def get_entity(self,world_id: str,entity_id: str,at_s: float|None=None):
        with self.sessions() as db:
            world,ent,at,s=self._at(db,world_id,entity_id,at_s)
            return {'id':ent.id,'kind':ent.kind,'state':s.as_dict(),'at_s':at,
                    'version':ent.version,'predicted':at>self.now(world)+.005}

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
            before=propagate(State(**entity.checkpoint),at-entity.checkpoint_s,world.mu)
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
