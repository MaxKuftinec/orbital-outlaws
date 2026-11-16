"""Server-authoritative salvage reel integration and failure scenarios."""
import math

from app.physics import State
from app.universe import new_sector, advance_sector


def setup(relative, kind='credits', mass=None):
    radius=300.
    orbital_speed=math.sqrt(310000./radius)
    player=State(radius,0.,0.,orbital_speed,1000.,100.)
    sector=new_sector(0.)
    sector['enemies']=[]
    sector['ally']['alive']=False
    pod={'id':'tether-object','type':kind,'amount':24.,'alive':True,
         'phase':0.,'x':radius+(17. if mass else 0.),
         'y':0.,'vx':relative,'vy':orbital_speed}
    if mass is not None:pod['massKg']=mass
    sector['pickups']=[pod]
    return player,sector


def test_server_does_not_pay_out_high_speed_pickup_before_real_reel_completion():
    player,sector=setup(6.)
    result,effects=advance_sector(sector,2.,player,upgrades={'capture':True})
    assert effects['credits']==0
    tether=result['captureTether']
    assert tether and tether['pickupId']=='tether-object'
    assert tether['durationS']>.25
    assert 0.<tether['peakTensionN']<=12000.
    assert effects['player_dvx']>0.
    assert result['player']['captureHeatProducedMJ']>0.
    assert len([e for e in result['events'] if 'grapple attached' in e['message']])==1


def test_failed_high_mass_cable_does_not_grant_credits_or_delete_wreck():
    player,sector=setup(4.,kind='wreck',mass=120.)
    result,effects=advance_sector(sector,2.,player,upgrades={'capture':True})
    assert effects['credits']==0
    assert len(result['pickups'])==1
    assert result['player']['hp']==100.  # refused contact causes no structural damage
    assert result['player']['captureFailures']==0.
    assert result['captureTether'] is None
    assert any('Unsafe automatic grapple' in e['message'] for e in result['events'])


def test_zero_relative_speed_payload_does_not_need_fake_tow_or_heating():
    player,sector=setup(0.)
    result,effects=advance_sector(sector,.25,player)
    assert effects['credits']==24.
    assert result['captureTether'] is None
    assert result['player']['captureHeatProducedMJ']<.1
    assert not result['pickups']
