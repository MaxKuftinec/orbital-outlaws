"""Authoritative guided burns: physical RCS, fuel cutoff and persistent commands."""
import math
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.auto_burn import advance_guided, initial_progress, validate_plan, public_status
from app.flight import GIMBAL_MAX
from app.main import app
from app.models import AutoBurn, Entity, Event, World
from app.physics import State
from app.store import WorldStore


MU = 310000.
CIRC = State(260., 0., 0., math.sqrt(MU / 260.), 1110., 200., math.pi/2, 0.)


def plan(state=CIRC, *, direction='heading', reference='kestrel',
         cutoff='duration', duration_s=1., fuel_floor_kg=None, angle_deg=None,
         reserve_kg=36.):
    return validate_plan(direction, reference, cutoff, duration_s,
                         fuel_floor_kg, angle_deg, reserve_kg,
                         state.fuel_kg, state.heading)


def test_fixed_heading_burn_starts_without_browser_lease_and_cuts_at_time():
    cfg=plan(duration_s=.5)
    end, prog=advance_guided(CIRC, 0., 4., MU, cfg, initial_progress(),system=False)
    assert prog['status']=='completed'
    assert prog['reason']=='Burn duration reached'
    assert prog['burn_elapsed_s']==pytest.approx(.5, abs=1e-5)
    assert end.fuel_kg==pytest.approx(197.5, abs=2e-5)
    assert end.mass_kg==pytest.approx(1107.5, abs=2e-5)
    assert end.vy!=pytest.approx(CIRC.vy)
    after, same=advance_guided(end,4.,100.,MU,cfg,prog,system=False)
    assert after.fuel_kg==pytest.approx(end.fuel_kg)
    assert after.mass_kg==pytest.approx(end.mass_kg)
    assert same==prog


def test_retrograde_uses_real_rcs_and_never_turns_thrust_instantly():
    cfg=plan(direction='retrograde',duration_s=.4,reserve_kg=20.)
    early, progress=advance_guided(CIRC, 1., 1.2, MU,cfg,initial_progress(),system=False)
    assert progress['status']=='aligning'
    assert progress['burn_elapsed_s']==0
    assert early.fuel_kg<200.  # RCS reaction mass expended
    assert early.fuel_kg>199.9  # no free main engine burn while facing prograde
    assert abs(early.omega)>0
    later, finished=advance_guided(CIRC,1.,50.,MU,cfg,initial_progress(),system=False)
    assert finished['status'] in ('completed','failed')
    assert finished['align_elapsed_s']>0
    assert later.mass_kg<=CIRC.mass_kg
    assert later.fuel_kg<=CIRC.fuel_kg


def test_fuel_cutoff_preserves_reserve_including_rcs_and_no_more_than_40s():
    initial=State(260,0,0,math.sqrt(MU/260), 960., 50.,math.pi/2,0.)
    cfg=plan(initial,cutoff='fuel',duration_s=None,fuel_floor_kg=42.,reserve_kg=36.)
    end,prog=advance_guided(initial,10.,100.,MU,cfg,initial_progress(),system=False)
    assert prog['status']=='completed'
    assert prog['reason']=='Fuel cutoff reached'
    assert end.fuel_kg >= 42.-1e-7
    assert end.fuel_kg <= 42.+2e-4
    assert 1.5 <= prog['burn_elapsed_s'] <= 1.61
    assert initial.mass_kg-end.mass_kg==pytest.approx(initial.fuel_kg-end.fuel_kg)


def test_rejects_unrealistic_burns_and_unprotected_floors():
    with pytest.raises(ValueError,match='reserve'):
        plan(cutoff='fuel',duration_s=None,fuel_floor_kg=30.,reserve_kg=36.)
    with pytest.raises(ValueError,match='duration'):
        plan(duration_s=70.)
    with pytest.raises(ValueError,match='angle'):
        plan(direction='angle',angle_deg=480.)
    with pytest.raises(ValueError,match='Insufficient'):
        plan(cutoff='fuel',duration_s=None,fuel_floor_kg=200.)


def test_persistent_checkpoint_survives_store_restart_and_abort(postgres_url):
    store=WorldStore(postgres_url)
    store.ensure_world()
    pilot=uuid4().hex
    store.connect_player(pilot)
    start=store.player_auto_start(pilot,direction='heading',reference='kestrel',
                                  cutoff='duration',duration_s=.4)
    assert start['auto_burn']['status']=='aligning'
    eid='pilot-'+pilot
    at=start['at_s']+1.
    with store.sessions.begin() as db:
        entity=db.get(Entity,eid)
        world=db.get(World,'kestrel')
        resolved=store._settle_auto(db,entity,world,at)
        assert resolved.fuel_kg==pytest.approx(start['state']['fuel_kg']-2.,abs=.01)
    restarted=WorldStore(postgres_url)
    read=restarted.get_entity('kestrel',eid,at_s=at)
    assert read['auto_burn']['status']=='completed'
    assert read['auto_burn']['burn_elapsed_s']==pytest.approx(.4,abs=1e-5)
    assert read['state']['fuel_kg']==pytest.approx(resolved.fuel_kg,abs=.01)
    with restarted.sessions() as db:
        kinds=[event.kind for event in db.query(Event).filter(Event.entity_id==eid)]
        assert 'auto_start' in kinds
        assert 'auto_finish' in kinds
    # Second pilot: abort from another store instance must leave safe coasting.
    other=uuid4().hex
    store.connect_player(other)
    store.player_auto_start(other,direction='heading',reference='kestrel',
                            cutoff='duration',duration_s=6.)
    aborted=restarted.player_auto_abort(other)
    assert aborted['auto_burn']['status']=='aborted'
    assert restarted.get_entity('kestrel','pilot-'+other)['auto_burn']['active'] is False


def test_neutral_manual_inputs_do_not_cancel_server_guidance(postgres_url):
    store=WorldStore(postgres_url)
    store.ensure_world()
    pilot=uuid4().hex
    store.connect_player(pilot)
    store.player_auto_start(pilot,direction='heading',reference='kestrel',
                            cutoff='duration',duration_s=4.)
    neutral=store.player_input(pilot,False,0,False,0.)
    assert neutral['auto_burn']['active']
    with pytest.raises(ValueError,match='Abort automated thrust'):
        store.set_player_reserve(pilot,50.)
    override=store.player_input(pilot,True,0,False,0.)
    assert override['auto_burn']['status']=='aborted'
    with store.sessions() as db:
        plan=db.get(AutoBurn,'pilot-'+pilot)
        assert plan.progress['reason']=='Manual flight control override'


def test_dev_only_rest_endpoint_rejects_public_and_invalid_orders(monkeypatch, postgres_url):
    import app.main as main
    monkeypatch.setenv('DATABASE_URL',postgres_url)
    main.store.cache_clear()
    pilot=uuid4().hex
    with TestClient(app) as client:
        monkeypatch.delenv('ORBITAL_DEV_COMMANDS',raising=False)
        assert client.post('/players/'+pilot+'/auto-burn',json={
            'direction':'prograde','cutoff':'duration','duration_s':2}).status_code==401
        monkeypatch.setenv('ORBITAL_DEV_COMMANDS','1')
        assert client.post('/players/not-a-pilot/auto-burn',json={
            'direction':'prograde','cutoff':'duration','duration_s':2}).status_code==400
        client.post('/players/'+pilot)
        bad=client.post('/players/'+pilot+'/auto-burn',json={
            'direction':'prograde','cutoff':'duration','duration_s':80})
        assert bad.status_code==422
        good=client.post('/players/'+pilot+'/auto-burn',json={
            'direction':'heading','cutoff':'duration','duration_s':1})
        assert good.status_code==200,good.text
        assert good.json()['auto_burn']['active']
        duplicate=client.post('/players/'+pilot+'/auto-burn',json={
            'direction':'heading','cutoff':'duration','duration_s':1})
        assert duplicate.status_code==409
        stop=client.post('/players/'+pilot+'/auto-burn/abort')
        assert stop.status_code==200,stop.text
        assert stop.json()['auto_burn']['status']=='aborted'
    main.store.cache_clear()


def test_dev_refuel_during_guidance_preserves_history_and_continues_burn(postgres_url):
    """Unrelated checkpoints must never reset or silently cancel the burn."""
    import time
    store=WorldStore(postgres_url)
    store.ensure_world()
    pilot=uuid4().hex
    eid='pilot-'+pilot
    store.connect_player(pilot)
    store.player_auto_start(pilot,direction='heading',reference='kestrel',
                            cutoff='duration',duration_s=3.)
    time.sleep(.16)
    refill=store.refuel_player(pilot, requested_kg=5.)
    assert refill['added_kg'] > 0.
    with store.sessions() as db:
        event=db.query(Event).filter(Event.entity_id==eid,
                                    Event.kind=='dev_refuel').order_by(Event.id.desc()).first()
        assert event is not None
        assert event.payload['auto_plan']['cutoff']=='duration'
        assert event.payload['auto_progress']['status']=='burning'
        refuel_at=event.at_s
        tank_after=event.after['fuel_kg']
    with store.sessions.begin() as db:
        ent=db.get(Entity,eid)
        world=db.get(World,'kestrel')
        store._settle_auto(db,ent,world,refuel_at+.3)
    with store.sessions() as db:
        _,_,_,historic=store._at(db,'kestrel',eid,refuel_at+.1)
        assert historic.fuel_kg < tank_after-.35
        assert historic.fuel_kg > tank_after-.65
