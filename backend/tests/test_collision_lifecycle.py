"""Regression coverage for physical impacts and persistent ship termination."""
import math
from uuid import uuid4

import pytest

from app.models import Entity, EncounterSnapshot, Event
from app.physics import State
from app.star_system import (CelestialImpact, PLANET_COLLISION_RADIUS_KM,
                             PLANET_MU, propagate_local)
from app.store import WorldStore


def test_inbound_kepler_coast_terminates_at_kestrel_surface():
    falling = State(170., 0., -45., 0.)
    with pytest.raises(CelestialImpact) as outcome:
        propagate_local(falling, 12., PLANET_MU, 0., detect_impact=True)
    collision = outcome.value
    assert collision.body == 'kestrel'
    assert 0. < collision.at_s < 12.
    assert math.hypot(collision.state.x, collision.state.y) == pytest.approx(
        PLANET_COLLISION_RADIUS_KM, abs=1e-4)


def test_grazing_orbit_cannot_tunnel_below_surface():
    # An orbit with a periapsis just 50 m inside the collision surface
    # must be detected even if nearby sampling endpoints are outside.
    apoapsis, periapsis = 170., PLANET_COLLISION_RADIUS_KM - .05
    speed = math.sqrt(2 * PLANET_MU * periapsis /
                      (apoapsis * (apoapsis + periapsis)))
    with pytest.raises(CelestialImpact):
        propagate_local(State(apoapsis, 0., 0., speed),
                        15., PLANET_MU, 0., detect_impact=True)


def test_near_surface_but_safe_orbit_does_not_false_positive():
    apoapsis, periapsis = 170., PLANET_COLLISION_RADIUS_KM + .05
    speed = math.sqrt(2 * PLANET_MU * periapsis /
                      (apoapsis * (apoapsis + periapsis)))
    result = propagate_local(State(apoapsis, 0., 0., speed),
                             15., PLANET_MU, 0., detect_impact=True)
    assert math.hypot(result.x, result.y) > PLANET_COLLISION_RADIUS_KM


def test_circular_orbit_does_not_false_positive():
    safe = State(260., 0., 0., math.sqrt(PLANET_MU / 260.))
    result = propagate_local(safe, 120., PLANET_MU, 0., detect_impact=True)
    assert math.hypot(result.x, result.y) > PLANET_COLLISION_RADIUS_KM


def test_destroyed_orbit_freezes_through_reconnect_restart_and_respawn(postgres_url):
    store = WorldStore(postgres_url)
    store.ensure_world()
    pilot = uuid4().hex
    entity_id = 'pilot-' + pilot
    store.now = lambda world: 0.
    store.connect_player(pilot)
    with store.sessions.begin() as db:
        ship = db.get(Entity, entity_id)
        ship.checkpoint = State(170., 0., -45., 0.).as_dict()
        ship.checkpoint_s = 0.
        assert db.get(EncounterSnapshot, entity_id).snapshot['player']['alive']

    store.now = lambda world: 12.
    snapshot = store.player_encounter(pilot)['snapshot']
    assert not snapshot['player']['alive']
    assert snapshot['player']['destroyedCause'] == 'kestrel'
    with store.sessions() as db:
        entity = db.get(Entity, entity_id)
        frozen = dict(entity.checkpoint)
        assert 0. < entity.checkpoint_s < 12.
        assert db.query(Event).filter_by(entity_id=entity_id, kind='ship_destroyed').count() == 1

    # Repeated reads and live reconnect cannot resume the impact orbit.
    store.now = lambda world: 100.
    assert store.connect_player(pilot)['state'] == frozen
    assert store.get_entity('kestrel', entity_id)['state'] == frozen
    assert not store.player_encounter(pilot)['snapshot']['player']['alive']
    with store.sessions() as db:
        assert db.query(Event).filter_by(entity_id=entity_id, kind='ship_destroyed').count() == 1

    replacement = store.respawn_player(pilot)
    assert replacement['state'] != frozen
    assert store.get_entity('kestrel', entity_id)['state']['x'] == pytest.approx(
        replacement['state']['x'])
    assert store.player_encounter(pilot)['snapshot']['player']['alive']


def test_respawn_does_not_replay_a_legacy_invalid_checkpoint(postgres_url):
    store = WorldStore(postgres_url)
    store.ensure_world()
    pilot = uuid4().hex
    store.now = lambda world: 0.
    store.connect_player(pilot)
    with store.sessions.begin() as db:
        entity = db.get(Entity, 'pilot-' + pilot)
        entity.checkpoint = State(0., 0., 0., 0.).as_dict()
        entity.checkpoint_s = 0.
    store.now = lambda world: 5.
    replacement = store.respawn_player(pilot)
    assert math.hypot(replacement['state']['x'], replacement['state']['y']) > 100.
    assert store.get_entity('kestrel', 'pilot-' + pilot)['state']
