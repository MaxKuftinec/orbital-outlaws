"""Server-owned orbital transfer planning and finite-duration NPC main-engine burns.

This is a sampled, bounded two-burn rendezvous planner, NOT a global optimal
low-thrust solution. Guidance decisions are independent of the browser.
"""
from __future__ import annotations

import math
from .physics import State, propagate, orbital_envelope, finite_burn

MU = 310000.
EXHAUST_KM_S = 320.
THRUST_N = 1_600_000.
FLOW_KG_S = 5.
RESERVE_KG = 30.
SAFE_RADIUS_KM = 103.


def _state(body: dict) -> State:
    fuel = float(body.get('fuel', 0.))
    return State(body['x'], body['y'], body['vx'], body['vy'],
                 body.get('dryMass', 1050.) + fuel, fuel,
                 body.get('heading', 0.), body.get('omega', 0.))


def fuel_for_dv(mass_kg: float, delta_v_km_s: float) -> float:
    if mass_kg <= 0 or not math.isfinite(delta_v_km_s) or delta_v_km_s < 0:
        return math.inf
    return mass_kg * (-math.expm1(-delta_v_km_s / EXHAUST_KM_S))


def queue_burn(body: dict, vx: float, vy: float, *, reserve_kg: float = RESERVE_KG,
               reason: str = 'navigation') -> bool:
    """Schedule engine work, never change velocity or fuel instantaneously."""
    dv = math.hypot(vx, vy)
    if body.get('burn') or dv < 0.025 or not math.isfinite(dv):
        return False
    minimum = max(0., reserve_kg)
    if fuel_for_dv(_state(body).mass_kg, dv) > body.get('fuel', 0.)-minimum+1e-9:
        return False
    body['burn'] = {'direction': [vx/dv, vy/dv], 'remainingDv': dv,
                    'reserveKg': minimum, 'reason': reason}
    return True


def move_with_burn(body: dict, dt: float, mu: float) -> State:
    """Gravity and thrust act during the same integration interval.

    Fuel mass falls continuously with fixed mass flow. An incomplete burn
    persists for the next frame; any remainder of the frame coasts under gravity.
    """
    start = _state(body)
    command = body.get('burn')
    if not command:
        body['thrustVector'] = None
        return propagate(start, dt, mu)
    fuel_budget = max(0., start.fuel_kg-command.get('reserveKg', RESERVE_KG))
    needed = fuel_for_dv(start.mass_kg, command['remainingDv'])
    spent = min(FLOW_KG_S*dt, fuel_budget, needed)
    if spent <= 1e-9:
        body.pop('burn', None)
        body['thrustVector'] = None
        return propagate(start, dt, mu)
    duration = spent / FLOW_KG_S
    direction = tuple(command['direction'])
    result = finite_burn(start, duration, mu, THRUST_N, FLOW_KG_S, direction, step_s=.05)
    delivered = EXHAUST_KM_S * math.log(start.mass_kg / result.mass_kg)
    command['remainingDv'] = max(0., command['remainingDv']-delivered)
    body['thrustVector'] = {'x': direction[0], 'y': direction[1]}
    body['heading'] = math.atan2(direction[1], direction[0])
    if command['remainingDv'] < 1e-4 or result.fuel_kg <= command.get('reserveKg', RESERVE_KG)+1e-8:
        body.pop('burn', None)
        body['thrustVector'] = None
    if dt-duration > 1e-8:
        result = propagate(result, dt-duration, mu)
    return State(result.x, result.y, result.vx, result.vy,
                 result.mass_kg, result.fuel_kg, body.get('heading', 0.), 0.)


def _safe(start: State, duration: float, mu: float) -> bool:
    try:
        peri, _ = orbital_envelope(start, mu)
        if not math.isfinite(peri) or peri <= SAFE_RADIUS_KM:
            return False
        for t in (duration*.25, duration*.5, duration*.75, duration):
            s = propagate(start, t, mu)
            radius = math.hypot(s.x, s.y)
            if not SAFE_RADIUS_KM < radius < 6000.:
                return False
        return True
    except (ValueError, OverflowError, ZeroDivisionError):
        return False


def _shoot(start: State, target: State, flight: float, mu: float):
    """Newton shooting for a transfer that meets a predicted target position."""
    try:
        drift = propagate(start, flight, mu)
    except (ValueError, OverflowError):
        return None
    vx = start.vx+(target.x-drift.x)/flight
    vy = start.vy+(target.y-drift.y)/flight
    for _ in range(11):
        try:
            launched = State(start.x, start.y, vx, vy)
            arrived = propagate(launched, flight, mu)
            err_x = target.x-arrived.x
            err_y = target.y-arrived.y
            if math.hypot(err_x, err_y) < 1.0:
                if not _safe(launched, flight, mu):
                    return None
                dv1 = (vx-start.vx, vy-start.vy)
                dv2 = (target.vx-arrived.vx, target.vy-arrived.vy)
                return dv1, dv2, math.hypot(err_x, err_y)
            eps = .06
            ax = propagate(State(start.x, start.y, vx+eps, vy), flight, mu)
            ay = propagate(State(start.x, start.y, vx, vy+eps), flight, mu)
            a, b = (ax.x-arrived.x)/eps, (ay.x-arrived.x)/eps
            c, d = (ax.y-arrived.y)/eps, (ay.y-arrived.y)/eps
            determinant = a*d-b*c
            if abs(determinant) < 1e-7:
                return None
            step_x = (d*err_x-b*err_y)/determinant
            step_y = (-c*err_x+a*err_y)/determinant
            length = math.hypot(step_x, step_y)
            if length > 15.:
                step_x *= 15./length
                step_y *= 15./length
            vx += step_x
            vy += step_y
        except (ValueError, OverflowError, ZeroDivisionError):
            return None
    return None


def plan_transfer(donor: dict, recipient: dict, mu: float = MU,
                  waits: tuple[float, ...] = (0., 5., 12., 25., 45., 70.),
                  flights: tuple[float, ...] = (12., 20., 30., 44., 60., 82., 110., 150.)) -> dict | None:
    """Choose a safe, reachable future encounter rather than chasing today's position.

    Fuel affordability, two finite burn durations, a donor reserve, and a
    donation allowance are considered. The selected impulses are only *targets*:
    actual propulsion is simulated by move_with_burn over successive ticks.
    """
    if not donor.get('alive', True) or not recipient.get('alive', True):
        return None
    initial = _state(donor)
    target = _state(recipient)
    if initial.fuel_kg <= RESERVE_KG + 7.:
        return None
    best = None
    for wait in waits:
        try:
            departure = propagate(initial, wait, mu)
        except (ValueError, OverflowError):
            continue
        if not _safe(departure, 0., mu):
            continue
        for flight in flights:
            try:
                future = propagate(target, wait+flight, mu)
            except (ValueError, OverflowError):
                continue
            if math.hypot(future.x, future.y) <= SAFE_RADIUS_KM:
                continue
            solution = _shoot(departure, future, flight, mu)
            if solution is None:
                continue
            dv1, dv2, miss = solution
            first = math.hypot(*dv1)
            second = math.hypot(*dv2)
            total = first+second
            mass = initial.mass_kg
            burn1kg = fuel_for_dv(mass, first)
            burn2kg = fuel_for_dv(mass-burn1kg, second)
            fuel = burn1kg+burn2kg
            burn1s, burn2s = burn1kg/FLOW_KG_S, burn2kg/FLOW_KG_S
            # Avoid an impulsive plan that the real engine cannot execute in time.
            if burn1s+burn2s > .55*flight or burn2s > .32*flight:
                continue
            if fuel*1.15+RESERVE_KG+7. > initial.fuel_kg:
                continue
            score = fuel + .055*(wait+flight)
            if best is None or score < best['score']:
                best = {'dv1': list(dv1), 'dv2': list(dv2),
                        'deltaV': total, 'fuelKg': fuel,
                        'wait': wait, 'flight': flight,
                        'burn1Sec': burn1s, 'burn2Sec': burn2s,
                        'missKm': miss, 'score': score,
                        'arrival': [future.x, future.y]}
    return best
