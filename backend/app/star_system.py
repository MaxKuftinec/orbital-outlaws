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

# Legacy physical collision radius; encounter simulation uses the same value.
PLANET_COLLISION_RADIUS_KM = 91.0


class CelestialImpact(Exception):
    """A physical surface crossing, distinct from a numerical propagation error."""

    def __init__(self, body: str, at_s: float, state: State):
        super().__init__(f"Spacecraft impacted {body} at t={at_s:.6f} s")
        self.body, self.at_s, self.state = body, at_s, state



# K2V Veyra: approximate but internally consistent main-sequence star.
# Solar conversion values from JPL/IAU; parameters are design assumptions.
SOLAR_MU = 132_712_440_018.
AU_KM = 149_597_870.7
SOLAR_RADIUS_KM = 695_700.
STAR_MASS_SOLAR = .82
STAR_RADIUS_SOLAR = .78
STAR_LUMINOSITY_SOLAR = .40
STAR_MU = STAR_MASS_SOLAR * SOLAR_MU
STAR_RADIUS_KM = STAR_RADIUS_SOLAR * SOLAR_RADIUS_KM
STAR_EFFECTIVE_TEMPERATURE_K = 5772 * (STAR_LUMINOSITY_SOLAR / STAR_RADIUS_SOLAR**2)**.25
ORBIT_RADIUS_KM = .40 * AU_KM
NERIS_ORBIT_KM = .65 * AU_KM  # Proposed only, no gravity or encounter object yet
NERIS_PERIOD_S = 2 * math.pi * math.sqrt(NERIS_ORBIT_KM**3 / STAR_MU)
PLANET_MU = 310_000.
# Kestrel's current 85-km rendered/collision radius is a LEGACY gameplay
# value, physically incompatible with its ~0.78 Earth mass. Planetary radius
# and saved orbital coordinates require a separately versioned migration.
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
                    start_s: float, *, detect_impact: bool = False) -> State:
    """Symmetric stellar-tide kicks and Kepler drift, with optional surface interception.

    Live player flights use adaptive forward steps near Kestrel so a plunge
    terminates at its physical surface rather than at the Kepler singularity.
    Backward and ordinary trajectory queries preserve the previous propagator.
    """
    if not math.isfinite(elapsed_s) or not math.isfinite(start_s):
        raise ValueError('Invalid star-system time')
    radius = PLANET_COLLISION_RADIUS_KM
    if detect_impact and math.hypot(start.x, start.y) <= radius:
        raise CelestialImpact('kestrel', start_s, start)
    if elapsed_s == 0:
        return start
    span = abs(elapsed_s)
    step_limit = 16. if span <= 120 else 40. if span <= 3600 else 90.
    if not detect_impact or elapsed_s < 0:
        steps = math.ceil(span / step_limit)
        dt = elapsed_s / steps
        body, t = start, start_s
        for _ in range(steps):
            ax, ay = stellar_tide(body.x, body.y, t)
            kicked = replace(body, vx=body.vx+ax*dt/2, vy=body.vy+ay*dt/2)
            drift = propagate(kicked, dt, planet_mu)
            ax2, ay2 = stellar_tide(drift.x, drift.y, t+dt)
            body = replace(drift, vx=drift.vx+ax2*dt/2,
                           vy=drift.vy+ay2*dt/2)
            t += dt
        return body

    body, t, finish = start, start_s, start_s + elapsed_s
    while t < finish - 1e-10:
        r = math.hypot(body.x, body.y)
        if r <= radius:
            raise CelestialImpact('kestrel', t, body)
        if star_collision(body.x, body.y, t):
            raise CelestialImpact('veyra', t, body)
        # Bound position changes near the surface to prevent tunneling.
        speed = max(math.hypot(body.vx, body.vy),
                    math.sqrt(planet_mu / r), 1e-6)
        dt = min(finish-t, step_limit, 0.15*r/speed)
        ax, ay = stellar_tide(body.x, body.y, t)
        while True:
            kicked = replace(body, vx=body.vx+ax*dt/2, vy=body.vy+ay*dt/2)
            try:
                drift = propagate(kicked, dt, planet_mu)
                break
            except (ValueError, OverflowError):
                # Retry smaller intervals, without declaring a false impact.
                if dt <= 1e-5:
                    raise
                dt /= 2
        if math.hypot(drift.x, drift.y) <= radius:
            low, high, impact = 0., dt, drift
            for _ in range(32):
                mid = (low + high) / 2
                candidate = propagate(kicked, mid, planet_mu)
                if math.hypot(candidate.x, candidate.y) <= radius:
                    high, impact = mid, candidate
                else:
                    low = mid
            scale = radius / math.hypot(impact.x, impact.y)
            impact = replace(impact, x=impact.x*scale, y=impact.y*scale)
            raise CelestialImpact('kestrel', t+high, impact)
        if star_collision(drift.x, drift.y, t+dt):
            raise CelestialImpact('veyra', t+dt, drift)
        ax2, ay2 = stellar_tide(drift.x, drift.y, t+dt)
        body = replace(drift, vx=drift.vx+ax2*dt/2, vy=drift.vy+ay2*dt/2)
        t += dt
    return body


def system_info(at_s: float) -> dict:
    planet=planet_ephemeris(at_s)
    return {'frame':'star-centered', 'time_s':at_s, 'star':{
              'id':'kestrel-primary','name':'VEYRA',
              'mu_km3_s2':STAR_MU,'radius_km':STAR_RADIUS_KM,
              'mass_solar':STAR_MASS_SOLAR,'radius_solar':STAR_RADIUS_SOLAR,
              'luminosity_solar':STAR_LUMINOSITY_SOLAR,
              'effective_temperature_k':STAR_EFFECTIVE_TEMPERATURE_K,
              'spectral_class':'K2V',
              'x':0.,'y':0.,'vx':0.,'vy':0.},
            'planet':{'id':'kestrel','name':'KESTREL',
              'mu_km3_s2':PLANET_MU,'radius_km':85., **planet},
            'orbit_radius_km':ORBIT_RADIUS_KM,
            'orbit_period_s':PERIOD_S,'hill_radius_km':HILL_RADIUS_KM,
            'physical_model':'K2V star with planet-relative legacy encounter geometry',
            'neris_design_orbit_km':NERIS_ORBIT_KM,
            'neris_design_period_s':NERIS_PERIOD_S}
