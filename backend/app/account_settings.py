"""Portable cockpit preferences and authenticated pilot account management."""
from __future__ import annotations

import json
import math
import re
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from .accounts import USERNAME_RE, password_hasher, public_profile, rate_limit, sessions, signed_in
from .models import Account, AccountPreferences, AccountSession

router = APIRouter(prefix='/auth', tags=['accounts'])


class CallsignBody(BaseModel):
    username: str = Field(min_length=3, max_length=20, pattern=USERNAME_RE)


class PasswordChangeBody(BaseModel):
    current_password: str
    new_password: str = Field(min_length=7, max_length=128)


class PreferencesBody(BaseModel):
    revision: int = Field(ge=0)
    preferences: dict


def validate_preferences(data: dict) -> dict:
    """Allow only bounded, non-executable, non-sensitive UI configuration."""
    if set(data) - {'layout', 'frame', 'show_axes', 'hotkeys'}:
        raise HTTPException(422, 'Unsupported preference keys')
    try:
        if len(json.dumps(data, allow_nan=False).encode()) > 12000:
            raise ValueError('Preferences exceed 12 KB')
    except (ValueError, TypeError, OverflowError) as exc:
        raise HTTPException(422, 'Invalid preference document') from exc
    result = {}
    if 'frame' in data:
        if type(data['frame']) is not str or data['frame'] not in ('planet', 'star'):
            raise HTTPException(422, 'Invalid map reference frame')
        result['frame'] = data['frame']
    if 'show_axes' in data:
        if type(data['show_axes']) is not bool:
            raise HTTPException(422, 'Invalid axes visibility')
        result['show_axes'] = data['show_axes']
    if 'layout' in data:
        layout = data['layout']
        if not isinstance(layout, dict) or len(layout) > 24:
            raise HTTPException(422, 'Invalid panel layout')
        cleaned = {}
        for panel_id, attrs in layout.items():
            if not isinstance(panel_id, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', panel_id):
                raise HTTPException(422, 'Invalid panel identifier')
            if not isinstance(attrs, dict) or set(attrs) - {'inside', 'collapsed', 'x', 'y'}:
                raise HTTPException(422, 'Invalid panel properties')
            if any(type(v) is not bool for k, v in attrs.items() if k in ('inside', 'collapsed')):
                raise HTTPException(422, 'Invalid panel visibility')
            if any(type(v) not in (int, float) or not math.isfinite(v) or v < 0 or v > 1
                   for k, v in attrs.items() if k in ('x', 'y')):
                raise HTTPException(422, 'Invalid normalized panel coordinates')
            cleaned[panel_id] = attrs
        result['layout'] = cleaned
    if 'hotkeys' in data:
        keys = data['hotkeys']
        if not isinstance(keys, dict) or len(keys) > 24:
            raise HTTPException(422, 'Invalid hotkey map')
        if any(not isinstance(k, str) or not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9]{0,35}', k)
               or not isinstance(v, str) or not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9]{0,35}', v)
               for k, v in keys.items()):
            raise HTTPException(422, 'Invalid hotkey binding')
        if len(set(keys.values())) != len(keys) or 'Escape' in keys.values():
            raise HTTPException(422, 'Conflicting or reserved hotkey')
        result['hotkeys'] = keys
    return result


@router.patch('/me/callsign')
def update_callsign(body: CallsignBody, request: Request, identity: tuple = Depends(signed_in)):
    rate_limit(request, 'callsign', identity[1]['id'], 8, 3600)
    username = body.username.casefold()
    with sessions().begin() as db:
        account = db.get(Account, identity[1]['id'], with_for_update=True)
        if username != account.username:
            if db.scalars(select(Account).where(Account.username == username)).first():
                raise HTTPException(409, 'That callsign is already taken')
            account.username = username
        return public_profile(account)


@router.post('/me/password')
def change_password(body: PasswordChangeBody, request: Request, identity: tuple = Depends(signed_in)):
    rate_limit(request, 'password-change', identity[1]['id'], 8, 3600)
    with sessions().begin() as db:
        account = db.get(Account, identity[1]['id'], with_for_update=True)
        if not password_hasher.verify(body.current_password, account.password_hash):
            raise HTTPException(401, 'Current password is incorrect')
        account.password_hash = password_hasher.hash(body.new_password)
        db.execute(delete(AccountSession).where(AccountSession.account_id == account.id))
    return {'status': 'password_updated', 'message': 'Password updated. All devices signed out.'}


@router.post('/logout-all')
def logout_all(identity: tuple = Depends(signed_in)):
    with sessions().begin() as db:
        db.execute(delete(AccountSession).where(AccountSession.account_id == identity[1]['id']))
    return {'status': 'signed_out_everywhere'}


@router.get('/me/preferences')
def get_preferences(identity: tuple = Depends(signed_in)):
    with sessions()() as db:
        row = db.get(AccountPreferences, identity[1]['id'])
        return {'revision': row.revision if row else 0,
                'preferences': row.preferences if row else {},
                'updated_at': row.updated_at if row else None}


@router.put('/me/preferences')
def put_preferences(body: PreferencesBody, identity: tuple = Depends(signed_in)):
    document = validate_preferences(body.preferences)
    with sessions().begin() as db:
        row = db.get(AccountPreferences, identity[1]['id'], with_for_update=True)
        current = row.revision if row else 0
        if current != body.revision:
            raise HTTPException(409, 'Preferences changed on another device. Reload and retry.')
        now = time.time()
        if row is None:
            row = AccountPreferences(account_id=identity[1]['id'], revision=1,
                                     preferences=document, updated_at=now)
            db.add(row)
        else:
            row.revision += 1
            row.preferences = document
            row.updated_at = now
        return {'revision': row.revision, 'preferences': document, 'updated_at': now}
