# Automated thrust — implementation and cockpit guide

**Status: implemented** as a basic, server-authoritative flight-computer system.

The cockpit's **ATTITUDE & PROPULSION → AUTOMATED BURN** instrument is an
expandable, responsive Vue interface under manual flight controls. It is a
**basic ship system**: no upgrade, purchase, or paywall is required.

## How to use it

1. Start the trusted FastAPI backend with PostgreSQL, and connect the cockpit
   to its live WebSocket. Development access requires
   `ORBITAL_DEV_COMMANDS=1` on your **private local machine only**.
2. Expand the **AUTOMATED BURN** section under the flight buttons.
3. Select a thrust direction:
   - **Prograde / retrograde**: along / opposite current velocity in the
     selected Kestrel or Veyra reference frame.
   - **Radial out / in**: away from / toward the selected reference origin.
   - **Ship heading**: fixed inertial direction captured at command issuance.
   - **Custom vector**: fixed inertial degrees: 0° is +X, +90° is +Y.
4. Select a cutoff:
   - **Duration**: main-engine ignition time in seconds (0.05–40 s), **not**
     total time including RCS alignment.
   - **Fuel remaining**: cutoff at a protected floor of 0–200 kg,
     which must be no lower than the stored pilot reserve.
5. Inspect approximate burn time, mass consumption, and ideal Δv.
   Estimates intentionally exclude RCS alignment fuel and real-world
   trajectory changes; the server uses the true fuel/mass state.
6. Select **ENGAGE AUTOMATED BURN**. The computer first rotates with the
   physical RCS, then fires using the ±28° main-engine gimbal. The status
   panel shows ALIGNING, BURNING, COMPLETED, ABORTED, or FAILED.
7. Choose **ABORT** whenever needed. W/A/D/S manual flight input also
   cancels the active server guidance; firing weapons does not.

The **ABORT** action remains available even when the planner is collapsed.

## Authoritative architecture

### Backend

- `app/auto_burn.py`: deterministic guidance control, physical RCS torque,
  integrated finite 1.6 MN / 5 kg/s main-engine acceleration, bounded
  alignment and burn windows, direction and frame derivation.
- `AutoBurn` PostgreSQL table: one plan + committed progress per pilot.
- `WorldStore.player_auto_start` and `player_auto_abort`: serialized
  commands with row locks, state checkpoint, plan validation and immutable
  command events. A new start request is refused while already active.
- `WorldStore._settle_auto` and `get_entity`: project a saved plan
  through elapsed authoritative world time; atomically commit checkpoints
  before sector interactions or manual overrides.
- `/players/{pilot_id}/live`: message types `auto_burn_start` and
  `auto_burn_abort`. The server acknowledges them with `auto_burn`,
  then publishes `auto_burn` status inside the flight snapshots.
- Dev-only HTTP endpoints:
  `POST /players/{pilot_id}/auto-burn` and
  `POST /players/{pilot_id}/auto-burn/abort`.

### Why it works after disconnect

The browser sends the *command*, not continuous fake thrust commands. The
server retains the plan in PostgreSQL. The project currently uses a
**lazy world-simulation model**: upon a later query/reconnect, it integrates
the missing finite RCS/burn interval and then coasts for any remaining
elapsed time. This reproduces the commanded fuel expenditure and state
without relying on browser timers or an always-connected socket.

When the universe becomes a genuinely shared multiplayer sector, guidance
must move into a continuously scheduled authoritative simulation worker so
other players observe the same state at the same time. The current pilot
sectors are separate; running a VM alone does not change this.

### Safety limits

- Maximum ignition time: **40 seconds** per command.
- Maximum cumulative attitude alignment: **25 seconds** per command.
- A selected fuel cutoff may never go below the saved pilot reserve.
  Duration-limited burns also stop if they reach the reserve first.
- RCS and main-engine fuel consumption come from the same tank.
- Reaching the fuel floor stops the burn even if the requested duration
  hasn't elapsed. Safety guards reject invalid references/angles and stop
  guidance if the integration detects an intersection with Kestrel's
  existing 91-km gameplay collision radius.
- The server rejects overlapping plans, destroyed ships, malformed input,
  non-finite values, and unrealistic command ranges.
- No client can directly set its server fuel, mass, position, or engine
  velocity through this protocol.

## Example HTTP commands (trusted local development)

```powershell
$pilot = 'YOUR_32_CHARACTER_PILOT_ID'
$base = 'http://localhost:8000/players/' + $pilot

# 6-second prograde ignition in the Kestrel velocity frame.
Invoke-RestMethod -Method Post -Uri "$base/auto-burn" `
  -ContentType 'application/json' `
  -Body '{"direction":"prograde","reference":"kestrel","cutoff":"duration","duration_s":6}'

# Stop retrograde ignition once the remaining tank reaches 50 kg.
Invoke-RestMethod -Method Post -Uri "$base/auto-burn" `
  -ContentType 'application/json' `
  -Body '{"direction":"retrograde","reference":"kestrel","cutoff":"fuel","fuel_floor_kg":50}'

# Abort the active plan explicitly.
Invoke-RestMethod -Method Post -Uri "$base/auto-burn/abort"
```

Do not issue the two start commands simultaneously; abort or complete the
first plan before the second. All legacy pilot REST/WebSocket routes still
require `ORBITAL_DEV_COMMANDS=1` and **are not authenticated public-player
endpoints**. Never enable them on a publicly exposed VM.

## Known v1.x limitations and future work

- The engine models a fixed 1.6 MN thrust and 5 kg/s mass flow; throttling
  between 0 and 100%, staged burns, delayed starts and target-relative
  docking guidance are future upgrades.
- This guidance is finite and physical but is a practical bang-bang/PD
  approximation for spacecraft attitude, not optimal control. A maneuver
  may fail to align within the allocated window.
- The client sees regularly sampled authoritative state; it does not yet
  interpolate RCS/engine flame animation using the new guidance phase.
- The burn estimate is a **rough ideal Δv**, not a guarantee of final orbit.
- Existing automatic rendezvous navigation is a separate system; initiating
  automated thrust supersedes that client-side plan.
- Multi-player flight ownership/authentication and truly continuous shared
  simulation remain future work.
