# Orbital Outlaws — v0.9 live-flight prototype

**Live flight and progression are persistent.** The Vue cockpit uses a bidirectional **WebSocket** to receive authoritative PostgreSQL-backed orbital snapshots, send controls, purchase technology and submit development-only salvage credit claims. The browser predicts the ship every 15 ms and smoothly reconciles snapshots. **Combat, projectiles, damage, NPC AI, ammunition, repairs and physical salvage are still local.** This is not yet a fully authoritative multiplayer universe.

## Start the backend (Windows PowerShell)

Create a PostgreSQL database first, then in the project:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create or edit `backend/.env`:

```dotenv
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@localhost:5432/orbital_outlaws
ORBITAL_DEV_COMMANDS=1
```

Run `uvicorn app.main:app --reload --port 8000`. FastAPI **GET `/`** remains the health endpoint. SQLAlchemy creates the new `player_progress` and `salvage_claims` tables in the *existing* database. No SQLite is used.

## Start the frontend

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies WebSocket upgrades on `/api` and the health check `/backend-health` to FastAPI `/`.

The game has **no Pause or time-speed multiplier**. The universe clock continues on the server even when nobody has the tab open. Unpowered motion is calculated lazily from orbital checkpoints. W/A/D/S and the gimbal are predicted immediately on the browser, with server snapshots ~10 Hz and held-control lease renewals ~5 Hz. Inputs expire after 0.4 seconds without renewal.

Credits begin at 65 ¤. Buying **Predictive (40 ¤)**, **Trajectory (25 ¤)** or **Navigation (60 ¤)** is checked by PostgreSQL and persists through refresh. The starter credit pickups and wreck credit rewards are submitted as idempotent claims. The same pickup ID can only be credited once per pilot, even if a local encounter is reset. The **technology remains owned after refreshing**, but navigation *autopilot itself* is not yet server-authoritative and remains disabled in persistent mode. Ammo, repair parts, enemy ships and encounter resets are still local.

### Important security boundary

**Do not expose this backend publicly with `ORBITAL_DEV_COMMANDS=1`.** Player IDs are stored in the browser and are **not authenticated**; WebSocket purchase, flight and credit claims are development-only. **Salvage claims are reported by the browser and can be forged.** Persistent credits are useful for playtesting, but they are **not cheat-resistant** until we move pickup acquisition, NPCs, and combat to server authority. This milestone is not production multiplayer.

The earlier HTTP API is retained for debugging and read-only queries; live gameplay uses WebSocket. The offline `orbital-outlaws.html` is an older standalone v0.6 local-only build and retains its original controls.

## Tests

```powershell
cd backend
python -m pytest -q
cd ..
node --test tests/*.test.cjs
cd frontend
npm run build
```

For database integration tests, set `TEST_DATABASE_URL` to a **separate PostgreSQL testing database**. Without it, integration tests are skipped; WebSocket protocol tests use an in-memory stub.

## Next milestones

1. Server-authoritative collision and combat event scheduling, including salvage reward validation.
2. Persist ammunition, hull, repairs, NPCs and other game-world entities.
3. Authenticated player accounts and migration scripts.
4. Scalable region subscriptions, prediction/reconciliation and multiplayer contention handling.
