# Orbital Outlaws — v0.12 autonomous sector / Vue cockpit migration

A persistent 2D Newtonian orbital combat prototype using **Vue 3 + Vuetify (Options API)**, **FastAPI**, **PostgreSQL** and a bidirectional **WebSocket**.

## Current architecture

- **Backend authority:** Flight state, RCS/thrust fuel, projectile creation, ammunition, hull damage, NPC target decisions, finite NPC maneuver impulses, swept projectile/ship collisions, salvage and credits.
- **Offline time:** The universe clock uses real wall-clock time. A pilot-sector checkpoint is **caught up by FastAPI on the next connection/query**. NPC decisions and collisions are resolved during the catch-up even if nobody kept a browser open. This is lazy offline simulation, not a dedicated continuously running background worker per pilot.
- **Frontend prediction:** Browser renders player controls immediately at ~60 FPS and interpolates authoritative NPC positions. The client never submits NPC positions, kills or credit claims.
- **Still limited:** Sectors are **per pilot**, not yet shared multiplayer space. Long-disconnect catch-up uses adaptive numerical timesteps and is a gameplay approximation, not an exact global causal event queue. There is no player authentication yet. These endpoints are development-only.

### Start backend

Create an existing PostgreSQL database first:

```powershell
cd backend
python -m venv .venv
..venvScriptsActivate.ps1
pip install -r requirements.txt
```

Edit `backend/.env`:

```dotenv
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@localhost:5432/orbital_outlaws
ORBITAL_DEV_COMMANDS=1
```

Then run:

```powershell
uvicorn app.main:app --reload --port 8000
```

The backend keeps **GET `/`** as the health endpoint. `Base.metadata.create_all` creates missing game tables but not the database itself. Existing databases aren't destroyed or automatically reset. Production schema changes should use Alembic migrations.

### Start frontend

```powershell
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173. Vite proxies WebSocket `/api` to FastAPI and maps `/backend-health` to the backend root.

## Gameplay

W: main engine. A/D: rotate via RCS. S: stabilize. Space: fire (server validates ammo/cooldown). R: repair (server validates spare parts and hull). Aim with cursor, right/middle drag the map, mouse wheel to zoom.

The **Rendezvous Computer** automatically computes and executes a planned transfer while the tab remains open. During autopilot, mouse hover **does not control the engine gimbal**; navigation owns its attitude and thrust target. Manual gimbal control resumes when autopilot disengages. Guidance is still client-side; its inputs are applied by the authoritative server.

Technology purchases are persistent in PostgreSQL. Each has a compact ability-style icon. The **Rendezvous Computer** now shows a glowing guidance monitor tracking a craft, target and interception point, separate from the shared WebP atlas used by the other icons:

| Technology | Credits | Capability |
| --- | ---: | --- |
| Predictive fire control | 40 ¤ | Lead-shot assistance |
| Target trajectory analyzer | 25 ¤ | Target motion relative to a ballistic shot |
| Rendezvous computer | 60 ¤ | Assisted orbital transfers and capture |
| **Ephemeris computer** | **45 ¤** | Predict selected object's unpowered orbit and show +60s/+120s markers |

Trajectory predictions assume **unpowered Kepler motion**. Future burns, impacts or NPC decisions can invalidate them.

### Spawn a raider from FastAPI (development only)

The cockpit no longer displays a Reinforcements toggle. Spawn **one** autonomous raider per POST through FastAPI's Swagger UI at http://127.0.0.1:8000/docs, or PowerShell:

```powershell
# Get the current pilot ID in the browser DevTools console:
# localStorage.getItem('orbital-outlaws.pilot.v1')
$pilot = "YOUR_32_CHARACTER_PILOT_ID"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/api/dev/players/$pilot/raiders"
```

Each successful request appends exactly one uniquely named raider to that pilot's persistent sector; it will appear in the next WebSocket snapshot. The pilot must already exist. This endpoint requires `ORBITAL_DEV_COMMANDS=1`; it has **no user authentication**, so keep the backend bound to a trusted development network and never enable these commands on a public service.

### Gradual Vue migration

The first extracted Options API component is `frontend/src/components/CommsPanel.vue`. The legacy game dispatches a typed `orbital-comms` event through the small `services/comms.ts` interface. Vue now renders the log with reactive state and text interpolation rather than `innerHTML`. Docking and collapsing keep working, as they operate on the component's panel element.

The remaining ship, telemetry, navigation, marketplace and canvas are still in the legacy compatibility layer. Next steps are extracting the Ship HUD and Technology Market into Vue components, giving them reactive snapshot props, then separating the renderer/input and protocol adapters from `game.js`. Pure orbital physics and server-side simulation stay framework independent.

### HUD customization

Every cockpit panel (including Comms, Upgrades, Navigation and Your Ship) has controls to:

- **↙ / ↗ Dock/undock**: move between sidebar and map.
- **Click the panel heading** to collapse/expand; Navigation and Telemetry retain their existing title buttons (no duplicate minimize button).
- **⠿ Drag** when inside the canvas (keyboard arrow keys also work on focused drag handles).

Click **⛶ Fullscreen** to make the canvas fill your display; Escape exits. **☷ Panels** sits immediately to the left of Fullscreen. Use **☷ Panels** to move any panel into the fullscreen map, even when it is currently docked outside. Panel layout persists in browser storage. **☷ Panels → Restore default layout** resets the HUD only.

## Restart versus reset

**Restart without losing data**: stop FastAPI/Vite with Ctrl+C and start them again. PostgreSQL game state stays unchanged. Refreshing the page also resumes the same pilot.

**Reset one pilot (ship, sector, hull, credits and technology)**: open browser DevTools console and copy the result of:

```js
localStorage.getItem('orbital-outlaws.pilot.v1')
```

Stop active gameplay for that pilot, then from `backend/` run:

```powershell
python -m app.reset_dev --pilot YOUR_32_CHARACTER_ID --confirm RESET-PILOT
```

Reload the page. Keeping the browser's pilot ID makes a **fresh ship for that same pilot**.

**Reset the ENTIRE development universe** (destructive to *all* pilots): stop FastAPI and run from `backend/`:

```powershell
python -m app.reset_dev --world --confirm RESET-WORLD
```

This drops and recreates Orbital Outlaws PostgreSQL tables, and clears **all** player and economy records. Use only with a dedicated local development database; the command requires `ORBITAL_DEV_COMMANDS=1` and an explicit confirmation phrase.

**New pilot without deleting old data**: browser DevTools:

```js
localStorage.removeItem('orbital-outlaws.pilot.v1')
location.reload()
```

**Reset only local UI preferences**: use the HUD's Restore default layout, or clear `orbital-outlaws.hud-layout.v2` in localStorage. Controls → Restore defaults resets key bindings. Neither changes PostgreSQL.

## Testing

GitHub Actions runs a PostgreSQL service and verifies the backend, Node regressions and Vue production build.

```powershell
cd backend
$env:TEST_DATABASE_URL = "postgresql+psycopg://USER:PASSWORD@localhost:5432/orbital_outlaws_test"
python -m pytest -q
cd ..
node --test tests/*.test.cjs
cd frontend
npm run build
```

Use a **separate** PostgreSQL test database. Without `TEST_DATABASE_URL`, database integration tests are skipped. A running Postgres instance is required for the full suite.

## Security and next architecture milestone

The development live WebSocket uses anonymous browser pilot IDs; **never expose `ORBITAL_DEV_COMMANDS=1` publicly**. Authentication, shared world-region authority, continuous multi-sector NPC scheduling, efficient causal collision/event queues, and mature migration tooling remain future work. The offline `orbital-outlaws.html` is an older local-only build, not the v0.11 connected client.
