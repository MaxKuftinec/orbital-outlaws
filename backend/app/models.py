"""Persistent authoritative orbital state and immutable event log."""
from __future__ import annotations
from sqlalchemy import Float, ForeignKey, Integer, String, JSON, Index, UniqueConstraint, Boolean
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class World(Base):
    __tablename__='worlds'
    id: Mapped[str]=mapped_column(String(80),primary_key=True)
    mu: Mapped[float]=mapped_column(Float,nullable=False)
    epoch_utc: Mapped[float]=mapped_column(Float,nullable=False)


class Entity(Base):
    __tablename__='entities'
    id: Mapped[str]=mapped_column(String(80),primary_key=True)
    world_id: Mapped[str]=mapped_column(ForeignKey('worlds.id'),index=True)
    kind: Mapped[str]=mapped_column(String(40))
    checkpoint_s: Mapped[float]=mapped_column(Float,nullable=False,default=0)
    checkpoint: Mapped[dict]=mapped_column(JSON,nullable=False)
    periapsis_km: Mapped[float]=mapped_column(Float,nullable=False)
    apoapsis_km: Mapped[float | None]=mapped_column(Float)
    version: Mapped[int]=mapped_column(Integer,default=0)
    __table_args__=(Index('ix_entities_radial', 'world_id','periapsis_km','apoapsis_km'),)


class Event(Base):
    __tablename__='events'
    id: Mapped[int]=mapped_column(Integer,primary_key=True,autoincrement=True)
    world_id: Mapped[str]=mapped_column(ForeignKey('worlds.id'),index=True)
    entity_id: Mapped[str]=mapped_column(ForeignKey('entities.id'),index=True)
    at_s: Mapped[float]=mapped_column(Float,nullable=False,index=True)
    kind: Mapped[str]=mapped_column(String(40))
    payload: Mapped[dict]=mapped_column(JSON,nullable=False,default=dict)
    after: Mapped[dict]=mapped_column(JSON,nullable=False)
    idempotency_key: Mapped[str]=mapped_column(String(128),nullable=False)
    __table_args__=(UniqueConstraint('world_id','idempotency_key',name='uq_world_command_key'),)


class FlightControl(Base):
    __tablename__='flight_controls'
    entity_id: Mapped[str]=mapped_column(ForeignKey('entities.id'),primary_key=True)
    thrust: Mapped[bool]=mapped_column(Boolean,default=False)
    turn: Mapped[int]=mapped_column(Integer,default=0)
    stabilize: Mapped[bool]=mapped_column(Boolean,default=False)
    gimbal: Mapped[float]=mapped_column(Float,default=0)
    expires_s: Mapped[float]=mapped_column(Float,default=0)


class PlayerProgress(Base):
    __tablename__='player_progress'
    entity_id: Mapped[str]=mapped_column(ForeignKey('entities.id'),primary_key=True)
    credits: Mapped[int]=mapped_column(Integer,nullable=False,default=65)
    upgrades: Mapped[dict]=mapped_column(JSON,nullable=False,default=dict)


class SalvageClaim(Base):
    __tablename__='salvage_claims'
    entity_id: Mapped[str]=mapped_column(ForeignKey('entities.id'),primary_key=True)
    claim_id: Mapped[str]=mapped_column(String(128),primary_key=True)
    amount: Mapped[int]=mapped_column(Integer,nullable=False)
