# Orbital Outlaws — Prototype v0.2

**Orbital Outlaws** is an experimental browser game about fighting and surviving in orbit under Newtonian gravity. The current prototype is single-player against AI raiders; multiplayer networking is not yet included.

In v0.2 you **rotate your actual spacecraft before firing its main engine**. Fuel is propellant mass (kg). A purchasable **rendezvous computer** searches fuel-efficient transfer opportunities, steers the spacecraft and attempts to match velocity near salvage or other targets.

## Play

Open `index.html` with a modern browser, or open the fully self-contained `orbital-outlaws.html` (works offline). No build tools or dependencies are needed. For development:

```bash
python -m http.server 8080
# open http://localhost:8080
```

## Controls

| Input | Action |
| --- | --- |
| Hold **A / ←** | Fire RCS to rotate counter-clockwise |
| Hold **D / →** | Fire RCS to rotate clockwise |
| Hold **S / ↓** | Fire RCS to stop spinning |
| **Move mouse** over arena | Aim the main engine's limited ±28° nozzle gimbal; cannot rotate the whole ship |
| Hold **W / ↑** | Fire the main engine in the ship's forward/gimbaled direction |
| Hold **Space** / FIRE button | Shoot ballistic projectiles at the locked hostile or manual aim point |
| **Left-click** a hostile | Lock it as the gun target; **Space** fires |
| **Left-click** empty arena | Activate manual weapon aiming; moving the cursor adjusts aim, and **Space** fires |
| **Left-click** a salvage pod | Select it as a navigation target without firing the main engine |
| **Alt + left-click** empty arena | Set a static waypoint, available in rendezvous dropdown |
| **Right/middle drag** or **Shift+left drag** | Pan the camera (does not affect physics) |
| **Wheel** over arena | Zoom toward cursor; `+` / `−` buttons also zoom |
| **P** | Pause/resume |
| Simulation **Speed** | 0.5×, 1×, 2×, 4× |

On touch devices, hold the control buttons to rotate, thrust or fire. Tapping the arena selects a contact or enables manual targeting; it does not burn propellant.

**Autopilot:** Use the navigation target dropdown; click **Calculate route** to preview the transfer. Purchase **Rendezvous computer** for 60 credits, then click **ENGAGE**. The starting 65-credit grant makes the upgrade immediately testable. Manual engine/rotation commands disengage the autopilot; weapons remain usable. Use **ABORT** to disengage voluntarily.

## Physics and instrumentation

Coordinates are displayed as **kilometres**, time as **seconds**, velocity as **km/s**, force as **newtons**, and propellant as **kg**. The fictional Kestrel body's parameter `mu = 310000 km³/s²` and radius `85 km` produce quick orbits, not a plausible naturally formed planet. Ships and ballistic objects use Newtonian inverse-square gravity, integrated with fixed-step **velocity Verlet**:

\[
\mathbf a_g=-\mu\frac{\mathbf r}{|\mathbf r|^3},\qquad
\mathbf a_\mathrm{engine}=\frac{\mathbf F}{m},\qquad m=m_\mathrm{dry}+m_\mathrm{propellant}.
\]

Starter vessel (fictional high-power propulsion):

| Quantity | Value |
| --- | ---: |
| Dry mass | 900 kg |
| Propellant | 200 kg |
| Main thrust | 1,600,000 N |
| Main propellant flow | 5 kg/s |
| Effective exhaust velocity | 320 km/s |
| Engine gimbal | ±28° |
| RCS | Paired 2,500 N attitude jets; shared propellant |

The main engine obeys the rocket equation, and the decrease in mass is accounted for at every physics step. The RCS pair provides torque through a 7 m lever arm, changes angular velocity, and also consumes propellant. There is **no artificial angular damping**, although the stop-spin input can apply opposing RCS torque. For simplicity, a gimbaled main-engine thrust vector is assumed to act through the center of mass (no extra torque from gimbal offset). Power/heat/engine plumbing are not modelled.

## Navigation maths (two-impulse search)

The rendezvous computer seeks a transfer with a **small total velocity change**:

\[
\Delta v_\mathrm{total}=\lVert\Delta\mathbf v_1\rVert+\lVert\Delta\mathbf v_2\rVert.
\]

1. Choose sampled **waiting times** `w` and **flight durations** `T`.
2. Propagate the ship and target under gravity until departure/arrival, respectively.
3. Numerically solve for the initial velocity change `Δv₁` that makes the unpowered transfer meet the predicted target position. This is done with two-dimensional Newton shooting and finite-difference Jacobian estimates.
4. Compute `Δv₂` from the relative velocity difference at arrival, then score the candidate by `Δv₁+Δv₂` plus a small cost for waiting longer.
5. Discard transfer paths that crash into Kestrel, exit the sector, or exceed available propellant under the rocket equation.
6. The autopilot uses RCS to turn, fires the finite-thrust engine, coasts, and uses a terminal relative-position/velocity controller to approach. It is intentionally **not** teleportation or instant velocity change.

With effective exhaust speed `vₑ`, the ideal propellant estimate is

\[
\Delta m=m_0\left(1-e^{-\Delta v_\mathrm{total}/v_e}\right).
\]

**Important limitation:** This is a **bounded discrete search of idealized two-impulse transfers**, not a proof of the global minimum-fuel solution and not a fully optimized low-thrust trajectory. Finite burns, rotation time, enemy maneuvers and numerical error can increase actual consumption. The navigation display is a projection, and the autopilot can fail or abort when a target changes course or no safe transfer is found. The game also requires low relative velocity for salvage pickup.

## Current features

- Real Newtonian coasting, orbital telemetry and trajectory preview.
- Independent spacecraft heading and orbital velocity; persistent angular momentum.
- Nose/tail RCS attitude control and limited-gimbal engine thrust with exhaust mass loss.
- Zoom-to-pointer, viewport panning, target locking, map waypoint selection.
- Purchasable rendezvous intelligence and predictive fire-control upgrades.
- Automatically planned/coasted transfers plus terminal proximity/velocity guidance.
- Armed AI raiders, ballistic weapons, hull damage, salvage, credits and respawn after game over.
- No online multiplayer, no GR black-hole simulation, no landing or persistent economy yet.

## Test

With Node.js 18 or later:

```bash
node --test tests/navigation.test.cjs
```

The test suite checks circular-orbit stability, predicted transfer accuracy, unsafe trajectory rejection and fuel affordability. See `navigation.js` for the isolated planner mathematics. Browser gameplay is implemented in `game.js`.

## Source layout

- `index.html` — UI and input elements.
- `styles.css` — responsive visual layout.
- `game.js` — physics loop, spacecraft controls, combat, salvage, HUD, canvas renderer and autopilot execution.
- `navigation.js` — pure Newtonian trajectory propagation and two-impulse transfer search.
- `tests/navigation.test.cjs` — Node tests for the transfer planner.
- `orbital-outlaws.html` — self-contained offline game (same implementation, inline scripts and CSS).
- `build_standalone.py` — regenerate the offline HTML from the modular source.

### Upcoming ideas

More advanced orbital rendezvous (including multi-revolution, finite-burn optimal control and recovery from changing target trajectories), upgraded RCS and engines, different rocket types, guided missiles, lasers, long-term debris, multiplayer networking and eventually relativistic geodesics near compact objects.