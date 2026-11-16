from __future__ import annotations
import os
from contextlib import asynccontextmanager
from functools import lru_cache
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from .physics import State
from .store import WorldStore

@lru_cache
def store() -> WorldStore:
    url=os.getenv('DATABASE_URL','sqlite:///./orbital-outlaws.db')
    return WorldStore(url)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store().ensure_world()
    yield


app=FastAPI(title='Orbital Outlaws — Persistent Universe Foundation',version='0.7.0',lifespan=lifespan)


def require_dev_commands():
    if os.getenv('ORBITAL_DEV_COMMANDS', '0') != '1':
        raise HTTPException(403,'Development commands disabled; enable ORBITAL_DEV_COMMANDS=1 in a trusted local environment')


@app.get('/api/health')
def health():
    return {'status':'ok','architecture':'lazy-orbits','authority':'foundation-only'}


class SpawnBody(BaseModel):
    id: str=Field(pattern=r'^[a-zA-Z0-9_-]{1,80}$')
    kind: str='ship'
    x: float
    y: float
    vx: float
    vy: float
    mass_kg: float=Field(default=1110,gt=0)
    fuel_kg: float=Field(default=200,ge=0)


class ImpulseBody(BaseModel):
    dvx: float
    dvy: float
    idempotency_key: str=Field(min_length=1,max_length=128)
    reserve_kg: float=Field(default=0,ge=0)


@app.get('/api/worlds/{world_id}')
def world(world_id: str):
    if world_id!='kestrel':raise HTTPException(404,'Unknown world')
    return store().ensure_world(world_id)


@app.post('/api/worlds/{world_id}/entities',status_code=201)
def spawn(world_id: str,body: SpawnBody):
    require_dev_commands()
    try:
        if body.fuel_kg>body.mass_kg:raise ValueError('Propellant cannot exceed mass')
        if (body.x**2+body.y**2)**.5<91:raise ValueError('Inside central body')
        entity_id=store().seed_entity(world_id,body.id,State(body.x,body.y,body.vx,body.vy,body.mass_kg,body.fuel_kg),body.kind)
        return {'id':entity_id}
    except LookupError as exc:raise HTTPException(404,str(exc)) from exc
    except ValueError as exc:raise HTTPException(409,str(exc)) from exc


@app.get('/api/worlds/{world_id}/entities/{entity_id}')
def get_entity(world_id: str,entity_id: str,at_s: float|None=None):
    try:return store().get_entity(world_id,entity_id,at_s)
    except LookupError as exc:raise HTTPException(404,str(exc)) from exc
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc


@app.get('/api/worlds/{world_id}/viewport')
def viewport(world_id: str,cx: float=0,cy: float=0,radius_km:float=Query(700,gt=0,le=100000),at_s:float|None=None):
    try:return store().viewport(world_id,cx,cy,radius_km,at_s)
    except LookupError as exc:raise HTTPException(404,str(exc)) from exc
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc


@app.post('/api/worlds/{world_id}/entities/{entity_id}/impulses')
def impulse(world_id: str,entity_id: str,body: ImpulseBody):
    require_dev_commands()
    try:return store().apply_impulse(world_id,entity_id,body.dvx,body.dvy,body.idempotency_key,body.reserve_kg)
    except LookupError as exc:raise HTTPException(404,str(exc)) from exc
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc
