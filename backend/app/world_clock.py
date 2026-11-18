"""Server-runtime clock for the persistent Orbital Outlaws simulation.

Simulation time is accumulated from time.monotonic() *only while the
authoritative API process is running*. PostgreSQL checkpoints preserve the
counter through shutdowns; no clock wall-time delta is replayed on restart.

Single-writer advisory ownership is enforced for FastAPI startup. Background
heartbeat checkpoints limit an abrupt crash to at most one heartbeat interval
of uncheckpointed clock time. Per-session anchors reconstruct when historical
sector events occurred even after planned downtime.
"""
from __future__ import annotations

import threading
import time
from uuid import uuid4

from sqlalchemy import func, select
from .models import World, WorldClock, WorldClockSession, Entity, Event, EncounterSnapshot

CLOCK_LOCK_KEY = 681273065
HEARTBEAT_SECONDS = 1.


class ServerClock:
    def __init__(self, engine, sessions):
        self.engine = engine
        self.sessions = sessions
        self._mutex = threading.RLock()
        # world_id -> (persisted simulation base, monotonic start, wall start, session id)
        self._anchors: dict[str, tuple[float, float, float, str]] = {}
        self._ownership_connection = None

    def acquire_ownership(self):
        """Fail closed if another API process already owns the same DB universe.

        This is intentionally incompatible with multiple independent uvicorn
        workers; scaling requires a dedicated authoritative simulation worker.
        """
        with self._mutex:
            if self._ownership_connection is not None:
                return
            connection = self.engine.connect()
            try:
                if not connection.exec_driver_sql(
                        f'SELECT pg_try_advisory_lock({CLOCK_LOCK_KEY})').scalar():
                    raise RuntimeError('Another Orbital Outlaws server owns this universe clock')
                connection.commit()
                self._ownership_connection = connection
            except BaseException:
                connection.close()
                raise

    def release_ownership(self):
        with self._mutex:
            if self._ownership_connection is None:
                return
            try:
                self._ownership_connection.exec_driver_sql(
                    f'SELECT pg_advisory_unlock({CLOCK_LOCK_KEY})')
                self._ownership_connection.commit()
            finally:
                self._ownership_connection.close()
                self._ownership_connection = None

    def _seed_from_checkpoints(self, db, world: World) -> float:
        """Avoid rewinding entities if the previous process crashed mid-tick."""
        entity_max = db.scalar(select(func.max(Entity.checkpoint_s)).where(
            Entity.world_id == world.id)) or 0.
        event_max = db.scalar(select(func.max(Event.at_s)).where(
            Event.world_id == world.id)) or 0.
        sector_max = 0.
        for snapshot in db.scalars(
                select(EncounterSnapshot.snapshot).join(
                    Entity, EncounterSnapshot.entity_id == Entity.id).where(
                    Entity.world_id == world.id)):
            if isinstance(snapshot, dict):
                sector_max = max(sector_max, float(snapshot.get('t') or 0.))
        return max(0., entity_max, event_max, sector_max)

    def start(self, world_id: str):
        with self._mutex:
            if world_id in self._anchors:
                return
            with self.sessions.begin() as db:
                world = db.get(World, world_id)
                if not world:
                    raise LookupError('Unknown world')
                row = db.scalars(select(WorldClock).where(
                    WorldClock.world_id == world_id).with_for_update()).first()
                # Even the FIRST migration must not replay historical
                # downtime: recover from the newest DURABLE gameplay
                # checkpoint, never from the old wall-clock world epoch.
                persisted_s = 0. if row is None else row.elapsed_s
                resumed_s = max(persisted_s, self._seed_from_checkpoints(db, world))
                wall_start = time.time()
                mono_start = time.monotonic()
                if row is None:
                    db.add(WorldClock(world_id=world_id, elapsed_s=resumed_s,
                                      updated_at_utc=wall_start))
                else:
                    row.elapsed_s = resumed_s
                    row.updated_at_utc = wall_start
                session_id = uuid4().hex
                db.add(WorldClockSession(id=session_id, world_id=world_id,
                    started_s=resumed_s, ended_s=resumed_s,
                    started_at_utc=wall_start, ended_at_utc=wall_start))
            self._anchors[world_id] = (
                resumed_s, mono_start, wall_start, session_id)

    def now(self, world_id: str) -> float:
        with self._mutex:
            if world_id not in self._anchors:
                self.start(world_id)
            start_s, start_mono, _, _ = self._anchors[world_id]
            return start_s + max(0., time.monotonic() - start_mono)

    def checkpoint(self) -> None:
        with self._mutex:
            for world_id, (start_s, start_mono, wall_start, session_id) in self._anchors.items():
                current_s = start_s + max(0., time.monotonic() - start_mono)
                with self.sessions.begin() as db:
                    row = db.scalars(select(WorldClock).where(
                        WorldClock.world_id == world_id).with_for_update()).one()
                    row.elapsed_s = max(row.elapsed_s, current_s)
                    row.updated_at_utc = time.time()
                    segment = db.get(WorldClockSession, session_id)
                    segment.ended_s = max(segment.ended_s, current_s)
                    segment.ended_at_utc = wall_start + (current_s - start_s)

    def stop(self):
        """Graceful shutdown checkpoints and releases the local time anchor."""
        with self._mutex:
            try:
                self.checkpoint()
            finally:
                self._anchors.clear()
                self.release_ownership()

    def event_utc(self, db, world: World, at_s: float) -> float:
        """Translate a *simulation* timestamp using its original server run."""
        with self._mutex:
            anchor = self._anchors.get(world.id)
            if anchor:
                start_s, _, start_wall, _ = anchor
                if at_s >= start_s:
                    return start_wall + (at_s - start_s)
        segment = db.scalars(select(WorldClockSession).where(
            WorldClockSession.world_id == world.id,
            WorldClockSession.started_s <= at_s,
            WorldClockSession.ended_s >= at_s
        ).order_by(WorldClockSession.started_s.desc()).limit(1)).first()
        if segment:
            return segment.started_at_utc + (at_s - segment.started_s)
        # Historical pre-migration events used wall epoch; this fallback is
        # only for events authored before the logical clock existed.
        return world.epoch_utc + at_s
