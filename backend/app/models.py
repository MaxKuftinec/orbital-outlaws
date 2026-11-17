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


class PlayerSettings(Base):
    """Pilot preferences survive ship destruction and technology resets."""
    __tablename__ = 'player_settings'
    entity_id: Mapped[str] = mapped_column(ForeignKey('entities.id'), primary_key=True)
    reserve_kg: Mapped[float] = mapped_column(Float, nullable=False, default=36.0)


class SalvageClaim(Base):
    __tablename__='salvage_claims'
    entity_id: Mapped[str]=mapped_column(ForeignKey('entities.id'),primary_key=True)
    claim_id: Mapped[str]=mapped_column(String(128),primary_key=True)
    amount: Mapped[int]=mapped_column(Integer,nullable=False)

class EncounterSnapshot(Base):
    """Temporary pilot-scoped checkpoint until NPC simulation becomes authoritative."""
    __tablename__='encounter_snapshots'
    entity_id: Mapped[str]=mapped_column(ForeignKey('entities.id'),primary_key=True)
    saved_at_utc: Mapped[float]=mapped_column(Float,nullable=False)
    snapshot: Mapped[dict]=mapped_column(JSON,nullable=False)


class Account(Base):
    """Player identity is separate from legacy per-pilot game entities."""
    __tablename__ = 'accounts'
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    username: Mapped[str] = mapped_column(String(24), nullable=False, unique=True, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    avatar_id: Mapped[str] = mapped_column(String(30), nullable=False, default='navigator')
    created_at: Mapped[float] = mapped_column(Float, nullable=False)


class EmailChallenge(Base):
    """One-time code hash; never persist or log the delivered six digits."""
    __tablename__ = 'email_challenges'
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), primary_key=True)
    challenge_id: Mapped[str] = mapped_column(String(40), nullable=False)
    digest: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[float] = mapped_column(Float, nullable=False)
    sent_at: Mapped[float] = mapped_column(Float, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class AccountSession(Base):
    """Only a SHA-256 digest of the opaque bearer token is persisted."""
    __tablename__ = 'account_sessions'
    token_digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), index=True)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
    expires_at: Mapped[float] = mapped_column(Float, nullable=False)


class AuthThrottle(Base):
    __tablename__ = 'auth_throttles'
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    resets_at: Mapped[float] = mapped_column(Float, nullable=False)
