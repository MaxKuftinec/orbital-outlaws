/**
 * Public-facing lore + physics catalog for v1.x.
 * Match the physical Veyra/Kestrel constants in backend/app/star_system.py
 * and frontend/public/legacy/star-system.js. The Neris orbit remains a design
 * candidate, not an active gravitational body.
 */
export const AU_KM = 149_597_870.7
export const SOLAR_MASS_KG = 1.9884e30
export const EARTH_MASS_KG = 5.9722e24
export const SOLAR_MU = 132_712_440_018
export const YEAR_SECONDS = 365.25 * 86400

export type AtlasObject = {
  id: 'veyra' | 'kestrel' | 'neris'
  name: string
  className: string
  type: string
  status: 'Simulated' | 'Concept'
  eyebrow: string
  lead: string
  story: string
  scienceNote: string
  specs: { label: string; value: string }[]
  detail: string
}

export const VEYRA_MASS_SOLAR = 0.82
export const VEYRA_RADIUS_SOLAR = 0.78
export const VEYRA_LUMINOSITY_SOLAR = 0.40
export const VEYRA_TEMPERATURE_K = 5772 *
  Math.pow(VEYRA_LUMINOSITY_SOLAR / VEYRA_RADIUS_SOLAR ** 2, 0.25)
export const VEYRA_MU = SOLAR_MU * VEYRA_MASS_SOLAR
export const KESTREL_ORBIT_AU = 0.40
export const NERIS_ORBIT_AU = 0.65
export const KESTREL_MU = 310_000
export const NERIS_MU = 398_600.435507

export function orbitalDays(orbitAu: number): number {
  const distanceKm = orbitAu * AU_KM
  return 2 * Math.PI * Math.sqrt(distanceKm ** 3 / VEYRA_MU) / 86400
}
export function insolationEarth(orbitAu: number): number {
  return VEYRA_LUMINOSITY_SOLAR / orbitAu ** 2
}
const fmt = (n: number, decimals = 2) =>
  n.toLocaleString('en-US', { maximumFractionDigits: decimals })
export const orbitalReference = {
  veyra: {
    stellarClass: 'K2V orange dwarf',
    massSolar: VEYRA_MASS_SOLAR, radiusSolar: VEYRA_RADIUS_SOLAR,
    luminositySolar: VEYRA_LUMINOSITY_SOLAR, temperatureK: VEYRA_TEMPERATURE_K,
    massKg: VEYRA_MASS_SOLAR * SOLAR_MASS_KG,
    radiusKm: VEYRA_RADIUS_SOLAR * 695700,
  },
  kestrel: { orbitAu: KESTREL_ORBIT_AU, orbitalDays: orbitalDays(KESTREL_ORBIT_AU),
    mu: KESTREL_MU, insolation: insolationEarth(KESTREL_ORBIT_AU) },
  neris: { orbitAu: NERIS_ORBIT_AU, orbitalDays: orbitalDays(NERIS_ORBIT_AU),
    mu: NERIS_MU, insolation: insolationEarth(NERIS_ORBIT_AU) }
}

export const objects: AtlasObject[] = [
  {
    id: 'veyra', name: 'VEYRA', className: 'atlas-sun',
    type: 'K2V · Orange main-sequence dwarf', status: 'Simulated',
    eyebrow: '01 / CENTRAL STAR',
    lead: 'The long-burning heart of a settled frontier.',
    story: 'For generations, ships have navigated by Veyra. Its quiet amber light powers farms, shipyards and cities scattered across a system humanity knows intimately—yet crossing between its worlds remains a serious engineering undertaking.',
    scienceNote: 'Representative stellar model. 0.82 solar masses, 0.78 solar radii and 0.40 solar luminosities imply roughly 5,200 K by Stefan–Boltzmann scaling; a detailed stellar-evolution track is not yet simulated.',
    specs: [
      { label:'Stellar class',value:'K2V / orange dwarf' },
      { label:'Mass',value:fmt(VEYRA_MASS_SOLAR * SOLAR_MASS_KG / 1e30, 3) + ' × 10³⁰ kg' },
      { label:'Radius',value:fmt(VEYRA_RADIUS_SOLAR*695700,0)+' km' },
      { label:'Luminosity',value:'0.40 L☉' },
      { label:'Temperature',value:fmt(VEYRA_TEMPERATURE_K,0)+' K' },
      { label:'Gravitational parameter',value:'1.088 × 10¹¹ km³/s²' }
    ], detail:'A mature, long-lived hydrogen-burning star, with an orbit architecture designed to support technological civilizations over geological time.'
  },
  {
    id: 'kestrel', name:'KESTREL', className:'atlas-kestrel',
    type:'Inner terrestrial planet · Active encounter', status:'Simulated',
    eyebrow:'02 / INNER WORLD',
    lead:'The first combat and salvage frontier.',
    story:'Kestrel has always been the point where pilots learn orbital mechanics the difficult way. Its surrounding traffic is a dense mixture of rescue craft, orbital scavengers and opportunistic raiders. Under Veyra, the real planet travels a much larger orbit than the old prototype chart allowed.',
    scienceNote:'Physical consistency warning: the encounter currently uses an 85 km collision radius and μ = 310,000 km³/s² (~0.78 Earth masses). That combination would imply an impossible density for an ordinary planet. A versioned planet-radius/orbit migration is required before surface gameplay.',
    specs:[
      { label:'Orbit around Veyra',value:'0.40 AU · '+fmt(.4*AU_KM/1e6,2)+' million km' },
      { label:'Orbital period',value:fmt(orbitalDays(.4),1)+' days' },
      { label:'Stellar irradiance',value:fmt(insolationEarth(.4),2)+' × Earth' },
      { label:'Gravitational mass',value:'~0.78 Earth masses' },
      { label:'Current encounter radius',value:'85 km · legacy geometry' },
      { label:'Environment',value:'High irradiation · not designated habitable' }
    ], detail:'Kestrel’s star orbit and stellar tidal force are simulated. Its local surface geometry is legacy gameplay infrastructure pending a physically consistent migration.'
  },
  {
    id:'neris',name:'NERIS',className:'atlas-neris',
    type:'Earth-sized terrestrial world · Design candidate',status:'Concept',
    eyebrow:'03 / POTENTIAL HABITABLE WORLD',
    lead:'A future home, not merely another destination.',
    story:'Imagine a world where descent corridors are crowded, shipyards compete for docking slots, manufacturing guilds trade propulsion technology, and cities negotiate over energy, cargo and orbital access. Neris is proposed as the place where civilization becomes something the simulation can actually model.',
    scienceNote:'Proposal only. Earth mass/radius and 0.65 AU orbit give ~0.95 Earth-equivalent stellar irradiance under Veyra. Habitability also depends on atmospheric history, greenhouse effect, water, stellar activity and geophysics—none of which can be guaranteed from insolation alone.',
    specs:[
      {label:'Proposed orbit',value:'0.65 AU · '+fmt(.65*AU_KM/1e6,2)+' million km'},
      {label:'Proposed year',value:fmt(orbitalDays(.65),1)+' days'},
      {label:'Stellar irradiance',value:fmt(insolationEarth(.65),2)+' × Earth'},
      {label:'Mass',value:'5.972 × 10²⁴ kg'},
      {label:'Mean radius',value:'6,371 km'},
      {label:'Surface gravity',value:'~9.8 m/s²'}
    ], detail:'Neris is an intentionally unimplemented physical world. It has no gravity, climate, surface, NPC settlements or docking ports in the live server yet.'
  }
]

export const fieldGuides = [
  { id:'frames',chapter:'01',title:'Reference frames',subtitle:'Position is relative; velocity is too.',
    body:'Select Kestrel or Veyra in Settings → Frame of reference. The map axes, historical trails and telemetry transform together. A 7 km/s orbital velocity near Kestrel need not look anything like your speed around the star.',
    note:'Switching reference frames changes the observation, not your ship’s momentum.' },
  { id:'maneuvering',chapter:'02',title:'Burns and encounters',subtitle:'Match velocity, not just position.',
    body:'A successful salvage rendezvous requires similar position AND velocity. Rotate with attitude thrusters, align the main exhaust and protect enough propellant for braking. A contact that flashes by your ship at high relative speed is not safely captured.',
    note:'Your propellant reserve is not a per-maneuver spend limit.' },
  { id:'capture',chapter:'03',title:'Salvage mechanics',subtitle:'Momentum has a price.',
    body:'Tethers apply finite tension and have limited stopping distance. Large wrecks can snap a line even when they are within nominal grapple range. Reduce relative speed before capture, then reel the payload carefully.',
    note:'Grapple attachment is not instantaneous loot collection.' },
  { id:'travel',chapter:'04',title:'Crossing a star system',subtitle:'Space is enormous, even after expansion.',
    body:'Kestrel and the proposed Neris orbit tens of millions of kilometres apart. Interplanetary departures take launch windows, transfers, midcourse correction and arrival capture. This is the next navigation milestone—not a teleport between maps.',
    note:'The current Rendezvous Computer still uses Kestrel-centered transfers.' },
]
