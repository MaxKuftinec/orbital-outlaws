# Orbital Outlaws — v1.1 System Atlas and K-dwarf Veyra

A persistent 2D Newtonian orbital combat simulation using **Vue 3 + Vuetify (Options API)**, **FastAPI**, **PostgreSQL** and a bidirectional **WebSocket**.

## Compute Engine deployment and public playtest

**The public browser alpha and persistent game backend are intentionally
separate until authentication and shared multiplayer are ready.**

The [Compute Engine deployment guide](infra/compute-engine/README.md)
provides Docker Compose (FastAPI, PostgreSQL 16, Caddy TLS), VM creation,
private API defaults, static Firebase Hosting setup, and offsite DB backups.
The [public alpha plan](docs/PUBLIC_ALPHA.md) records the initial 10–30 player
testing wave, feedback, changelog, and early pioneer recognition direction.

For a **public static preview** set `VITE_PUBLIC_PREVIEW=1` using
`frontend/.env.alpha.example` as a template before building. That build
disables anonymous WebSocket persistence and clearly labels gameplay
as a local, **not-saved** sandbox. A VM alone does not create multiplayer;
the current server still has isolated pilot sectors, so production
gameplay routes remain blocked until identity and shared-world work is done.

## Pilot profile and inertial map instruments

**Pilot Registry:** The cockpit now has a **Pilot Profile** action with
a six-portrait fictional character selector, registration with email/callsign
and password, six-digit email verification, sign-in via email or callsign,
a verified profile dossier, avatar changes and logout.

Accounts are disabled on deployments until `AUTH_ENABLED=1`, strong
`AUTH_SECRET`, SMTP mail submission and frontend `AUTH_ORIGINS` are
configured. The current anonymous game-pilot WebSocket is **not** granted
access by account sessions; persistent ship ownership and shared multiplayer
are separate next steps. See [Account design](docs/PILOT_ACCOUNTS.md).

**Map Tools:** The Ruler stores free points in Veyra-centered inertial
coordinates, independent of the selected map frame. The new **Compass**
measures bearing clockwise from inertial north. Clicking near Veyra, Kestrel
or a ship snaps the measuring endpoint to the moving object's centre.
Very long lines are clipped to visible canvas bounds to avoid costly
astronomical-scale draw calls.

**Automated engine burn:** A proposed basic guidance console is documented in
[Automated thrust UI concept](docs/AUTO_THRUST_UI_CONCEPT.md). It has **not**
been implemented in game physics, server commands or cockpit controls.

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

### Development-only fuel replenishment

For flight experiments, use the backend-only `POST /dev/players/{pilot_id}/refuel`
route with `ORBITAL_DEV_COMMANDS=1` **in a trusted local environment only**.
The pilot ID is the existing 32-character lowercase hexadecimal ID.
An empty request refills the ship's propellant to its **200 kg** capacity;
`{"kg": 25}` adds up to 25 kg, capped at the remaining tank space.

```powershell
$pilotId = 'YOUR_32_CHARACTER_LOWERCASE_HEX_ID'
Invoke-RestMethod -Method Post -Uri "http://localhost:8000/dev/players/$pilotId/refuel"
Invoke-RestMethod -Method Post -Uri "http://localhost:8000/dev/players/$pilotId/refuel" -ContentType 'application/json' -Body '{"kg":25}'
```

The command advances the authoritative simulation first, adds the same
number of kilograms to both fuel and total spacecraft mass, and records a
`dev_refuel` history event. A full tank is a successful no-op; a destroyed
ship must use the separate development respawn endpoint first.
This route deliberately has **no cockpit control** and is forbidden if
development commands are disabled. Never enable anonymous development
commands on a public deployment.

### Start frontend

```powershell
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173. Vite proxies `/players` (including WebSocket), `/worlds` and `/dev` to FastAPI and maps `/backend-health` to the backend root.

## Allied fleet fuel assistance and Ephemeris controls (v0.18.1)

The **REQUEST FUEL ASSISTANCE** button (H) is an SOS for KESTREL-7.
All available friendly NPCs, including spawned AEGIS visitors that have
completed their approach, can be selected as donors. Each physically
transfers at most 35 kg per rendezvous. If the receiver is still below
75% of tank capacity and other craft have reserve fuel, the order remains
active and can assign a different donor for another delivery. NPCs also
issue automatic requests when a same-faction vessel drops under 18% fuel.

To help a particular ally, click *any* living friendly spacecraft on
the map or choose its name in the Navigation dropdown. The navigation
panel shows its propellant, distance, relative speed, and live donor
assignment. Click **Request assistance for selected ally** to order an
available NPC donor to rendezvous with that spacecraft. Click
**Transfer up to 20 kg to selected ally** to donate from KESTREL-7 once
within **18 km** and below **2.5 km/s** relative speed, while respecting
your protected propellant reserve. The control disables itself when
physical transfer conditions are not met. A queued NPC order does not
guarantee success; it still needs a safe, fuel-affordable orbital rendezvous.

The separate **Ephemeris ON/OFF** control above the map appears when
the Ephemeris Computer is installed. It independently toggles the
selected contact's projected **unpowered** orbital path and T+60/T+120s
markers. Clicking a different allied ship on the map selects that
specific craft and shows its ephemeris, rather than silently displaying
the original escort or a hostile. The normal `Trajectory` button
continues to govern your own predicted path.

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

The endpoint is dev-only (`ORBITAL_DEV_COMMANDS=1`). It permits **starting
a fresh run even when the previous ship is alive**, and returns **404** for
unknown pilot IDs. It records the abandoned ship's last authoritative
checkpoint in the immutable respawn event history (the previous vessel is **not**
kept as an active NPC). It restores 100% hull,
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


## v0.19 — limited-force grapple, structural loads and finite recovery

A contact below 5 km/s (8 km/s with the rig) does **not** grant salvage automatically.
The server first evaluates the payload mass, initial velocity and thermal budget,
then attaches one reeling line to one pickup. `backend/app/tether.py` applies
**equal and opposite tension impulses to ship and payload** every simulation
step, preserving total linear momentum for this internal force. A reel controller
tries to reduce separation at a bounded 0.36 km/s, but tension cannot push the
payload away; it is capped at **2,200 N basic / 12,000 N upgraded**. A fast,
light pod can take several seconds to catch. Strongly mismatched or massive
objects can overload the line, require more braking distance than the 19 km
maximum, exhaust heat capacity, or accumulate structural fatigue. A failed
capture releases the pod onto its actual remaining orbit and costs 2 hull HP;
it cannot be retried for 20 seconds. Payload and credits are added only after
separation is below **0.7 km** and relative speed below **0.65 km/s**, at which
point a final low-energy mechanical latch merges the remaining momentum.

The cockpit displays live tether tension and grapple status and the canvas
renders the tether. The local-only mode approximates the same reel. The server
stores the active grapple in the encounter checkpoint, so a disconnected pilot
cannot bypass the time-dependent physics. Dissipated work heats the existing
radiative heat sink; positive mechanical work used for powered reeling is
separately accounted as `captureMotorMJ` (energy accounting, not yet a battery).

**Gameplay-scale approximations:** The 19 km grapple envelope is not a realistic
physical arm length, and the force controller applies impulses at the sector
simulation tick rather than integrating full elastic cable elements/attitude
dynamics. Realistic metre-scale grapple reach, multi-body tethers, rotational
torque, finite cable mass, retraction power supply and spool failure are future
physical-model improvements.


### Automatic grapple safety and salvage autopilot handoff

Automatic capture refuses a contact when its current outward radial speed and
payload mass require more braking distance than the free tether length. Such
refusals preserve the payload and do not impose hull damage. Once a viable
line is attached, the Rendezvous Computer switches to **tether** guidance:
it does not fire new transfer burns or time out under the obsolete six-second
capture-window deadline while the server reels in the payload. If the line
breaks or disappears without recovery, guidance stops and requires a new
approach. The separate grapple-tension, overheating and fatigue limits remain;
a line that becomes unsafe *after* attachment may still snap and damage hull.


### Request fuel from a specific AEGIS spacecraft

Select a living AEGIS ship in the Navigation target selector (or click it on
the orbital map), then press **Request fuel for KESTREL-7 from AEGIS-XX** in
the quick Navigation console or the full Rendezvous panel. This sends a
server-validated donor ID with the assistance order. The selected ally must
be alive, finished arriving, carrying more than 55 kg of fuel, and not
occupied by a different rescue request. If KESTREL-7 already has an order
with a different donor, the new selection **reassigns** it and stops the
previous donor's rescue maneuver. Specified-donor orders conclude after
one real rendezvous and physical transfer (up to 35 kg); request another
ally separately for an additional delivery. On rejection, check the Comms
log for the specific server error.

The large **REQUEST FUEL ASSISTANCE** button (H) remains automatic:
the server chooses an available donor and may ask another available ally
for follow-up fuel if your ship is still short.


### Focus and follow distant objects (camera-only controls)

Choose a wreck, salvage parcel, hostile, friendly or waypoint in Navigation
(or click one on the orbital map). **⌖ Focus** in the map toolbar or
**⌖ Focus selected** inside the Navigation console centers the camera on
that contact and zooms to at least 2.8×. **◎ Follow** continuously follows
a moving selection until toggled off, the target disappears, or you begin
dragging the map. Zoom buttons and wheel continue to work independently.
A colored round/corner targeting scope marks the selected navigation contact
on the canvas; when it is outside the visible map, an edge reticle points
toward its direction and reports its current distance from KESTREL-7.
The map also displays a NAV TARGET label separately from the weapon
TARGET LOCK readout.

These camera controls do not require a paid technology, move spacecraft,
use propellant, engage autopilot, or change weapon targeting.


### Flight-input release safety and attitude control

Live flight inputs are now acknowledged with an incrementing `seq` on the
existing WebSocket snapshots. The client keeps at most one ordinary in-flight
control command, coalesces high-frequency thrust/turn/aim changes into the
latest sample, and **sends engine releases immediately** even while the last
command is awaiting acknowledgement. Existing finite 0.4-second server
leases remain an emergency expiry; network/server processing latency still
matters, so exact zero-latency cutoff over an unreliable connection cannot
be promised. Local player-input prediction stops as soon as the key/button is
released. Autopilot now uses a common braking-aware angular-rate controller
for both local movement and server flight commands, with a 0.55 rad/s speed
limit rather than the previous 1.9 rad/s cap; dynamic rendezvous accuracy
still depends on trajectory replanning and finite-burn planning.


## v0.20 — Veyra: first star–planet system

**✦ System map** above the canvas switches from a planet-relative camera to a
**star-centered** system view. VEYRA stays fixed on the system map,
while KESTREL moves along a circular, analytically calculated stellar orbit.
**◎ Planet view** returns to the familiar Kestrel-local encounter. Both objects
can be selected on the map or in Navigation; **⌖ Focus** and **◎ Follow** work
with these celestial contacts, while the existing **CENTER ON MY SHIP** works
from either frame. Zooming and panning never spend fuel or change velocity.

This is not a background-only star. Both authoritative backend and the browser
simulate the primary's **differential gravitational acceleration** on spacecraft,
NPCs, salvage and projectiles. Kestrel itself follows a circular Keplerian
ephemeris; the existing ship coordinates are **Kestrel-relative inertial
coordinates** with star gravity minus the planet's common star acceleration.
Thus all previous player saves and sectors retain their coordinate meanings.

| Star system parameter | Initial value |
| --- | --- |
| Parent | VEYRA, gravitational parameter 2.0 × 10⁹ km³/s² |
| Kestrel planet | Gravitational parameter 310,000 km³/s² |
| Planetary orbit radius | 160,000 km |
| Planet orbital period | ~8,992 seconds (2.50 hours of game time) |
| Planetary Hill radius, approximate | ~5,959 km |
| Star radius (game scale) | 4,500 km |

The backend exposes **GET `/system`** with the current star-centered
positions/velocities, orbit period and approximate Hill radius. There is no
schema migration or player-save reset. Local flight and live server flight
share the same star/gravity constants.

**Scope / realism:** This first version is a planar *restricted three-body*
model: the star does not wobble around the system barycenter, the planet
follows a prescribed circular Kepler orbit, and there is no orbit
precession caused by the spacecraft's negligible mass. The authoritative
stellar tide is split around existing planet-centric integrations; very
long offline catch-up is approximate. Existing rendezvous and NPC orbital
planners still use **planet-only Kepler** projections, so their transfer
predictions grow unreliable near/outside Kestrel's Hill sphere. A celestial
body is deliberately **not** an autopilot rendezvous destination yet:
selecting it allows inspection/camera tracking, but requesting a
star/planet transfer reports that interplanetary guidance is unsupported.
Precise interplanetary transfers and multiple-system sector streaming are
future work.



## v1.0 — Veyra and cockpit navigation tools

The parent star has been formally named **Veyra** (replacing the provisional
Kestrel Primary name). This star–planet simulation is now the first **v1.0**
version rather than another 0.x prototype milestone; the world/gravity model
is unchanged from v0.20 apart from the published name.

The top-right **⚙ Settings** opens two categories:

- **⌨ Controls:** the existing remappable hotkeys, still saved per browser.
- **◎ Frame of reference:** choose **Kestrel** (planet origin) or **Veyra**
  (star origin), or hide the coordinate axes/origin grid entirely.
  Both the selected frame and axis visibility are saved locally. The
  reference axes follow the chosen frame; changing frames does not
  rotate your ship, alter velocity or consume fuel.

A **live, distance-calibrated scale bar** sits near the bottom right of the
map, above the SOS control. It changes in a conventional 1–2–5 sequence as
zoom changes. Press **↔ Ruler**, click a first map point and a second point,
and read straight-line distance in kilometres (metres at sub-kilometre
scale). A temporary line previews the measurement as the cursor moves.
**Clear** removes both points. These map tools are free for every player
and work in either frame.

**Ballistic ETA** is no longer included in the basic HUD or in the preview
path label; the numeric arrival time requires the **Predictive Fire Control**
upgrade. The physical path visualization remains available.

**New ship / new run:** The guarded `POST /dev/players/{pilot_id}/respawn`
works for living or destroyed pilots. It spawns a new randomized spacecraft,
resets 65 starter credits and technology ownership, and preserves NPC/salvage
sector state and event history. The old ship's last checkpoint is archived
in the respawn event; it is no longer an active controllable vessel.
It does **not** create a new browser pilot ID or separate login account.


## v1.0 navigation and rendering refinement

**Fuel assistance** is a normal action inside the **Rendezvous Computer /
Navigation sidebar**, alongside selecting a donor or assisting another ally.
The automatic `⚑ Request fuel assistance` command still works using the **H**
shortcut, has the same live-server validation and transfer physics, and
does not occupy the canvas or block the map's distance scale.

**Visual size now responds to zoom level without a large minimum sprite.**
At planet-scale zoom, individual spacecraft remain readable with ship
silhouettes, engine effects and health indicators. At star-system distances,
ships and salvage become **tiny colored point markers** (normally less than
2 px radius); text labels, health bars, gimbal rings, and large player
circles disappear until the camera zooms in again. Veyra and Kestrel retain
their own visibly larger celestial markers.

**Target acquisition** uses a compact, pulsing ring with slow rotating
arc segments and corner brackets. Its size is based on map zoom and the
selected body's visible radius, with a bounded maximum; it does not
become a giant fixed-size scope covering a planet or star. At distant
zoom, the selection identity remains in the existing NAV TARGET caption
rather than a large label over the object. Offscreen targets still show
direction and distance. Users requesting reduced animation motion see a
stationary reticle. These are presentation-only changes: target selection,
weapon lock, trajectory, and fuel consumption are unchanged.


## Reference frame, history and map toolbar

The selected **Settings → Frame of reference** now controls the
**historical trajectories and telemetry**, not merely the axes. Each newly
recorded ship trail point and near-term player prediction carries a game
timestamp; star-centered rendering translates the point using Kestrel's
**position at that sample time**, avoiding a misleading path that follows
today's planetary origin. Old un-timestamped trail points do not claim to
be valid star-frame history and are omitted until fresh samples appear.

The single **Orbital Telemetry** panel reports position/speed, reference-body
altitude and instantaneous two-body osculating periapsis/apoapsis/period
against the selected body (Veyra or Kestrel). Its heading identifies the
origin and warns that these conics are approximations: stellar/planetary
perturbations can invalidate Keplerian long-term predictions.
The planet-only NAV transfer overlay is hidden in Veyra view because its
samples lack stellar-frame epoch information; actual spacecraft physics
and active guidance are not changed by this camera setting.

At top-right of the map, **⌖ Tools** appears directly to the left of
**☷ Panels**, with free **↔ Ruler** and **Clear** controls in its dropdown.
The distance scale is a standalone **unboxed bottom-right canvas overlay**
and remains live while zooming in either reference frame.

See [Second Planet Design Candidate](docs/SECOND_PLANET_DESIGN.md) for
an Earth-mass, Earth-radius potential civilization world and the two
possible Veyra stellar models. It is a proposal, not a shipped planet.


## v1.1 — System Atlas / lore & hard-science architecture

The separate, bookmarkable **`#/atlas`** page (or **◈ System Atlas** in
the cockpit header) presents an editorial system overview, interactive
orbit-preview chart, **individual Veyra, Kestrel and Neris dossiers**, mass,
radius, gravity, orbital period and luminosity data, gameplay lore, a
pilot field handbook, and a civilization/future-economy roadmap. Click
**Return to cockpit** to preserve the active flight session. The live
simulation continues to run in the background; this is not a pause menu.
The **Locate in cockpit** action switches back and selects/focuses
simulated Veyra or Kestrel. Neris is labeled **Concept**, never a live
gravitational destination.

### Veyra physical calibration

Veyra now has a plausible **K2V orange-dwarf model** replacing its
brown-dwarf-scale demonstration parameters: **0.82 M☉**, **0.78 R☉**,
**0.40 L☉**, roughly **5,197 K**, μ ≈ **1.08824 × 10¹¹ km³/s²**.
Kestrel's Keplerian orbital radius has changed to **0.40 AU**
(59.84 million km), orbital period to **102.04 days**, and local
star-tide calculation updates in both backend and browser. The system
view can now zoom out to actual astronomical-unit distances. This
changes only the planet's stellar orbit and differential force, not
persisted Kestrel-relative ship positions.

The second planet, **Neris**, has a reserved **design orbit at 0.65 AU**,
an estimated 211.38-day period and about 0.947 times Earth's stellar
irradiance. It is **not yet instantiated** as a moving or gravitating
entity; the Atlas chart shows the planned phase only. The design
describes an Earth-radius and Earth-mass world with candidate oceans,
habitable climate, industrial ports and future ecological simulation.

**Outstanding geometry debt:** the current Kestrel local encounter still
uses μ = 310,000 km³/s² (~0.78 Earth mass) with an 85 km collision
radius. This cannot be a normal rocky planet. Before surface landing,
we must choose a plausible physical radius, version and migrate local
positions/velocities safely, and revisit encounter scale, flight times,
spawn points and game time acceleration. The Atlas transparently marks
this as a legacy approximation; it does not claim physical completeness.

### Planned semantic versioning

**v1.x** continues orbital gameplay, solar-system physics and flight
navigation, ship/port infrastructure and UX. The FIRST implementation
of an actual persistent **planetary ecology or civilization** (its
resources, inhabitants, settlements, or interacting economy) is the
explicit **v2.0 major milestone**. Lore and static concepts alone
do not trigger v2.0.

Reference: [Veyra stellar canon](docs/STAR_SYSTEM_CANON.md),
[Neris design](docs/SECOND_PLANET_DESIGN.md),
[Versioning milestones](docs/VERSIONING.md).
