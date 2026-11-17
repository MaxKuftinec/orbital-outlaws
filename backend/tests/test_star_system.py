"""First real star/planet system: analytic orbit, differential gravity and persistence."""
import math

import pytest
from app.physics import State, propagate
from app.flight import advance
from app.star_system import (
    PLANET_MU, STAR_MU, ORBIT_RADIUS_KM, PERIOD_S, HILL_RADIUS_KM,
    planet_ephemeris, star_from_planet, stellar_tide,
    acceleration, propagate_local, star_collision, system_info,
)
from app.universe import move
from app.store import WorldStore


def test_parent_star_and_planet_complete_a_circular_orbit():
    a=planet_ephemeris(0)
    b=planet_ephemeris(PERIOD_S/4)
    full=planet_ephemeris(PERIOD_S)
    assert math.hypot(a['x'],a['y'])==pytest.approx(ORBIT_RADIUS_KM)
    assert math.hypot(a['vx'],a['vy'])==pytest.approx(math.sqrt(STAR_MU/ORBIT_RADIUS_KM))
    assert math.hypot(a['x']-b['x'],a['y']-b['y'])==pytest.approx(ORBIT_RADIUS_KM*math.sqrt(2))
    for component in ('x','y','vx','vy'):
        assert full[component]==pytest.approx(a[component],rel=1e-12,abs=1e-8)
    assert HILL_RADIUS_KM>4500


def test_stellar_gravity_subtracts_planet_common_acceleration():
    for t in (0, 70, 1000, PERIOD_S/4):
        ax,ay=stellar_tide(0,0,t)
        assert abs(ax)<1.e-12 and abs(ay)<1.e-12
        ax,ay=acceleration(300,0,t)
        assert math.isclose(ax,-PLANET_MU/(300*300),rel_tol=.001)
        assert abs(ay)<.005


def test_restricted_three_body_propagation_is_reversible_and_perturbed():
    initial=State(260.,0.,0.,math.sqrt(PLANET_MU/260))
    future=propagate_local(initial,12,PLANET_MU,120)
    pure=propagate(initial,12,PLANET_MU)
    assert abs(future.x-pure.x)+abs(future.y-pure.y)>1.e-7
    recovered=propagate_local(future,-12,PLANET_MU,132)
    assert math.hypot(recovered.x-initial.x,recovered.y-initial.y)<.03
    assert math.hypot(recovered.vx-initial.vx,recovered.vy-initial.vy)<.01


def test_server_manual_burn_and_npc_gravity_use_same_star_system():
    initial=State(260.,0.,0.,math.sqrt(PLANET_MU/260))
    neutral={'thrust':False,'turn':0,'stabilize':False,'gimbal':0}
    resumed=advance(initial,100.,101.,PLANET_MU,neutral,0.,system=True)
    target=propagate_local(initial,1.,PLANET_MU,100.)
    assert resumed.x==pytest.approx(target.x,abs=1e-8)
    assert resumed.vx==pytest.approx(target.vx,abs=1e-8)
    npc={'x':260.,'y':0.,'vx':0.,'vy':initial.vy,
         'alive':True,'fuel':100.,'dryMass':1000.,'heading':0.,'omega':0.}
    move(npc,1.,PLANET_MU,101.)
    assert math.hypot(npc['x']-target.x,npc['y']-target.y)<.1


def test_star_collision_is_relative_to_planet_at_each_instant():
    sun=star_from_planet(1234)
    assert star_collision(sun['x'],sun['y'],1234)
    assert not star_collision(0,0,1234)


def test_system_ephemeris_has_no_migration_of_legacy_player_coordinates(postgres_url):
    db=WorldStore(postgres_url)
    db.ensure_world()
    info=db.system_view()
    assert info['star']['name']=='KESTREL PRIMARY'
    assert info['planet']['name']=='KESTREL'
    assert info['frame']=='star-centered'
    assert math.hypot(info['planet']['x'],info['planet']['y'])==pytest.approx(ORBIT_RADIUS_KM)
    assert info['orbit_period_s']==pytest.approx(PERIOD_S)
