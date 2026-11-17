# Veyra — physical stellar model (v1.1)

## The choice

**Veyra is a K2V (orange) hydrogen-burning main-sequence dwarf**.
The adopted model balances a long stellar lifetime, moderate irradiation,
and a useful habitable region for a civilization-capable star system.
It is not a brown dwarf, magnetar, neutron star, or Sun analogue.
Human societies in Orbital Outlaws can be advanced, but travel and
infrastructure obey real Newtonian conservation laws unless specific
fictional technologies are explicitly approved.

NASA has discussed K dwarfs as potentially favorable long-lived
life-hosting stars, with less extreme close-in radiation concerns than
many active M dwarfs. These are statistical considerations, not
guarantees of natural planetary habitability:
https://science.nasa.gov/exoplanets/stars/
https://science.nasa.gov/missions/hubble/goldilocks-stars-are-best-places-to-look-for-life/

## Adopted star constants

| Quantity | Canonical physical model |
| --- | ---: |
| Star designation | Veyra |
| Spectral type | Approximate K2V |
| Mass | 0.82 M☉ = 1.6305 × 10³⁰ kg |
| Radius | 0.78 R☉ = 542,646 km |
| Luminosity | 0.40 L☉ |
| Effective temperature | ~5,197 K |
| Gravitational parameter μ | ~1.088242 × 10¹¹ km³/s² |
| Reference stellar model | Stationary star + circular planet ephemeris |
| Star activity, age, evolution | Not yet calculated; future models |

The temperature is set by
`T = 5772 K × (L/L☉ / (R/R☉)²)^(1/4)`.
This keeps luminosity, radius and blackbody temperature consistent.
The mass, radius and luminosity are illustrative typical K-dwarf
inputs, not attributes copied from a specific observed star.

Nominal constants:
https://ssd.jpl.nasa.gov/astro_par.html
https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html

## Orbital architecture

| World | Orbit | Orbital period | Incident energy | Implementation |
| --- | ---: | ---: | ---: | --- |
| Kestrel | 0.40 AU = 59.84 million km | 102.04 days | 2.50 × Earth | **Simulated** |
| Neris | 0.65 AU = 97.24 million km | 211.38 days | 0.947 × Earth | **Design only** |

Circular Kepler periods use
`P = 2π sqrt(a³ / μ_Veyra)`.
The irradiance ratio is
`F/F_earth = (L/L☉)/(a/AU)²`.

**Kestrel** is a high-insolation inner world ideal for a challenging,
resource-rich industrial frontier. The current game continues to
calculate its differential stellar gravity, with the planet-centered
relative frame preserving player coordinates.

**Neris** is the candidate Earth-composition world for future
habitats, atmospheric flight, resource economies and surface settlements.
It is not yet added to authoritative multi-body gravity, and the
system chart labels it as a design proposal. Receiving roughly
Earth-like sunlight alone cannot prove liquid oceans, climate, or life.

The simple two-planet architecture is widely spaced; it needs
full long-term stability analysis and mutual perturbations once Neris
becomes a simulated body.

## Known physical inconsistency and migration requirement

Kestrel currently has μ = 310,000 km³/s² (≈0.78 Earth mass) but a
game collision radius of 85 km. Such a configuration would imply an
absurd mean density and is not a plausible ordinary planet.

This is a **known, explicitly unfixed gameplay inheritance**.
Do NOT silently update its collision radius to ~6,000 km: current
spacecraft and salvage at a few hundred kilometres would be buried.
A proper migration must transform ship and NPC positions, velocities,
altitudes, rendezvous conditions, camera scale, spawn radius, and
historic checkpoints, or carefully separate a staged surface model
from the legacy encounter until migration completes.

## Major-release boundary

**v1.x:** accurate stellar/spaceflight foundation, instruments,
rendezvous, map/codex, additional body groundwork, and infrastructure.

**v2.0:** first actually simulated planetary ecology or civilization,
not merely static lore, decorative settlement art, or a planet card.

See `docs/VERSIONING.md` for release criteria.
