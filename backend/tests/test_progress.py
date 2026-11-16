from uuid import uuid4
import pytest
from app.store import WorldStore


def test_persistent_credits_upgrades_and_idempotent_salvage(postgres_url):
    store=WorldStore(postgres_url)
    store.ensure_world()
    pilot=uuid4().hex
    store.connect_player(pilot)
    assert store.player_progress(pilot)=={'credits':65,'upgrades':{},'reserve_kg':36.}
    bought=store.player_purchase(pilot,'predictive')
    assert bought=={'credits':25,'upgrades':{'predictive':True},'reserve_kg':36.}
    assert store.player_purchase(pilot,'predictive')==bought
    with pytest.raises(ValueError,match='Insufficient credits'):
        store.player_purchase(pilot,'nav')
    assert store.player_progress(pilot)==bought
    credited=store.player_salvage(pilot,'starter-credits-0',24)
    assert credited['credits']==49
    assert store.player_salvage(pilot,'starter-credits-0',24)==credited
    reopened=WorldStore(postgres_url)
    assert reopened.player_progress(pilot)==credited
    assert reopened.player_purchase(pilot,'trajectory')['credits']==24


def test_salvage_capture_upgrade_is_purchased_and_persists(postgres_url):
    store=WorldStore(postgres_url)
    store.ensure_world()
    pilot=uuid4().hex
    store.connect_player(pilot)
    bought=store.player_purchase(pilot,'capture')
    assert bought['credits']==10
    assert bought['upgrades']['capture'] is True
    assert store.player_purchase(pilot,'capture')==bought
    assert WorldStore(postgres_url).player_progress(pilot)==bought
