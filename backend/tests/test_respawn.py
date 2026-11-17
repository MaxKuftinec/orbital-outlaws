import copy
import math
from uuid import uuid4
import pytest
from app.models import EncounterSnapshot
from app.store import WorldStore


def test_dev_respawn_preserves_sector_but_resets_economy_and_creates_random_outer_ship(postgres_url):
    store=WorldStore(postgres_url)
    store.ensure_world()
    pilot=uuid4().hex
    store.connect_player(pilot)
    first=store.player_encounter(pilot)['snapshot']
    store.player_purchase(pilot,'predictive')
    progress_before=store.player_progress(pilot)
    raider=store.spawn_raider(pilot)['ship']['id']
    with store.sessions.begin() as db:
        saved=db.get(EncounterSnapshot,'pilot-'+pilot)
        sector=copy.deepcopy(saved.snapshot)
        sector['player']['hp']=0
        sector['player']['alive']=False
        saved.snapshot=sector
    respawn=store.respawn_player(pilot)
    assert respawn['hp']==100
    assert respawn['progress_preserved'] is False
    assert respawn['sector_preserved'] is True
    assert respawn['arrival_control']=='manual'
    assert respawn['spawn_radius_km']>900
    state=respawn['state']
    assert 20<=math.hypot(state['vx'],state['vy'])<=32
    assert state['fuel_kg']==200
    assert state['mass_kg']==1110
    assert store.player_progress(pilot)['credits']==65
    assert store.player_progress(pilot)['upgrades']=={}
    assert progress_before['credits']<65
    resumed=WorldStore(postgres_url).player_encounter(pilot)['snapshot']
    assert resumed['player']['alive'] is True
    assert resumed['player']['hp']==100
    assert raider in {e['id'] for e in resumed['enemies']}
    second=store.respawn_player(pilot)
    assert second['hp']==100
    assert second['previous_ship_abandoned'] is True
    assert second['previous_ship_state']['fuel_kg']==pytest.approx(200)
    assert second['state']!=state
    assert store.player_progress(pilot)['credits']==65
    assert raider in {e['id'] for e in store.player_encounter(pilot)['snapshot']['enemies']}


def test_live_pilot_can_start_new_run_and_preserve_ship_event_history(postgres_url):
    from sqlalchemy import select
    from app.models import Event
    store=WorldStore(postgres_url)
    store.ensure_world()
    pilot=uuid4().hex
    store.connect_player(pilot)
    store.player_encounter(pilot)
    store.player_purchase(pilot,'predictive')
    replacement=store.respawn_player(pilot)
    assert replacement['previous_ship_abandoned'] is True
    assert replacement['progress_preserved'] is False
    assert replacement['previous_ship_state']['fuel_kg']==pytest.approx(200.)
    assert replacement['state']['mass_kg']==1110.
    assert store.player_progress(pilot)['credits']==65
    assert store.player_progress(pilot)['upgrades']=={}
    with store.sessions() as db:
        history=list(db.scalars(select(Event).where(
            Event.entity_id=='pilot-'+pilot,Event.kind=='respawn')))
        assert history[-1].payload['reason']=='dev-abandon'
        assert history[-1].payload['previous_alive'] is True
