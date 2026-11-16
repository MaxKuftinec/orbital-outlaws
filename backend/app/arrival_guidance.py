"""Finite-thrust arrival, flyby and orbital insertion guidance.

Every maneuver is a burn command executed by the sector's normal physics clock.
A small, bounded numerical search chooses the post-burn orbit, and guidance
reassesses the real (not impulsively assumed) trajectory after each burn.
"""
from __future__ import annotations

import math

from .physics import orbital_envelope, finite_burn
from .npc_guidance import (_state, fuel_for_dv, queue_burn,
                           FLOW_KG_S, THRUST_N, SAFE_RADIUS_KM)

ACTIVE_ARRIVAL = frozenset(('launch','course_burn','course_trim',
                             'approach','insertion_burn','insertion_trim'))


def desired_approach(body: dict, mu: float) -> tuple[float, float]:
    """Inbound hyperbolic velocity for chosen periapsis and orbital sense."""
    x,y=body['x'],body['y']
    radius=max(1.,math.hypot(x,y))
    peri=body['insertionRadius']
    vinf=body['arrivalVInfinity']
    tangential=peri*math.sqrt(vinf**2+2*mu/peri)/radius
    inward=math.sqrt(max(0.,vinf**2+2*mu/radius-tangential**2))
    sign=body['orbitDirection']
    return (-inward*x/radius-sign*tangential*y/radius,
            -inward*y/radius+sign*tangential*x/radius)


def _preview(body: dict, dvx: float, dvy: float, mu: float,
             reserve: float) -> dict | None:
    """Test actual finite burn before allowing the NPC to commit its fuel."""
    state=_state(body)
    delta=math.hypot(dvx,dvy)
    if not .025 < delta < 105.:
        return None
    fuel=fuel_for_dv(state.mass_kg,delta)
    if fuel > state.fuel_kg-reserve or fuel <= 0.:
        return None
    duration=fuel/FLOW_KG_S
    if duration > 70.:
        return None
    direction=(dvx/delta,dvy/delta)
    try:
        # Sample the in-burn path, not just its final osculating orbit.
        for frac in (.25,.5,.75):
            during=finite_burn(state,duration*frac,mu,THRUST_N,FLOW_KG_S,
                               direction,step_s=.25)
            if math.hypot(during.x,during.y) <= SAFE_RADIUS_KM+4.:
                return None
        end=finite_burn(state,duration,mu,THRUST_N,FLOW_KG_S,direction,
                        step_s=.25)
        radius=math.hypot(end.x,end.y)
        peri,apo=orbital_envelope(end,mu)
        if not SAFE_RADIUS_KM+4. < radius < 10000. or peri <= SAFE_RADIUS_KM:
            return None
        angular=end.x*end.vy-end.y*end.vx
        if angular*body['orbitDirection'] <= 0:
            return None
        radial=(end.x*end.vx+end.y*end.vy)/max(1.,radius)
        return {'dv': (dvx,dvy), 'fuelKg':fuel,'duration':duration,
                'radius':radius,'radial':radial,'peri':peri,'apo':apo,
                'end':end}
    except (ValueError,OverflowError,ZeroDivisionError):
        return None


def _candidates(dvx: float, dvy: float):
    angle=math.atan2(dvy,dvx)
    speed=math.hypot(dvx,dvy)
    for scale in (.8,1.,1.18):
        for offset in (-.20,0.,.20):
            theta=angle+offset
            yield speed*scale*math.cos(theta),speed*scale*math.sin(theta)


def plan_course(body: dict, mu: float, reserve: float = 62.) -> dict | None:
    wanted=desired_approach(body,mu)
    base=(wanted[0]-body['vx'],wanted[1]-body['vy'])
    desired_peri=body['insertionRadius']
    winner=None
    for dvx,dvy in _candidates(*base):
        candidate=_preview(body,dvx,dvy,mu,reserve)
        if not candidate:
            continue
        # Periapsis accuracy and safety take precedence over small fuel gains.
        err=abs(math.log(candidate['peri']/desired_peri))
        score=8.*err+candidate['fuelKg']/140.+max(0.,candidate['radial'])/12.
        if winner is None or score < winner['score']:
            candidate['score']=score
            winner=candidate
    return winner


def plan_insertion(body: dict, mu: float, reserve: float = 20.) -> dict | None:
    radius=math.hypot(body['x'],body['y'])
    speed=math.sqrt(mu/radius)*body['orbitDirection']
    tx,ty=-body['y']/radius,body['x']/radius
    base=(speed*tx-body['vx'],speed*ty-body['vy'])
    desired=body['insertionRadius']
    winner=None
    for dvx,dvy in _candidates(*base):
        candidate=_preview(body,dvx,dvy,mu,reserve)
        if not candidate or candidate['apo'] is None:
            continue
        peri,apo=candidate['peri'],candidate['apo']
        eccentricity=(apo-peri)/max(1.,apo+peri)
        radius_error=abs(math.log(max(1.,(apo+peri)*.5)/desired))
        score=7.*eccentricity+2.*radius_error+candidate['fuelKg']/180.
        if winner is None or score < winner['score']:
            candidate['score']=score
            winner=candidate
    return winner


def _inserted(body: dict, mu: float) -> bool:
    try:
        peri,apo=orbital_envelope(_state(body),mu)
    except (ValueError,OverflowError):
        return False
    if apo is None or peri <= SAFE_RADIUS_KM+2:
        return False
    eccentricity=(apo-peri)/(apo+peri)
    return eccentricity < .22 and (apo+peri)*.5 < 2.*body['insertionRadius']


def _start(body: dict, plan: dict, reserve: float, phase: str,
           when: float, notify) -> bool:
    if not plan:
        return False
    if not queue_burn(body,*plan['dv'],reserve_kg=reserve,reason=phase):
        return False
    body['arrivalPhase']=phase
    body['burnStartedFuel']=body['fuel']
    body['nextArrivalDecision']=when+1.
    notify(f"{body['name']} initiated {phase.replace('_',' ')}: "
           f"finite {plan['duration']:.1f}s thrust, budget {plan['fuelKg']:.1f} kg.",'neutral')
    return True


def resolve_arrival(body: dict, mu: float, when: float, notify):
    """Advance guidance at physical flight state, never grant a free velocity change."""
    if not body.get('alive',True):
        return
    phase=body.get('arrivalPhase')
    if phase not in ACTIVE_ARRIVAL:
        return
    if phase=='launch':
        if when < body['courseBurnAt']:
            return
        if not _start(body,plan_course(body,mu),62.,'course_burn',when,notify):
            body['arrivalPhase']='failed'
            notify(f"{body['name']} could not plan an affordable, safe finite approach.",'danger')
        return
    if body.get('burn'):
        return
    if phase in ('course_burn','course_trim','insertion_burn','insertion_trim'):
        used=max(0.,body.get('burnStartedFuel',body['fuel'])-body['fuel'])
        notify(f"{body['name']} finished {phase.replace('_',' ')} "
               f"({used:.1f} kg propellant consumed).",'neutral')
        if phase.startswith('course'):
            body['arrivalPhase']='approach'
        else:
            if _inserted(body,mu):
                body['arrivalPhase']='orbiting'
                notify(f"{body['name']} completed finite-thrust orbital insertion.",'good')
                return
            body['arrivalPhase']='approach'
            body['insertionAttempts']=body.get('insertionAttempts',0)+1
            body['nextArrivalDecision']=when+2.
        return
    radius=math.hypot(body['x'],body['y'])
    radial=(body['x']*body['vx']+body['y']*body['vy'])/max(radius,1.)
    if body['arrivalIntent']=='flyby' and radial>0 and radius>650:
        body['arrivalPhase']='departed'
        notify(f"{body['name']} completed its unpowered Kestrel flyby.",'neutral')
        return
    if when < body.get('nextArrivalDecision',0.):
        return
    peri,apo=orbital_envelope(_state(body),mu)
    if radial>0 and radius>body['insertionRadius']+200:
        body['arrivalPhase']='departed' if body['arrivalIntent']=='flyby' else 'missed'
        notify(f"{body['name']} completed flyby without orbital capture.",'neutral')
        return
    if body['arrivalIntent']=='flyby':
        if not .75*body['insertionRadius'] <= peri <= 1.3*body['insertionRadius']:
            count=body.get('courseTrims',0)
            if count<3 and radius>body['insertionRadius']+110:
                body['courseTrims']=count+1
                _start(body,plan_course(body,mu,reserve=42.),42.,
                       'course_trim',when,notify)
        body['nextArrivalDecision']=when+8.
        return

    if _inserted(body,mu):
        body['arrivalPhase']='orbiting'
        notify(f"{body['name']} established a bound orbit under finite thrust.",'good')
        return

    target_r=body['insertionRadius']
    if radius<=SAFE_RADIUS_KM+17:
        body['arrivalPhase']='failed'
        notify(f"{body['name']} lost the safe insertion corridor.",'danger')
        return
    if body.get('insertionAttempts',0)>=4:
        body['arrivalPhase']='missed'
        notify(f"{body['name']} exhausted finite orbit-insertion corrections.",'danger')
        return
    current_speed=math.sqrt(mu/max(radius,1.))
    tx,ty=-body['y']/radius,body['x']/radius
    needed=math.hypot(current_speed*body['orbitDirection']*tx-body['vx'],
                      current_speed*body['orbitDirection']*ty-body['vy'])
    seconds=fuel_for_dv(_state(body).mass_kg,needed)/FLOW_KG_S
    time_to_peri=max(0.,(radius-target_r)/max(1.,-radial))
    # Start braking BEFORE periapsis: finite engines need a stopping distance.
    if radial<0 and radius<1200 and time_to_peri<=seconds*1.45+5.:
        plan=plan_insertion(body,mu)
        if plan and _start(body,plan,20.,
                           'insertion_burn' if not body.get('insertionAttempts')
                           else 'insertion_trim',when,notify):
            return
        # No affordable safe solution yet; attempt again in 2s.
        body['nextArrivalDecision']=when+2.
        return
    if radius<target_r+100 and radial<0:
        body['nextArrivalDecision']=when+1.
        return
    if peri<SAFE_RADIUS_KM+6. and radius<target_r+200:
        body['arrivalPhase']='failed'
        notify(f"{body['name']} has an unsafe periapsis and no safe correction.",'danger')
        return
    body['nextArrivalDecision']=when+4.
