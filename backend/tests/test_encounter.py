import time
from uuid import uuid4
import pytest
from app.store import WorldStore


def test_server_simulates_live_time_but_not_downtime(postgres_url):
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
    during_live=store.player_encounter(pilot)
    assert during_live['snapshot']['t']>original['snapshot']['t']
    assert during_live['saved_at_utc']>original['saved_at_utc']
    stop_t=during_live['snapshot']['t']
    store.stop_clock()
    time.sleep(.16)  # The server is DOWN, so sim time cannot advance.
    restarted=WorldStore(postgres_url)
    resumed=restarted.player_encounter(pilot)
    assert resumed['snapshot']['t']==pytest.approx(stop_t,abs=.04)
    assert len(resumed['snapshot']['enemies'])==2
