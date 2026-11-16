# Orbital Outlaws — v0.7 migration foundation

> **Migration in progress.** The new Vue 3 + Vuetify cockpit currently mounts the existing v0.6 local JavaScript game. The new FastAPI backend provides a *separate*, persistent, queryable lazy-orbit foundation. **Live gameplay does not yet read or write authoritative backend state**; it still resets when reloaded. We will bridge game commands/state to the backend after establishing authoritative collision and AI event resolution

## Run the Vue/Vuetify cockpit

```bash
cd frontend
npm install
npm run dev
# http://localhost:5173
```

The Vite server proxies `/api` requests to `http://localhost:8000`. If the API is unavailable, the cockpit shows `Local gameplay · backend offline`, and the v0.6 simulation still runs. The color palette, layout, HUD and user controls have intentionally been preserved. Vuetify powers the app shell, top bar controls, and status; the original canvas and many panels remain a compatibility layer during migration

For an immediately playable version that needs no npm, open **`orbital-outlaws.html`** (the preserved v0.6 standalone build). It remains intentionally unchanged

## Start the Python backend

Python 3.11+ recommended:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# http://localhost:8000/docs
```

By default the backend uses persistent **SQLite** `backend/orbital-outlaws.db` for an easy local demo. Set `DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/orbital_outlaws` to run on PostgreSQL. `Base.metadata.create_all` creates foundational tables in a new database; production will need Alembic migrations

The API has `/`, `/api/worlds/kestrel`, `/api/worlds/kestrel/viewport?cx=0&cy=0&radius_km=700`, and entity state/command endpoints. Initial world is empty, so viewport returns no entities until development code seeds them

### Local-only development commands

The spawn and impulse endpoints intentionally return **403 by default**. For a trusted local test session, run with `ORBITAL_DEV_COMMANDS=1`. Do **not** expose these endpoints on a public multiplayer server: they're unauthenticated and permit arbitrary entity creation and velocity changes

```bash
# In a trusted local backend with ORBITAL_DEV_COMMANDS=1:
curl -X POST http://localhost:8000/api/worlds/kestrel/entities \
  -H 'Content-Type: application/json' \
  -d '{"id":"demo-probe","x":260,"y":0,"vx":0,"vy":34.5298087499,"mass_kg":1110,"fuel_kg":200}'

curl 'http://localhost:8000/api/worlds/kestrel/viewport?cx=260&cy=0&radius_km=100'

curl -X POST http://localhost:8000/api/worlds/kestrel/entities/demo-probe/impulses \
  -H 'Content-Type: application/json' \
  -d '{"dvx":0,"dvy":1,"reserve_kg":36,"idempotency_key":"demo-001"}'
```

## Current backend architecture

- **Authoritative clock:** simulation seconds elapsed since persistent world epoch (UTC wall clock at 1×).
- **Sparse state:** store a post-event checkpoint plus timestamp, not continuous orbital positions.
- **Lazy propagation:** evaluate conic orbits using universal variables for ellipses, parabolas, and hyperbolas. A million revolutions do not require a million frames
- **Events:** immutable `spawn`/`impulse` records, server-chosen timestamps, idempotency key for at-least-once command delivery.
- **Viewport query:** radial orbital envelopes reduce candidate set; only currently visible entities are serialized.
- **Finite-burn physics prototype:** deterministic gravity+constant-direction thrust integrator in `app/physics.py` (not yet wired to player controls)

**Not done yet:** real-time authoritative W/A/D thrust, cross-entity collision scheduling, AI decisions during offline periods, authenticated players, multiplayer concurrency guarantees, and syncing game inventory/equipment with backend. These are critical for the fully persistent universe; a read of an old unconstrained orbit is *not* a valid substitute for resolving collisions and intervening commands. Spatial filtering is a first-stage radial coarse filter, not yet a scalable spacetime trajectory index

## Tests

```bash
cd backend && PYTHONPATH=. pytest -q
cd .. && node --test tests/*.test.cjs
```

## Project structure

```text
frontend/         Vue 3 + Vuetify + Vite cockpit and v0.6 canvas compatibility scripts
backend/          FastAPI, SQLAlchemy, Kepler propagator, persisted states/events, tests
docs/             Migration architecture and decision records
navigation.js     Existing v0.6 navigation algorithm (legacy game)
game.js           Existing v0.6 browser engine (legacy game)
orbital-outlaws.html  Preserved single-file offline version of v0.6
```

## Next milestones

1. Extract and unify the frontend and backend physical state schemas (coordinates, masses, attitude, impulses and thrust).
2. Make backend-authoritative engine control via timestamped start/stop inputs, finite burns and snapshots, with frontend prediction + reconciliation
3. Implement causally correct collision/AI event scheduling, region subscriptions, and server-sent live updates
4. Turn legacy DOM mutation into Vue reactive state one panel at a time; migrate navigation, targeting and hotkey settings fully
5. Add authenticated accounts, production PostgreSQL migrations, command authorization, backups, and multiplayer contention tests
