# Orbital Outlaws — Prototype v0.6

**Orbital Outlaws** is an experimental browser game about fighting and surviving in orbit under Newtonian gravity. The current prototype is single-player against AI raiders; multiplayer networking is not yet included.

The game uses independently rotating spacecraft, propellant measured in kilograms, and a purchasable **rendezvous computer** for fuel-conscious orbital transfers. **v0.3 adds basic manual hull repairs, spare-parts salvage, and carried spare-parts mass**. **v0.4 adds AEGIS-01, a friendly armed escort, a reinforcement toggle (off by default), a curved ballistic-trajectory preview, and a purchasable target-position analyzer.**

## Play

Open `index.html` with a modern browser, or open the fully self-contained `orbital-outlaws.html` (works offline). No build tools or dependencies are needed. For development:

```bash
python -m http.server 8080
# open http://localhost:8080
```

## Controls

| Input | Action |
| --- | --- |
| Hold **A** (configurable) | Fire RCS to rotate counter-clockwise |
| Hold **D** (configurable) | Fire RCS to rotate clockwise |
| Hold **S** (configurable) | Fire RCS to stop spinning |
| **Move mouse** over arena | Aim the main engine's limited ±28° nozzle gimbal; cannot rotate the whole ship |
| Hold **W** (configurable) | Fire the main engine in the ship's forward/gimbaled direction |
| Hold **Space** / FIRE button | Shoot ballistic projectiles at the locked hostile or manual aim point |
| **Left-click** a hostile | Lock it as the gun target; **Space** fires |
| **Left-click** empty arena | Activate manual weapon aiming; moving the cursor adjusts aim, and **Space** fires |
| **Left-click** a salvage pod | Select it as a navigation target without firing the main engine |
| **Alt + left-click** empty arena | Set a static waypoint, available in rendezvous dropdown |
| **Right/middle drag** or **Shift+left drag** | Pan the camera (does not affect physics) |
| **Wheel** over arena | Zoom toward cursor; `+` / `−` buttons also zoom |
| Hold **R** / **HOLD R · REPAIR** button | Repair hull at 5 HP/s using 1 kg of spare parts per second. Full repair to 100% is possible; no repair after death |
| **P** | Pause/resume |
| **H** | Ask AEGIS-01 for fuel rescue |
| **V / T** | Collapse or open map navigation / telemetry consoles |
| **N / C / E / X** | Cycle targets / calculate route / engage / abort |
| **⚙ Controls** | Remap keyboard keys; saved locally in this browser |
| Simulation **Speed** | 0.5×, 1×, 2×, 4× |

On touch devices, hold the control buttons to rotate, thrust or fire. Tapping the arena selects a contact or enables manual targeting; it does not burn propellant.

**Autopilot:** Use the navigation target dropdown; click **Calculate route** to preview the transfer. Purchase **Rendezvous computer** for 60 credits, then click **ENGAGE**. The starting 65-credit grant makes the upgrade immediately testable. Manual engine/rotation commands disengage the autopilot; weapons remain usable. Use **ABORT** to disengage voluntarily.

## Field repairs (v0.3)

Field repairs are available from the beginning. KESTREL-7 starts with **10 kg** of spare parts in a **24 kg** storage bay. Holding **R** repairs at **5 hull HP/s**, consuming **1 kg/s**, while the game is running. Repairs stop at **100 HP** or when parts are depleted; they do not work on a destroyed spacecraft. A repair button in the ship panel also works for touch users. Repairing can happen while coasting, manoeuvring, or using autopilot; it does not cancel navigation.

Spare parts appear as blue `PARTS` salvage containers (**8 kg**) and are also recovered from wrecks (up to **6 kg**, limited by remaining storage). Carried parts contribute to inertial mass. When used, repair material becomes hull structure rather than vanishing: dry mass increases, spare-parts inventory decreases, and total ship mass is conserved (except when propellant is expelled). The repair constants are intentionally gameplay values, not an engineering model of real hull materials. No drones, individual subsystem damage, repair stations, or repair-cost markets yet.

## Allies, ballistic targeting and object persistence (v0.4)

**AEGIS-01** is a friendly escort spacecraft that shoots at raiders, carries limited ammunition, and can be destroyed. Enemy AI can engage the escort. The game starts with two raiders but **new pirates do not spawn unless you turn Reinforcements ON** using the button above the orbit map.

The **cyan curved fire-control line is included by default**, reflecting the projectile trajectory in the gravitational field. Click empty space to aim freely, or left-click a raider to lock it; hold **SPACE** to fire and **W** to thrust. A **Target trajectory analyzer (25 credits)** adds a purple future target path and marker at the time the ballistic shot reaches the cursor-selected range. This assumes the opponent does not thrust during the prediction. The display uses a finite **12-second preview horizon** for performance; this is *not* a projectile lifetime.

**Physical objects have no automatic expiry:** bullets, uncollected resource pods and floating wrecks persist. Objects are removed only by meaningful events such as a collision with the planet, hitting a vessel, or being collected. Bullets that escape the gravitational well continue on their outward trajectories, even outside the visible camera. Camera rendering culls off-screen bullets without deleting their simulated positions. Small impact/engine sparks are transient *visual effects* and still fade normally. Continuous firing can make the simulation more expensive over time; optimized persistent-debris simulation is future work.


## Navigation HUD and physical collisions (v0.5)

**Navigation is always visible in the orbital map**, with a target picker, cycle control (N), Calculate (C), Buy Computer / Engage (E), and Abort (X). Buying the rendezvous computer costs **60 credits**; after purchase, the same button engages a calculated route. Selecting a contact by clicking it in the arena updates the picker. The sidebar retains detailed route statistics but no longer requires scrolling for routine navigation.

The two-impulse route planner now performs an **extended coast-time search**, including longer flights and some windows derived from the starting and target orbital periods. This helps with highly elliptical targets. It is not a globally optimal finite-burn solver or an automatic three-burn high-apoapsis orbit reversal. The existing autopilot still corrects finite-burn errors near its destination.

**Vessel-to-vessel collisions:** spacecraft now have a **4 km total collision envelope** for playable 2-D encounter rates; this is an intentionally exaggerated gameplay hitbox, not a claim that a 14-metre craft is kilometres wide. A swept collision calculation checks paths between frames so fast crossing trajectories aren't missed. Encounters produce a normal impulse using mass-weighted momentum conservation and impact damage based on the relative *closing* kinetic energy. Gentle bumps can be survivable, while orbital-speed impacts are usually catastrophic. Wrecks persist according to the existing salvage mechanics. Collision calculations are simplified rigid-body mechanics, not structural fragmentation or docking simulation.

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
- Armed AI raiders, friendly AEGIS-01 escort, ballistic-trajectory preview, optional reinforcements, hull damage, salvage, credits and respawn after game over.
- Persistent projectiles and floating salvage/wrecks (no artificial object expiration).
- Basic field repairs (hold R), spare-parts salvage, and spare-parts mass in the propulsion and Δv budget.
- No online multiplayer, no GR black-hole simulation, no landing or persistent economy yet.

## Test

With Node.js 18 or later:

```bash
node --test tests/*.test.cjs
```

The test suite checks circular-orbit stability, predicted transfer accuracy, unsafe trajectory rejection and fuel affordability. See `navigation.js` for the isolated planner mathematics. Browser gameplay is implemented in `game.js`.

## Source layout

- `index.html` — UI and input elements.
- `styles.css` — responsive visual layout.
- `game.js` — physics loop, spacecraft controls, combat, salvage, HUD, canvas renderer and autopilot execution.
- `collisions.js` — swept spacecraft impacts and mass-based collision impulses.
- `tests/collisions.test.cjs` — crossing, conservation, low-speed and near-miss tests.
- `navigation.js` — pure Newtonian trajectory propagation and two-impulse transfer search.
- `ballistics.js` — shared-gravity projectile forecast and target-at-arrival computation.
- `tests/navigation.test.cjs` — Node tests for the transfer planner.
- `tests/ballistics.test.cjs` — Node tests for the ballistic preview and forecast horizon.
- `orbital-outlaws.html` — self-contained offline game (same implementation, inline scripts and CSS).

### Upcoming ideas

More advanced orbital rendezvous (including multi-revolution, finite-burn optimal control and recovery from changing target trajectories), upgraded RCS and engines, different rocket types, guided missiles, lasers, long-term debris, multiplayer networking and eventually relativistic geodesics near compact objects.

Navigation console shortcuts: **N** next target, **C** calculate, **E** purchase/engage, **X** abort. The existing **W**, **A**, **D**, **S**, **R**, and **SPACE** controls remain unchanged.


## v0.6 — flight deck, rescue, fuel-safe guidance and arrivals

- The orbital canvas spans the full horizontal viewport. Detailed panels move underneath. Open or collapse on-map navigation with V and orbital telemetry with T.
- The ⚙ Controls settings dialog lets players rebind actions, checks for key conflicts and saves assignments to browser localStorage.
- H or REQUEST FUEL ASSISTANCE asks AEGIS-01 to rendezvous with KESTREL-7 and transfer up to 35 kg of its own fuel. Ships must match position and relative velocity before transfer. If the ally lacks surplus fuel, it first searches for an affordable salvage fuel pod, then flies to the player. Both legs can fail if no affordable route exists; fuel is never teleported.
- Autopilot now protects a 36 kg emergency reserve on the 200 kg starting tank. It estimates fuel using m_prop = m0 × (1 − exp(−Δv/v_exhaust)), requires a 1.65× execution allowance, then aborts if burns exceed the allowance, hit the protected reserve or take 28 seconds beyond the planned arrival. This is a conservative fail-safe, NOT a proof of optimal finite-thrust guidance; plans can still miss and require replanning. Manual thrust is NOT reserve-limited.
- Optional new reinforcements spawn at about 1450 km on inbound trajectories, outside the old 1200 km boundary. Initial scripted raiders remain within the sector. Player spacecraft can escape beyond 1200 km without an artificial game-over.
- Planets, moons, civilized stations, surface landing, docking, markets and food are future world-expansion features; not included in v0.6.

### Development tests

Run `node --test tests/*.test.cjs` in Node.js 18+. Additional v0.6 tests cover autonomous fuel reserve limits and outside-sector inbound vessel states.
