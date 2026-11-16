import math
import pytest
from app.physics import State, propagate, orbital_envelope, apply_impulse, finite_burn

MU=310000
R=260
V=math.sqrt(MU/R)
INITIAL=State(R,0,0,V,1110,200)
P=2*math.pi*math.sqrt(R**3/MU)


def test_kepler_quarter_orbit():
    a=propagate(INITIAL,P/4,MU)
    assert abs(a.x)<1e-7
    assert abs(a.y-R)<1e-7
    assert a.vx==pytest.approx(-V,abs=1e-8)
    assert abs(a.vy)<1e-8


def test_kepler_many_revolutions_no_drift():
    a=propagate(INITIAL,1_000_000*P+P/4,MU)
    assert a.x==pytest.approx(0,abs=3e-6)
    assert a.y==pytest.approx(R,abs=3e-6)
    assert a.fuel_kg==200


def test_inverse_time_roundtrip():
    start=State(310,0,-5,30)
    middle=propagate(start,100,MU)
    back=propagate(middle,-100,MU)
    for key in ['x','y','vx','vy']:
        assert getattr(back,key)==pytest.approx(getattr(start,key),rel=1e-8,abs=1e-7)


def test_hyperbolic_trajectory():
    start=State(R,0,0,110)
    end=propagate(start,40,MU)
    assert math.hypot(end.x,end.y)>R
    peri,apo=orbital_envelope(start,MU)
    assert apo is None


def test_impulse_reserve():
    a=apply_impulse(INITIAL,0,2,320,reserve_kg=40)
    assert a.fuel_kg<200
    assert a.mass_kg-a.fuel_kg==pytest.approx(910)
    with pytest.raises(ValueError):apply_impulse(INITIAL,0,90,320,reserve_kg=40)


def test_finite_burn_is_not_instantaneous():
    a=finite_burn(INITIAL,1,MU,1_600_000,5,(1,0))
    assert a.fuel_kg==pytest.approx(195)
    assert a.mass_kg==pytest.approx(1105)
    assert a.x!=INITIAL.x
