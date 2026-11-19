# Authenticated live alpha — deployment runbook

This enables existing server-authoritative flight with verified user ownership and
admin-only production developer endpoints, without exposing anonymous pilot commands.

**Do not set `ORBITAL_DEV_COMMANDS=1` on the internet-facing VM.** Keep it
`0` in Compose. Developer commands are accessible in production only to the
verified account with email matching `AUTH_ADMIN_EMAIL`.

## 1. Backend secrets and email

On the VM at `~/orbital-outlaws/infra/compute-engine`, keep the existing
`.env` outside Git. Set:

```dotenv
API_DOMAIN=34-87-6-209.sslip.io
AUTH_ENABLED=1
AUTH_SECRET=REPLACE_WITH_FRESH_RANDOM_SECRET
AUTH_ADMIN_EMAIL=YOUR_VERIFIED_LOGIN_EMAIL
AUTH_ORIGINS=https://orbital-outlaws.web.app
SMTP_HOST=YOUR_SMTP_PROVIDER
SMTP_PORT=587
SMTP_FROM=YOUR_VERIFIED_SENDER_EMAIL
SMTP_USER=YOUR_SMTP_USERNAME
SMTP_PASSWORD=YOUR_SMTP_APP_PASSWORD
```

Use `openssl rand -hex 32` to generate `AUTH_SECRET`; do not publish it.
The admin address is the email **used to register the pilot**; the SMTP sender
can be a personal mailbox with a provider-specific SMTP app password.
No game-specific domain is needed for alpha email verification or recovery.
For Gmail, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, and an eligible
Google Account app password (not the account's login password) is one option.
Port 465 with TLS is supported too. Keep your current POSTGRES_* values
unchanged. Do not paste credentials into bug reports, consoles, or Git.

Registration presently requires working SMTP and verification. Send one
verification email, enter the six-digit code, and sign in. Password recovery
also sends a six-digit code, which expires in 10 minutes. Recovery invalidates
all of that account's active bearer sessions.

## 2. Pull and rebuild the API

This update does **not** alter the tracked Caddyfile because the VM has local
Swagger Basic Auth changes that should be preserved.

```bash
cd ~/orbital-outlaws
git status --short
git pull --ff-only
cd infra/compute-engine
sudo docker compose --env-file .env -f compose.yaml up -d --build api
sudo docker compose --env-file .env -f compose.yaml logs --tail=60 api
```

A modified tracked Caddyfile should normally be preserved by the pull because
that path is unchanged by this change; if Git refuses to pull, resolve or
back up local changes first. **Never reset/overwrite the local Caddyfile.**

## 3. Allow authenticated routes through Caddy

In the VM's existing `infra/compute-engine/Caddyfile`, REMOVE the old
`@restricted path ...` matcher and its `respond @restricted ... 403`
directive. They used to block `/players`, `/dev`, `/worlds`.
Those endpoints now perform their own bearer authorization checks in FastAPI.

**Preserve** your `basic_auth` section protecting `/docs`,
`/redoc`, and `/openapi.json`. Keep `reverse_proxy api:8000`
and existing HTTPS configuration.

```bash
sudo docker compose --env-file .env -f compose.yaml exec gateway \
  caddy validate --config /etc/caddy/Caddyfile
sudo docker compose --env-file .env -f compose.yaml exec gateway \
  caddy reload --config /etc/caddy/Caddyfile
```

Never enable anonymous `ORBITAL_DEV_COMMANDS` for this production deployment.

## 4. Frontend build and Firebase deployment

In PowerShell at the Windows repo root:

```powershell
git pull --ff-only
notepad frontend\.env.production.local
```

Set:

```dotenv
VITE_PUBLIC_PREVIEW=0
VITE_API_BASE_URL=https://34-87-6-209.sslip.io
```

Then:

```powershell
cd frontend
npm ci
npm run build
cd ..
firebase deploy --only hosting:orbital-outlaws --project axore-456421
```

The old `VITE_PUBLIC_PREVIEW=1` **deliberately suppresses** flight
WebSockets. Set it to 0 and rebuild. The Firebase site should remain
`https://orbital-outlaws.web.app`, separate from `axore.my`.

## 5. Check gameplay and admin commands

1. Open `https://orbital-outlaws.web.app`, register and verify the admin
   email account, then sign in via Pilot Profile.
2. Chrome DevTools > Network > WS should show a connection to
   `wss://34-87-6-209.sslip.io/players/<your-account-id>/live`.
3. Cockpit should report live flight, with server-owned flight state,
   NPC encounters, purchases, and progress persisted to PostgreSQL.
4. Copy the account's **Pilot ID** (32 hexadecimal characters) from its
   profile dialog.
5. To use developer commands: authenticate to password-protected Swagger
   at `https://34-87-6-209.sslip.io/docs`, get the signed-in session
   bearer token from your browser's session storage, click Swagger's
   `Authorize` control and enter the bearer token. The `/dev/players/`
   commands (raiders, allies, respawn, refuel) are protected by the
   `AUTH_ADMIN_EMAIL` check. Never share or paste bearer tokens publicly.

Anonymous requests to player routes must return 401; a non-admin bearer
on developer routes must return 403. API root `/` and `/system`
remain public. The `/worlds` inspection/mutation APIs are admin-only
for this alpha. Multiple registered players still operate in separate
server-side pilot sectors: **this does not yet provide shared multiplayer
interactions**.

## 6. Rollback and secrets

Back up PostgreSQL before deployments and never destroy the volume.
Changing or removing `AUTH_ADMIN_EMAIL` immediately removes
administrator permission at the next HTTP request. Rotating the account
password invalidates all bearer sessions. Update SMTP sender details later
without changing pilot identities. You can revert the frontend to
`VITE_PUBLIC_PREVIEW=1` and redeploy if you need to disable live flight
quickly; disabling `AUTH_ENABLED` on the VM also rejects authenticated
flight requests.
