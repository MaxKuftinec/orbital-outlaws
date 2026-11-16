"""New inbound ships must spend propellant through actual finite burns."""
import math
import pytest
from app.universe import incoming_ship, resolve_arrival
from app.npc_guidance import move_with_burn, _state
from app.arrival_guidance import (plan_course, plan_insertion, desired_approach)


def test_arrival_guidance_uses_measured_post_burn_state_and_no_instant_impulse():
    ship=incoming_ship('ally-21',0.2,'flyby',True,
                       velocity_angle=1.2,velocity_speed=26.)
    ship['courseBurnAt']=0.
    before=(ship['vx'],ship['vy'],ship['fuel'])
    sector={'events':[]}
    resolve_arrival(sector,ship,310000.,1.)
    assert (ship['vx'],ship['vy'],ship['fuel'])==before
    assert ship['arrivalPhase'] in ('course_burn','failed')
    if ship['arrivalPhase']=='course_burn':
        result=move_with_burn(ship,.25,310000.)
        assert result.fuel_kg<before[2]
        assert result.mass_kg-result.fuel_kg==pytest.approx(ship['dryMass'])


def test_insertion_plans_safe_bounded_orbits_and_never_changes_velocity_directly():
    ship=incoming_ship('ally-22',0.,'orbit',True,
                       velocity_angle=math.pi/2,velocity_speed=30.)
    r=ship['insertionRadius']
    ship.update(x=r+15.,y=0.,vx=-2.,vy=math.sqrt(310000./r),fuel=220.,
                arrivalPhase='approach')
    before=(ship['vx'],ship['vy'],ship['fuel'])
    plan=plan_insertion(ship,310000.)
    assert plan is not None
    assert plan['peri']>103.
    assert plan['apo'] is not None
    assert plan['duration']>0.
    assert (ship['vx'],ship['vy'],ship['fuel'])==before
