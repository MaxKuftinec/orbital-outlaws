"""Pilot-sector authoritative NPC simulation with deterministic offline catch-up.

Kilometres, seconds and kilograms throughout. Live clients render the results;
they never submit NPC positions, damage or rewards.
"""
from __future__ import annotations

import math
import secrets
from .physics import State, propagate, apply_impulse

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
    return {**orbit, 'id': id, 'name': 'AEGIS-01' if ally else id.upper(),
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
    """Hyperbolic Kestrel approach with a specified periapsis and orbit sense."""
    x,y=body['x'],body['y']
    radius=math.hypot(x,y)
    peri=body['insertionRadius']
    vinf=body['arrivalVInfinity']
    tangential=peri*math.sqrt(vinf*vinf+2*mu/peri)/radius
    inward=math.sqrt(max(0.,vinf*vinf+2*mu/radius-tangential*tangential))
    orbit_sign=body['orbitDirection']
    return (-inward*x/radius-orbit_sign*tangential*y/radius,
            -inward*y/radius+orbit_sign*tangential*x/radius)


def resolve_arrival(sector: dict, body: dict, mu: float, when: float):
    """Intention-driven impulses: first aim an encounter, then optionally capture."""
    if not body.get('alive', True):
        return
    if body.get('arrivalPhase') == 'launch':
        if when < body['courseBurnAt']:
            return
        target_vx,target_vy=arrival_course(body,mu)
        dvx,dvy=target_vx-body['vx'],target_vy-body['vy']
        try:
            result=apply_impulse(state_of(body),dvx,dvy,320.,reserve_kg=100.)
        except ValueError:
            body['arrivalPhase']='failed'
            event(sector,when,body['name']+' lacks fuel for approach correction.', 'danger')
            return
        before=body['fuel']
        body['vx'],body['vy'],body['fuel']=result.vx,result.vy,result.fuel_kg
        body['arrivalPhase']='approach'
        event(sector,when,f"{body['name']} executed {body['arrivalIntent']} approach burn "
              f"(Δv {math.hypot(dvx,dvy):.1f} km/s; "
              f"{before-result.fuel_kg:.1f} kg propellant).",'neutral')
    if body.get('arrivalPhase') != 'approach':
        return
    radius=math.hypot(body['x'],body['y'])
    radial=(body['x']*body['vx']+body['y']*body['vy'])/radius
    if body['arrivalIntent']=='flyby':
        if radial>0 and radius>650:
            body['arrivalPhase']='departed'
            event(sector,when,body['name']+' completed its Kestrel flyby.','neutral')
        return
    if radius>body['insertionRadius']+24:
        if radial>0 and radius>body['insertionRadius']+80:
            body['arrivalPhase']='missed'
            event(sector,when,body['name']+' missed its orbit insertion window.','danger')
        return
    tangent_x,tangent_y=-body['y']/radius,body['x']/radius
    circular_speed=math.sqrt(mu/radius)*body['orbitDirection']
    dvx=circular_speed*tangent_x-body['vx']
    dvy=circular_speed*tangent_y-body['vy']
    before=body['fuel']
    try:
        result=apply_impulse(state_of(body),dvx,dvy,320.,reserve_kg=8.)
    except ValueError:
        body['arrivalPhase']='failed'
        event(sector,when,body['name']+' could not afford orbit insertion; flyby continues.','danger')
        return
    body['vx'],body['vy'],body['fuel']=result.vx,result.vy,result.fuel_kg
    body['arrivalPhase']='orbiting'
    sense='clockwise' if body['orbitDirection']>0 else 'counterclockwise'
    event(sector,when,f"{body['name']} entered a {radius:.0f} km {sense} orbit "
         f"(Δv {math.hypot(dvx,dvy):.1f} km/s; "
         f"{before-result.fuel_kg:.1f} kg propellant).",'good')


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
                                    'alive': True, 'gunReady': world_time},
            'events': [], 'reinforcements': False, 'nextEnemySpawn': world_time+75,
            'playerKills': 0, 'collisionCooldown': {}}


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
        result = propagate(state_of(body), dt, mu)
        for field in ('x', 'y', 'vx', 'vy', 'heading', 'omega'):
            body[field] = getattr(result, field)
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
        'phase': 0., 'alive': True
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


def change_velocity(body: dict, toward: dict, mu: float):
    if body.get('fuel', 0) < 1:
        return
    dist = distance(body, toward)
    if dist > 550:
        return
    dx = toward['x']-body['x']
    dy = toward['y']-body['y']
    length = max(1., math.hypot(dx, dy))
    # Matching motion, with low continuous impulse budget and conserved propellant.
    dvx = max(-.08, min(.08, .18*dx/length+.015*(toward['vx']-body['vx'])))
    dvy = max(-.08, min(.08, .18*dy/length+.015*(toward['vy']-body['vy'])))
    try:
        s = apply_impulse(state_of(body), dvx, dvy, 320.)
    except ValueError:
        return
    for field in ('vx', 'vy'):
        body[field] = getattr(s, field)
    body['fuel'] = s.fuel_kg


def advance_sector(sector: dict, seconds: float, start_player: State, mu: float = MU):
    """Resolve all elapsed time on the server, including periods with zero clients.

    Uses adaptive time slices to bound long disconnections; swept collisions avoid
    tunnelling through fast-moving ships. This is a pilot-sector prototype.
    """
    if seconds <= 0:
        return sector, {'credits': 0, 'fuel': 0, 'player_dvx': 0., 'player_dvy': 0.}
    effects = {'credits': 0, 'fuel': 0, 'player_dvx': 0., 'player_dvy': 0.}
    player = {**start_player.as_dict(), **sector['player'],
              'name': 'KESTREL-7', 'id': 'player', 'isPlayer': True,
              'fuel': start_player.fuel_kg,
              'dryMass': start_player.mass_kg-start_player.fuel_kg}
    elapsed = 0.
    time_step = max(.25, min(12., seconds / 15000))
    while elapsed < seconds-1e-8:
        dt = min(time_step, seconds-elapsed)
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
        enemy_list=[b for b in sector['enemies'] if b.get('alive',True)]
        for ally in allies:
            if not ally.get('alive',True) or ally.get('arrivalPhase')=='approach':
                continue
            if enemy_list:
                near=min(enemy_list,key=lambda b:distance(b,ally))
                if distance(near,ally)<460:
                    fire(sector,ally,near,when,'ally')
        for enemy in sector['enemies']:
            if not enemy.get('alive',True):
                continue
            candidates=[b for b in (player,*allies) if b.get('alive',True)]
            if not candidates:
                continue
            target=min(candidates,key=lambda b:distance(b,enemy))
            if enemy.get('arrivalPhase') not in ('approach','departed','failed'):
                if when>=enemy.get('nextDecision',0):
                    change_velocity(enemy,target,mu)
                    enemy['nextDecision']=when+7.
            if distance(enemy,target)<310:
                fire(sector,enemy,target,when,'raider')

        for body in bodies:
            if not body.get('alive',True):
                continue
            was_alive=body['alive']
            move(body,dt,mu)
            if was_alive and not body.get('alive',True):
                body['hp']=0
                event(sector,when,body['name']+' impacted Kestrel.','danger')
            if body.get('alive',True) and body.get('arrivalPhase') in ('launch','approach'):
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
                m1=a.get('dryMass',900)+a.get('fuel',0)
                m2=b.get('dryMass',1050)+b.get('fuel',0)
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
                if distance(player,pickup)>19 or math.hypot(
                    pickup['vx']-player['vx'],pickup['vy']-player['vy'])>=5:
                    continue
                kind=pickup['type'];amount=pickup['amount']
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
                    spare=min(amount,max(0.,24.-player['repairParts']))
                    if spare:
                        player['repairParts']+=spare
                        gains.append(f'+{spare:.1f} kg spare parts')
                elif kind=='fuel':
                    fuel=min(amount,max(0.,200-start_player.fuel_kg-effects['fuel']))
                    if fuel:
                        effects['fuel']+=fuel
                        gains.append(f'+{fuel:.1f} kg propellant')
                if not gains:
                    continue  # Keep full-capacity salvage in the world for later.
                pickup['alive']=False
                event(sector,when,f"KESTREL-7 recovered {kind}: "
                      +', '.join(gains)+'.','good')
        sector['shots']=[shot for shot in sector['shots'] if shot.get('alive',True)]
        sector['pickups']=[p for p in sector['pickups'] if p.get('alive',True)]
        elapsed+=dt
        sector['t']=when
    for field in ('hp','ammo','repairParts','alive','gunReady'):
        sector['player'][field]=player[field]
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
