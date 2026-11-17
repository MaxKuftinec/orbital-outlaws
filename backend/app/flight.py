"""Server-authoritative, lease-limited manual flight controls (km, seconds, kg)."""
from math import ceil, cos, hypot, log, pi, remainder, sin
from .physics import State, propagate
from .star_system import acceleration as system_acceleration, propagate_local

LEASE_S = 0.4
GIMBAL_MAX = 28 * pi / 180


def advance(state: State, start_s: float, at_s: float, mu: float, control=None, expires_s: float = 0, *, system: bool = False) -> State:
    dt = at_s - start_s
    if dt < 0:
        raise ValueError('Cannot advance backwards')
    active = min(dt, max(0, expires_s - start_s)) if control else 0
    if active and (control['thrust'] or control['turn'] or control['stabilize']):
        state = burn_segment(state, active, mu, control, start_s=start_s, system=system)
    else:
        active = 0
    return (propagate_local(state,dt-active,mu,start_s+active) if system
            else propagate(state,dt-active,mu))


def burn_segment(state: State, duration: float, mu: float, control: dict, *, start_s: float = 0., system: bool = False) -> State:
    """Integrate input while its server-time lease is valid; no indefinite offline thrust."""
    if duration <= 0:
        return state
    n = ceil(duration / .025)
    dt = duration / n
    x, y, vx, vy = state.x, state.y, state.vx, state.vy
    mass, fuel, heading, omega = state.mass_kg, state.fuel_kg, state.heading, state.omega
    for i in range(n):
        sign = control['turn']
        if control['stabilize'] and abs(omega) > 1e-5:
            sign = -1 if omega > 0 else 1
        if sign and fuel > 0:
            used = min(fuel, .04 * dt)
            angular_acc = 2 * 2500 * 7 / (mass * 14**2 / 12)
            delta = sign * angular_acc * dt * used / (.04 * dt)
            omega = 0 if control['stabilize'] and omega * (omega + delta) <= 0 else omega + delta
            mass -= used
            fuel -= used
        heading = remainder(heading + omega * dt, 2 * pi)
        ax, ay = 0., 0.
        if control['thrust'] and fuel > 0:
            used = min(fuel, 5 * dt)
            after = mass - used
            dv = 320 * log(mass / after)
            direction = heading + max(-GIMBAL_MAX, min(GIMBAL_MAX, control['gimbal']))
            ax, ay = cos(direction) * dv / dt, sin(direction) * dv / dt
            mass, fuel = after, fuel - used
        r = hypot(x, y)
        gx, gy = (system_acceleration(x,y,start_s+i*dt,mu) if system else
                  (-mu*x/r**3, -mu*y/r**3))
        half_vx = vx + (gx + ax) * dt / 2
        half_vy = vy + (gy + ay) * dt / 2
        x += half_vx * dt
        y += half_vy * dt
        r = hypot(x, y)
        gx2,gy2 = (system_acceleration(x,y,start_s+(i+1)*dt,mu) if system else
                   (-mu*x/r**3, -mu*y/r**3))
        vx = half_vx + (gx2+ax)*dt/2
        vy = half_vy + (gy2+ay)*dt/2
    return State(x, y, vx, vy, mass, fuel, heading, omega)
