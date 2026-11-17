"""Verified account creation, login-by-email/username and controlled avatars."""
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import Account, AccountSession, EmailChallenge
from app.accounts import token_digest


@pytest.fixture
def client_accounts(monkeypatch, postgres_url):
    import app.main as main
    import app.accounts as accounts
    monkeypatch.setenv('DATABASE_URL', postgres_url)
    monkeypatch.setenv('AUTH_ENABLED', '1')
    monkeypatch.setenv('AUTH_SECRET', 'test-secret-replace-on-server-safely-very-long')
    monkeypatch.setenv('SMTP_HOST', 'localhost')
    monkeypatch.setenv('SMTP_FROM', 'test@example.com')
    messages = []
    monkeypatch.setattr(accounts, 'send_verification',
                        lambda email, code: messages.append((email, code)))
    main.store.cache_clear()
    with TestClient(app) as client:
        yield client, messages, main.store()
    main.store.cache_clear()


def test_registration_verification_login_avatar_and_logout(client_accounts):
    client, messages, database = client_accounts
    slug = uuid4().hex[:12]
    email = slug + '@example.com'
    username = 'pilot_' + slug
    account = {'email': email, 'username': username, 'password': 'blue-comet-drift-safe-passphrase',
               'avatar_id': 'salvager'}
    response = client.post('/auth/register', json=account)
    assert response.status_code == 202, response.text
    assert 'code' not in response.json()
    assert messages[-1][0] == email
    code = messages[-1][1]
    assert len(code) == 6 and code.isdigit()
    with database.sessions() as db:
        pending = db.query(Account).filter(Account.email == email).one()
        assert pending.password_hash != account['password']
        assert pending.password_hash.startswith('$argon2id$')
        assert pending.verified is False
        challenge = db.get(EmailChallenge, pending.id)
        assert challenge.digest != code
    assert client.post('/auth/login', json={
        'identifier': username, 'password': account['password']
    }).status_code == 403
    assert client.post('/auth/verify', json={'identifier': username, 'code': '999999' if code != '999999' else '111111'}).status_code == 400
    assert client.post('/auth/verify', json={'identifier': email, 'code': code}).status_code == 200

    login = client.post('/auth/login', json={
        'identifier': username.upper(), 'password': account['password']
    })
    assert login.status_code == 200, login.text
    token = login.json()['access_token']
    assert login.json()['profile']['avatar_id'] == 'salvager'
    assert login.json()['profile']['verified'] is True
    headers = {'Authorization': 'Bearer ' + token}
    assert client.get('/auth/me', headers=headers).json()['username'] == username
    updated = client.patch('/auth/me/avatar', json={'avatar_id': 'sentinel'}, headers=headers)
    assert updated.status_code == 200 and updated.json()['avatar_id'] == 'sentinel'
    assert client.patch('/auth/me/avatar', json={'avatar_id': '../../secret'}, headers=headers).status_code == 422
    with database.sessions() as db:
        assert db.get(AccountSession, token_digest(token)) is not None
        assert db.get(AccountSession, token) is None
    assert client.post('/auth/logout', headers=headers).status_code == 200
    assert client.get('/auth/me', headers=headers).status_code == 401
    assert client.post('/auth/login', json={'identifier': email, 'password': account['password']}).status_code == 200


def test_expired_email_code_and_attempt_limits(client_accounts):
    client, messages, database = client_accounts
    slug = uuid4().hex[:12]
    email = slug + '@example.com'
    created = client.post('/auth/register', json={
        'email': email, 'username': 'c' + slug,
        'password': 'another-random-long-password'
    })
    assert created.status_code == 202
    wrong = '000001' if messages[-1][1] != '000001' else '000002'
    for _ in range(5):
        assert client.post('/auth/verify', json={'identifier': email, 'code': wrong}).status_code == 400
    assert client.post('/auth/verify', json={'identifier': email, 'code': messages[-1][1]}).status_code == 400
    with database.sessions.begin() as db:
        account = db.query(Account).filter(Account.email == email).one()
        challenge = db.get(EmailChallenge, account.id)
        assert challenge.attempts == 5
        challenge.sent_at = time.time() - 61
    assert client.post('/auth/resend', json={'identifier': email}).status_code == 202
    new_code = messages[-1][1]
    with database.sessions.begin() as db:
        account = db.query(Account).filter(Account.email == email).one()
        challenge = db.get(EmailChallenge, account.id)
        challenge.expires_at = time.time() - 1
    assert client.post('/auth/verify', json={'identifier': email, 'code': new_code}).status_code == 400


def test_accounts_disabled_by_default(monkeypatch, postgres_url):
    import app.main as main
    monkeypatch.setenv('DATABASE_URL', postgres_url)
    monkeypatch.setenv('AUTH_ENABLED', '0')
    main.store.cache_clear()
    with TestClient(app) as client:
        assert client.post('/auth/login', json={
            'identifier': 'pilot', 'password': 'irrelevant'
        }).status_code == 503
    main.store.cache_clear()
