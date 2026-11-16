"""Finite-force winch tests: force, momentum, thermal budget and line failure."""
import math
import pytest
from app.tether import (begin_tether, step_tether, BASE_TENSION_N,
                        RIG_TENSION_N, LINE_LENGTH_KM)


def spacecraft():
    return {'id':'player','alive':True,'x':0.,'y':0.,'vx':0.,'vy':0.,
            'mass_kg':1000.,'fuel':100.,'captureHeatMJ':0.,
            'captureHeatProducedMJ':0.,'captureMotorMJ':0.}


def test_tether_requires_real_time_and_conserves_impulse_each_step():
    ship=spacecraft()
    pod={'id':'credits-tether','alive':True,'type':'credits','amount':24.,
         'x':0.,'y':0.,'vx':3.,'vy':0.}
    arm,reason=begin_tether(ship,pod,2.,0.,False)
    assert arm is not None,reason
    assert pod['vx']==3.  # No magical impulse at the latch.
    start_momentum=1000.*ship['vx']+2.*pod['vx']
    statuses=[]
    for i in range(420):
        ship['x']+=ship['vx']*.25
        pod['x']+=pod['vx']*.25
        step=step_tether(ship,pod,arm,.25,False)
        statuses.append(step.status)
        assert step.status!='broken',step.reason
        assert 1000.*ship['vx']+2.*pod['vx']==pytest.approx(start_momentum,abs=1e-8)
        assert arm['tensionN']<=BASE_TENSION_N+1e-6
        if step.status=='captured':
            break
    assert statuses[0]=='reeling'
    assert len(statuses)>5
    assert statuses[-1]=='captured'
    assert 0.<arm['durationS']<110.
    assert ship['captureHeatProducedMJ']>0.
    assert arm['heatMJ']==pytest.approx(ship['captureHeatProducedMJ'])
    assert ship['captureMotorMJ']>=0.


def test_upgraded_arm_can_reel_fast_light_pod_over_multiple_seconds():
    ship=spacecraft()
    pod={'id':'fast-light','alive':True,'type':'credits','amount':24.,
         'x':0.,'y':0.,'vx':6.,'vy':0.}
    arm,reason=begin_tether(ship,pod,2.,0.,True)
    assert arm is not None,reason
    elapsed=0.
    last=None
    for i in range(440):
        ship['x']+=ship['vx']*.25
        pod['x']+=pod['vx']*.25
        last=step_tether(ship,pod,arm,.25,True)
        elapsed+=.25
        assert arm['peakTensionN']<=RIG_TENSION_N+1e-6
        if last.status!='reeling':break
    assert last.status=='captured',last.reason
    assert elapsed>1.
    assert ship['vx']>0.
    assert pod['vx']<6.


def test_heavy_fast_salvage_cannot_exceed_tether_braking_distance():
    ship=spacecraft()
    pod={'id':'wreck','alive':True,'type':'wreck','amount':50.,
         'massKg':120.,'x':17.,'y':0.,'vx':4.,'vy':0.}
    arm,reason=begin_tether(ship,pod,120.,0.,True)
    assert arm is not None,reason  # passes speed, heat and mass contact checks
    before=(ship['vx'],pod['vx'])
    step=step_tether(ship,pod,arm,.25,True)
    assert step.status=='broken'
    assert 'braking distance' in step.reason
    assert (ship['vx'],pod['vx'])==before  # no nonphysical impulse on failure


def test_tether_breaks_when_line_overextends_or_heat_capacity_would_fail():
    ship=spacecraft()
    pod={'id':'small','alive':True,'type':'credits','amount':24.,
         'x':0.,'y':0.,'vx':2.,'vy':0.}
    arm,_=begin_tether(ship,pod,2.,0.,False)
    pod['x']=LINE_LENGTH_KM+.1
    assert step_tether(ship,pod,arm,.25,False).status=='broken'
    pod['x']=2.
    ship['captureHeatMJ']=519.99
    result=step_tether(ship,pod,arm,.25,False)
    assert result.status=='broken'
    assert 'heat sink' in result.reason


def test_different_salvage_masses_produce_different_acceleration_under_same_force():
    first=spacecraft()
    a={'id':'light','type':'credits','amount':1.,'alive':True,
       'x':3.,'y':0.,'vx':1.,'vy':0.}
    second=spacecraft()
    b={'id':'heavy','type':'fuel','amount':20.,'alive':True,
       'x':3.,'y':0.,'vx':1.,'vy':0.}
    a_arm,_=begin_tether(first,a,2.,0.,True)
    b_arm,_=begin_tether(second,b,20.,0.,True)
    step_tether(first,a,a_arm,.25,True)
    step_tether(second,b,b_arm,.25,True)
    assert abs(a['vx']-1.)>abs(b['vx']-1.)
