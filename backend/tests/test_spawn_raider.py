from uuid import uuid4
from app.store import WorldStore


def test_each_dev_trigger_adds_one_inbound_ship_and_persists_both_factions(postgres_url,monkeypatch):
    decisions=iter([0,1,0,1])
    monkeypatch.setattr('app.store.secrets.randbelow',lambda n:next(decisions))
    store = WorldStore(postgres_url)
    store.ensure_world()
    pilot = uuid4().hex
    store.connect_player(pilot)
    before = store.player_encounter(pilot)['snapshot']
    raider1 = store.spawn_raider(pilot)
    raider2 = store.spawn_raider(pilot)
    ally1 = store.spawn_ally(pilot)
    ally2 = store.spawn_ally(pilot)
    assert raider1['ship_count'] == len(before['enemies']) + 1
    assert raider2['ship_count'] == len(before['enemies']) + 2
    assert ally1['ship_count'] == 1 and ally2['ship_count'] == 2
    assert len({d['ship']['id'] for d in (raider1,raider2,ally1,ally2)}) == 4
    assert [d['intent'] for d in (raider1,raider2,ally1,ally2)] == ['flyby','orbit','flyby','orbit']
    saved=WorldStore(postgres_url).player_encounter(pilot)['snapshot']
    assert len(saved['enemies']) == len(before['enemies']) + 2
    assert len(saved['allies']) == 2
    for body in saved['allies'] + saved['enemies'][len(before['enemies']):]:
        assert (body['x']**2 + body['y']**2)**.5 > 900
        assert body['arrivalPhase'] == 'launch'
        assert 20 <= (body['vx']**2+body['vy']**2)**.5 <= 32
        assert body['courseBurnAt'] >= saved['t']
