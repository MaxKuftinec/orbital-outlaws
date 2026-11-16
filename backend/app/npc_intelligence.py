"""Risk-aware 2D tactical coordination for NPC fleets.

Decisions are deterministic for a given sector checkpoint and time, are
computed from predicted Kepler positions, and execute via finite burns.
This is bounded tactical reasoning, not a complete strategy-game planner.
"""
from __future__ import annotations

import math
from .physics import propagate, orbital_envelope, State
from .npc_guidance import _state, queue_burn, RESERVE_KG, SAFE_RADIUS_KM


def _at(body: dict, seconds: float, mu: float):
    try:
        return propagate(_state(body),seconds,mu)
    except (ValueError,OverflowError):
        return None


def risk_report(body: dict, companions: list[dict], mu: float, horizon: float = 12.) -> dict:
    """Screen dangerous future periapses and short-range close approaches."""
    state=_state(body)
    try:
        peri,_=orbital_envelope(state,mu)
    except (ValueError,OverflowError):
        peri=0.
    danger={'periKm':peri,'threat':None,'closestKm':float('inf'),
            'timeToThreatS':None, 'level':'nominal'}
    if peri<SAFE_RADIUS_KM:
        danger['level']='orbit-impact'
    candidates=[x for x in companions
                if x.get('alive',True) and x.get('id')!=body.get('id')]
    for seconds in (2.,4.,7.,horizon):
        a=_at(body,seconds,mu)
        if a is None:
            danger['level']='orbit-impact'
            break
        for other in candidates:
            b=_at(other,seconds,mu)
            if b is None:
                continue
            range_km=math.hypot(a.x-b.x,a.y-b.y)
            if range_km < danger['closestKm']:
                danger['closestKm']=range_km
                danger['threat']=other['id']
                danger['timeToThreatS']=seconds
            relative=math.hypot(a.vx-b.vx,a.vy-b.vy)
            if range_km<14. and relative>1.5:
                danger['level']='collision'
    return danger


def evasive_burn(body: dict, report: dict, companions: list[dict],
                 mu: float) -> bool:
    """Small finite avoidance burn; forbid outcomes with unsafe periapsis."""
    if body.get('burn') or body.get('fuel',0.)<RESERVE_KG+8.:
        return False
    if report['level']=='orbit-impact':
        x,y=body['x'],body['y']
        r=max(1.,math.hypot(x,y))
        sign=1 if x*body['vy']-y*body['vx']>=0 else -1
        dx,dy=-sign*y/r*1.2,sign*x/r*1.2
    elif report['level']=='collision':
        other=next((b for b in companions if b.get('id')==report['threat']),None)
        if not other:
            return False
        vx=body['vx']-other['vx'];vy=body['vy']-other['vy']
        speed=max(1e-6,math.hypot(vx,vy))
        dx,dy=-vy/speed*.8,vx/speed*.8
    else:
        return False
    start=_state(body)
    try:
        projected=State(start.x,start.y,start.vx+dx,start.vy+dy,
                        start.mass_kg,start.fuel_kg)
        peri,_=orbital_envelope(projected,mu)
        if peri<=SAFE_RADIUS_KM:
            return False
    except (ValueError,OverflowError):
        return False
    return queue_burn(body,dx,dy,reserve_kg=RESERVE_KG,reason='evasion')


def _future_range(a: dict, b: dict, mu: float, seconds: float = 8.) -> float:
    p=_at(a,seconds,mu)
    q=_at(b,seconds,mu)
    if p is None or q is None:
        return math.hypot(a['x']-b['x'],a['y']-b['y'])
    return math.hypot(p.x-q.x,p.y-q.y)


def choose_tactical_target(attacker: dict, candidates: list[dict],
                           priority: dict[str,float], mu: float) -> dict | None:
    live=[b for b in candidates if b.get('alive',True)]
    if not live:
        return None
    def rank(target):
        current=math.hypot(attacker['x']-target['x'],attacker['y']-target['y'])
        future=_future_range(attacker,target,mu)
        vulnerability=(100.-target.get('hp',100.))/60.
        return .4*current+.6*future-60.*vulnerability+priority.get(target['id'],0.)
    return min(live,key=rank)


def coordinate_allies(sector: dict, player: dict, allies: list[dict],
                      enemies: list[dict], busy: set, mu: float):
    """One target allocation per defense interval avoids everyone chasing the same raider."""
    hostiles=[e for e in enemies if e.get('alive',True)]
    allocated: dict[str,int]={}
    for ally in sorted(allies,key=lambda b:b['id']):
        if not ally.get('alive',True):
            continue
        if ally.get('id') in busy:
            ally['tacticalRole']='rescue'
            ally['tacticalTarget']=None
            continue
        if ally.get('arrivalPhase') in ('launch','course_burn','course_trim',
                                       'approach','insertion_burn','insertion_trim'):
            ally['tacticalRole']='navigation'
            continue
        cost={}
        for threat in hostiles:
            proximity_to_player=(_future_range(threat,player,mu)
                                 if player.get('alive',True) else 900.)
            # Defend the pilot first; assign surplus escorts to uncovered raiders.
            cost[threat['id']]=allocated.get(threat['id'],0)*105. - max(0.,450.-proximity_to_player)*.45
        chosen=choose_tactical_target(ally,hostiles,cost,mu)
        ally['tacticalRole']='intercept' if chosen else 'patrol'
        ally['tacticalTarget']=chosen['id'] if chosen else None
        if chosen:
            allocated[chosen['id']]=allocated.get(chosen['id'],0)+1


def choose_raider_target(raider: dict, player: dict, allies: list[dict],
                         mu: float) -> dict | None:
    candidates=[player,*allies]
    priority={'player':-95.} if player.get('alive',True) else {}
    return choose_tactical_target(raider,candidates,priority,mu)
