"""One-armed finite-force salvage capture (Newtonian 2D approximation).

A tether can PULL but never push. The winch reels the payload using bounded
tension applied to both bodies over time, preserving linear momentum at every
step. Motion damping converts mechanical energy to heat; powered reeling tracks
motor work. Captures can fail due to rope length, structural fatigue, or heat.
The 19 km line is a deliberate gameplay-scale abstraction, not a real-world
spacecraft capture-arm dimension.
"""
from __future__ import annotations

from dataclasses import dataclass
import math

from .capture_physics import (assess_capture, BASE_HEAT_MJ, RIG_HEAT_MJ)

LINE_LENGTH_KM=19.
LATCH_DISTANCE_KM=.7
LATCH_RELATIVE_KM_S=.65
BASE_TENSION_N=2_200.
RIG_TENSION_N=12_000.
BASE_BREAK_N=6_000.
RIG_BREAK_N=30_000.
MAX_TETHER_SECONDS=110.
FATIGUE_LIMIT_SECONDS=55.


@dataclass(frozen=True)
class TetherStep:
    status: str
    reason: str = ''
    player_dvx: float = 0.
    player_dvy: float = 0.
    pickup_dvx: float = 0.
    pickup_dvy: float = 0.
    heat_mj: float = 0.
    motor_mj: float = 0.


def begin_tether(player: dict, pickup: dict, selected_mass: float,
                 when: float, upgraded: bool) -> tuple[dict | None, str]:
    decision=assess_capture(player,pickup,selected_mass,upgraded)
    if not decision.ok:
        return None, decision.reason
    # A capture is voluntary only in the abstracted auto-grapple system.
    # Refuse obviously impossible contact *before* attaching and penalizing
    # the pilot: the winch cannot safely arrest outward radial motion with
    # less line than the required minimum stopping distance.
    dx=pickup['x']-player['x']
    dy=pickup['y']-player['y']
    separation=math.hypot(dx,dy)
    if separation>LINE_LENGTH_KM:
        return None,'Outside grapple reach'
    relative_x=pickup['vx']-player['vx']
    relative_y=pickup['vy']-player['vy']
    relative=math.hypot(relative_x,relative_y)
    if separation>1.e-7:
        nx,ny=dx/separation,dy/separation
    elif relative>1.e-7:
        nx,ny=relative_x/relative,relative_y/relative
    else:
        nx,ny=1.,0.
    radial=max(0.,relative_x*nx+relative_y*ny)
    ship_mass=float(player.get('mass_kg',player.get('dryMass',900.)+player.get('fuel',0.)))
    reduced=ship_mass*selected_mass/(ship_mass+selected_mass)
    rated=RIG_TENSION_N if upgraded else BASE_TENSION_N
    braking=reduced*1000.*radial*radial/(2.*rated)
    remaining=LINE_LENGTH_KM-separation
    if braking+.25>remaining:
        return None,(f'Unsafe automatic grapple: needs at least {braking:.1f} km '
                     f'braking distance but only {remaining:.1f} km line remains')
    return {'pickupId':pickup['id'], 'massKg':selected_mass,
            'startedAt':when, 'durationS':0., 'tensionN':0.,
            'peakTensionN':0.,'fatigueS':0.,'heatMJ':0.,
            'motorMJ':0., 'status':'reeling'}, ''


def step_tether(player: dict, pickup: dict, tether: dict,
                dt: float, upgraded: bool) -> TetherStep:
    if not player.get('alive',True) or not pickup.get('alive',True):
        return TetherStep('broken','lost grapple attachment')
    payload_mass=tether['massKg']
    ship_mass=float(player.get('mass_kg',
                       player.get('dryMass',900.)+player.get('fuel',0.)))
    if ship_mass<=0 or payload_mass<=0:
        return TetherStep('broken','invalid grapple mass')
    reduced=ship_mass*payload_mass/(ship_mass+payload_mass)
    dx=pickup['x']-player['x']
    dy=pickup['y']-player['y']
    distance=math.hypot(dx,dy)
    rvx=pickup['vx']-player['vx']
    rvy=pickup['vy']-player['vy']
    relative=math.hypot(rvx,rvy)
    if distance <= LATCH_DISTANCE_KM and relative <= LATCH_RELATIVE_KM_S:
        tether['tensionN']=0.
        return TetherStep('captured')
    if dt<=0.:
        return TetherStep('reeling')
    if tether.get('durationS',0.)>MAX_TETHER_SECONDS:
        return TetherStep('broken','capture arm timed out')
    if distance > LINE_LENGTH_KM:
        return TetherStep('broken','tether overextended')
    if distance < 1e-7:
        nx,ny=(rvx/relative,rvy/relative) if relative>1e-7 else (1.,0.)
    else:
        nx,ny=dx/distance,dy/distance
    radial=rvx*nx+rvy*ny
    rated=RIG_TENSION_N if upgraded else BASE_TENSION_N
    breaking=RIG_BREAK_N if upgraded else BASE_BREAK_N
    # A finite winch commands a slow inward radial velocity, avoiding the
    # unrealistically instantaneous capture of the original magnetic grapple.
    inward_goal=-min(.36,max(0.,distance-LATCH_DISTANCE_KM)*.20)
    usable_dt=max(.025,dt)
    needed=max(0.,reduced*1000.*(radial-inward_goal)/usable_dt)
    stopping_km=reduced*1000.*max(0.,radial)**2/(2.*rated)
    if (radial>0. and distance+stopping_km>LINE_LENGTH_KM+.05) or (
            needed>breaking and distance>LINE_LENGTH_KM*.85):
        return TetherStep('broken','overload: insufficient line braking distance')
    tension=min(rated,needed)
    # Internal tension cannot create linear momentum, even if the winch fails.
    heat=max(0.,tension*radial*usable_dt/1000.)
    motor=max(0.,-tension*radial*usable_dt/1000.)
    capacity=RIG_HEAT_MJ if upgraded else BASE_HEAT_MJ
    if player.get('captureHeatMJ',0.)+heat>capacity:
        return TetherStep('broken','grapple heat sink overloaded')
    accumulated=tether.get('fatigueS',0.)+(tension/rated)**2*usable_dt
    if accumulated>FATIGUE_LIMIT_SECONDS:
        return TetherStep('broken','tether fatigue limit exceeded')
    impulse=tension*usable_dt/1000.
    ship_dv=impulse/ship_mass
    payload_dv=impulse/payload_mass
    pdx,pdy=ship_dv*nx,ship_dv*ny
    bdx,bdy=-payload_dv*nx,-payload_dv*ny
    player['vx']+=pdx
    player['vy']+=pdy
    pickup['vx']+=bdx
    pickup['vy']+=bdy
    tether['durationS']=tether.get('durationS',0.)+usable_dt
    tether['tensionN']=tension
    tether['peakTensionN']=max(tether.get('peakTensionN',0.),tension)
    tether['fatigueS']=accumulated
    tether['heatMJ']=tether.get('heatMJ',0.)+heat
    tether['motorMJ']=tether.get('motorMJ',0.)+motor
    player['captureHeatMJ']=player.get('captureHeatMJ',0.)+heat
    player['captureHeatProducedMJ']=player.get('captureHeatProducedMJ',0.)+heat
    player['captureMotorMJ']=player.get('captureMotorMJ',0.)+motor
    return TetherStep('reeling',player_dvx=pdx,player_dvy=pdy,
                      pickup_dvx=bdx,pickup_dvy=bdy,heat_mj=heat,motor_mj=motor)
