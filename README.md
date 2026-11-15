# Orbital Outlaws — Prototype v0.3

**Orbital Outlaws** is an experimental browser game about fighting and surviving in orbit under Newtonian gravity. The current prototype is single-player against AI raiders; multiplayer networking is not yet included.

The game uses independently rotating spacecraft, propellant measured in kilograms, and a purchasable **rendezvous computer** for fuel-conscious orbital transfers. **v0.3 adds basic manual hull repairs, spare-parts salvage, and carried spare-parts mass**, without adding complex subsystem damage or repair drones.

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
| Hold **R** / **HOLD R · REPAIR** button | Repair hull at 5 HP/s using 1 kg of spare parts per second. Full repair to 100% is possible; no repair after death |
| **P** | Pause/resume |
| Simulation **Speed** | 0.5×, 1×, 2×, 4× |

On touch devices, hold the control buttons to rotate, thrust or fire. Tapping the arena selects a contact or enables manual targeting; it does not burn propellant.

**Autopilot:** Use the navigation target dropdown; click **Calculate route** to preview the transfer. Purchase **Rendezvous computer** for 60 credits, then click **ENGAGE**. The starting 65-credit grant makes the upgrade immediately testable. Manual engine/rotation commands disengage the autopilot; weapons remain usable. Use **ABORT** to disengage voluntarily.

## Field repairs (v0.3)

Field repairs are available from the beginning. KESTREL-7 starts with **10 kg** of spare parts in a **24 kg** storage bay. Holding **R** repairs at **5 hull HP/s**, consuming **1 kg/s**, while the game is running. Repairs stop at **100 HP** or when parts are depleted; they do not work on a destroyed spacecraft. A repair button in the ship panel also works for touch users. Repairing can happen while coasting, manoeuvring, or using autopilot; it does not cancel navigation.

Spare parts appear as blue `PARTS` salvage containers (**8 kg**) and are also recovered from wrecks (up to **6 kg**, limited by remaining storage). The mass of carried parts contributes to your spacecraft's total inertial mass and therefore affects thrust acceleration and remaining Δv. The repair constants are intentionally gameplay values, not an engineering model of real hull materials. No drones, individual subsystem damage, repair stations, or repair-cost markets yet.

## Ballistic weapon realism

Current projectiles are **not photons**. The muzzle velocity is **205 km/s relative to the shooting spacecraft**, and rounds inherit the shooter's orbital velocity before following Newtonian trajectories. That is extremely fast for a solid slug (ordinary firearms are typically below ~1.2 km/s) and is fictionalized for this game. The simulation currently has **no projectile mass, firing recoil, weapon energy budget or energy-based damage model**; hits inflict fixed damage (26 HP against raiders, 10 HP against the player). A conventional/hypervelocity/laser weapon rebalance is postponed.

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
- Basic field repairs (hold R), spare-parts salvage, and spare-parts mass in the propulsion and Δv budget.
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