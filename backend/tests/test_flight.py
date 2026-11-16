import math
import pytest
from app.flight import advance, burn_segment, LEASE_S
from app.physics import State, propagate

MU = 310000
CIRCULAR = State(260, 0, 0, math.sqrt(MU / 260), 1110, 200, math.pi / 2, 0)


def test_burn_changes_velocity_and_consumes_propellant():
    control = {'thrust': True, 'turn': 0, 'stabilize': False, 'gimbal': 0}
    burn = burn_segment(CIRCULAR, .3, MU, control)
    coast = propagate(CIRCULAR, .3, MU)
    assert burn.fuel_kg == pytest.approx(198.5)
    assert burn.mass_kg == pytest.approx(1108.5)
    assert burn.vy > coast.vy


def test_expired_input_coasts_without_spending_fuel_forever():
    control = {'thrust': True, 'turn': 0, 'stabilize': False, 'gimbal': 0}
    s = advance(CIRCULAR, 10, 20, MU, control, 10 + LEASE_S)
    expected = propagate(burn_segment(CIRCULAR, LEASE_S, MU, control), 10 - LEASE_S, MU)
    assert s.fuel_kg == pytest.approx(198)
    assert s.x == pytest.approx(expected.x)
    assert s.y == pytest.approx(expected.y)
    assert advance(s, 20, 30, MU, control, 10 + LEASE_S).fuel_kg == pytest.approx(s.fuel_kg)


def test_rotation_persists_during_coast():
    control = {'thrust': False, 'turn': 1, 'stabilize': False, 'gimbal': 0}
    rotated = advance(CIRCULAR, 0, .2, MU, control, LEASE_S)
    assert rotated.omega > 0
    coast = advance(rotated, .2, 5, MU)
    assert coast.omega == pytest.approx(rotated.omega)
    assert coast.heading != rotated.heading
