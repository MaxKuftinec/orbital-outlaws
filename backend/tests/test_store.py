import math
from uuid import uuid4
import pytest
from app.physics import State
from app.store import WorldStore


def test_persistent_snapshots_event_order_and_idempotency(postgres_url):
    store = WorldStore(postgres_url)
    world = 'test-' + uuid4().hex
    store.ensure_world(world)
    v = math.sqrt(310000 / 260)
    store.seed_entity(world, 'scout-' + world, State(260, 0, 0, v, 1110, 200))
    entity = 'scout-' + world
    first = store.get_entity(world, entity)
    assert first['state']['fuel_kg'] == 200
    action = store.apply_impulse(world, entity, 0, 1, 'cmd-' + world)
    assert action['replayed'] is False
    replay = store.apply_impulse(world, entity, 0, 1, 'cmd-' + world)
    assert replay['replayed'] is True
    assert replay['state'] == action['state']
    assert store.get_entity(world, entity)['version'] == 1
    reopened = WorldStore(postgres_url)
    state = reopened.get_entity(world, entity)
    assert state['version'] == 1
    assert state['state']['fuel_kg'] < 200
    past = reopened.get_entity(world, entity, first['at_s'])
    assert past['state']['fuel_kg'] == pytest.approx(200)


def test_viewport_filters_by_radial_envelope(postgres_url):
    store = WorldStore(postgres_url)
    world = 'test-' + uuid4().hex
    store.ensure_world(world)
    store.seed_entity(world, 'near-' + world, State(260, 0, 0, math.sqrt(310000 / 260)))
    store.seed_entity(world, 'far-' + world, State(900, 0, 0, math.sqrt(310000 / 900)))
    visible = store.viewport(world, 260, 0, 40)
    assert [e['id'] for e in visible['entities']] == ['near-' + world]
    assert visible['candidate_count'] == 1


def test_reject_unaffordable_action(postgres_url):
    store = WorldStore(postgres_url)
    world = 'test-' + uuid4().hex
    store.ensure_world(world)
    entity = 'low-' + world
    store.seed_entity(world, entity, State(260, 0, 0, 34, 1000, 0))
    with pytest.raises(ValueError):
        store.apply_impulse(world, entity, 1, 1, 'bad-' + world)
    assert store.get_entity(world, entity)['version'] == 0
