"""Deterministic two-body (2D) orbital propagation and numerical finite burns.

Distances are km, velocities km/s, gravitational parameter km³/s².
The universal-variable method works for elliptical, parabolic, and hyperbolic orbits.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from math import sqrt, sin, cos, sinh, cosh, hypot, pi, remainder, isfinite


@dataclass(frozen=True)
class State:
    x: float
    y: float
    vx: float
    vy: float
    mass_kg: float = 1110.0
    fuel_kg: float = 200.0
    heading: float = 0.0
    omega: float = 0.0

    def as_dict(self) -> dict:
        return asdict(self)


def _stumpff(z: float) -> tuple[float, float]:
    if abs(z) < 1e-7:
        c = 0.5-z/24+z*z/720-z*z*z/40320
        s = 1/6-z/120+z*z/5040-z*z*z/362880
    elif z > 0:
        q = sqrt(z)
        c = (1-cos(q))/z
        s = (q-sin(q))/(q*q*q)
    else:
        q = sqrt(-z)
        c = (cosh(q)-1)/(-z)
        s = (sinh(q)-q)/(q*q*q)
    return c, s


def propagate(initial: State, elapsed_s: float, mu: float) -> State:
    """Exact (to numerical tolerance) Kepler propagation without stepping frames."""
    if not isfinite(elapsed_s) or not isfinite(mu) or mu <= 0:
        raise ValueError('Invalid propagation duration/gravitational parameter')
    if elapsed_s == 0:
        return initial
    r0 = hypot(initial.x, initial.y)
    if r0 <= 0:
        raise ValueError('Entity at gravity singularity')
    v2 = initial.vx**2+initial.vy**2
    vr0 = (initial.x*initial.vx+initial.y*initial.vy)/r0
    alpha = 2/r0-v2/mu
    sqrt_mu = sqrt(mu)
    dt = elapsed_s
    # Whole revolutions on bound Kepler orbits return to the identical state.
    if alpha > 1e-12:
        period = 2*pi/(sqrt_mu*alpha**1.5)
        dt = remainder(dt, period)
        if abs(dt) < 1e-13:
            return State(initial.x,initial.y,initial.vx,initial.vy,initial.mass_kg,initial.fuel_kg,
                         remainder(initial.heading+initial.omega*elapsed_s,2*pi),initial.omega)
    chi = (sqrt_mu*alpha*dt if alpha>1e-10 else sqrt_mu*dt/r0)
    # Newton iteration on universal Kepler equation.
    for _ in range(100):
        z = alpha*chi*chi
        c,s = _stumpff(z)
        eq = (r0*vr0/sqrt_mu)*chi*chi*c + (1-alpha*r0)*chi**3*s + r0*chi-sqrt_mu*dt
        deriv = (r0*vr0/sqrt_mu)*chi*(1-z*s) + (1-alpha*r0)*chi*chi*c + r0
        if abs(deriv) < 1e-12:
            raise ValueError('Degenerate Kepler propagation')
        change = eq/deriv
        chi -= change
        if abs(change) <= 1e-10*max(1,abs(chi)):
            break
    else:
        raise ValueError('Kepler solver did not converge')
    z=alpha*chi*chi
    c,s=_stumpff(z)
    f=1-(chi*chi/r0)*c
    g=dt-(chi**3/sqrt_mu)*s
    x=f*initial.x+g*initial.vx
    y=f*initial.y+g*initial.vy
    r=hypot(x,y)
    if r <= 0:
        raise ValueError('Propagation reached gravity singularity')
    fdot=sqrt_mu/(r*r0)*(alpha*chi**3*s-chi)
    gdot=1-(chi*chi/r)*c
    vx=fdot*initial.x+gdot*initial.vx
    vy=fdot*initial.y+gdot*initial.vy
    return State(x,y,vx,vy,initial.mass_kg,initial.fuel_kg,
                 remainder(initial.heading+initial.omega*elapsed_s,2*pi),initial.omega)


def orbital_envelope(state: State,mu: float) -> tuple[float, float | None]:
    """Conservative radial envelope; None apoapsis means unbound (infinite)."""
    r=hypot(state.x,state.y)
    v2=state.vx**2+state.vy**2
    energy=v2/2-mu/r
    h=state.x*state.vy-state.y*state.vx
    eccentricity=sqrt(max(0.0,1+2*energy*h*h/(mu*mu)))
    peri=h*h/(mu*(1+eccentricity))
    if energy>=0 or eccentricity>=1:
        return peri,None
    apo=h*h/(mu*(1-eccentricity))
    # Numerical round-off near circular trajectories is harmless with min/max.
    return min(peri,apo), max(peri,apo)


def apply_impulse(state: State, dvx: float, dvy: float, exhaust_km_s: float, reserve_kg: float = 0) -> State:
    """Instantaneous Δv command (engineering/test foundation, not a finite rocket burn)."""
    dv=hypot(dvx,dvy)
    if exhaust_km_s <= 0 or reserve_kg < 0:
        raise ValueError('Invalid rocket properties')
    from math import exp
    consumed=state.mass_kg*(1-exp(-dv/exhaust_km_s))
    if consumed > state.fuel_kg-reserve_kg+1e-9:
        raise ValueError('Insufficient usable propellant')
    return State(state.x,state.y,state.vx+dvx,state.vy+dvy,
                 state.mass_kg-consumed,state.fuel_kg-consumed,state.heading,state.omega)


def finite_burn(state: State, duration_s: float, mu: float, thrust_n: float,
                mass_flow_kg_s: float, direction: tuple[float, float], step_s: float = .05) -> State:
    """Proof-of-concept constant inertial thrust integration; includes gravity and mass loss.

    Attitude-control, gimbal and rotations are intentionally NOT modeled here yet.
    """
    from math import ceil
    if not 0 <= duration_s <= 120 or thrust_n < 0 or mass_flow_kg_s <= 0:
        raise ValueError('Invalid burn')
    ux,uy=direction
    norm=hypot(ux,uy)
    if norm < 1e-12:
        raise ValueError('Thrust direction required')
    ux/=norm;uy/=norm
    if mass_flow_kg_s*duration_s>state.fuel_kg+1e-9:
        raise ValueError('Not enough propellant')
    if duration_s==0:return state
    n=ceil(duration_s/step_s);dt=duration_s/n
    x,y,vx,vy,m,fuel=state.x,state.y,state.vx,state.vy,state.mass_kg,state.fuel_kg
    for _ in range(n):
        r=hypot(x,y)
        if r<=0:raise ValueError('Gravity singularity')
        ax=-mu*x/(r*r*r)+thrust_n*ux/(m*1000)
        ay=-mu*y/(r*r*r)+thrust_n*uy/(m*1000)
        x+=vx*dt+.5*ax*dt*dt
        y+=vy*dt+.5*ay*dt*dt
        mnext=m-mass_flow_kg_s*dt
        r=hypot(x,y)
        a2x=-mu*x/(r*r*r)+thrust_n*ux/(mnext*1000)
        a2y=-mu*y/(r*r*r)+thrust_n*uy/(mnext*1000)
        vx+=.5*(ax+a2x)*dt
        vy+=.5*(ay+a2y)*dt
        m=mnext
        fuel-=mass_flow_kg_s*dt
    return State(x,y,vx,vy,m,max(0,fuel),remainder(state.heading+state.omega*duration_s,2*pi),state.omega)
