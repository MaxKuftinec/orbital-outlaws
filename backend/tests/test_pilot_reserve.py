"""Per-pilot reserve choices remain authoritative and survive restarts."""
import copy
import math
import time
from uuid import uuid4

import pytest
from app.store import WorldStore
from app.models import Entity, EncounterSnapshot
from app.physics import State, orbital_envelope


def test_reserve_is_persistent_clamped_and_is_not_a_technology(postgres_url):
    store = WorldStore(postgres_url)
    store.ensure_world()
    pilot = uuid4().hex
    store.connect_player(pilot)
    assert store.player_progress(pilot)['reserve_kg'] == 36.
    saved = store.set_player_reserve(pilot, 72.5)
    assert saved['reserve_kg'] == 72.5
    assert store.player_progress(pilot)['credits'] == 65
    assert store.player_progress(pilot)['upgrades'] == {}
    restarted = WorldStore(postgres_url)
    assert restarted.player_progress(pilot)['reserve_kg'] == 72.5
    assert restarted.set_player_reserve(pilot, 0)['reserve_kg'] == 0
    assert restarted.set_player_reserve(pilot, 200)['reserve_kg'] == 200
    for invalid in (-1., 201., math.inf, math.nan):
        with pytest.raises(ValueError, match='reserve'):
            store.set_player_reserve(pilot, invalid)


def test_player_donations_obey_chosen_reserve_and_debit_fuel(postgres_url):
    store=WorldStore(postgres_url)
    store.ensure_world()
    pilot=uuid4().hex
    store.connect_player(pilot)
    store.player_encounter(pilot)
    eid='pilot-'+pilot
    # Arrange a genuine same-position/same-velocity rendezvous.
    with store.sessions.begin() as db:
        saved=db.get(EncounterSnapshot,eid)
        sector=copy.deepcopy(saved.snapshot)
        ally=sector['ally']
        ally['fuel']=100.
        ally['alive']=True
        saved.snapshot=sector
        saved.saved_at_utc=time.time()
        world=db.get(__import__('app.models',fromlist=['World']).World,'kestrel')
        entity=db.get(Entity,eid)
        now=store.now(world)
        state=State(ally['x'],ally['y'],ally['vx'],ally['vy'],1060.,160.)
        peri,apo=orbital_envelope(state,world.mu)
        entity.checkpoint_s=now
        entity.checkpoint=state.as_dict()
        entity.periapsis_km=peri
        entity.apoapsis_km=apo
    store.set_player_reserve(pilot,145.)
    transfer=store.offer_fuel(pilot,'ally-01',20.)
    assert transfer['transferred_kg']==pytest.approx(15.,abs=.2)
    assert transfer['remaining_fuel_kg']==pytest.approx(145.,abs=.2)
    with pytest.raises(ValueError,match='surplus fuel'):
        store.offer_fuel(pilot,'ally-01',10.)
    snapshot=store.player_encounter(pilot)['snapshot']
    assert snapshot['ally']['fuel']==pytest.approx(115.,abs=.2)
