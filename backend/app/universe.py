"""Pilot-sector authoritative NPC simulation with deterministic offline catch-up.

Kilometres, seconds and kilograms throughout. Live clients render the results;
they never submit NPC positions, damage or rewards.
"""
from __future__ import annotations

import math
import secrets
from .physics import State, propagate, apply_impulse, orbital_envelope
from .npc_guidance import plan_transfer, queue_burn, move_with_burn
from .arrival_guidance import desired_approach, resolve_arrival as advance_arrival, ACTIVE_ARRIVAL
from .capture_physics import assess_capture, payload_mass, cool_capture_system
from .npc_intelligence import risk_report, evasive_burn, coordinate_allies, choose_raider_target

MU = 310000.0
BODY_RADIUS = 91.0
SHOT_SPEED = 205.0
SHOT_RADIUS = 14.0
SHIP_DIAMETER = 4.0


def circular(radius: float, angle: float, mu: float = MU) -> dict:
    speed = math.sqrt(mu / radius)
    return {'x': radius * math.cos(angle), 'y': radius * math.sin(angle),
            'vx': -speed * math.sin(angle), 'vy': speed * math.cos(angle)}


def ship(id: str, radius: float, angle: float, ally: bool = False) -> dict:
    orbit = circular(radius, angle)
    return {**orbit, 'id': id, 'name': ('AEGIS-'+id.rsplit('-',1)[-1]) if ally else id.upper(),
            'alive': True, 'isAlly': ally,
            'color': '#67e0aa' if ally else '#ff7184',
            'hp': 80.0 if ally else 66.0,
            'ammo': 120 if ally else 999, 'fuel': 140.0 if ally else 150.0,
            'fuelMax': 170.0, 'dryMass': 1050.0,
            'heading': math.atan2(orbit['vy'], orbit['vx']), 'omega': 0.,
            'gunCooldown': 2.0 if ally else 4.0, 'nextDecision': 6.0,
            'aiThrustKind': None, 'aiThrustUntil': 0., 'trail': [], 'trailT': 0.,
            'shotCount': 0, 'gimbal': 0, 'thrustVector': None, 'rcsFiring': 0}



def incoming_ship(id: str, angle: float, intent: str, ally: bool = False,
                  mu: float = MU, velocity_angle: float | None = None,
                  velocity_speed: float | None = None) -> dict:
    """Random 360-degree launch, followed by a separate intention-driven course burn.

    The spawn position is independent of velocity direction. The intended
    orbital sense comes from random initial angular momentum, so clockwise
    and counterclockwise are both possible.
    """
    if intent not in ('flyby', 'orbit'):
        raise ValueError('Unknown arrival intention')
    number = int(id.rsplit('-', 1)[-1])
    radius = 950. + (number % 4) * 85.
    periapsis = 275. + (number % 4) * 24.
    v_inf = 12. + (number % 3) * 2.
    direction = (2*math.pi*secrets.randbits(53)/2**53
                 if velocity_angle is None else velocity_angle)
    speed = (20 + 12*secrets.randbits(53)/2**53
             if velocity_speed is None else velocity_speed)
    x, y = radius*math.cos(angle), radius*math.sin(angle)
    vx, vy = speed*math.cos(direction), speed*math.sin(direction)
    orbit_direction = 1 if x*vy-y*vx >= 0 else -1
    vessel = ship(id, radius, angle, ally)
    vessel.update({'name':('AEGIS-'+id.rsplit('-',1)[-1]) if ally else id.upper(),
                   'x':x, 'y':y, 'vx':vx, 'vy':vy,
                   'heading':direction, 'launchDirection':direction,
                   'arrivalIntent':intent, 'arrivalPhase':'launch',
                   'courseBurnAt':2.5, 'orbitDirection':orbit_direction,
                   'insertionRadius':periapsis, 'arrivalVInfinity':v_inf,
                   'nextDecision':0., 'fuel':420., 'fuelMax':420.})
    return vessel


def arrival_course(body: dict, mu: float) -> tuple[float, float]:
    """Compatibility wrapper; approach choice is implemented by finite guidance."""
    return desired_approach(body,mu)


def resolve_arrival(sector: dict, body: dict, mu: float, when: float):
    advance_arrival(body,mu,when,
                    lambda message,kind='neutral':event(sector,when,message,kind))


def new_sector(world_time: float, mu: float = MU) -> dict:
    def pod(id, radius, angle, kind, amount):
        return {**circular(radius, angle, mu), 'id': id, 'type': kind,
                'amount': amount, 'alive': True, 'phase': 0.}
    return {'version': 3, 't': world_time,
            'enemies': [ship('raider-01', 280, .17), ship('raider-02', 323, -2.02)],
            'ally': ship('ally-01', 272, -.21, True),
            'pickups': [
                pod('starter-fuel-0', 260, -.42, 'fuel', 28),
                pod('starter-credits-0', 250, -1.20, 'credits', 24),
                pod('starter-ammo-0', 330, -2.42, 'ammo', 16),
                pod('starter-fuel-1', 312, .75, 'fuel', 32),
                pod('starter-credits-1', 365, 1.7, 'credits', 30),
                pod('starter-parts-0', 295, 1.1, 'parts', 8)],
            'shots': [], 'shotCounter': 0, 'nextRaiderId': 3, 'nextAllyId': 2,
            'allies': [], 'player': {'hp': 100., 'ammo': 36, 'repairParts': 10.,
                                    'alive': True, 'gunReady': world_time,
            'cargoKg':0., 'captureHeatMJ':0., 'captureRadiatedMJ':0., 'captureHeatProducedMJ':0.},
            'events': [], 'reinforcements': False, 'nextEnemySpawn': world_time+75,
            'playerKills': 0, 'collisionCooldown': {}, 'assistance': []}


def event(sector: dict, when: float, message: str, category='neutral'):
    sector['events'].append({'t': when, 'message': message, 'category': category})
    sector['events'] = sector['events'][-30:]


def state_of(body: dict) -> State:
    fuel = float(body.get('fuel', 0))
    return State(body['x'], body['y'], body['vx'], body['vy'],
                 body.get('dryMass', 1050) + fuel, fuel,
                 body.get('heading', 0), body.get('omega', 0))


def move(body: dict, dt: float, mu: float):
    if not body.get('alive', True):
        return
    try:
        result = move_with_burn(body, dt, mu)
        for field in ('x', 'y', 'vx', 'vy', 'heading', 'omega'):
            body[field] = getattr(result, field)
        if 'fuel' in body:
            body['fuel'] = result.fuel_kg
        if math.hypot(result.x, result.y) < BODY_RADIUS:
            body['alive'] = False
    except (ValueError, OverflowError):
        body['alive'] = False


def distance(a: dict, b: dict) -> float:
    return math.hypot(a['x']-b['x'], a['y']-b['y'])


def hit_swept(a0: dict, a: dict, b0: dict, b: dict, radius: float) -> bool:
    """Closest approach of two moving segments, including high-speed projectiles."""
    px, py = a0['x']-b0['x'], a0['y']-b0['y']
    vx = (a['x']-a0['x']) - (b['x']-b0['x'])
    vy = (a['y']-a0['y']) - (b['y']-b0['y'])
    t = max(0., min(1., -(px*vx+py*vy)/(vx*vx+vy*vy))) if vx*vx+vy*vy > 1e-12 else 0.
    return (px+t*vx)**2 + (py+t*vy)**2 <= radius**2


def destroy(sector: dict, body: dict, when: float, cause: str):
    if not body.get('alive', True) or body.get('hp', 1) > 0:
        return
    body['alive'] = False
    event(sector, when, f"{body['name']} destroyed ({cause}).", 'danger')
    if body.get('isAlly') or body.get('isPlayer'):
        return
    sector['pickups'].append({
        **{k: body[k] for k in ('x', 'y', 'vx', 'vy')},
        'id': 'wreck-'+body['id'], 'type': 'wreck', 'amount': 50,
        'phase': 0., 'alive': True, 'massKg':120.
    })


def fire(sector: dict, shooter: dict, target: dict, at: float, faction: str,
         aim: tuple[float, float] | None = None) -> bool:
    if not shooter.get('alive', True) or shooter.get('ammo', 0) <= 0:
        return False
    if shooter.get('gunReady', 0) > at:
        return False
    dx, dy = aim if aim is not None else (target['x']-shooter['x'], target['y']-shooter['y'])
    length = math.hypot(dx, dy)
    if length <= 1e-8:
        return False
    ux, uy = dx/length, dy/length
    sector['shotCounter']=sector.get('shotCounter',0)+1
    sector['shots'].append({'id':'shot-'+str(sector['shotCounter']),
                            'x': shooter['x']+12*ux, 'y': shooter['y']+12*uy,
                            'vx': shooter['vx']+SHOT_SPEED*ux,
                            'vy': shooter['vy']+SHOT_SPEED*uy,
                            'faction': faction, 'fromPlayer': faction == 'player',
                            'alive': True, 'born': at})
    shooter['ammo'] -= 1
    shooter['gunReady'] = at + (.27 if faction == 'player' else 2.5 if faction == 'ally' else 4.)
    return True


def change_velocity(body: dict, toward: dict, mu: float,
                    min_fuel: float = 1., max_range: float = 550.):
    if body.get('fuel', 0) <= min_fuel:
        return
    dist = distance(body, toward)
    if dist > max_range:
        return
    dx = toward['x']-body['x']
    dy = toward['y']-body['y']
    length = max(1., math.hypot(dx, dy))
    # Matching motion, with low continuous impulse budget and conserved propellant.
    dvx = max(-.08, min(.08, .18*dx/length+.015*(toward['vx']-body['vx'])))
    dvy = max(-.08, min(.08, .18*dy/length+.015*(toward['vy']-body['vy'])))
    # Tactical corrections also obey real engine acceleration and fuel flow.
    queue_burn(body, dvx, dvy, reserve_kg=max(12., min_fuel), reason='tactical')


def guide_fuel_donor(donor: dict, recipient: dict, mu: float,
                     when: float = 0., order: dict | None = None) -> bool:
    """Plan a delayed two-burn encounter, without altering velocity or fuel now.

    Exact Kepler coast predictions and Newton shooting choose affordable,
    body-clearing future intersections. Executing the result uses finite thrust.
    """
    if donor.get('burn') or donor.get('arrivalPhase') in ACTIVE_ARRIVAL or recipient.get('arrivalPhase') in ACTIVE_ARRIVAL:
        return False
    plan = plan_transfer(donor, recipient, mu)
    if plan is None:
        return False
    if order is not None:
        order['navigation'] = {
            **plan, 'phase': 'wait',
            'startAt': when + plan['wait'],
            'dueAt': when + plan['wait'] + plan['flight']
        }
    return True


def update_support_navigation(sector: dict, order: dict, donor: dict,
                              recipient: dict, when: float, mu: float):
    """Advance the transfer's wait / finite departure / coast / braking phases."""
    nav = order.get('navigation')
    if not nav:
        return
    if when > nav['dueAt'] + 16.:
        donor.pop('burn', None)
        order.pop('navigation', None)
        order['nextDecision'] = when + 8.
        event(sector, when, f"{donor['name']} missed its planned fuel rendezvous; replanning.", 'neutral')
        return
    phase = nav['phase']
    if phase == 'wait' and when >= nav['startAt']:
        dx, dy = nav['dv1']
        if queue_burn(donor, dx, dy, reserve_kg=30., reason='support-departure'):
            nav['phase'] = 'departure'
            event(sector, when, f"{donor['name']} started finite rendezvous departure burn.", 'neutral')
        else:
            # A zero-sized first burn is a legitimate coast start.
            nav['phase'] = 'coast' if math.hypot(dx, dy) < .025 else 'failed'
    elif phase == 'departure' and not donor.get('burn'):
        nav['phase'] = 'coast'
    elif phase == 'correction' and not donor.get('burn'):
        nav['phase']='coast'
    elif (phase == 'coast' and
          when < nav['dueAt'] - nav['burn2Sec'] - 8. and
          when >= nav['startAt']+nav['burn1Sec']+7. and
          nav.get('corrections',0) < 2 and
          when >= nav.get('nextCorrectionAt',0.)):
        # Reproject the physically flown (finite burn) trajectory and adjust
        # position error before terminal velocity matching.
        nav['nextCorrectionAt']=when+10.
        remaining=nav['dueAt']-when
        try:
            projected=propagate(state_of(donor),remaining,mu)
            destination=propagate(state_of(recipient),remaining,mu)
            ex=destination.x-projected.x
            ey=destination.y-projected.y
            mismatch=math.hypot(ex,ey)
            if mismatch>9. and donor['fuel']>45.:
                dvx=.65*ex/max(6.,remaining)
                dvy=.65*ey/max(6.,remaining)
                amplitude=math.hypot(dvx,dvy)
                if amplitude>1.:
                    dvx/=amplitude
                    dvy/=amplitude
                future=state_of(donor)
                safety=State(future.x,future.y,future.vx+dvx,future.vy+dvy,
                             future.mass_kg,future.fuel_kg)
                peri,_=orbital_envelope(safety,mu)
                if peri>BODY_RADIUS+12. and queue_burn(
                        donor,dvx,dvy,reserve_kg=35.,reason='support-midcourse'):
                    nav['phase']='correction'
                    nav['corrections']=nav.get('corrections',0)+1
                    event(sector,when,f"{donor['name']} correcting rendezvous "
                          f"trajectory ({mismatch:.1f} km projected miss).",'neutral')
        except (ValueError,OverflowError,ZeroDivisionError):
            pass
    elif phase == 'coast' and when >= nav['dueAt'] - nav['burn2Sec'] - 1.:
        # Terminal velocity matching, with a small bounded position correction
        # for the real departure burn's finite duration.
        dx, dy = nav['dv2']
        try:
            remain = max(1., nav['dueAt'] - when)
            coast = propagate(state_of(donor), remain, mu)
            future = propagate(state_of(recipient), remain, mu)
            residual_x = (future.x - coast.x) / max(8., remain)
            residual_y = (future.y - coast.y) / max(8., remain)
            correction = math.hypot(residual_x, residual_y)
            if correction > 1.5:
                residual_x *= 1.5/correction
                residual_y *= 1.5/correction
            dx += residual_x
            dy += residual_y
        except (ValueError, OverflowError):
            pass
        if queue_burn(donor, dx, dy, reserve_kg=30., reason='support-arrival'):
            nav['phase'] = 'arrival'
            event(sector, when, f"{donor['name']} started finite velocity-matching burn.", 'neutral')
        else:
            nav['phase'] = 'failed'
    elif phase == 'arrival' and not donor.get('burn'):
        nav['phase'] = 'complete'
    if nav['phase'] in ('failed', 'complete'):
        order.pop('navigation', None)
        order['nextDecision'] = when + (8. if nav['phase'] == 'failed' else 3.)


def support_orders(sector: dict, player: dict, allies: list[dict], enemies: list[dict],
                   when: float, mu: float, effects: dict):
    """Incremental autonomous support: select donors, match velocity, then transfer mass.

    Neither an NPC nor a client can mint propellant. Each donor retains a reserve;
    every transfer occurs only at a verified low-relative-speed rendezvous.
    """
    orders = sector.setdefault('assistance', [])
    groups = [(allies, 'friendly'), (enemies, 'raider')]
    involved = {o['recipient'] for o in orders}
    involved.update(o['donor'] for o in orders if o.get('donor'))
    for fleet, faction in groups:
        if len(fleet) < 2:
            continue
        for recipient in fleet:
            capacity = recipient.get('fuelMax', 170.)
            if not recipient.get('alive', True) or recipient['id'] in involved or recipient.get('fuel', 0) >= .18*capacity:
                continue
            donors = [b for b in fleet if b['id'] not in involved and b['id'] != recipient['id']
                      and b.get('alive', True) and b.get('arrivalPhase') not in ACTIVE_ARRIVAL
                      and b.get('fuel', 0) > max(55., .35*b.get('fuelMax', 170.))]
            if donors:
                donor = min(donors,key=lambda b:
                    (2000. if risk_report(b,[player,*allies,*enemies],mu)['level']!='nominal' else 0.)+
                    distance(b,recipient)+max(0.,90.-b['fuel'])*4.)
                orders.append({'recipient': recipient['id'], 'donor': donor['id'],
                               'faction': faction, 'createdAt': when, 'nextDecision': when})
                involved.update((recipient['id'], donor['id']))
                event(sector, when, f"{donor['name']} responding to {recipient['name']}'s low-fuel alert.", 'neutral')

    fleet = [player, *allies, *enemies]
    by_id = {body['id']: body for body in fleet}
    remaining = []
    reserved_donors = {o.get('donor') for o in orders if o.get('donor')}
    for order in orders:
        recipient = by_id.get(order['recipient'])
        if not recipient or not recipient.get('alive', True) or when-order['createdAt'] > 900:
            previous_donor = by_id.get(order.get('donor'))
            if previous_donor:
                previous_donor.pop('burn', None)
            continue
        if not order.get('donor'):
            candidates = [a for a in allies if a.get('alive', True) and
                          a['id'] not in reserved_donors and a['id'] != recipient['id']
                          and a.get('arrivalPhase') not in ACTIVE_ARRIVAL
                          and a.get('fuel', 0) > 55.]
            if candidates:
                used=set(order.get('usedDonors',[]))
                donor = min(candidates,key=lambda a:
                    (10000. if a['id'] in used and len(candidates)>len(used) else 0.)+
                    (2000. if risk_report(a,[player,*allies,*enemies],mu)['level']!='nominal' else 0.)+
                    distance(a,recipient)+max(0.,90.-a['fuel'])*4.)
                order['donor'] = donor['id']
                reserved_donors.add(donor['id'])
                event(sector,when,f"{donor['name']} assigned to refuel {recipient['name']}.",'neutral')
            else:
                remaining.append(order)
                continue
        donor = by_id.get(order['donor'])
        if not donor or not donor.get('alive', True):
            order['donor'] = None
            remaining.append(order)
            continue
        surplus = max(0., donor.get('fuel', 0.) - 30.)
        need = max(0., recipient.get('fuelMax', 200.)-recipient.get('fuel', 0.))
        if surplus < 2 or need < 1:
            donor.pop('burn', None)
            continue
        relative = math.hypot(donor['vx']-recipient['vx'], donor['vy']-recipient['vy'])
        if distance(donor, recipient) <= 18. and relative < 2.5:
            donor.pop('burn', None)
            moved = min(35., surplus, need)
            # Physically transfer propellant with donor inertial momentum.
            # The receiving ship accelerates toward the donor velocity; the
            # difference is dissipated as hose/grapple heat, not free Δv.
            incoming_x=donor['vx']-recipient['vx']
            incoming_y=donor['vy']-recipient['vy']
            receiver_mass=recipient.get('mass_kg',recipient.get('dryMass',1050.)+recipient['fuel'])
            ratio=moved/(receiver_mass+moved)
            dvx,dvy=ratio*incoming_x,ratio*incoming_y
            thermal_mj=.5*receiver_mass*moved/(receiver_mass+moved)*relative**2
            donor['fuel'] -= moved
            recipient['fuel'] += moved
            recipient['vx'] += dvx
            recipient['vy'] += dvy
            recipient['transferHeatMJ']=recipient.get('transferHeatMJ',0.)+thermal_mj
            if recipient.get('isPlayer'):
                effects['fuel'] += moved
                effects['player_dvx'] = effects.get('player_dvx',0.) + dvx
                effects['player_dvy'] = effects.get('player_dvy',0.) + dvy
                recipient['mass_kg'] = receiver_mass + moved
            event(sector, when, f"{donor['name']} transferred {moved:.1f} kg propellant to "
                  f"{recipient['name']} ({relative:.2f} km/s relative; {thermal_mj:.1f} MJ damped).", 'good')
            # A rescue does not silently terminate after the first 35 kg packet.
            # Other available craft may take the next transfer; no free fuel is
            # created and each packet still needs a real low-speed rendezvous.
            remaining_need=max(0.,.75*recipient.get('fuelMax',200.)-recipient['fuel'])
            if remaining_need > 5. and when-order['createdAt']<900:
                other_donors=[a for a in allies if a['id'] not in set([donor['id'],*order.get('usedDonors',[])])
                              and a['id']!=recipient['id']
                              and a.get('alive',True) and a.get('arrivalPhase') not in ACTIVE_ARRIVAL
                              and a.get('fuel',0.)>55.]
                if other_donors:
                    order.setdefault('usedDonors',[]).append(donor['id'])
                    order['donor']=None
                    order.pop('navigation',None)
                    order['nextDecision']=when+2.
                    remaining.append(order)
                    event(sector,when,f"{recipient['name']} still needs propellant; "
                          f"requesting a follow-up delivery from the friendly fleet.",'neutral')
            continue
        if not order.get('navigation') and not donor.get('burn') and when >= order.get('nextDecision', 0):
            planned = guide_fuel_donor(donor, recipient, mu, when, order)
            order['nextDecision'] = when + (20. if not planned else 6.)
            if planned:
                nav = order['navigation']
                event(sector, when, f"{donor['name']} planned fuel rendezvous with {recipient['name']}: "
                      f"{nav['deltaV']:.1f} km/s Δv across {nav['wait']+nav['flight']:.0f} s "
                      f"(estimated {nav['fuelKg']:.1f} kg propellant).", 'neutral')
        update_support_navigation(sector, order, donor, recipient, when, mu)
        remaining.append(order)
    sector['assistance'] = remaining


def advance_sector(sector: dict, seconds: float, start_player: State, mu: float = MU,
                   upgrades: dict | None = None):
    """Resolve all elapsed time on the server, including periods with zero clients.

    Uses adaptive time slices to bound long disconnections; swept collisions avoid
    tunnelling through fast-moving ships. This is a pilot-sector prototype.
    """
    if seconds <= 0:
        return sector, {'credits': 0, 'fuel': 0, 'player_dvx': 0., 'player_dvy': 0.,
                        'capture_cargo_mass':0., 'capture_heat_mj':0.}
    effects = {'credits': 0, 'fuel': 0, 'player_dvx': 0., 'player_dvy': 0.,
               'capture_cargo_mass':0., 'capture_heat_mj':0.}
    capture_limit = 8. if (upgrades or {}).get('capture') else 5.
    player = {**start_player.as_dict(), **sector['player'],
              'name': 'KESTREL-7', 'id': 'player', 'isPlayer': True,
              'fuel': start_player.fuel_kg,
              'dryMass': start_player.mass_kg-start_player.fuel_kg}
    elapsed = 0.
    time_step = max(.25, min(12., seconds / 15000))
    while elapsed < seconds-1e-8:
        dt = min(time_step, seconds-elapsed)
        cool_capture_system(player,dt)
        when = sector['t']+dt
        allies = [sector['ally'], *sector.get('allies', [])]
        bodies = [player, *allies, *sector['enemies']]
        previous = {b['id']: {k:b[k] for k in ('x','y')} for b in bodies if b.get('alive',True)}
        for pickup in sector['pickups']:
            if pickup.get('alive',True):
                previous[pickup['id']]={k:pickup[k] for k in ('x','y')}
        for index, shot in enumerate(sector['shots']):
            if shot.get('alive',True):
                previous['shot-'+str(index)]={k:shot[k] for k in ('x','y')}

        # Decisions and firing happen before motion; offline events are durable.
        support_orders(sector, player, allies, sector['enemies'], when, mu, effects)
        active_donors = {o.get('donor') for o in sector.get('assistance', [])}
        enemy_list=[b for b in sector['enemies'] if b.get('alive',True)]
        if when>=sector.get('nextTacticalCouncil',0.):
            previous_roles={a['id']:(a.get('tacticalRole'),a.get('tacticalTarget')) for a in allies}
            coordinate_allies(sector,player,allies,enemy_list,active_donors,mu)
            for ally in allies:
                before=previous_roles.get(ally['id'])
                now_role=(ally.get('tacticalRole'),ally.get('tacticalTarget'))
                if before!=now_role and ally.get('alive',True):
                    target=ally.get('tacticalTarget')
                    event(sector,when,f"{ally['name']} tactical role: {ally.get('tacticalRole','patrol')}"
                          +(f"; intercepting {target}." if target else "."),'neutral')
            sector['nextTacticalCouncil']=when+6.
        by_ship={body['id']:body for body in bodies}

        for ally in allies:
            if not ally.get('alive',True) or ally.get('arrivalPhase') in ACTIVE_ARRIVAL:
                continue
            chosen=by_ship.get(ally.get('tacticalTarget'))
            if not chosen or not chosen.get('alive',True) or chosen not in enemy_list:
                chosen=min(enemy_list,key=lambda e:distance(ally,e)) if enemy_list else None
            if chosen and distance(chosen,ally)<460:
                fire(sector,ally,chosen,when,'ally')
            if when>=ally.get('nextDecision',0.) and ally['id'] not in active_donors:
                danger=risk_report(ally,[player,*allies,*enemy_list],mu)
                ally['tacticalRisk']=danger['level']
                if evasive_burn(ally,danger,[player,*allies,*enemy_list],mu):
                    event(sector,when,f"{ally['name']} initiated finite evasive burn "
                          f"({danger['level']}).",'neutral')
                else:
                    if chosen and ally.get('fuel',0.)>75. and distance(ally,chosen)>160.:
                        change_velocity(ally,chosen,mu,min_fuel=45.,max_range=520.)
                ally['nextDecision']=when+7.

        for enemy in enemy_list:
            chosen=by_ship.get(enemy.get('tacticalTarget'))
            candidates=[b for b in (player,*allies) if b.get('alive',True)]
            if not chosen or not chosen.get('alive',True) or chosen not in candidates:
                chosen=choose_raider_target(enemy,player,allies,mu)
            if not chosen:
                continue
            if enemy.get('arrivalPhase') in (None,'orbiting','failed','missed'):
                if when>=enemy.get('nextDecision',0.):
                    chosen=choose_raider_target(enemy,player,allies,mu) or chosen
                    enemy['tacticalTarget']=chosen['id']
                    danger=risk_report(enemy,[player,*allies,*enemy_list],mu)
                    enemy['tacticalRisk']=danger['level']
                    if enemy['id'] not in active_donors:
                        if evasive_burn(enemy,danger,[player,*allies,*enemy_list],mu):
                            event(sector,when,f"{enemy['name']} initiated finite evasive burn "
                                  f"({danger['level']}).",'neutral')
                        else:
                            if enemy.get('fuel',0.)>35.:
                                change_velocity(enemy,chosen,mu,min_fuel=30.)
                    enemy['nextDecision']=when+7.
            if distance(enemy,chosen)<310:
                fire(sector,enemy,chosen,when,'raider')

        for body in bodies:
            if not body.get('alive',True):
                continue
            was_alive=body['alive']
            move(body,dt,mu)
            if was_alive and not body.get('alive',True):
                body['hp']=0
                event(sector,when,body['name']+' impacted Kestrel.','danger')
            if body.get('alive',True) and body.get('arrivalPhase') in ACTIVE_ARRIVAL:
                resolve_arrival(sector,body,mu,when)
        for pickup in sector['pickups']:
            move(pickup,dt,mu)

        for index,shot in enumerate(sector['shots']):
            if not shot.get('alive',True):
                continue
            previous.setdefault('shot-'+str(index),{k:shot[k] for k in ('x','y')})
            move(shot,dt,mu)
            if not shot['alive'] or when-shot['born'] > 30:
                shot['alive']=False
                continue
            targets = [player,*allies] if shot['faction']=='raider' else sector['enemies']
            for target in targets:
                if not target.get('alive',True):
                    continue
                start=previous.get(target['id'])
                if start and hit_swept(previous['shot-'+str(index)],shot,start,target,SHOT_RADIUS):
                    shot['alive']=False
                    damage=26 if shot['faction']=='player' else 18 if shot['faction']=='ally' else 10
                    target['hp']=max(0.,target['hp']-damage)
                    if target.get('isPlayer'):
                        event(sector,when,'KESTREL-7 hit! Hull '+str(round(target['hp']))+'%.','danger')
                    if target['hp']<=0:
                        destroy(sector,target,when,'projectile')
                        if shot['faction']=='player':
                            sector['playerKills']+=1
                    break

        alive=[b for b in bodies if b.get('alive',True)]
        for i,a in enumerate(alive):
            for b in alive[i+1:]:
                key=':'.join(sorted((a['id'],b['id'])))
                if sector['collisionCooldown'].get(key,0)>when:
                    continue
                if not hit_swept(previous[a['id']],a,previous[b['id']],b,SHIP_DIAMETER):
                    continue
                rvx=b['vx']-a['vx'];rvy=b['vy']-a['vy']
                rx=b['x']-a['x'];ry=b['y']-a['y']
                r=max(.001,math.hypot(rx,ry));nx,ny=rx/r,ry/r
                impact=abs(rvx*nx+rvy*ny)
                damage=min(95.,impact*6)
                a['hp']=max(0,a['hp']-damage);b['hp']=max(0,b['hp']-damage)
                # Equal-and-opposite momentum impulse, evaluated at contact.
                m1=a.get('mass_kg',a.get('dryMass',900)+a.get('fuel',0))
                m2=b.get('mass_kg',b.get('dryMass',1050)+b.get('fuel',0))
                j=-(1+.2)*(rvx*nx+rvy*ny)/(1/m1+1/m2)
                if j>0:
                    a['vx']-=j*nx/m1;a['vy']-=j*ny/m1
                    b['vx']+=j*nx/m2;b['vy']+=j*ny/m2
                    if a.get('isPlayer'):
                        effects['player_dvx']-=j*nx/m1;effects['player_dvy']-=j*ny/m1
                    if b.get('isPlayer'):
                        effects['player_dvx']+=j*nx/m2;effects['player_dvy']+=j*ny/m2
                sector['collisionCooldown'][key]=when+1.
                event(sector,when,f"{a['name']} collided with {b['name']}.",'danger')
                for body in (a,b):
                    if body['hp']<=0:
                        destroy(sector,body,when,'collision')

        # Server-validated physical salvage, never client-reported currency.
        if player.get('alive',True):
            for pickup in sector['pickups']:
                if not pickup.get('alive',True):
                    continue
                start_player_pos = previous.get('player')
                start_pickup_pos = previous.get(pickup['id'])
                encountered = (start_player_pos and start_pickup_pos and
                               hit_swept(start_player_pos, player, start_pickup_pos, pickup, 19.))
                if not encountered and distance(player, pickup) > 19.:
                    continue
                kind=pickup['type']
                amount=pickup['amount']
                # Materialize only what fits in storage. A partly emptied fuel
                # or parts container remains available for another attempt.
                fuel_need=min(amount,max(0.,200.-player['fuel'])) if kind=='fuel' else 0.
                spare_need=min(amount,max(0.,24.-player['repairParts'])) if kind=='parts' else 0.
                if kind=='fuel' and fuel_need < .00001:
                    continue
                if kind=='parts' and spare_need < .00001:
                    continue
                recovered = fuel_need if kind=='fuel' else spare_need if kind=='parts' else amount
                mass = payload_mass(pickup,recovered)
                decision = assess_capture(player,pickup,mass,bool((upgrades or {}).get('capture')))
                if not decision.ok:
                    if when-pickup.get('lastCaptureDeniedAt',-1e9) > 12.:
                        pickup['lastCaptureDeniedAt']=when
                        event(sector,when,f"Salvage {pickup['id']} flyby at "
                              f"{decision.relative_km_s:.1f} km/s; "
                              f"{decision.reason}.",'neutral')
                    continue
                gains=[]
                if kind=='credits':
                    effects['credits']+=amount
                    gains.append(f'+{amount} ¤')
                elif kind=='wreck':
                    effects['credits']+=50
                    player['ammo']+=12
                    spare=min(6.,max(0.,24.-player['repairParts']))
                    player['repairParts']+=spare
                    gains.extend(['+50 ¤','+12 rounds'])
                    if spare:gains.append(f'+{spare:.1f} kg spare parts')
                elif kind=='ammo':
                    player['ammo']+=amount
                    gains.append(f'+{amount} rounds')
                elif kind=='parts':
                    player['repairParts']+=spare_need
                    gains.append(f'+{spare_need:.1f} kg spare parts')
                elif kind=='fuel':
                    player['fuel']+=fuel_need
                    effects['fuel']+=fuel_need
                    gains.append(f'+{fuel_need:.1f} kg propellant')
                if not gains:
                    continue
                # Inelastic coupling: momentum is conserved across incoming mass
                # and KESTREL-7; lost relative kinetic energy is stored as heat.
                player['vx']+=decision.dvx
                player['vy']+=decision.dvy
                player['mass_kg']+=decision.mass_kg
                if kind!='fuel':
                    player['dryMass']+=decision.mass_kg
                    player['cargoKg']=player.get('cargoKg',0.)+decision.mass_kg
                    effects['capture_cargo_mass']+=decision.mass_kg
                effects['player_dvx']+=decision.dvx
                effects['player_dvy']+=decision.dvy
                player['captureHeatMJ']+=decision.heat_mj
                player['captureHeatProducedMJ']+=decision.heat_mj
                effects['capture_heat_mj']+=decision.heat_mj
                if kind in ('fuel','parts') and recovered < amount-.00001:
                    pickup['amount']=amount-recovered
                    # The remaining debris stays on its previous orbit.
                else:
                    pickup['alive']=False
                event(sector,when,f"KESTREL-7 captured {kind}: "
                      +', '.join(gains)+f". Absorbed {decision.heat_mj:.1f} MJ; "
                      f"momentum correction {math.hypot(decision.dvx,decision.dvy):.3f} km/s.",'good')
        sector['shots']=[shot for shot in sector['shots'] if shot.get('alive',True)]
        sector['pickups']=[p for p in sector['pickups'] if p.get('alive',True)]
        elapsed+=dt
        sector['t']=when
    for field in ('hp','ammo','repairParts','alive','gunReady','cargoKg',
                  'captureHeatMJ','captureRadiatedMJ','captureHeatProducedMJ','transferHeatMJ'):
        sector['player'][field]=player.get(field,0.)
    return sector,effects


def player_fire(sector: dict, player_state: State, at: float, dx: float, dy: float) -> bool:
    player={**player_state.as_dict(),**sector['player'], 'alive':sector['player']['alive']}
    player['ammo']=sector['player']['ammo']
    if not math.isfinite(dx) or not math.isfinite(dy):
        return False
    if not fire(sector,player,player,at,'player',(dx,dy)):
        return False
    sector['player']['ammo']=player['ammo']
    sector['player']['gunReady']=player['gunReady']
    return True
