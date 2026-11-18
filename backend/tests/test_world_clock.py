"""The universe advances while the authoritative process runs, not while it is stopped."""
import time
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models import Entity, World, WorldClock, WorldClockSession
from app.store import WorldStore
from app.physics import State


def test_clock_freezes_during_clean_server_downtime(postgres_url):
    world_id = 'clock-' + uuid4().hex[:12]
    store = WorldStore(postgres_url)
    store.ensure_world(world_id)
    with store.sessions() as db:
        world = db.get(World, world_id)
        start = store.now(world)
    time.sleep(.11)
    with store.sessions() as db:
        live = store.now(db.get(World, world_id))
    assert .07 < live-start < .6
    store.stop_clock()
    with store.sessions() as db:
        saved = db.get(WorldClock, world_id).elapsed_s
    time.sleep(.16)  # Intentional offline wall-clock gap
    restarted = WorldStore(postgres_url)
    restarted.ensure_world(world_id)
    with restarted.sessions() as db:
        world = db.get(World, world_id)
        after = restarted.now(world)
    assert after == pytest.approx(saved, abs=.05)
    restarted.stop_clock()


def test_event_wall_times_remain_tied_to_original_runtime_segment(postgres_url):
    world_id = 'clock-' + uuid4().hex[:12]
    store = WorldStore(postgres_url)
    store.ensure_world(world_id)
    time.sleep(.08)
    with store.sessions() as db:
        world = db.get(World, world_id)
        at = store.now(world)
        actual_wall = store.clock.event_utc(db, world, at)
    assert abs(actual_wall - time.time()) < 2
    store.stop_clock()
    time.sleep(.15)
    restarted = WorldStore(postgres_url)
    restarted.ensure_world(world_id)
    with restarted.sessions() as db:
        world = db.get(World, world_id)
        original_wall = restarted.clock.event_utc(db, world, at)
        segments = db.scalars(select(WorldClockSession).where(
            WorldClockSession.world_id == world_id).order_by(
            WorldClockSession.started_at_utc)).all()
        assert len(segments) == 2
        assert segments[1].started_s >= segments[0].ended_s
        assert segments[1].started_at_utc - segments[0].ended_at_utc >= .10
    assert original_wall == pytest.approx(actual_wall, abs=.01)
    restarted.stop_clock()


def test_crash_recovery_never_rewinds_a_durable_ship_checkpoint(postgres_url):
    world_id = 'clock-' + uuid4().hex[:12]
    store = WorldStore(postgres_url)
    store.ensure_world(world_id)
    store.seed_entity(world_id, 'clock-ship-'+uuid4().hex[:12],
                      State(260, 0, 0, 34.525, 1110, 200))
    with store.sessions.begin() as db:
        ship = db.scalars(select(Entity).where(Entity.world_id == world_id)).one()
        ship.checkpoint_s += 2.5
        durable_checkpoint = ship.checkpoint_s
    # Simulate a crash: no latest heartbeat; durable entity progress is ahead.
    # A fresh server must not start at an earlier simulated timestamp.
    restarted = WorldStore(postgres_url)
    restarted.ensure_world(world_id)
    with restarted.sessions() as db:
        world = db.get(World, world_id)
        assert restarted.now(world) >= durable_checkpoint
    restarted.stop_clock()
    store.stop_clock()


def test_one_authoritative_writer_per_database(postgres_url):
    first, second = WorldStore(postgres_url), WorldStore(postgres_url)
    first.clock.acquire_ownership()
    try:
        with pytest.raises(RuntimeError, match='Another Orbital Outlaws server'):
            second.clock.acquire_ownership()
    finally:
        first.clock.release_ownership()
    second.clock.acquire_ownership()
    second.clock.release_ownership()
