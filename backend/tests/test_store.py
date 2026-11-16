import math
import time
import pytest
from app.physics import State
from app.store import WorldStore


def test_persistent_snapshots_event_order_and_idempotency(tmp_path):
    path=tmp_path/'world.sqlite'
    store=WorldStore(f'sqlite:///{path}')
    store.ensure_world()
    v=math.sqrt(310000/260)
    store.seed_entity('kestrel','scout',State(260,0,0,v,1110,200))
    first=store.get_entity('kestrel','scout')
    assert first['state']['fuel_kg']==200
    action=store.apply_impulse('kestrel','scout',0,1,'cmd1')
    assert action['replayed'] is False
    replay=store.apply_impulse('kestrel','scout',0,1,'cmd1')
    assert replay['replayed'] is True
    assert replay['state']==action['state']
    assert store.get_entity('kestrel','scout')['version']==1
    reopened=WorldStore(f'sqlite:///{path}')
    s=reopened.get_entity('kestrel','scout')
    assert s['version']==1
    assert s['state']['fuel_kg']<200
    past=reopened.get_entity('kestrel','scout',first['at_s'])
    assert past['state']['fuel_kg']==pytest.approx(200)


def test_viewport_filters_by_radial_envelope(tmp_path):
    store=WorldStore(f'sqlite:///{tmp_path}/v.db')
    store.ensure_world()
    store.seed_entity('kestrel','near',State(260,0,0,math.sqrt(310000/260)))
    store.seed_entity('kestrel','far',State(900,0,0,math.sqrt(310000/900)))
    visible=store.viewport('kestrel',260,0,40)
    assert [e['id'] for e in visible['entities']]==['near']
    assert visible['candidate_count']==1


def test_reject_unaffordable_action(tmp_path):
    store=WorldStore(f'sqlite:///{tmp_path}/v.db')
    store.ensure_world()
    store.seed_entity('kestrel','low',State(260,0,0,34,1000,0))
    with pytest.raises(ValueError):store.apply_impulse('kestrel','low',1,1,'bad')
    assert store.get_entity('kestrel','low')['version']==0
