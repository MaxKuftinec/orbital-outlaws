"""Tactical coordination chooses threats by predicted orbit and avoids unsafe burns."""
from app.universe import ship
from app.npc_intelligence import (risk_report, choose_tactical_target,
                                  coordinate_allies, evasive_burn)


def test_escort_coordinator_distributes_targets_and_respects_rescue_donors():
    player=ship('pilot-01',300.,0.,True)
    player.update(id='player',isPlayer=True,alive=True)
    a=ship('ally-10',300.,.15,True)
    b=ship('ally-11',300.,.17,True)
    e1=ship('raider-11',310.,.3)
    e2=ship('raider-12',315.,.32)
    coordinate_allies({},player,[a,b],[e1,e2],{a['id']},310000.)
    assert a['tacticalRole']=='rescue'
    assert a['tacticalTarget'] is None
    assert b['tacticalTarget'] in (e1['id'],e2['id'])
    assert b['tacticalRole']=='intercept'


def test_risk_report_detects_converging_orbital_contacts():
    a=ship('ally-12',300.,0.,True)
    b=ship('raider-13',300.,0.)
    b['vx']=a['vx']+2.
    b['vy']=a['vy']
    danger=risk_report(a,[b],310000.,horizon=8.)
    assert danger['closestKm']<25.
    assert danger['threat']==b['id']
