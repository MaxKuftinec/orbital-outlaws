# Pilot accounts (v1.x foundation)

This feature creates **verified, account-based pilot profiles**, separately
from the legacy anonymous, per-browser gameplay pilot ID. It is not yet a
multiplayer permission model: **a signed-in account cannot command a game ship
until ownership authorization is implemented**.

## Account flow

1. User selects one of six in-house fictional portraits.
2. Sign up with unique callsign (3–20 characters, ASCII letter followed by
   letters, digits or underscores), a valid email, and a password of at least
   12 characters.
3. Backend normalizes usernames/emails to lowercase, hashes the password with
   Argon2id, and stores a pending account.
4. Server emails a random **six-digit** verification code. Only a secret-key
   HMAC hash of that code is stored; it expires in **10 minutes**.
   At most five wrong guesses are allowed per issued code; resends require
   at least 60 seconds between messages.
5. The player enters their code and then signs in with **either the callsign
   or their verified email** and password.
6. The server gives a random bearer session token (12h lifetime); only its
   SHA-256 digest is stored in PostgreSQL. The browser holds the token in
   sessionStorage, not localStorage.
7. Users may change between whitelisted fictional avatars; no image uploads.
8. Logout revokes the session token. Unverified accounts cannot sign in.

API routes:

| Method | Path | Description |
| --- | --- | --- |
| POST | /auth/register | Create pending account, send email |
| POST | /auth/resend | Issue another email verification code |
| POST | /auth/verify | Verify six-digit code |
| POST | /auth/login | Login via email or callsign |
| GET | /auth/me | Return current verified profile (bearer token) |
| PATCH | /auth/me/avatar | Choose one of six portraits |
| POST | /auth/logout | Invalidate bearer session |

## Security and operating requirements

Account routes are **disabled by default** using `AUTH_ENABLED=0`. Never enable
on a public VM until `AUTH_SECRET` is set to a long randomly generated
secret and real authenticated SMTP is configured. The system needs:
`AUTH_ENABLED=1`, `AUTH_SECRET`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD` and exact
`AUTH_ORIGINS` for cross-origin Firebase frontend requests. Set SMTP
port 587 with STARTTLS, or 465 with implicit TLS. Do not publish credentials.

The account system uses PostgreSQL-backed IP- and identity-keyed throttling.
A verified email code is one-time; five wrong guesses lock the challenge
until reissued. Limit session lifetime and use HTTPS throughout. Production
launch also needs a forgot-password/reset workflow, email-delivery monitoring,
privacy notice, anti-abuse operations, recovery procedures, and a reviewed
schema migration process (the initial alpha uses `create_all`).

The existing `/players/{pilot_id}/live` endpoint still checks the local-only
development switch and anonymous legacy IDs. This is by design. **Never set
`ORBITAL_DEV_COMMANDS=1` on the public VM.** Authenticated live gameplay
requires a separate ownership mapping from Account to pilot entities, secure
WebSocket admission, rate limits, shared-sector authority, and tests proving
cross-player access is forbidden.

Future social systems: alliance membership, rank and permissions, invitations,
and diplomacy will have **separate** models. Do not bake alliances into the
authentication tables.

No personal photos are required or supported. The bundled portraits in
`frontend/public/avatars` are purely cosmetic starter art.
