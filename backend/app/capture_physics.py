"""Capturing orbital salvage with conserved linear momentum and heat accounting.

A grapple traps the moving payload inelastically: the combined spacecraft
velocity changes to the center-of-mass velocity, while the relative kinetic
energy becomes stored heat that must be radiated. This is still a 2D point-mass
engineering abstraction, not a detailed tether or structural-dynamics solver.
"""
from __future__ import annotations
from dataclasses import dataclass
import math

BASE_SPEED_KM_S = 5.
RIG_SPEED_KM_S = 8.
BASE_HEAT_MJ = 520.
RIG_HEAT_MJ = 1300.
BASE_PAYLOAD_KG = 150.
RIG_PAYLOAD_KG = 240.
COOLING_MJ_PER_S = 8.


@dataclass(frozen=True)
class Capture:
    ok: bool
    reason: str
    mass_kg: float = 0.
    dvx: float = 0.
    dvy: float = 0.
    heat_mj: float = 0.
    relative_km_s: float = 0.


def payload_mass(pickup: dict, recovered: float | None = None) -> float:
    """Physical captured mass; non-propellant items remain aboard as cargo."""
    kind=pickup.get('type')
    amount=float(pickup.get('amount',0.) if recovered is None else recovered)
    if kind=='fuel' or kind=='parts':
        return max(0.,amount)
    if kind=='ammo':
        return max(0.,amount)*.12  # kg per physical ballistic round + packing
    if kind=='credits':
        return 2.  # token cassette and protective housing
    if kind=='wreck':
        return float(pickup.get('massKg',120.))
    return 0.


def assess_capture(player: dict, pickup: dict, mass_kg: float, upgraded: bool) -> Capture:
    """Compute a *possible* inelastic capture before modifying any inventory."""
    if not player.get('alive',True) or mass_kg<=0. or not math.isfinite(mass_kg):
        return Capture(False,'No physical payload')
    max_mass=RIG_PAYLOAD_KG if upgraded else BASE_PAYLOAD_KG
    if mass_kg>max_mass:
        return Capture(False,f'Payload exceeds {max_mass:.0f} kg grapple rating')
    ship_mass=float(player.get('mass_kg',
                               player.get('dryMass',900.)+player.get('fuel',0.)))
    if ship_mass<=0.:
        return Capture(False,'Invalid spacecraft mass')
    rvx=pickup['vx']-player['vx']
    rvy=pickup['vy']-player['vy']
    relative=math.hypot(rvx,rvy)
    limit=RIG_SPEED_KM_S if upgraded else BASE_SPEED_KM_S
    if relative>=limit:
        return Capture(False,f'capture requires relative speed below {limit:g} km/s',
                       relative_km_s=relative)
    reduced=ship_mass*mass_kg/(ship_mass+mass_kg)
    energy_mj=.5*reduced*relative*relative  # kg * (km/s)^2 -> MJ
    capacity=RIG_HEAT_MJ if upgraded else BASE_HEAT_MJ
    heat=float(player.get('captureHeatMJ',0.))
    if heat+energy_mj>capacity+1e-8:
        return Capture(False,f'Heat sink capacity exceeded ({heat+energy_mj:.0f} / {capacity:.0f} MJ)',
                       relative_km_s=relative)
    ratio=mass_kg/(ship_mass+mass_kg)
    return Capture(True,'Captured',mass_kg,ratio*rvx,ratio*rvy,energy_mj,relative)


def cool_capture_system(player: dict, dt: float):
    current=max(0.,float(player.get('captureHeatMJ',0.)))
    cooling=min(current,COOLING_MJ_PER_S*max(0.,dt))
    player['captureHeatMJ']=current-cooling
    player['captureRadiatedMJ']=player.get('captureRadiatedMJ',0.)+cooling
