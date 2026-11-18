"""The salvage grapple must conserve mass and linear momentum, not create free Δv."""
import math
import pytest
from app.physics import State
from app.capture_physics import (assess_capture, payload_mass,
                                 cool_capture_system, RIG_HEAT_MJ)
from app.universe import advance_sector, new_sector


def test_inelastic_capture_preserves_total_linear_momentum_and_accounts_heat():
    ship={'id':'player','alive':True,'mass_kg':1000.,'fuel':100.,
          'x':300.,'y':0.,'vx':0.,'vy':30.,'captureHeatMJ':0.}
    pickup={'type':'fuel','amount':20.,'vx':3.,'vy':30.}
    m=payload_mass(pickup)
    result=assess_capture(ship,pickup,m,False)
    assert result.ok
    expected_x=(ship['mass_kg']*ship['vx']+m*pickup['vx'])/(ship['mass_kg']+m)
    assert ship['vx']+result.dvx==pytest.approx(expected_x)
    assert ship['vy']+result.dvy==pytest.approx(30.)
    reduced=ship['mass_kg']*m/(ship['mass_kg']+m)
    assert result.heat_mj==pytest.approx(.5*reduced*3.**2)
    # E_before = E_after + energy dumped into grapple heat (MJ).
    before=.5*ship['mass_kg']*(ship['vx']**2+ship['vy']**2)+.5*m*(pickup['vx']**2+pickup['vy']**2)
    after=.5*(ship['mass_kg']+m)*((ship['vx']+result.dvx)**2+(ship['vy']+result.dvy)**2)
    assert before-after==pytest.approx(result.heat_mj)


def test_capture_thermal_limits_reject_hot_wreck_even_with_8km_s_upgrade():
    ship={'alive':True,'mass_kg':1000.,'x':300.,'y':0.,'vx':0.,'vy':30.,'captureHeatMJ':0.}
    huge={'type':'wreck','massKg':120.,'vx':6.,'vy':30.}
    result=assess_capture(ship,huge,payload_mass(huge),True)
    assert not result.ok
    assert 'Heat sink' in result.reason
    assert result.relative_km_s==6.
    close={'type':'credits','amount':24.,'vx':6.,'vy':30.}
    assert assess_capture(ship,close,payload_mass(close),True).ok
    ship['captureHeatMJ']=RIG_HEAT_MJ-2.
    assert not assess_capture(ship,close,payload_mass(close),True).ok


def test_cooling_radiates_stored_capture_energy():
    player={'captureHeatMJ':100.,'captureRadiatedMJ':10.}
    cool_capture_system(player,5.)
    assert player['captureHeatMJ']==60.
    assert player['captureRadiatedMJ']==50.
    cool_capture_system(player,20.)
    assert player['captureHeatMJ']==0.
    assert player['captureRadiatedMJ']==110.


def test_capture_server_moves_ship_and_increases_cargo_mass():
    radius=300.
    v=math.sqrt(310000/radius)
    player=State(radius,0.,0.,v,1000.,100.)
    sector=new_sector(0)
    sector['enemies']=[]
    sector['ally']['alive']=False
    sector['pickups']=[{'id':'credits-physical','type':'credits','amount':24.,'alive':True,
                        'phase':0.,'x':radius,'y':0.,'vx':.3,'vy':v}]
    result,effects=advance_sector(sector,.25,player)
    assert effects['credits']==24
    assert effects['capture_cargo_mass']==2.
    assert effects['player_dvx']==pytest.approx(2.*.3/1002.,abs=.0002)
    assert result['player']['cargoKg']==2.
    assert result['player']['captureHeatMJ']>0.
    assert result['player']['captureHeatProducedMJ']>=result['player']['captureHeatMJ']


def test_refuel_transfer_preserves_fleet_momentum():
    from app.universe import ship, support_orders
    donor=ship('ally-50',300.,0.,True)
    recipient=ship('ally-51',300.,0.,True)
    donor.update(vx=0.,vy=31.,fuel=140.)
    recipient.update(vx=1.,vy=31.,fuel=10.)
    pilot={'id':'player','isPlayer':True,'name':'KESTREL-7','x':350.,'y':0.,
           'vx':0.,'vy':0.,'fuel':200.,'fuelMax':200.,'alive':True}
    m1=donor['dryMass']+donor['fuel']
    m2=recipient['dryMass']+recipient['fuel']
    before_x=m1*donor['vx']+m2*recipient['vx']
    sector={'assistance':[{'recipient':recipient['id'],'donor':donor['id'],
                           'createdAt':0.,'nextDecision':0.}],'events':[]}
    support_orders(sector,pilot,[donor,recipient],[],1.,310000.,{'fuel':0.})
    after_x=(donor['dryMass']+donor['fuel'])*donor['vx']+(
             recipient['dryMass']+recipient['fuel'])*recipient['vx']
    assert before_x==pytest.approx(after_x)
    assert recipient['transferHeatMJ']>0.


def test_captured_cargo_persists_as_mass_in_authoritative_player_checkpoint(postgres_url):
    import copy
    import time
    from uuid import uuid4
    from app.store import WorldStore
    from app.models import Entity, EncounterSnapshot, World
    from app.physics import orbital_envelope

    store=WorldStore(postgres_url)
    store.ensure_world()
    pilot=uuid4().hex
    store.connect_player(pilot)
    store.player_encounter(pilot)
    # Move the simulated checkpoint beyond the newly created pilot's spawn event.
    time.sleep(.7)
    eid='pilot-'+pilot
    velocity=math.sqrt(310000/300.)
    with store.sessions.begin() as db:
        world=db.get(World,'kestrel')
        ship=db.get(Entity,eid)
        saved=db.get(EncounterSnapshot,eid)
        state=State(300.,0.,0.,velocity,1000.,100.)
        peri,apo=orbital_envelope(state,world.mu)
        # Deliberately position the authoritative checkpoint 0.25
        # simulation-seconds behind the RUNNING server clock.
        ship.checkpoint_s=max(0.,store.now(world)-.25)
        ship.checkpoint=state.as_dict()
        ship.periapsis_km,ship.apoapsis_km=peri,apo
        sector=copy.deepcopy(saved.snapshot)
        sector['enemies']=[]
        sector['ally']['alive']=False
        sector['pickups']=[{
            'id':'cargo-token','type':'credits','amount':24.,
            'alive':True,'phase':0.,'x':300.,'y':0.,'vx':0.,'vy':velocity}]
        sector['t']=ship.checkpoint_s
        saved.snapshot=sector
        saved.saved_at_utc=time.time()
    result=store.player_encounter(pilot)
    actual=store.get_entity('kestrel',eid)['state']
    assert actual['mass_kg']==pytest.approx(1002.,abs=1e-3)
    assert actual['fuel_kg']==pytest.approx(100.)
    assert math.isfinite(actual['vx'])
    assert result['snapshot']['player']['cargoKg']==pytest.approx(2.)
