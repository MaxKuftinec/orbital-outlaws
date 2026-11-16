import time
from uuid import uuid4
import pytest
from app.store import WorldStore


def test_server_owns_encounter_and_catches_up_after_disconnect(postgres_url):
    store=WorldStore(postgres_url)
    store.ensure_world()
    pilot=uuid4().hex
    store.connect_player(pilot)
    original=store.player_encounter(pilot)
    assert original['snapshot']['version']==3
    assert len(original['snapshot']['enemies'])==2
    with pytest.raises(ValueError,match='disabled'):
        store.save_encounter(pilot,{'enemies':[]})
    time.sleep(.15)
    resumed=WorldStore(postgres_url).player_encounter(pilot)
    assert resumed['snapshot']['t']>original['snapshot']['t']
    assert len(resumed['snapshot']['enemies'])==2
    assert resumed['saved_at_utc']>original['saved_at_utc']
