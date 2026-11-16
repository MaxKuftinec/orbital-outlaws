"""Lazy query API: checkpoint + event source, with radial coarse filtering

Collision graph / active thrusters are not yet authoritative. The safe role of this
first API is durable snapshots, impulsive manoeuvre events and Kepler coasts
"""
from __future__ import annotations
import math, time
from sqlalchemy import create_engine, select, and_, or_
from sqlalchemy.orm import sessionmaker
from .models import Base, World, Entity, Event
from .physics import State, propagate, orbital_envelope, apply_impulse


class WorldStore:
    def __init__(self, database_url: str):
        self.engine=create_engine(database_url)
        self.sessions=sessionmaker(self.engine,expire_on_commit=False)
        Base.metadata.create_all(self.engine)

    def ensure_world(self,world_id: str='kestrel',mu: float=310000):
        with self.sessions.begin() as db:
            world=db.get(World,world_id)
            if not world:
                world=World(id=world_id,mu=mu,epoch_utc=time.time())
                db.add(world)
            return {'id':world.id,'mu':world.mu,'epoch_utc':world.epoch_utc}

    def now(self,world: World) -> float:
        return max(0.,time.time()-world.epoch_utc)

    def seed_entity(self,world_id: str,entity_id: str,state: State,kind: str='ship'):
        with self.sessions.begin() as db:
            world=db.get(World,world_id)
            if not world:raise LookupError('World not found')
            if db.get(Entity,entity_id):raise ValueError('Entity already exists')
            peri,apo=orbital_envelope(state,world.mu)
            entity=Entity(id=entity_id,world_id=world_id,kind=kind,
                          checkpoint_s=self.now(world),checkpoint=state.as_dict(),
                          periapsis_km=peri,apoapsis_km=apo)
            db.add(entity);db.flush()
            db.add(Event(world_id=world_id,entity_id=entity_id,at_s=entity.checkpoint_s,
                         kind='spawn',payload={},after=state.as_dict(),idempotency_key=f'spawn:{entity_id}'))
            return entity.id

    def _at(self,db,world_id,entity_id,at_s: float|None=None):
        world=db.get(World,world_id)
        if not world:raise LookupError('World not found')
        entity=db.get(Entity,entity_id)
        if not entity or entity.world_id!=world_id:raise LookupError('Entity not found')
        at=self.now(world) if at_s is None else float(at_s)
        if at<0:raise ValueError('Negative world time')
        if at>=entity.checkpoint_s:
            base=State(**entity.checkpoint);base_t=entity.checkpoint_s
        else:
            event=db.scalars(select(Event).where(and_(Event.entity_id==entity_id,Event.at_s<=at)).order_by(Event.at_s.desc(),Event.id.desc()).limit(1)).first()
            if not event:raise ValueError('Entity did not exist at this time')
            base=State(**event.after);base_t=event.at_s
        return world,entity,at,propagate(base,at-base_t,world.mu)

    def get_entity(self,world_id: str,entity_id: str,at_s: float|None=None):
        with self.sessions() as db:
            world,ent,at,s=self._at(db,world_id,entity_id,at_s)
            return {'id':ent.id,'kind':ent.kind,'state':s.as_dict(),'at_s':at,
                    'version':ent.version,'predicted':at>self.now(world)+.005}

    def viewport(self,world_id: str,cx: float,cy: float,radius_km: float,at_s: float|None=None):
        if not 0<radius_km<=100000:raise ValueError('Invalid viewport radius')
        with self.sessions() as db:
            world=db.get(World,world_id)
            if not world:raise LookupError('World not found')
            at=self.now(world) if at_s is None else float(at_s)
            if at<0:raise ValueError('Negative world time')
            cr=math.hypot(cx,cy)
            # Radial envelopes are conservative for the CURRENT osculating orbit
            # Historical viewport queries use all entities (older events may change envelopes)
            past=at<self.now(world)-1.0
            q=select(Entity).where(Entity.world_id==world_id)
            if not past:
                q=q.where(and_(Entity.periapsis_km<=cr+radius_km,
                               or_(Entity.apoapsis_km==None,Entity.apoapsis_km>=max(0,cr-radius_km))))
            rows=db.scalars(q).all()
            found=[]
            for entity in rows:
                try:
                    _,_,_,s=self._at(db,world_id,entity.id,at)
                except ValueError:
                    continue
                if math.hypot(s.x-cx,s.y-cy)<=radius_km:
                    found.append({'id':entity.id,'kind':entity.kind,'state':s.as_dict()})
            return {'world_id':world_id,'at_s':at,'entities':found,'candidate_count':len(rows),
                    'predicted':at>self.now(world)+.005}

    def apply_impulse(self,world_id: str,entity_id: str,dvx: float,dvy: float,key: str,reserve_kg: float=0):
        """Authoritative development command using server time (never client-supplied time)."""
        if not key or len(key)>128:raise ValueError('Invalid idempotency key')
        with self.sessions.begin() as db:
            previous=db.scalars(select(Event).where(and_(Event.world_id==world_id,Event.idempotency_key==key))).first()
            if previous:
                if previous.entity_id!=entity_id:raise ValueError('Duplicate command key belongs to another entity')
                return {'at_s':previous.at_s,'state':previous.after,'replayed':True}
            world=db.get(World,world_id)
            if not world:raise LookupError('World not found')
            entity=db.scalars(select(Entity).where(and_(Entity.id==entity_id,Entity.world_id==world_id)).with_for_update()).first()
            if not entity:raise LookupError('Entity not found')
            at=max(self.now(world),entity.checkpoint_s)
            before=propagate(State(**entity.checkpoint),at-entity.checkpoint_s,world.mu)
            after=apply_impulse(before,dvx,dvy,320.,reserve_kg)
            peri,apo=orbital_envelope(after,world.mu)
            entity.checkpoint_s=at
            entity.checkpoint=after.as_dict()
            entity.periapsis_km=peri;entity.apoapsis_km=apo
            entity.version+=1
            db.add(Event(world_id=world_id,entity_id=entity_id,at_s=at,
                         kind='impulse',payload={'dvx':dvx,'dvy':dvy,'reserve_kg':reserve_kg},
                         after=after.as_dict(),idempotency_key=key))
            return {'at_s':at,'state':after.as_dict(),'replayed':False}
