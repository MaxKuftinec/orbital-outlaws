from uuid import uuid4
from app.store import WorldStore


def test_each_dev_trigger_creates_exactly_one_persistent_raider(postgres_url):
    store = WorldStore(postgres_url)
    store.ensure_world()
    pilot = uuid4().hex
    store.connect_player(pilot)
    initial = store.player_encounter(pilot)
    before = len(initial['snapshot']['enemies'])
    first = store.spawn_raider(pilot)
    second = store.spawn_raider(pilot)
    assert first['enemy_count'] == before + 1
    assert second['enemy_count'] == before + 2
    assert first['enemy']['id'] != second['enemy']['id']
    ids = {e['id'] for e in WorldStore(postgres_url).player_encounter(pilot)['snapshot']['enemies']}
    assert first['enemy']['id'] in ids
    assert second['enemy']['id'] in ids
