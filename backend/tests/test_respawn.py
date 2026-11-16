import copy
import math
from uuid import uuid4
import pytest
from app.models import EncounterSnapshot
from app.store import WorldStore


def test_dev_respawn_keeps_sector_and_economy_but_creates_random_outer_ship(postgres_url):
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
    assert respawn['progress_preserved'] is True
    assert respawn['sector_preserved'] is True
    assert respawn['arrival_control']=='manual'
    assert respawn['spawn_radius_km']>900
    state=respawn['state']
    assert 20<=math.hypot(state['vx'],state['vy'])<=32
    assert state['fuel_kg']==200
    assert state['mass_kg']==1110
    assert store.player_progress(pilot)==progress_before
    resumed=WorldStore(postgres_url).player_encounter(pilot)['snapshot']
    assert resumed['player']['alive'] is True
    assert resumed['player']['hp']==100
    assert raider in {e['id'] for e in resumed['enemies']}
    with pytest.raises(ValueError, match='still alive'):
        store.respawn_player(pilot)
