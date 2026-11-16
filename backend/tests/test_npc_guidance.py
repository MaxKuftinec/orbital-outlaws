"""Regression tests for sampled orbital planning and finite NPC engine burns."""
import math
from app.physics import propagate, orbital_envelope
from app.npc_guidance import (
    plan_transfer, queue_burn, move_with_burn, fuel_for_dv, _state)
from app.universe import ship, guide_fuel_donor, support_orders


def test_finite_burn_consumes_mass_over_time_instead_of_teleporting_velocity():
    donor=ship('ally-40',300.,0.,True)
    donor['fuel']=140.
    start=_state(donor)
    assert queue_burn(donor, 0., 5., reserve_kg=30., reason='test')
    assert donor['fuel']==140.
    assert donor['vx']==start.vx and donor['vy']==start.vy
    coast=propagate(start,1.,310000.)
    burned=move_with_burn(donor,1.,310000.)
    assert 134.9 < burned.fuel_kg < 135.1
    assert math.isclose(burned.mass_kg-burned.fuel_kg, start.mass_kg-start.fuel_kg,
                        abs_tol=1e-7)
    assert math.hypot(burned.vx-coast.vx,burned.vy-coast.vy) > .5
    assert donor['burn']['remainingDv'] < 5.
    peri,_=orbital_envelope(burned,310000.)
    assert peri>103.


def test_finite_burn_respects_fuel_reserve_and_finishes_without_reburn():
    donor=ship('ally-41',300.,0.,True)
    donor['fuel']=34.
    assert not queue_burn(donor,0.,5.,reserve_kg=30.)
    assert queue_burn(donor,0.,.25,reserve_kg=30.)
    result=move_with_burn(donor,10.,310000.)
    assert result.fuel_kg>=30.-1e-6
    assert not donor.get('burn')
    assert math.isclose(result.mass_kg-result.fuel_kg,donor['dryMass'],abs_tol=1e-6)


def test_orbital_planner_finds_delayed_fuel_bounded_solution_without_spending_it():
    donor=ship('ally-42',300.,0.,True)
    recipient=ship('ally-43',300.,.025,True)
    donor['fuel']=140.
    original=(donor['vx'],donor['vy'],donor['fuel'])
    plan=plan_transfer(donor,recipient,310000.)
    assert plan is not None
    assert plan['deltaV']>=0.
    assert plan['fuelKg']*1.15+37. <= donor['fuel']
    assert plan['burn1Sec']+plan['burn2Sec']<=plan['flight']*.55
    assert (donor['vx'],donor['vy'],donor['fuel'])==original
    order={}
    assert guide_fuel_donor(donor,recipient,310000.,20.,order)
    assert order['navigation']['dueAt']>20.
    assert not donor.get('burn')


def test_fuel_planning_does_not_transfer_before_real_rendezvous():
    player={'id':'player','name':'KESTREL-7','isPlayer':True,'alive':True,
            'x':0.,'y':300.,'vx':-32.,'vy':0.,'fuel':190.,'fuelMax':200.}
    donor=ship('ally-44',300.,0.,True)
    recipient=ship('ally-45',300.,.12,True)
    recipient['fuel']=10.
    donor['fuel']=140.
    sector={'assistance':[], 'events':[]}
    effects={'fuel':0.}
    start=donor['fuel']
    support_orders(sector,player,[donor,recipient],[],.25,310000.,effects)
    assert effects['fuel']==0.
    assert recipient['fuel']==10.
    assert donor['fuel']==start
    assert sector['assistance']
