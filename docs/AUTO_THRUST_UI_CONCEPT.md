# Automated thrust — proposed UI, NOT implemented

## Placement

Add an expandable **AUTOMATED BURN** instrument alongside the existing
**ATTITUDE & PROPULSION** controls, accessible on desktop and touch devices.
It is a basic ship system, not a premium technology purchase.

The initial compact panel should show:

- **Direction**: Ship heading / Prograde / Retrograde / Radial out / Radial in.
  Advanced selectable target-relative modes may be added later.
- **Reference**: Kestrel / Veyra, where meaningful. Make the active reference
  explicit and avoid silently switching frames.
- **Termination**: segmented control **Duration** / **Stop at fuel**.
- **Duration**: seconds input, bounded to an achievable safe maximum.
- **Stop at fuel**: a floor in kilograms, bounded by tank capacity and safety
  reserve, not the amount of fuel to burn. Default protects pilot reserve.
- **Estimate**: expected propellant use (current mass flow × duration) and
  approximate ideal Δv. Warn if alignment costs extra RCS propellant.
- **Actions**: prominent **ENGAGE BURN** button and persistent **ABORT**.
- **Active state**: ALIGNING → BURNING → COMPLETED / ABORTED / FAULT;
  live fuel, remaining seconds, chosen bearing and thruster attitude.

No magic vector change: server first uses the ship's nose/tail RCS to align
to the requested vector, then uses the physically limited ±28° gimbal and
main-engine burn. A request may be rejected if attitude, energy, reserve or
collision-safety constraints make the burn unsafe. Manual pilot input should
abort the automated plan, and UI should provide an always-accessible stop.

For multiplayer, a single authoritative server or simulation worker must
persist the *command and stop conditions*, execute it against world time and
record fuel/mass changes in history. Do not implement this solely as a
browser timer: changing tabs, losing network or closing the browser would
otherwise produce incorrect burn durations. Introduce clear disconnect
semantics, a bounded maximum burn, idempotency and a fail-safe stop.

This file describes the future UI only. **No automated thrust logic, flight
protocol or game physics were changed by this task.**
