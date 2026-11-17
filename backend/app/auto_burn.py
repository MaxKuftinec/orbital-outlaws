"""Persistent, server-authoritative finite engine burn guidance.

State uses Kestrel-relative km and km/s with fixed inertial X/Y axes. The
navigator's reference affects the desired *direction*, never the physics.
Plan progress is checkpointed in PostgreSQL independently of browser lifetime.
"""
from __future__ import annotations

import math
from .flight import GIMBAL_MAX, burn_segment
from .physics import State, propagate
from .star_system import planet_ephemeris, propagate_local

ENGINE_FLOW_KG_S = 5.
MAX_IGNITION_S = 40.
MAX_ALIGNMENT_S = 25.
STEP_S = .05
MIN_FUEL_MARGIN = 1e-6
PLAN_STATES = ('aligning', 'burning', 'completed', 'aborted', 'failed')
ACTIVE_STATES = ('aligning', 'burning')
DIRECTIONS = ('prograde', 'retrograde', 'radial_out', 'radial_in', 'heading', 'angle')
REFERENCES = ('kestrel', 'veyra')


def validate_plan(direction: str, reference: str, cutoff: str,
                  duration_s: float | None, fuel_floor_kg: float | None,
                  angle_deg: float | None, reserve_kg: float, fuel_kg: float,
                  heading: float) -> dict:
    if direction not in DIRECTIONS or reference not in REFERENCES:
        raise ValueError('Unknown direction or reference frame')
    if cutoff not in ('duration', 'fuel'):
        raise ValueError('Choose a time or fuel cutoff')
    if direction == 'angle':
        if angle_deg is None or not math.isfinite(angle_deg) or not -360 <= angle_deg <= 360:
            raise ValueError('Custom angle must be between -360° and +360°')
    elif angle_deg is not None:
        raise ValueError('Custom angle only applies to angle mode')
    if not all(math.isfinite(v) for v in (reserve_kg, fuel_kg, heading)):
        raise ValueError('Invalid flight state')
    if cutoff == 'duration':
        if duration_s is None or not math.isfinite(duration_s) or not 0.05 <= duration_s <= MAX_IGNITION_S:
            raise ValueError('Burn duration must be between 0.05 and 40 seconds')
        if fuel_floor_kg is not None:
            raise ValueError('Fuel floor applies only to fuel cutoff mode')
    else:
        if fuel_floor_kg is None or not math.isfinite(fuel_floor_kg) or not 0 <= fuel_floor_kg <= 200:
            raise ValueError('Fuel cutoff must be between 0 and 200 kg')
        if duration_s is not None:
            raise ValueError('Duration applies only to time cutoff mode')
        if fuel_floor_kg + 1e-6 < reserve_kg:
            raise ValueError('Fuel cutoff cannot go below protected reserve')
    floor = max(reserve_kg, fuel_floor_kg if cutoff == 'fuel' else 0.)
    if fuel_kg <= floor + 1e-6:
        raise ValueError('Insufficient fuel above the protected cutoff')
    return {'direction': direction, 'reference': reference, 'cutoff': cutoff,
            'duration_s': duration_s, 'fuel_floor_kg': fuel_floor_kg,
            'effective_floor_kg': floor, 'angle_deg': angle_deg,
            'fixed_heading': heading if direction == 'heading' else None,
            'max_ignition_s': MAX_IGNITION_S, 'max_alignment_s': MAX_ALIGNMENT_S}


def initial_progress() -> dict:
    return {'status': 'aligning', 'align_elapsed_s': 0., 'burn_elapsed_s': 0.,
            'reason': '', 'rcs_used_kg': 0.}


def _direction(state: State, at_s: float, plan: dict) -> float | None:
    direction = plan['direction']
    if direction == 'heading':
        return plan['fixed_heading']
    if direction == 'angle':
        return math.radians(plan['angle_deg'])
    if plan['reference'] == 'veyra':
        p = planet_ephemeris(at_s)
        x, y = state.x + p['x'], state.y + p['y']
        vx, vy = state.vx + p['vx'], state.vy + p['vy']
    else:
        x, y, vx, vy = state.x, state.y, state.vx, state.vy
    if direction in ('prograde', 'retrograde'):
        dx, dy = vx, vy
        if direction == 'retrograde':
            dx, dy = -dx, -dy
    else:
        dx, dy = x, y
        if direction == 'radial_in':
            dx, dy = -dx, -dy
    if math.hypot(dx, dy) < 1e-10:
        return None
    return math.atan2(dy, dx)


def _steer(state: State, angle: float) -> tuple[int, float, float]:
    error = math.remainder(angle - state.heading, 2 * math.pi)
    # RCS angular acceleration is derived from 2x2500 N, 7 m arm, and the
    # 14 m body's moment of inertia; this is the same model as manual RCS.
    angular_acc = 2 * 2500 * 7 / (state.mass_kg * 14**2 / 12)
    target_omega = max(-.75, min(.75, error * 3.5))
    delta = target_omega - state.omega
    turn = 1 if delta > angular_acc * STEP_S * .35 else -1 if delta < -angular_acc * STEP_S * .35 else 0
    return turn, error, angular_acc


def advance_guided(state: State, start_s: float, at_s: float, mu: float,
                   plan: dict, progress: dict, *, system: bool = True) -> tuple[State, dict]:
    """Project a saved plan; return state and NEW progress without modifying DB.

    Integrates attitude, RCS fuel, 5 kg/s thrust and gravity in bounded steps.
    Stops a burn without UI involvement, then analytically coasts the remainder.
    """
    if at_s < start_s:
        raise ValueError('Cannot project guided burn backwards')
    current = state
    status = dict(progress)
    elapsed = at_s - start_s
    if elapsed <= 0:
        return current, status
    coast = lambda s, dt, t: (propagate_local(s, dt, mu, t) if system
                             else propagate(s, dt, mu))
    if status['status'] not in ACTIVE_STATES:
        return coast(current, elapsed, start_s), status
    t = start_s
    steps = 0
    while t < at_s - 1e-10 and status['status'] in ACTIVE_STATES:
        if steps > 2000:
            status['status'] = 'failed'
            status['reason'] = 'Safety integration limit reached'
            break
        steps += 1
        dt = min(STEP_S, at_s - t)
        if math.hypot(current.x, current.y) < 91:
            status['status'] = 'failed'
            status['reason'] = 'Flight safety: central-body intersection'
            break
        floor = plan['effective_floor_kg']
        if current.fuel_kg <= floor + MIN_FUEL_MARGIN:
            status['status'] = 'completed'
            status['reason'] = 'Fuel cutoff reached'
            break
        if status['burn_elapsed_s'] >= (plan['duration_s'] if plan['cutoff'] == 'duration'
                                       else plan['max_ignition_s']) - 1e-9:
            status['status'] = 'completed'
            status['reason'] = 'Burn duration reached' if plan['cutoff'] == 'duration' else 'Maximum ignition time reached'
            break
        target = _direction(current, t, plan)
        if target is None:
            status['status'] = 'failed'
            status['reason'] = 'Cannot resolve thrust reference vector'
            break
        turn, error, angular_acc = _steer(current, target)
        aligned = abs(error) <= .06 and abs(current.omega) <= .09
        if status['status'] == 'aligning':
            if aligned:
                status['status'] = 'burning'
                continue
            if status['align_elapsed_s'] >= plan['max_alignment_s'] - 1e-9:
                status['status'] = 'failed'
                status['reason'] = 'Attitude alignment timed out'
                break
            dt = min(dt, plan['max_alignment_s'] - status['align_elapsed_s'])
            before_fuel = current.fuel_kg
            current = burn_segment(current, dt, mu, {'thrust': False, 'turn': turn,
                                  'stabilize': False, 'gimbal': 0.}, start_s=t, system=system)
            status['align_elapsed_s'] += dt
            status['rcs_used_kg'] += max(0., before_fuel - current.fuel_kg)
            t += dt
            continue
        # Re-align if an evolving prograde/radial vector rotates out of the
        # physical 28-degree gimbal envelope. Do not magically vector thrust.
        if abs(error) > GIMBAL_MAX - .025 or abs(current.omega) > .24:
            status['status'] = 'aligning'
            continue
        dt = min(dt, plan['max_ignition_s'] - status['burn_elapsed_s'],
                 (current.fuel_kg - floor) / ENGINE_FLOW_KG_S)
        if plan['cutoff'] == 'duration':
            dt = min(dt, plan['duration_s'] - status['burn_elapsed_s'])
        if dt <= 1e-10:
            status['status'] = 'completed'
            status['reason'] = 'Fuel cutoff reached'
            break
        before_fuel = current.fuel_kg
        current = burn_segment(current, dt, mu, {'thrust': True, 'turn': turn,
                              'stabilize': False, 'gimbal': max(-GIMBAL_MAX, min(GIMBAL_MAX, error))},
                              start_s=t, system=system)
        used = max(0., before_fuel - current.fuel_kg)
        status['rcs_used_kg'] += max(0., used - ENGINE_FLOW_KG_S * dt)
        status['burn_elapsed_s'] += dt
        t += dt
    if status['status'] not in ACTIVE_STATES and t < at_s:
        current = coast(current, at_s - t, t)
    return current, status


def public_status(plan: dict, progress: dict) -> dict:
    """No secret or client-editable physics state in status."""
    return {**{key: plan[key] for key in (
                'direction', 'reference', 'cutoff', 'duration_s', 'fuel_floor_kg',
                'effective_floor_kg', 'max_ignition_s')},
            **progress,
            'active': progress['status'] in ACTIVE_STATES}
