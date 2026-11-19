"""Verified email/password accounts for Orbital Outlaws.

Account sessions authorize the owner's persistent flight; privileged
production development commands require a separate administrator identity.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import smtplib
import time
from email.message import EmailMessage
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from pwdlib import PasswordHash
from sqlalchemy import delete, or_, select

from .models import Account, AccountSession, AuthThrottle, EmailChallenge, PasswordResetChallenge

router = APIRouter(prefix='/auth', tags=['accounts'])
password_hasher = PasswordHash.recommended()
# Fixed dummy hash avoids a noticeably faster failure for non-existent identities.
DUMMY_PASSWORD_HASH = password_hasher.hash('not-an-existing-player-credential')
AVATARS = ('vanguard', 'navigator', 'salvager', 'envoy', 'mechanic', 'sentinel')
USERNAME_RE = r'^[a-zA-Z][a-zA-Z0-9_]{2,19}$'
CODE_RE = r'^\d{6}$'
SESSION_TTL_SECONDS = 12 * 3600
VERIFICATION_TTL_SECONDS = 10 * 60


def require_accounts_enabled():
    if os.getenv('AUTH_ENABLED', '0') != '1':
        raise HTTPException(503, 'Account registration is not enabled on this deployment')
    secret = os.getenv('AUTH_SECRET', '')
    if len(secret) < 32 or secret.startswith(('REPLACE', 'CHANGE_ME')):
        raise HTTPException(503, 'Account signing secret has not been configured')


def smtp_ready():
    if not os.getenv('SMTP_HOST') or not os.getenv('SMTP_FROM'):
        raise HTTPException(503, 'Email delivery is not configured yet')


def sessions():
    # Deferred import avoids circular dependency with main.py's app/router.
    from .main import store
    return store().sessions


def public_profile(account: Account) -> dict:
    return {'id': account.id, 'username': account.username,
            'email': account.email, 'verified': account.verified,
            'avatar_id': account.avatar_id, 'created_at': account.created_at}


def code_digest(account_id: str, challenge_id: str, code: str) -> str:
    return hmac.new(os.environ['AUTH_SECRET'].encode(),
                    f'{account_id}:{challenge_id}:{code}'.encode(),
                    hashlib.sha256).hexdigest()


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def throttle(db, category: str, value: str, limit: int, seconds: float):
    """Shared PostgreSQL-backed throttle; not process-local per-worker state."""
    key = hashlib.sha256(f'{category}:{value.casefold()}'.encode()).hexdigest()
    now = time.time()
    row = db.scalars(select(AuthThrottle).where(
        AuthThrottle.key == key).with_for_update()).first()
    if row is None:
        db.add(AuthThrottle(key=key, count=1, resets_at=now + seconds))
        return
    if row.resets_at <= now:
        row.count = 1
        row.resets_at = now + seconds
    elif row.count >= limit:
        raise HTTPException(429, 'Too many attempts. Please retry later.')
    else:
        row.count += 1


def rate_limit(request: Request, category: str, identity: str, limit: int, seconds: int):
    host = request.client.host if request.client else 'unknown'
    with sessions().begin() as db:
        throttle(db, category+':ip', host, limit * 3, seconds)
        throttle(db, category+':identity', identity, limit, seconds)


def find_account(db, identity: str):
    value = identity.strip().casefold()
    return db.scalars(select(Account).where(
        or_(Account.email == value, Account.username == value))).first()


def issue_challenge(db, account: Account) -> str:
    code = f'{secrets.randbelow(1_000_000):06d}'
    challenge_id = secrets.token_hex(16)
    now = time.time()
    row = db.get(EmailChallenge, account.id)
    if row is None:
        row = EmailChallenge(account_id=account.id, challenge_id=challenge_id,
                             digest='', expires_at=0, sent_at=0, attempts=0)
        db.add(row)
    row.challenge_id = challenge_id
    row.digest = code_digest(account.id, challenge_id, code)
    row.expires_at = now + VERIFICATION_TTL_SECONDS
    row.sent_at = now
    row.attempts = 0
    return code


def _send_mail(email: str, subject: str, body: str):
    """SMTP submission over STARTTLS 587 or implicit TLS 465."""
    smtp_ready()
    host = os.environ['SMTP_HOST']
    port = int(os.getenv('SMTP_PORT', '587'))
    message = EmailMessage()
    message['Subject'] = subject
    message['From'] = os.environ['SMTP_FROM']
    message['To'] = email
    message.set_content(body)
    transport = smtplib.SMTP_SSL(host, port, timeout=12) if port == 465 else smtplib.SMTP(host, port, timeout=12)
    with transport as client:
        if port != 465:
            client.starttls()
        if os.getenv('SMTP_USER') and os.getenv('SMTP_PASSWORD'):
            client.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'])
        client.send_message(message)


def send_verification(email: str, code: str):
    _send_mail(email, 'Orbital Outlaws — verify your pilot account',
               'Your Orbital Outlaws verification code is: '+code+
               '\n\nThis code expires after 10 minutes. Do not share it with anyone.\n'
               'If you did not register, you can ignore this email.\n')


class RegisterBody(BaseModel):
    username: str = Field(min_length=3, max_length=20, pattern=USERNAME_RE)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    avatar_id: str = Field(default='navigator')


class IdentityBody(BaseModel):
    identifier: str = Field(min_length=3, max_length=320)


class VerifyBody(IdentityBody):
    code: str = Field(pattern=CODE_RE)


class LoginBody(IdentityBody):
    password: str


class PasswordResetConfirm(VerifyBody):
    new_password: str = Field(min_length=12, max_length=128)


class AvatarBody(BaseModel):
    avatar_id: str


@router.post('/register', status_code=202)
def register(body: RegisterBody, request: Request):
    require_accounts_enabled()
    smtp_ready()
    if body.avatar_id not in AVATARS:
        raise HTTPException(422, 'Unknown pilot avatar')
    email = str(body.email).strip().casefold()
    username = body.username.casefold()
    rate_limit(request, 'register', email, 4, 3600)
    with sessions().begin() as db:
        if db.scalars(select(Account).where(
                or_(Account.email == email, Account.username == username))).first():
            raise HTTPException(409, 'This email or callsign is not available')
        account = Account(id=uuid4().hex, username=username, email=email,
                          password_hash=password_hasher.hash(body.password),
                          verified=False, avatar_id=body.avatar_id,
                          created_at=time.time())
        db.add(account)
        db.flush()
        code = issue_challenge(db, account)
    try:
        send_verification(email, code)
    except (OSError, smtplib.SMTPException) as exc:
        # Account remains pending, and can request a new code later.
        raise HTTPException(503, 'Email could not be delivered. Please retry verification later.') from exc
    return {'status': 'verification_required',
            'message': 'A six-digit code was sent to your email address.'}


@router.post('/resend', status_code=202)
def resend(body: IdentityBody, request: Request):
    require_accounts_enabled()
    smtp_ready()
    rate_limit(request, 'resend', body.identifier, 4, 3600)
    recipient = code = None
    with sessions().begin() as db:
        account = find_account(db, body.identifier)
        if account and not account.verified:
            existing = db.scalars(select(EmailChallenge).where(
                EmailChallenge.account_id == account.id).with_for_update()).first()
            if existing and time.time() - existing.sent_at < 60:
                raise HTTPException(429, 'Please wait 60 seconds before requesting another code')
            code = issue_challenge(db, account)
            recipient = account.email
    if recipient:
        try:
            send_verification(recipient, code)
        except (OSError, smtplib.SMTPException) as exc:
            raise HTTPException(503, 'Email could not be delivered. Please try again later.') from exc
    return {'status': 'accepted', 'message': 'If verification is pending, a new code was sent.'}


@router.post('/verify')
def verify(body: VerifyBody, request: Request):
    require_accounts_enabled()
    rate_limit(request, 'verify', body.identifier, 15, 3600)
    invalid = False
    profile = None
    with sessions().begin() as db:
        account = find_account(db, body.identifier)
        if not account:
            invalid = True
        elif account.verified:
            profile = public_profile(account)
        else:
            challenge = db.scalars(select(EmailChallenge).where(
                EmailChallenge.account_id == account.id).with_for_update()).first()
            if not challenge or challenge.attempts >= 5 or challenge.expires_at < time.time():
                invalid = True
            else:
                expected = code_digest(account.id, challenge.challenge_id, body.code)
                if not hmac.compare_digest(challenge.digest, expected):
                    challenge.attempts += 1
                    invalid = True
                else:
                    account.verified = True
                    db.delete(challenge)
                    profile = public_profile(account)
    if invalid:
        raise HTTPException(400, 'Invalid or expired code. Request another code if needed.')
    return {'status': 'verified', 'profile': profile}


@router.post('/login')
def login(body: LoginBody, request: Request):
    require_accounts_enabled()
    rate_limit(request, 'login', body.identifier, 10, 900)
    with sessions().begin() as db:
        account = find_account(db, body.identifier)
        correct = password_hasher.verify(
            body.password, account.password_hash if account else DUMMY_PASSWORD_HASH)
        if not account or not correct:
            raise HTTPException(401, 'Invalid username/email or password')
        if not account.verified:
            raise HTTPException(403, 'Verify your email before logging in')
        token = secrets.token_urlsafe(32)
        now = time.time()
        db.add(AccountSession(token_digest=token_digest(token), account_id=account.id,
                              created_at=now, expires_at=now + SESSION_TTL_SECONDS))
        profile = public_profile(account)
    return {'access_token': token, 'token_type': 'bearer',
            'expires_in': SESSION_TTL_SECONDS, 'profile': profile}


def profile_for_token(token: str) -> dict:
    """The account ID is the server-authoritative pilot ID."""
    require_accounts_enabled()
    if not token or len(token) < 32 or len(token) > 128:
        raise HTTPException(401, 'Please sign in')
    with sessions()() as db:
        session = db.get(AccountSession, token_digest(token))
        if not session or session.expires_at <= time.time():
            raise HTTPException(401, 'Your session has expired')
        account = db.get(Account, session.account_id)
        if not account or not account.verified:
            raise HTTPException(401, 'Invalid account session')
        return public_profile(account)


def signed_in(request: Request) -> tuple[str, dict]:
    authorization = request.headers.get('Authorization', '')
    kind, _, token = authorization.partition(' ')
    if kind.lower() != 'bearer':
        raise HTTPException(401, 'Please sign in')
    return token, profile_for_token(token)


@router.get('/me')
def me(identity: tuple = Depends(signed_in)):
    return identity[1]


@router.patch('/me/avatar')
def update_avatar(body: AvatarBody, identity: tuple = Depends(signed_in)):
    if body.avatar_id not in AVATARS:
        raise HTTPException(422, 'Unknown pilot avatar')
    with sessions().begin() as db:
        account = db.get(Account, identity[1]['id'])
        account.avatar_id = body.avatar_id
        return public_profile(account)


@router.post('/logout')
def logout(identity: tuple = Depends(signed_in)):
    with sessions().begin() as db:
        row = db.get(AccountSession, token_digest(identity[0]))
        if row:
            db.delete(row)
    return {'status': 'signed_out'}


@router.post('/password-reset/request', status_code=202)
def request_password_reset(body: IdentityBody, request: Request):
    """Return the same response regardless of whether this identity exists."""
    require_accounts_enabled()
    smtp_ready()
    rate_limit(request, 'password-reset-request', body.identifier, 4, 3600)
    email = code = None
    with sessions().begin() as db:
        account = find_account(db, body.identifier)
        if account and account.verified:
            row = db.get(PasswordResetChallenge, account.id)
            now = time.time()
            if row is None or now - row.sent_at >= 60:
                code = f'{secrets.randbelow(1_000_000):06d}'
                challenge_id = secrets.token_hex(16)
                if row is None:
                    row = PasswordResetChallenge(account_id=account.id, challenge_id=challenge_id,
                                                 digest='', expires_at=0, sent_at=0, attempts=0)
                    db.add(row)
                row.challenge_id = challenge_id
                row.digest = code_digest(account.id, 'reset:'+challenge_id, code)
                row.expires_at = now + VERIFICATION_TTL_SECONDS
                row.sent_at = now
                row.attempts = 0
                email = account.email
    if email:
        try:
            _send_mail(email, 'Orbital Outlaws — reset your password',
                       'Your Orbital Outlaws password reset code is: '+code+
                       '\n\nExpires in 10 minutes. If you did not request this, ignore it.\n')
        except (OSError, smtplib.SMTPException):
            import logging
            logging.exception('Password reset email could not be delivered')
    return {'status': 'accepted', 'message': 'If this account exists, a reset code has been sent.'}


@router.post('/password-reset/confirm')
def confirm_password_reset(body: PasswordResetConfirm, request: Request):
    require_accounts_enabled()
    rate_limit(request, 'password-reset-confirm', body.identifier, 12, 3600)
    invalid = False
    with sessions().begin() as db:
        account = find_account(db, body.identifier)
        row = db.get(PasswordResetChallenge, account.id) if account else None
        if not account or not account.verified or not row:
            invalid = True
        elif row.expires_at < time.time() or row.attempts >= 5:
            invalid = True
        else:
            expected = code_digest(account.id, 'reset:'+row.challenge_id, body.code)
            if not hmac.compare_digest(row.digest, expected):
                row.attempts += 1
                invalid = True
            else:
                account.password_hash = password_hasher.hash(body.new_password)
                db.execute(delete(AccountSession).where(AccountSession.account_id == account.id))
                db.delete(row)
    if invalid:
        raise HTTPException(400, 'Invalid or expired recovery code.')
    return {'status': 'password_updated', 'message': 'Password changed. Sign in again.'}
