from __future__ import annotations
import os
import asyncio
from dotenv import load_dotenv
from contextlib import asynccontextmanager
from functools import lru_cache
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool
from pydantic import ValidationError
from pydantic import BaseModel, Field
from .physics import State
from .store import WorldStore

load_dotenv()

@lru_cache
def store() -> WorldStore:
    return WorldStore(os.environ['DATABASE_URL'])


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store().ensure_world()
    yield


app=FastAPI(title='Orbital Outlaws',version='0.9.0',lifespan=lifespan)


def require_dev_commands():
    if os.getenv('ORBITAL_DEV_COMMANDS', '0') != '1':
        raise HTTPException(403,'Development commands disabled; enable ORBITAL_DEV_COMMANDS=1 in a trusted local environment')



class PlayerInput(BaseModel):
    thrust: bool = False
    turn: int = Field(default=0, ge=-1, le=1)
    stabilize: bool = False
    gimbal: float = Field(default=0, ge=-0.4886921906, le=0.4886921906)



@app.websocket('/api/players/{pilot_id}/live')
async def pilot_live(ws: WebSocket,pilot_id: str):
    # Anonymous pilot IDs and client-reported salvage are permitted ONLY in local dev.
    if os.getenv('ORBITAL_DEV_COMMANDS')!='1' or len(pilot_id)!=32 or any(c not in '0123456789abcdef' for c in pilot_id):
        await ws.close(code=1008)
        return
    await ws.accept()
    database=store()
    try:
        flight=await run_in_threadpool(database.connect_player,pilot_id)
        progress=await run_in_threadpool(database.player_progress,pilot_id)
        await ws.send_json({'type':'welcome','flight':flight,'progress':progress})
        while True:
            try:
                message=await asyncio.wait_for(ws.receive_json(),timeout=.1)
            except asyncio.TimeoutError:
                flight=await run_in_threadpool(database.get_entity,'kestrel','pilot-'+pilot_id)
                await ws.send_json({'type':'snapshot','flight':flight})
                continue
            try:
                kind=message.get('type')
                if kind=='input':
                    body=PlayerInput.model_validate(message)
                    flight=await run_in_threadpool(database.player_input,pilot_id,body.thrust,body.turn,body.stabilize,body.gimbal)
                    await ws.send_json({'type':'snapshot','flight':flight})
                elif kind=='purchase':
                    progress=await run_in_threadpool(database.player_purchase,pilot_id,str(message.get('upgrade','')))
                    await ws.send_json({'type':'progress','progress':progress})
                elif kind=='salvage':
                    progress=await run_in_threadpool(database.player_salvage,pilot_id,str(message.get('id','')),int(message.get('credits',0)))
                    await ws.send_json({'type':'progress','progress':progress})
                else:
                    raise ValueError('Unknown message type')
            except (ValueError,ValidationError,LookupError) as exc:
                await ws.send_json({'type':'error','message':str(exc)})
    except WebSocketDisconnect:
        pass


@app.post('/api/players/{pilot_id}')
def connect_player(pilot_id: str):
    require_dev_commands()
    if len(pilot_id)!=32 or any(c not in '0123456789abcdef' for c in pilot_id):
        raise HTTPException(400,'Expected 32-character pilot ID')
    return store().connect_player(pilot_id)


@app.get('/api/players/{pilot_id}')
def player_state(pilot_id: str):
    require_dev_commands()
    return store().get_entity('kestrel','pilot-'+pilot_id)


@app.post('/api/players/{pilot_id}/input')
def player_input(pilot_id: str, command: PlayerInput):
    require_dev_commands()
    try:
        return store().player_input(pilot_id,command.thrust,command.turn,
                                    command.stabilize,command.gimbal)
    except LookupError as exc:
        raise HTTPException(404,str(exc)) from exc


@app.get('/')
def health():
    return {'status':'ok','architecture':'lazy-orbits','authority':'player-flight-only'}


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
