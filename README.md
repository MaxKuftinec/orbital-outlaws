# Orbital Outlaws — persistent flight preview

> **Partial migration.** Vue still runs the v0.6 local combat prototype. With PostgreSQL and `ORBITAL_DEV_COMMANDS=1`, **the player's orbital position, velocity, heading, rotation and propellant are backend-authoritative** and survive browser refresh and offline time. NPCs, combat, damage, salvage, inventory, upgrades and autopilot are still local and **do not persist**.

## Start the backend (Windows PowerShell)

You need an existing PostgreSQL database. SQLAlchemy will create tables, not the database.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env`:

```dotenv
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@localhost:5432/orbital_outlaws
ORBITAL_DEV_COMMANDS=1
```

Start FastAPI:

```powershell
uvicorn app.main:app --reload --port 8000
```

Check [http://localhost:8000/](http://localhost:8000/) for the root health endpoint or visit [http://localhost:8000/docs](http://localhost:8000/docs). The backend creates `worlds`, `entities`, `events` and `flight_controls` in PostgreSQL.

## Start the frontend

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite server proxies `/api` to FastAPI and `/backend-health` to **FastAPI's `/` endpoint**. On initial connection, a browser-local pilot ID is generated and its ship is inserted in PostgreSQL; subsequent visits reuse it. Press W to thrust, A/D to rotate, S to stabilize, and move the mouse to gimbal the engine. Position, orientation and fuel are reconciled from the server. The backend owns a 1× real-time clock, even when the browser is paused.

**Persistence test:** thrust for a few seconds, note the fuel and orbit, refresh the browser. The same ship should resume with the reduced fuel, advanced along its orbit.

## Scope and safety

- The backend stores sparse state checkpoints + event history, propagates unpowered Kepler orbits lazily, and integrates short finite-thrust/RCS control windows. Controls are renewed while held, but **expire after 0.4 seconds** if the browser stops sending them. There is no perpetual offline thrust.
- **Do not expose this server publicly** with `ORBITAL_DEV_COMMANDS=1`: player IDs are anonymous browser IDs, not authentication. The older arbitrary spawn and impulse development endpoints also remain enabled.
- When persistent flight is active, client-side repair, fuel salvage/transfers and autopilot engagement are disabled. Combat, ammo, credits, hits, NPCs and AI remain **client-local** for now. The browser's prediction is visual only and its state is never sent to the server.
- If the backend cannot connect, the legacy local game still runs. Offline standalone `orbital-outlaws.html` remains v0.6 local-only.
- PostgreSQL `create_all` creates new tables but does not migrate existing columns. Production requires schema migrations, authenticated commands, collision/event scheduling and reconciliation of all entities and inventory.

## Tests

```powershell
cd backend
python -m pytest -q
cd ..
node --test tests/*.test.cjs
```

Set `TEST_DATABASE_URL` to a **separate PostgreSQL test database** to run persistence integration tests; without it they are skipped. The pure physics and JavaScript tests require no server.

## Next milestones

1. Backend-authoritative collisions, weapons, damage and salvage; inventory consistency.
2. Server-scheduled NPC decisions, arrivals and cross-entity interactions.
3. Live region subscriptions and frontend prediction/reconciliation improvements.
4. Authenticated accounts, production migrations, concurrency safety and multiplayer.
