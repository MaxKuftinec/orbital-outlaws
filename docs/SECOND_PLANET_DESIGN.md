# Neris — Earth-sized second world (design proposal, not yet in-game)

> The Atlas displays Neris as **Concept**. Its gravity, orbital movement,
> climate, atmosphere, settlements, and landing mechanics are NOT yet
> simulated. The current universe contains Veyra and Kestrel only.

## Orbital and physical design (v1.1 canon candidate)

| Quantity | Proposed value | Reason |
| --- | ---: | --- |
| Central star | Veyra · K2V · 0.82 M☉ · 0.40 L☉ | Long-lived stellar environment |
| Orbit | Circular, 0.65 AU = 97.24 million km | ~94.7% Earth sunlight |
| Period | ~211.38 Earth days | Kepler's third law with Veyra μ |
| Stellar irradiance | ~0.947 Earth flux | Basic insolation; NOT a climate result |
| Mass | 5.9722 × 10²⁴ kg | Earth reference |
| Mean radius | 6,371 km | Earth reference |
| Gravitational parameter | 398,600.435507 km³/s² | Earth reference |
| Mean surface gravity | ~9.82 m/s² | Earth reference |
| Composition | Silicate mantle, iron-nickel core | Terrestrial chemistry |
| Atmosphere | Target ~1 bar, N₂-led, conditional oxygen | Biology/climate to model |
| Ocean fraction | Candidate 60–70% | Worldbuilding; not yet procedurally derived |
| Magnetosphere | Proposed; strength requires dynamo model | Atmosphere retention and radiation |
| Surface life | Conditional; not proven by orbital distance | Depends on atmosphere, geology, water, UV |
| Settlements | Planned ports, factories, institutions | Civilization enters at v2.0 |

Numbers are nominal design assumptions, not an exoplanet discovery.
A thick atmosphere can move the surface temperature materially,
and stellar radiation/activity and climate feedback require actual
models before assigning life or ecology.

Earth physical reference:
https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html

## Where it sits

Veyra has μ = 1.0882420081476 × 10¹¹ km³/s².
Kestrel's updated orbit is 0.40 AU (period 102.04 days); Neris is
proposed at 0.65 AU (period 211.38 days). The orbital separation is
0.25 AU ≈ 37.40 million km. Their proposed circular orbits are separated
by about 36.8 mutual Hill radii (using their point-mass values), ample
spacing for the simplified near-circular two-planet layout. This is
not a general long-term N-body stability certificate.

An idealized, perfectly timed, coplanar Hohmann transfer between
0.40 AU and 0.65 AU takes ~76.72 days and costs roughly
4.81 km/s departure plus 4.25 km/s arrival heliocentric impulses.
These are only *star-relative* ideal-impulse terms, excluding escape
from Kestrel, capture at Neris, finite thrust, plane changes, launch
windows and trajectory corrections. They are for travel *design*,
not currently usable in the Rendezvous Computer.

## Future planetary civilization (v2.0 milestone)

The player fantasy is a developed humanity throughout the star system.
A living settlement needs simulation rather than a decorative tile:
supply chains, spare parts, ownership, public services, shipyards, local
technological capability, political economy, habitats and populations.
Technologies are produced or installed by real suppliers at physical
ports. Landing/takeoff must model at least approach, orbital insertion,
thermal environment if atmospheric, and propulsion/fuel limits.

Version policy: **the first implemented persistent civilization or
planetary ecology is v2.0**. A design card or a planet orbit alone is
not a v2.0 release.

## Engineering dependencies

1. Replace Kestrel's legacy 85 km surface geometry with a physically
   appropriate radius and migration that does not destroy live pilots.
2. Add first-class body IDs, physical parameters, orbital elements,
   rotation and orbital phase independent from gameplay sector physics.
3. Add Neris' star-centered ephemeris and differential gravitational
   influence, with tests against the existing Kestrel local frame.
4. Introduce additional camera/telemetry origins with time-aware
   historical trajectories and precision-preserving coordinates.
5. Implement an interplanetary trajectory planner and time acceleration.
6. Add orbital stations and economic transactions, then atmospheric
   landing, cities, planetary ecology and civilizations.

See [Veyra's stellar specification](STAR_SYSTEM_CANON.md) and
[Versioning policy](VERSIONING.md).
