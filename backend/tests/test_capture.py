"""Capture upgrades only affect server-authoritative salvage contact speed."""
import math
from app.physics import State
from app.universe import new_sector, advance_sector


def trial(relative: float, installed: bool):
    radius=300.
    v=math.sqrt(310000./radius)
    pilot=State(radius,0.,0.,v,1000.,100.)
    sector=new_sector(0.)
    sector['enemies']=[]
    sector['ally']['alive']=False
    sector['pickups']=[{'id':'test-credit-1','type':'credits','amount':24.,'alive':True,
                        'phase':0.,'x':radius,'y':0.,'vx':relative,'vy':v}]
    return advance_sector(sector,.25,pilot,upgrades={'capture':True} if installed else {})


def test_capture_starter_limit_is_five_kilometres_per_second():
    sector,effects=trial(6.,False)
    assert effects['credits']==0
    assert len(sector['pickups'])==1
    assert any('below 5 km/s' in e['message'] for e in sector['events'])


def test_capture_rig_extends_speed_limit_to_eight_not_infinity():
    sector,effects=trial(6.,True)
    assert effects['credits']==24
    assert not sector['pickups']
    fast,effects_fast=trial(9.,True)
    assert effects_fast['credits']==0
    assert len(fast['pickups'])==1
    assert any('below 8 km/s' in e['message'] for e in fast['events'])
