"""Fuel assistance and physical salvage regression tests."""
import math

from app.physics import State
from app.universe import new_sector, advance_sector, support_orders, ship


def player_state(fuel=100.):
    speed = math.sqrt(310000 / 260)
    return State(260., 0., 0., speed, 900.+fuel, fuel)


def test_close_slow_pickup_transfers_fuel_from_pod():
    initial = player_state(90.)
    sector = new_sector(0)
    sector['enemies']=[]
    sector['ally']['alive']=False
    sector['pickups']=[{
        'id':'fuel-nearby','type':'fuel','amount':25,'alive':True,'phase':0.,
        'x':initial.x, 'y':initial.y, 'vx':initial.vx, 'vy':initial.vy}]
    updated,effects = advance_sector(sector,.25,initial)
    assert effects['fuel']==25.
    assert not updated['pickups']
    assert any('+25.0 kg propellant' in e['message'] for e in updated['events'])


def test_fast_crossing_is_reported_but_never_collected():
    initial = player_state(80.)
    sector = new_sector(0)
    sector['enemies']=[]
    sector['ally']['alive']=False
    sector['pickups']=[{
        'id':'wreck-fast','type':'wreck','amount':50,'alive':True,'phase':0.,
        'x':260., 'y':-20., 'vx':0., 'vy':180.}]
    updated,effects = advance_sector(sector,.25,initial)
    assert effects['credits']==0
    assert len(updated['pickups'])==1
    assert any('flyby' in e['message'] for e in updated['events'])


def test_player_rescue_transfer_preserves_fuel_and_protects_donor_reserve():
    player = {'id':'player','isPlayer':True,'name':'KESTREL-7','x':300.,
              'y':0.,'vx':0.,'vy':32.,'fuel':15.,'fuelMax':200.,'alive':True}
    donor = ship('ally-01',300.,0.,True)
    donor.update(x=300.,y=0.,vx=0.,vy=32.,fuel=140.)
    sector = {'assistance':[{'recipient':'player','donor':'ally-01',
                            'createdAt':0.,'nextDecision':0.}],
              'events':[]}
    effects = {'fuel':0.}
    support_orders(sector,player,[donor],[],1.,310000.,effects)
    assert donor['fuel']==105.
    assert player['fuel']==50.
    assert effects['fuel']==35.
    assert donor['fuel']+player['fuel']==155.
    assert not sector['assistance']


def test_npcs_autonomously_refuel_same_faction_member():
    player = {'id':'player','isPlayer':True,'name':'KESTREL-7','x':250.,'y':0.,
              'vx':0.,'vy':30.,'fuel':170.,'fuelMax':200.,'alive':True}
    recipient=ship('ally-02',300.,0.,True)
    recipient.update(x=300.,y=0.,vx=0.,vy=32.,fuel=5.)
    donor=ship('ally-03',300.,0.,True)
    donor.update(x=300.,y=0.,vx=0.,vy=32.,fuel=140.)
    sector={'assistance':[], 'events':[]}
    effects={'fuel':0.}
    support_orders(sector,player,[recipient,donor],[],1.,310000.,effects)
    assert recipient['fuel']==40.
    assert donor['fuel']==105.
    assert effects['fuel']==0.
    assert not sector['assistance']
    assert any('transferred 35.0 kg' in e['message'] for e in sector['events'])
