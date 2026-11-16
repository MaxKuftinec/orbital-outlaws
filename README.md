# Orbital Outlaws — v0.18 finite arrival AI, coordinated tactics and momentum-conserving capture

A persistent 2D Newtonian orbital combat prototype using **Vue 3 + Vuetify (Options API)**, **FastAPI**, **PostgreSQL** and a bidirectional **WebSocket**.

## Current architecture

- **Backend authority:** Flight state, RCS/thrust fuel, projectile creation, ammunition, hull damage, NPC target decisions, physically integrated NPC support/tactical thrust (all incoming arrival and insertion burns now use finite thrust), swept projectile/ship collisions, salvage and credits.
- **Offline time:** The universe clock uses real wall-clock time. A pilot-sector checkpoint is **caught up by FastAPI on the next connection/query**. NPC decisions and collisions are resolved during the catch-up even if nobody kept a browser open. This is lazy offline simulation, not a dedicated continuously running background worker per pilot.
- **Frontend prediction:** Browser renders player controls immediately at ~60 FPS and interpolates authoritative NPC positions. The client never submits NPC positions, kills or credit claims.
- **Still limited:** Sectors are **per pilot**, not yet shared multiplayer space. Long-disconnect catch-up uses adaptive numerical timesteps and is a gameplay approximation, not an exact global causal event queue. There is no player authentication yet. These endpoints are development-only.

### Start backend

Create an existing PostgreSQL database first:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
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

Open http://localhost:5173. Vite proxies `/players` (including WebSocket), `/worlds` and `/dev` to FastAPI and maps `/backend-health` to the backend root.

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

**Comms & Events now itemizes salvage rewards**, using the server's actual awarded amounts rather than the pickup label: for example `+18.0 kg propellant`, `+12 rounds`, `+50 ¤` or `+2.0 kg spare parts` on a capacity-limited wreck. Full tanks and full parts capacity no longer consume pickups without giving a benefit. Starter salvage capture requires being within 19 km and moving below **5 km/s relative to the pickup**. The new **Salvage Capture Rig (55 ¤)** increases the speed limit to **8 km/s**, but only for small floating salvage—not intact spacecraft. Swept encounters are now checked to detect high-speed fly-throughs; those are logged but **not recovered**. To collect a counter-orbiting wreck, first slow down and match its velocity.

### v0.17 autonomous NPC guidance

Fuel-rescue NPCs now search sampled orbital wait/transfer windows using Kepler
coast predictions and Newton shooting. A candidate must clear the central body,
fit the donor's fuel reserve and leave propellant for donation. It also must fit
the finite-duration main-engine burns into the selected flight window. The donor
then **waits, thrusts for multiple simulation steps, coasts, and thrusts again**
to match velocity. Propellant and spacecraft mass decrease continuously through
`backend/app/npc_guidance.py`, using 1.6 MN thrust and 5 kg/s mass flow.
Small combat-course adjustments now also use finite thrust, not instant velocity
changes. The rescue remains a sampled **two-burn approximation**: it may miss and
replan; it is not a global low-thrust optimizer or a fleet coordinator.
New inbound ships also use finite-duration main-engine burns. Their arrival controller
samples candidate approach burns, predicts post-burn periapsis, retains the
independent random 360° launch velocity, performs up to three course trims,
and attempts finite orbital insertion before periapsis. A physically infeasible
arrival can miss or fail; the simulation never awards a free instant orbit.

A rescue transfer is never awarded merely because a route was calculated.
The donor must physically come within 18 km at under 2.5 km/s relative speed.
The **Salvage Capture Rig** (55 ¤) raises the contact threshold from 5 km/s
to 8 km/s, but never guarantees a capture. A 2D inelastic grapple computes
the incoming payload mass and relative momentum; the ship's velocity changes
to their combined center-of-mass velocity and the lost relative kinetic
energy heats a bounded sink. Basic capture heat capacity is 520 MJ, upgraded
capacity is 1,300 MJ, and 8 MJ/s radiates away. Payload limits are 150 kg
basic / 240 kg upgraded; a massive/high-speed wreck can still be rejected.
The HUD displays grapple heat and acquired cargo. Non-fuel material contributes
real dry/cargo mass and makes later acceleration more expensive. Fuel containers
and parts capsules can be partly emptied without deleting remaining salvage.
The thermal model is simplified: no actual multi-second tether payout, hull
stress, ammo round ejection or globally tracked debris destruction yet.

### v0.18 coordinated NPC decision making and capture dynamics

`backend/app/arrival_guidance.py` samples candidate finite approach/insertion
burns and uses post-burn orbit elements for corrections and risk refusal.
`backend/app/npc_intelligence.py` forecasts short-horizon close approaches,
assigns allied intercept targets across available friendlies, prioritizes the
player's defense, gives raiders future-range target selection, and queues
fuel-constrained finite evasive burns. Rescue craft can perform up to two
midcourse corrections before terminal velocity matching; donor selection
avoids predicted hazardous orbits when possible. These are **bounded policies**,
not a global fleet strategic planner or optimal-control solver.

`backend/app/capture_physics.py` conserves capture momentum and accounts for
energy absorbed by an inelastic grapple as stored/radiated heat. Crew G-loads,
tether dynamics and waste heat engine penalties are next-stage realism work.

### Spawn incoming raiders or allies from FastAPI (development only)

The cockpit has no reinforcement toggle. Instead, each POST creates **exactly one** incoming ship, either hostile or friendly, through FastAPI's Swagger UI at http://127.0.0.1:8000/docs or PowerShell:

```powershell
# Get the current pilot ID in the browser DevTools console:
# localStorage.getItem('orbital-outlaws.pilot.v1')
$pilot = "YOUR_32_CHARACTER_PILOT_ID"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/dev/players/$pilot/raiders"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/dev/players/$pilot/allies"
```

Each successful request adds one uniquely identified ship to the pilot's persistent sector; it appears in the next WebSocket snapshot. The pilot must already exist. Both factions spawn **outside** the operational orbital region, with independent uniformly random **360° initial velocity direction** (speed 20–32 km/s). After 2.5 seconds, their mission computer selects a safe finite approach burn using predicted post-burn periapsis and real fuel consumption. A fair 50/50 decision chooses **flyby** (approach burn only, then depart) or **orbit insertion** (an additional circularization burn near periapsis). The chosen orbital sense is based on initial angular momentum, so visitors may orbit in either direction. The response includes `intent`, faction, initial heading, orbital sense, and new ship ID. All of these NPC approach and insertion maneuvers now consume fuel during actual finite engine burns. The pilot still chooses their own arrival intention. Initial sector residents retain their existing established orbits. This endpoint requires `ORBITAL_DEV_COMMANDS=1`; it has **no user authentication**, so keep the backend bound to a trusted development network and never enable these commands on a public service.

### Respawn a destroyed pilot (development only)

Restarting FastAPI or refreshing the browser **does not** respawn a destroyed pilot.
A dead pilot can continue watching, panning and zooming the sector without a blackout overlay.
To replace only the destroyed spacecraft, keeping the same pilot ID, NPCs and world state but **resetting credits to 65 and clearing purchased technologies**, use Swagger at http://127.0.0.1:8000/docs or:

```powershell
$pilot = "YOUR_32_CHARACTER_PILOT_ID"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/dev/players/$pilot/respawn"
```

Retrieve your pilot ID in browser DevTools with:

```javascript
localStorage.getItem('orbital-outlaws.pilot.v1')
```

The endpoint is dev-only (`ORBITAL_DEV_COMMANDS=1`). It returns **409** when the
pilot is still alive and **404** for unknown pilot IDs. It restores 100% hull,
200 kg fuel, 36 rounds and 10 kg spare parts, resets control leases, and
resets purchased technology and credits, while preserving sector inhabitants. A replacement ship and
**new pilot accounts** now spawn beyond 950 km with independently randomized
velocity heading (full 360°); the pilot steers manually, unlike programmed
NPC flyby/orbit missions. The game camera recenters on respawn; no new
respawn button was added to the cockpit.

**Fuel assistance:** The old Friendly Escort panel is gone. Friendlies remain visible on the map
and in Navigation. The **Request Fuel Assistance** button on the canvas queues a server-controlled
rescue. To help a selected ally, use **Offer 20 kg to selected ally** in the Navigation sidebar;
transfer requires being within 18 km at less than 2.5 km/s relative speed.
Other allied NPCs and raiders autonomously assist same-faction NPCs.

**Pilot-configurable fuel reserve:** In the Navigation sidebar, set **Protected propellant** to
any value from 0 to 200 kg (default **36 kg**, formerly the hardcoded 18% of the starter tank).
This value governs autopilot planning/burn cutoff **and** the minimum fuel retained when
donating to allies. A reserve of 0 deliberately removes those protections. **Manual thrust
can still use all remaining fuel**. Connected pilots store their preference in PostgreSQL's
new `player_settings` table and keep it across ship destruction/respawn; local-only cockpit
sessions retain it in browser storage. Changing reserve aborts an active autopilot and
invalidates its previous route, requiring recalculation. NPCs keep independent AI reserves.
The server also exposes `POST /players/{pilot_id}/reserve` with `{"kg":36}` (dev-only).
### Gradual Vue migration

**Migrated:** `CommsPanel.vue`, `ShipPanel.vue` and `TechnologyMarket.vue`, all using Vue **Options API**. The legacy game emits typed `orbital-comms` and `orbital-cockpit-state` events through the interfaces in `frontend/src/services/`. Vue now renders Comms messages, ship hull/fuel/ammo/credits and technology ownership with reactive state. Market purchases flow back through `orbital-market-purchase` actions rather than raw button event listeners. The old standalone HTML retains a compatibility DOM path.

**v0.15:** Telemetry, Targeting and Navigation instruments are Vue Options API components bound to typed state events; `frontend/public/legacy/rendering.js` isolates the canvas draw functions from the simulation. Simulation input and WebSocket networking remain in legacy JavaScript for the next migration.

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

## Fuel support and collision behavior (v0.15)

The UI **Request Fuel Assistance** button sends a persistent WebSocket support request. The server chooses an allied donor, guides it with limited impulse corrections, requires a genuine low-relative-speed rendezvous and transfers mass from the donor's tank. NPCs may also ask friendly NPCs (including same-faction raiders) for assistance automatically. This remains rudimentary AI, not yet a globally optimized transfer planner.

To assist an ally, select a friendly target in Navigation, get within **18 km** and **2.5 km/s** relative speed, then click **Offer 20 kg to selected ally**. The server limits each transfer to 35 kg, honors your configurable donor reserve and never creates free fuel.

Developers can alternatively use `POST /players/{pilot_id}/request-assistance` with `{\"recipient\":\"player\"}` and `POST /players/{pilot_id}/offer-fuel` with `{\"target\":\"ally-01\",\"kg\":20}`. These endpoints require `ORBITAL_DEV_COMMANDS=1`. In Swagger at `http://127.0.0.1:8000/docs` no `/api` prefix is used.

**Rendezvous diagnostics:** When a sampled route fails, Comms distinguishes a transfer above the fuel budget from a transfer that the finite two-impulse search couldn't solve. Opposite-sense/counter-orbiting objects can require substantial braking; visual overlap alone is not a safe capture.
