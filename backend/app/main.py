from __future__ import annotations
import os
import asyncio
import time
from dotenv import load_dotenv
from contextlib import asynccontextmanager, suppress
import logging
from functools import lru_cache
from typing import Literal
from fastapi import FastAPI, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.concurrency import run_in_threadpool
from pydantic import ValidationError
from pydantic import BaseModel, Field
from .physics import State
from .store import WorldStore

load_dotenv()

@lru_cache
def store() -> WorldStore:
    return WorldStore(os.environ['DATABASE_URL'])


async def _heartbeat_world_clock(database: WorldStore):
    """Persist simulation seconds even if nobody is playing or making API calls"""
    while True:
        await asyncio.sleep(1.)
        try:
            await run_in_threadpool(database.checkpoint_clock)
        except Exception:
            logging.exception('World-clock heartbeat failed; check PostgreSQL availability')


@asynccontextmanager
async def lifespan(_app: FastAPI):
    database = store()
    # One authoritative world owner per PostgreSQL database. A second API
    # worker must not independently run the same simulation clock
    await run_in_threadpool(database.clock.acquire_ownership)
    heartbeat = None
    try:
        await run_in_threadpool(database.ensure_world)
        heartbeat = asyncio.create_task(_heartbeat_world_clock(database))
        yield
    finally:
        if heartbeat is not None:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat
        await run_in_threadpool(database.stop_clock)


app=FastAPI(title='Orbital Outlaws',version='1.1.0',lifespan=lifespan)

# Public accounts are disabled unless AUTH_ENABLED=1 and all secrets are set
# Browser origin allow-list is explicit; never use wildcard CORS for credentials
from fastapi.middleware.cors import CORSMiddleware
from .accounts import router as accounts_router, profile_for_token
from .account_settings import router as account_settings_router
approved_origins=[origin.strip() for origin in os.getenv('AUTH_ORIGINS','').split(',') if origin.strip()]
if approved_origins:
    app.add_middleware(CORSMiddleware,allow_origins=approved_origins,
                       allow_methods=['GET','POST','PATCH','PUT'],
                       allow_headers=['Authorization','Content-Type'])
app.include_router(accounts_router)
app.include_router(account_settings_router)



# Swagger exposes a Bearer authorization control for private game/admin routes
bearer_scheme = HTTPBearer(auto_error=False)


def _request_profile(credentials: HTTPAuthorizationCredentials | None):
    # Preserve anonymous tooling solely for explicitly enabled LOCAL development
    if os.getenv('ORBITAL_DEV_COMMANDS') == '1' and os.getenv('AUTH_ENABLED') != '1':
        return None
    if credentials is None or credentials.scheme.lower() != 'bearer':
        raise HTTPException(401, 'Sign in with a Bearer token')
    return profile_for_token(credentials.credentials)


def require_owned_pilot(pilot_id: str,
                        credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)):
    if len(pilot_id) != 32 or any(c not in '0123456789abcdef' for c in pilot_id):
        raise HTTPException(400, 'Expected a 32-character pilot ID')
    profile = _request_profile(credentials)
    if profile is not None and profile['id'] != pilot_id:
        raise HTTPException(403, 'You may only control your own pilot')
    return profile


def require_admin(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)):
    profile = _request_profile(credentials)
    if profile is not None:
        admin_email = os.getenv('AUTH_ADMIN_EMAIL', '').strip().casefold()
        if not admin_email or profile['email'].casefold() != admin_email:
            raise HTTPException(403, 'Pilot administrator permission required')
    return profile


class PlayerInput(BaseModel):
    seq: int = Field(default=0, ge=0)
    thrust: bool = False
    turn: int = Field(default=0, ge=-1, le=1)
    stabilize: bool = False
    gimbal: float = Field(default=0, ge=-0.4886921906, le=0.4886921906)
    fire: bool = False
    repair: bool = False
    aim_x: float = Field(default=0, ge=-1, le=1)
    aim_y: float = Field(default=0, ge=-1, le=1)



class AutoBurnCommand(BaseModel):
    direction: Literal['prograde','retrograde','radial_out','radial_in','heading','angle']
    reference: Literal['kestrel','veyra'] = 'kestrel'
    cutoff: Literal['duration','fuel'] = 'duration'
    duration_s: float | None = Field(default=None, gt=0, le=40, allow_inf_nan=False)
    fuel_floor_kg: float | None = Field(default=None, ge=0, le=200, allow_inf_nan=False)
    angle_deg: float | None = Field(default=None, ge=-360, le=360, allow_inf_nan=False)



@app.websocket('/players/{pilot_id}/live')
async def pilot_live(ws: WebSocket,pilot_id: str):
    # Authenticate BEFORE accepting the socket. No bearer secrets in URLs
    # Pilot ownership is derived from a verified account, never a browser-chosen ID
    is_local_dev = os.getenv('ORBITAL_DEV_COMMANDS') == '1' and os.getenv('AUTH_ENABLED') != '1'
    protocol = None
    auth_token = None
    if len(pilot_id) != 32 or any(c not in '0123456789abcdef' for c in pilot_id):
        await ws.close(code=1008)
        return
    if not is_local_dev:
        origins = {origin.strip() for origin in os.getenv('AUTH_ORIGINS', '').split(',') if origin.strip()}
        offered = [part.strip() for part in ws.headers.get('sec-websocket-protocol', '').split(',')]
        tokens = [part[5:] for part in offered if part.startswith('auth.')]
        if ws.headers.get('origin') not in origins or 'orbital-v1' not in offered or len(tokens) != 1:
            await ws.close(code=1008)
            return
        auth_token = tokens[0]
        try:
            profile = await run_in_threadpool(profile_for_token, auth_token)
        except HTTPException:
            await ws.close(code=1008)
            return
        if profile['id'] != pilot_id:
            await ws.close(code=1008)
            return
        protocol = 'orbital-v1'
    await ws.accept(subprotocol=protocol)
    database=store()
    next_auth_check = time.monotonic() + 30
    try:
        await run_in_threadpool(database.connect_player,pilot_id)
        encounter=await run_in_threadpool(database.player_encounter,pilot_id)
        flight=await run_in_threadpool(database.get_entity,'kestrel','pilot-'+pilot_id)
        progress=await run_in_threadpool(database.player_progress,pilot_id)
        await ws.send_json({'type':'welcome','flight':flight,'progress':progress,
                            'encounter':encounter})
        while True:
            if auth_token and time.monotonic() >= next_auth_check:
                try:
                    await run_in_threadpool(profile_for_token, auth_token)
                except HTTPException:
                    await ws.close(code=1008)
                    return
                next_auth_check = time.monotonic() + 30
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
                                        'encounter':encounter,'progress':progress,
                                        'input_ack':body.seq})
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
                elif kind=='auto_burn_start':
                    command=AutoBurnCommand.model_validate(message)
                    outcome=await run_in_threadpool(
                        database.player_auto_start, pilot_id, direction=command.direction,
                        reference=command.reference, cutoff=command.cutoff,
                        duration_s=command.duration_s, fuel_floor_kg=command.fuel_floor_kg,
                        angle_deg=command.angle_deg)
                    await ws.send_json({'type':'auto_burn','result':outcome})
                    flight=await run_in_threadpool(database.get_entity,'kestrel','pilot-'+pilot_id)
                    await ws.send_json({'type':'snapshot','flight':flight,
                                        'encounter':await run_in_threadpool(database.player_encounter,pilot_id),
                                        'progress':await run_in_threadpool(database.player_progress,pilot_id)})
                elif kind=='auto_burn_abort':
                    outcome=await run_in_threadpool(database.player_auto_abort,pilot_id)
                    await ws.send_json({'type':'auto_burn','result':outcome})
                    flight=await run_in_threadpool(database.get_entity,'kestrel','pilot-'+pilot_id)
                    await ws.send_json({'type':'snapshot','flight':flight,
                                        'encounter':await run_in_threadpool(database.player_encounter,pilot_id),
                                        'progress':await run_in_threadpool(database.player_progress,pilot_id)})
                else:
                    raise ValueError('Only flight, guidance, purchases, reserve settings and fuel-assistance orders are accepted; NPCs and loot are server-owned')
            except (ValueError,ValidationError,LookupError) as exc:
                await ws.send_json({'type':'error','message':str(exc)})
    except WebSocketDisconnect:
        pass


@app.post('/players/{pilot_id}')
def connect_player(pilot_id: str, _owner=Depends(require_owned_pilot)):
    if len(pilot_id)!=32 or any(c not in '0123456789abcdef' for c in pilot_id):
        raise HTTPException(400,'Expected 32-character pilot ID')
    return store().connect_player(pilot_id)


@app.get('/players/{pilot_id}')
def player_state(pilot_id: str, _owner=Depends(require_owned_pilot)):
    return store().get_entity('kestrel','pilot-'+pilot_id)


@app.post('/players/{pilot_id}/input')
def player_input(pilot_id: str, command: PlayerInput, _owner=Depends(require_owned_pilot)):
    try:
        return store().player_input(pilot_id,command.thrust,command.turn,
                                    command.stabilize,command.gimbal)
    except LookupError as exc:
        raise HTTPException(404,str(exc)) from exc



@app.post('/players/{pilot_id}/auto-burn')
def start_auto_burn(pilot_id: str, command: AutoBurnCommand, _owner=Depends(require_owned_pilot)):
    """Development-only REST alternative to the cockpit's WebSocket command."""
    if len(pilot_id)!=32 or any(c not in '0123456789abcdef' for c in pilot_id):
        raise HTTPException(400, 'Expected 32-character pilot ID')
    try:
        return store().player_auto_start(
            pilot_id, direction=command.direction, reference=command.reference,
            cutoff=command.cutoff, duration_s=command.duration_s,
            fuel_floor_kg=command.fuel_floor_kg, angle_deg=command.angle_deg)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post('/players/{pilot_id}/auto-burn/abort')
def abort_auto_burn(pilot_id: str, _owner=Depends(require_owned_pilot)):
    if len(pilot_id)!=32 or any(c not in '0123456789abcdef' for c in pilot_id):
        raise HTTPException(400, 'Expected 32-character pilot ID')
    try:
        return store().player_auto_abort(pilot_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post('/dev/players/{pilot_id}/raiders', status_code=201)
def spawn_dev_raider(pilot_id: str, _admin=Depends(require_admin)):
    """Explicit dev-only enemy spawn. Intentionally absent from the game UI."""
    if len(pilot_id) != 32 or any(ch not in '0123456789abcdef' for ch in pilot_id):
        raise HTTPException(400, 'Expected 32-character pilot ID')
    try:
        return store().spawn_raider(pilot_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc



@app.post('/dev/players/{pilot_id}/allies', status_code=201)
def spawn_dev_ally(pilot_id: str, _admin=Depends(require_admin)):
    """Create one incoming allied spacecraft; no player-facing spawn control."""
    if len(pilot_id) != 32 or any(ch not in '0123456789abcdef' for ch in pilot_id):
        raise HTTPException(400, 'Expected 32-character pilot ID')
    try:
        return store().spawn_ally(pilot_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post('/dev/players/{pilot_id}/respawn')
def respawn_dev_pilot(pilot_id: str, _admin=Depends(require_admin)):
    """Create a new pilot spacecraft even if still alive; reset progression."""
    if len(pilot_id) != 32 or any(ch not in '0123456789abcdef' for ch in pilot_id):
        raise HTTPException(400, 'Expected 32-character pilot ID')
    try:
        return store().respawn_player(pilot_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


class DevRefuelBody(BaseModel):
    """Omit kg to refill the pilot's tank to its 200 kg capacity."""
    kg: float | None = Field(default=None, gt=0, allow_inf_nan=False)


@app.post('/dev/players/{pilot_id}/refuel')
def refuel_dev_pilot(pilot_id: str, body: DevRefuelBody | None = None, _admin=Depends(require_admin)):
    """Development-only propellant refill; never exposed as a cockpit control."""
    if len(pilot_id) != 32 or any(ch not in '0123456789abcdef' for ch in pilot_id):
        raise HTTPException(400, 'Expected 32-character pilot ID')
    try:
        return store().refuel_player(pilot_id, body.kg if body else None)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.get('/system')
def system_view():
    """Read-only star-centered ephemeris for the system map."""
    return store().system_view()


@app.get('/')
def health():
    return {'status':'ok','architecture':'lazy-orbits','authority':'sector-authoritative'}


class ReserveConfig(BaseModel):
    kg: float = Field(ge=0, le=200, allow_inf_nan=False)


@app.post('/players/{pilot_id}/reserve')
def set_reserve(pilot_id: str, config: ReserveConfig, _owner=Depends(require_owned_pilot)):
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
def request_assistance(pilot_id: str, body: FuelRequest, _owner=Depends(require_owned_pilot)):
    try:
        return store().request_assistance(pilot_id, body.recipient, body.donor)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post('/players/{pilot_id}/offer-fuel')
def offer_fuel(pilot_id: str, body: FuelOffer, _owner=Depends(require_owned_pilot)):
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
def world(world_id: str, _admin=Depends(require_admin)):
    if world_id!='kestrel':raise HTTPException(404,'Unknown world')
    return store().ensure_world(world_id)


@app.post('/worlds/{world_id}/entities',status_code=201)
def spawn(world_id: str,body: SpawnBody, _admin=Depends(require_admin)):
    try:
        if body.fuel_kg>body.mass_kg:raise ValueError('Propellant cannot exceed mass')
        if (body.x**2+body.y**2)**.5<91:raise ValueError('Inside central body')
        entity_id=store().seed_entity(world_id,body.id,State(body.x,body.y,body.vx,body.vy,body.mass_kg,body.fuel_kg),body.kind)
        return {'id':entity_id}
    except LookupError as exc:raise HTTPException(404,str(exc)) from exc
    except ValueError as exc:raise HTTPException(409,str(exc)) from exc


@app.get('/worlds/{world_id}/entities/{entity_id}')
def get_entity(world_id: str,entity_id: str,at_s: float|None=None, _admin=Depends(require_admin)):
    try:return store().get_entity(world_id,entity_id,at_s)
    except LookupError as exc:raise HTTPException(404,str(exc)) from exc
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc


@app.get('/worlds/{world_id}/viewport')
def viewport(world_id: str,cx: float=0,cy: float=0,radius_km:float=Query(700,gt=0,le=100000),at_s:float|None=None, _admin=Depends(require_admin)):
    try:return store().viewport(world_id,cx,cy,radius_km,at_s)
    except LookupError as exc:raise HTTPException(404,str(exc)) from exc
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc


@app.post('/worlds/{world_id}/entities/{entity_id}/impulses')
def impulse(world_id: str,entity_id: str,body: ImpulseBody, _admin=Depends(require_admin)):
    try:return store().apply_impulse(world_id,entity_id,body.dvx,body.dvy,body.idempotency_key,body.reserve_kg)
    except LookupError as exc:raise HTTPException(404,str(exc)) from exc
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc
