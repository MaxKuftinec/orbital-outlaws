# Second planet: Earth-like civilization world (design candidate)

Status: **parameters under discussion, not simulated in v1.0**.
The immediate implementation in this change set fixes historical trails, current
telemetry and map tools in the existing Kestrel/Veyra reference frames.

## Why we should settle Veyra's physics first

Today's Veyra is deliberately game-scaled:
- Standard gravitational parameter `μ = 2 × 10⁹ km³/s²`, equal to ~0.015
  solar masses or ~16 Jupiter masses. This is a **brown dwarf** regime,
  not a sustained hydrogen-fusing main-sequence star.
- Radius = 4,500 km; far too small for an ordinary brown dwarf.
- Kestrel currently orbits at 160,000 km with a planet radius of only 85 km
  but `μ = 310,000 km³/s²` (~78% of Earth's mass), so Kestrel is not an
  ordinary planet either.

A second Earth-composition planet can be given realistic size, density,
gravity and atmosphere, but a **naturally habitable surface cannot be inferred**
from present Veyra parameters. Its luminous flux, spectrum, effective
temperature, evolutionary age, and atmospheric forcing aren't modeled.
We should not silently assign a habitable zone without a stellar-luminosity
model or migrate persistent player orbits without versioned conversion.

## Proposed second planet: "Neris" (working name, editable)

| Property | Target |
|---|---|
| Planet class | Terrestrial silicate–iron planet |
| Mean radius | ~6,371 km (Earth) |
| Mass | ~5.9722 × 10²⁴ kg (Earth) |
| Gravitational parameter | ~398,600 km³/s² |
| Surface gravity | ~9.8 m/s² |
| Mean density | ~5,510 kg/m³ |
| Core | Iron–nickel; partly molten outer core |
| Mantle/crust | Silicates, tectonic diversity |
| Atmosphere | Initially suggest ~1 bar, N₂-dominated, O₂-rich only if biology supports it |
| Surface water | Candidate 55–70% ocean fraction; land ports and archipelagos |
| Magnetosphere | Active enough to protect much of the atmosphere |
| Life | Plausible if luminosity, radiation, water stability, geology and atmospheric escape checks pass |
| Civilizations | Ports, manufacturers, traders and local economies (later milestone) |

Earth reference: NASA Earth Fact Sheet
https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html

### Stellar-system decision before finalizing orbit

**Option A — preserve the current Veyra as a low-mass brown dwarf.**
Set Neris on a non-overlapping outer orbit and allow human/civilization
settlements only through explained energy sources (reactors, underground
geothermal, orbital mirrors, imported volatiles), not a free natural
Earth-like biosphere. Needs orbital period, stellar cooling/luminosity,
and tidal stability checks. Can keep existing Kestrel save coordinates.

**Option B — make Veyra a physically modeled low-mass red dwarf.**
For example, a candidate star of ~0.2 solar mass would have
`μ ~ 2.65 × 10¹⁰ km³/s²`. A representative luminosity *assumption* of
~0.006 solar luminosity suggests an Earth-insolation distance
`sqrt(0.006) AU ≈ 11.6 million km`; this is not a full habitable-zone
calculation. An Earth-like planet near that distance would have a
roughly 18-day year and could be tidally affected, flare-exposed or
tidally locked. The assumption requires validation against a stellar
evolution model, age and spectrum.

Crucially, this option requires moving the existing Kestrel orbital
radius far beyond the newly enlarged star and revising star radius,
stellar ephemerides, Hill regions, sector physics and all affected maps
**together**. Save migration must preserve current planet-relative
ship positions and controls. We should never change the star's mass
alone, because that would invalidate existing planet orbits.

Background: NASA's habitable-zone and M-dwarf discussions
https://science.nasa.gov/exoplanets/habitable-zone/
https://science.nasa.gov/universe/exoplanets/earth-sized-planets-the-newest-weirdest-generation/

## Implementation architecture

1. Give celestial bodies first-class immutable IDs and versioned
   physical properties: `mu, radius, ephemeris, luminosity, albedo,
   atmosphere, rotation, habitable-condition estimates`.
2. Extend barycentric/system ephemerides with Neris. Initially analytic
   circular orbits, then integrate mutual perturbations if needed.
   Spacecraft and NPCs feel differential gravity from both planets.
3. Add three camera/telemetry origins (Veyra, Kestrel, Neris) and
   reference-frame-correct historical trails, without rewriting
   stored ship coordinate history.
4. Create approach, atmospheric-entry, landing, take-off and docking
   transitions with engineering costs (heat shields, thrust, fuel,
   life support and safe relative velocities). Start with orbital
   stations before surface entries for playability.
5. Move technology acquisition from omnipresent remote credits to
   civilization ports/stations: paid installation, real inventory,
   suppliers, faction access, service hours, repairs and manufacturing.
   Make persistent cargo and economy transactions server authoritative.
6. Integrate local civilizations as simulation systems (settlement,
   demographics, economy, politics, ecology) with optional physical
   surface rendering rather than pretending they're already active.

No civilization, interplanetary docking, new planet or second-planet
gravity is included until the star model / orbit choice is settled.
