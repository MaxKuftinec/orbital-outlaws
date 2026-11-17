"""Parent-star ephemeris and restricted star–planet–spacecraft gravity.

Coordinates stored by the existing game remain Kestrel-centered, with fixed
inertial axes. The planet follows an analytic circular orbit around its parent
star. A spacecraft feels the star's differential gravity: star acceleration
on the spacecraft MINUS star acceleration on the planet. This prevents the
planet's enormous common acceleration from destroying local orbits.

This is a planar restricted three-body model; the star's reflex motion and
planetary perturbation of the parent star are currently neglected.
"""
from __future__ import annotations

import math
from dataclasses import replace
from .physics import State, propagate

PLANET_MU = 310_000.
STAR_MU = 2_000_000_000.
STAR_RADIUS_KM = 4_500.
ORBIT_RADIUS_KM = 160_000.
START_PHASE = 0.4  # deterministic orientation for existing sector saves
ANGULAR_RATE = math.sqrt(STAR_MU / ORBIT_RADIUS_KM**3)
PERIOD_S = 2*math.pi / ANGULAR_RATE
# Hill-radius estimate: useful scale for deciding when Keplerian planning
# about Kestrel becomes unreliable.
HILL_RADIUS_KM = ORBIT_RADIUS_KM * (PLANET_MU / (3*STAR_MU))**(1/3)


def planet_ephemeris(at_s: float) -> dict:
    angle = START_PHASE + ANGULAR_RATE*at_s
    cs, sn = math.cos(angle), math.sin(angle)
    speed = ANGULAR_RATE*ORBIT_RADIUS_KM
    return {'x': ORBIT_RADIUS_KM*cs, 'y': ORBIT_RADIUS_KM*sn,
            'vx': -speed*sn, 'vy': speed*cs}


def star_from_planet(at_s: float) -> dict:
    planet = planet_ephemeris(at_s)
    return {k: -v for k, v in planet.items()}


def stellar_tide(x: float, y: float, at_s: float) -> tuple[float, float]:
    star = star_from_planet(at_s)
    dx, dy = x-star['x'], y-star['y']
    # Clamp inside star surface; collisions are handled separately.
    distance = max(STAR_RADIUS_KM, math.hypot(dx,dy))
    inv = 1/(distance**3)
    planet_inv = 1/(ORBIT_RADIUS_KM**3)
    return (-STAR_MU*dx*inv - STAR_MU*star['x']*planet_inv,
            -STAR_MU*dy*inv - STAR_MU*star['y']*planet_inv)


def acceleration(x: float, y: float, at_s: float, planet_mu: float = PLANET_MU) -> tuple[float,float]:
    r = max(1.,math.hypot(x,y))
    sx,sy = stellar_tide(x,y,at_s)
    return (-planet_mu*x/r**3 + sx, -planet_mu*y/r**3 + sy)


def star_collision(x: float,y: float, at_s: float) -> bool:
    star = star_from_planet(at_s)
    return math.hypot(x-star['x'],y-star['y']) <= STAR_RADIUS_KM


def propagate_local(start: State, elapsed_s: float, planet_mu: float,
                    start_s: float) -> State:
    """Kepler drift + symmetric stellar-tide kicks in the translated planet frame.

    Retains exact conic motion between tidal corrections and supports backwards
    projection for existing historical queries. For long offline gaps, coarse
    sampling of the weak tidal term is a documented approximation.
    """
    if not math.isfinite(elapsed_s) or not math.isfinite(start_s):
        raise ValueError('Invalid star-system time')
    if elapsed_s == 0:
        return start
    span = abs(elapsed_s)
    step_limit = 16. if span <= 120 else 40. if span <= 3600 else 90.
    steps = math.ceil(span / step_limit)
    dt = elapsed_s/steps
    body = start
    t = start_s
    for _ in range(steps):
        ax,ay = stellar_tide(body.x,body.y,t)
        kicked = replace(body, vx=body.vx+ax*dt/2, vy=body.vy+ay*dt/2)
        drift = propagate(kicked,dt,planet_mu)
        ax2,ay2 = stellar_tide(drift.x,drift.y,t+dt)
        body = replace(drift, vx=drift.vx+ax2*dt/2,
                       vy=drift.vy+ay2*dt/2)
        t += dt
    return body


def system_info(at_s: float) -> dict:
    planet=planet_ephemeris(at_s)
    return {'frame':'star-centered', 'time_s':at_s, 'star':{
              'id':'kestrel-primary','name':'VEYRA',
              'mu_km3_s2':STAR_MU,'radius_km':STAR_RADIUS_KM,
              'x':0.,'y':0.,'vx':0.,'vy':0.},
            'planet':{'id':'kestrel','name':'KESTREL',
              'mu_km3_s2':PLANET_MU,'radius_km':85., **planet},
            'orbit_radius_km':ORBIT_RADIUS_KM,
            'orbit_period_s':PERIOD_S,'hill_radius_km':HILL_RADIUS_KM}
