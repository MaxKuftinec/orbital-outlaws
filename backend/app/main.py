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


app=FastAPI(title='Orbital Outlaws',version='0.19.0',lifespan=lifespan)


def require_dev_commands():
    if os.getenv('ORBITAL_DEV_COMMANDS', '0') != '1':
        raise HTTPException(403,'Development commands disabled; enable ORBITAL_DEV_COMMANDS=1 in a trusted local environment')



class PlayerInput(BaseModel):
    thrust: bool = False
    turn: int = Field(default=0, ge=-1, le=1)
    stabilize: bool = False
    gimbal: float = Field(default=0, ge=-0.4886921906, le=0.4886921906)
    fire: bool = False
    repair: bool = False
    aim_x: float = Field(default=0, ge=-1, le=1)
    aim_y: float = Field(default=0, ge=-1, le=1)



@app.websocket('/players/{pilot_id}/live')
async def pilot_live(ws: WebSocket,pilot_id: str):
    # Anonymous pilot IDs are permitted ONLY in trusted local development.
    if os.getenv('ORBITAL_DEV_COMMANDS')!='1' or len(pilot_id)!=32 or any(c not in '0123456789abcdef' for c in pilot_id):
        await ws.close(code=1008)
        return
    await ws.accept()
    database=store()
    try:
        await run_in_threadpool(database.connect_player,pilot_id)
        encounter=await run_in_threadpool(database.player_encounter,pilot_id)
        flight=await run_in_threadpool(database.get_entity,'kestrel','pilot-'+pilot_id)
        progress=await run_in_threadpool(database.player_progress,pilot_id)
        await ws.send_json({'type':'welcome','flight':flight,'progress':progress,
                            'encounter':encounter})
        while True:
            try:
                message=await asyncio.wait_for(ws.receive_json(),timeout=.25)
            except asyncio.TimeoutError:
                encounter=await run_in_threadpool(database.player_encounter,pilot_id)
                flight=await run_in_threadpool(database.get_entity,'kestrel','pilot-'+pilot_id)
                progress=await run_in_threadpool(database.player_progress,pilot_id)
                await ws.send_json({'type':'snapshot','flight':flight,
                                    'encounter':encounter,'progress':progress})
                continue
            try:
                kind=message.get('type')
                if kind=='input':
                    body=PlayerInput.model_validate(message)
                    await run_in_threadpool(database.player_input,pilot_id,
                                            body.thrust,body.turn,body.stabilize,body.gimbal)
                    if body.fire:
                        await run_in_threadpool(database.player_fire,pilot_id,body.aim_x,body.aim_y)
                    if body.repair:
                        await run_in_threadpool(database.player_repair,pilot_id)
                    encounter=await run_in_threadpool(database.player_encounter,pilot_id)
                    flight=await run_in_threadpool(database.get_entity,'kestrel','pilot-'+pilot_id)
                    progress=await run_in_threadpool(database.player_progress,pilot_id)
                    await ws.send_json({'type':'snapshot','flight':flight,
                                        'encounter':encounter,'progress':progress})
                elif kind=='purchase':
                    progress=await run_in_threadpool(database.player_purchase,pilot_id,
                                                     str(message.get('upgrade','')))
                    await ws.send_json({'type':'progress','progress':progress})
                elif kind=='reserve':
                    settings=ReserveConfig.model_validate(message)
                    progress=await run_in_threadpool(database.set_player_reserve,pilot_id,
                                                     settings.kg)
                    await ws.send_json({'type':'progress','progress':progress})
                elif kind=='request_assistance':
                    order=FuelRequest.model_validate(message)
                    outcome=await run_in_threadpool(database.request_assistance,pilot_id,
                                                     order.recipient,order.donor)
                    await ws.send_json({'type':'assistance','result':outcome})
                elif kind=='offer_fuel':
                    outcome=await run_in_threadpool(database.offer_fuel,pilot_id,
                                                     str(message.get('target','')),
                                                     float(message.get('kg',20)))
                    await ws.send_json({'type':'assistance','result':outcome})
                else:
                    raise ValueError('Only flight inputs, purchases, reserve settings and authorized fuel-assistance orders are accepted; NPCs and loot are server-owned')
            except (ValueError,ValidationError,LookupError) as exc:
                await ws.send_json({'type':'error','message':str(exc)})
    except WebSocketDisconnect:
        pass


@app.post('/players/{pilot_id}')
def connect_player(pilot_id: str):
    require_dev_commands()
    if len(pilot_id)!=32 or any(c not in '0123456789abcdef' for c in pilot_id):
        raise HTTPException(400,'Expected 32-character pilot ID')
    return store().connect_player(pilot_id)


@app.get('/players/{pilot_id}')
def player_state(pilot_id: str):
    require_dev_commands()
    return store().get_entity('kestrel','pilot-'+pilot_id)


@app.post('/players/{pilot_id}/input')
def player_input(pilot_id: str, command: PlayerInput):
    require_dev_commands()
    try:
        return store().player_input(pilot_id,command.thrust,command.turn,
                                    command.stabilize,command.gimbal)
    except LookupError as exc:
        raise HTTPException(404,str(exc)) from exc



@app.post('/dev/players/{pilot_id}/raiders', status_code=201)
def spawn_dev_raider(pilot_id: str):
    """Explicit dev-only enemy spawn. Intentionally absent from the game UI."""
    require_dev_commands()
    if len(pilot_id) != 32 or any(ch not in '0123456789abcdef' for ch in pilot_id):
        raise HTTPException(400, 'Expected 32-character pilot ID')
    try:
        return store().spawn_raider(pilot_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc



@app.post('/dev/players/{pilot_id}/allies', status_code=201)
def spawn_dev_ally(pilot_id: str):
    """Create one incoming allied spacecraft; no player-facing spawn control."""
    require_dev_commands()
    if len(pilot_id) != 32 or any(ch not in '0123456789abcdef' for ch in pilot_id):
        raise HTTPException(400, 'Expected 32-character pilot ID')
    try:
        return store().spawn_ally(pilot_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post('/dev/players/{pilot_id}/respawn')
def respawn_dev_pilot(pilot_id: str):
    """Replace destroyed ship, reset credits/upgrades, retain NPC sector."""
    require_dev_commands()
    if len(pilot_id) != 32 or any(ch not in '0123456789abcdef' for ch in pilot_id):
        raise HTTPException(400, 'Expected 32-character pilot ID')
    try:
        return store().respawn_player(pilot_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.get('/')
def health():
    return {'status':'ok','architecture':'lazy-orbits','authority':'sector-authoritative'}


class ReserveConfig(BaseModel):
    kg: float = Field(ge=0, le=200, allow_inf_nan=False)


@app.post('/players/{pilot_id}/reserve')
def set_reserve(pilot_id: str, config: ReserveConfig):
    require_dev_commands()
    try:
        return store().set_player_reserve(pilot_id, config.kg)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class FuelRequest(BaseModel):
    recipient: str = 'player'
    donor: str | None = None


class FuelOffer(BaseModel):
    target: str
    kg: float = Field(default=20, gt=0, le=35)


@app.post('/players/{pilot_id}/request-assistance')
def request_assistance(pilot_id: str, body: FuelRequest):
    require_dev_commands()
    try:
        return store().request_assistance(pilot_id, body.recipient, body.donor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post('/players/{pilot_id}/offer-fuel')
def offer_fuel(pilot_id: str, body: FuelOffer):
    require_dev_commands()
    try:
        return store().offer_fuel(pilot_id, body.target, body.kg)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


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


@app.get('/worlds/{world_id}')
def world(world_id: str):
    if world_id!='kestrel':raise HTTPException(404,'Unknown world')
    return store().ensure_world(world_id)


@app.post('/worlds/{world_id}/entities',status_code=201)
def spawn(world_id: str,body: SpawnBody):
    require_dev_commands()
    try:
        if body.fuel_kg>body.mass_kg:raise ValueError('Propellant cannot exceed mass')
        if (body.x**2+body.y**2)**.5<91:raise ValueError('Inside central body')
        entity_id=store().seed_entity(world_id,body.id,State(body.x,body.y,body.vx,body.vy,body.mass_kg,body.fuel_kg),body.kind)
        return {'id':entity_id}
    except LookupError as exc:raise HTTPException(404,str(exc)) from exc
    except ValueError as exc:raise HTTPException(409,str(exc)) from exc


@app.get('/worlds/{world_id}/entities/{entity_id}')
def get_entity(world_id: str,entity_id: str,at_s: float|None=None):
    try:return store().get_entity(world_id,entity_id,at_s)
    except LookupError as exc:raise HTTPException(404,str(exc)) from exc
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc


@app.get('/worlds/{world_id}/viewport')
def viewport(world_id: str,cx: float=0,cy: float=0,radius_km:float=Query(700,gt=0,le=100000),at_s:float|None=None):
    try:return store().viewport(world_id,cx,cy,radius_km,at_s)
    except LookupError as exc:raise HTTPException(404,str(exc)) from exc
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc


@app.post('/worlds/{world_id}/entities/{entity_id}/impulses')
def impulse(world_id: str,entity_id: str,body: ImpulseBody):
    require_dev_commands()
    try:return store().apply_impulse(world_id,entity_id,body.dvx,body.dvy,body.idempotency_key,body.reserve_kg)
    except LookupError as exc:raise HTTPException(404,str(exc)) from exc
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc
