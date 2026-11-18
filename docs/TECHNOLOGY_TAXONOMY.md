# Orbital Outlaws — technology classification and fiction contract

## Purpose

Every proposed feature, ship component, weapon, propulsion system or cosmic
capability receives an explicit **access level**, **technology era**, and
**scientific basis**, *before* gameplay implementation. The universe stays
an exciting combat-oriented game, not a physics toy or an unrestricted
superhero simulator.

**Era is a classification, not a linear release order or mandatory unlock
tree.** Designers can introduce an Era IV tool in the next build and an Era I
tool several releases later. Each has a clear technical contract and game
balance. A release/version number is **not** a technology tier. v2.0 remains
reserved for the first planet ecology or civilization implementation.

## Three independent labels

1. **Access:** *BASIC* (available to every relevant starting spacecraft /
   scenario without purchase) or *UNLOCKABLE* (requires research, salvage,
   manufacturing, ownership or game-mode selection). Exceptional restricted
   items can be *SCENARIO-ONLY*, e.g. laboratory god-mode controls, without
   implying pay-to-win or universal multiplayer access.
2. **Era:** I–V, describing capability scale and scientific assumptions.
   BASIC is not a lower era; an Era I cockpit computer may be BASIC while an
   Era I high-end nuclear engine might be UNLOCKABLE.
3. **Scientific status:** *demonstrated*, *physically derived but
   unproven engineering*, *hypothetical/extrapolated*, *invented consistent
   postulate*, or *rule-of-fiction*. Do not describe a fictional postulate
   as established physics.

| Era | Label | Examples | Design boundary |
| --- | --- | --- | --- |
| **I** | **Orbital Frontier / Established technology** | chemical propulsion, RCS, radio, kinetic weapons, basic orbital flight computers, solar arrays | Real known mechanics, accessible constraints |
| **II** | **Interplanetary Expansion / Plausible advanced engineering** | nuclear thermal rockets, speculative practical fusion drives, beam-powered sails, autonomous refineries | Physics broadly grounded, engineering challenges and costs explicit |
| **III** | **Stellar Engineering / Extreme megatechnology** | planet assembly from existing raw material, Dyson swarms, moving orbits by vast momentum exchange, giant habitat engineering | Extreme matter, power, timescales and political scale |
| **IV** | **Exotic Physics / Hypothesis-dependent technology** | hypothetical engineered gravity, traversable-wormhole projects, compact artificial black-hole experiments using unresolved constraints | Exact new physical postulates and measurable limits required |
| **V** | **Transcendent / Cosmic engineering** | machines granting Marvel-like cosmic capabilities: local physical-law rewriting, engineered pocket universes, astronomical-scale matter transmutation or spacetime topology editing | Intentionally fantastical **technology**, not innate superpowers; constrained by declared in-universe rules, costs, vulnerabilities and counterplay |

Era V can be extraordinarily powerful and even absurd. It still needs to be
**technological**, e.g. manufactured systems, infrastructure, a control
interface, power sources, logistics and consequences. It is not free
individual magic and it does not need to claim real-world physical
plausibility. Some Tier V systems should be restricted to special sandbox
rooms, story scenarios, or carefully controlled late-universe environments.
Never silently introduce one into a realistic competitive orbital arena.

## Classification examples

| Proposal | Access | Era | Why |
| --- | --- | --- | --- |
| Basic attitude stabilization / RCS | BASIC | I | Ordinary flight control |
| Server-authoritative finite automated burn | BASIC | I | Flight-computer control of real engines; existing ship's unusually powerful engine is a separate technical assumption |
| Gravity slingshot training scenario | BASIC scenario | I | Orbital technique, not an invented technology |
| Fusion propulsion (if implemented as engineering extrapolation) | UNLOCKABLE | II | Fusion physics known, practical drive performance unresolved |
| Construct a moon from mined asteroid mass over centuries | UNLOCKABLE | III | Conservation of mass/energy, gigantic industrial budget |
| Rapidly make a planet from nothing | SCENARIO-ONLY or UNLOCKABLE | V | Violates known conservation laws unless explicit invented mechanism |
| Generate an artificial black hole through extreme mass compression | UNLOCKABLE | III–IV depending on mechanism | Distinguish conceivable GR outcome from practical manufacturing claims |
| Rewrite local gravity or causality with a manufactured device | SCENARIO-ONLY / highly restricted | V | Explicit rule-of-fiction, not a demonstrated scientific effect |

The **same object** can have different classifications depending on how it
is produced. An engineered, extremely dense Kestrel cannot simply be
declared 'physically realistic' without specifying material/energy
requirements and limits. A fully invented relic explanation is allowed,
but should be honestly labeled as lore-supported speculative physics.

## Required technology proposal record

Each new design should record:

- **Name / role:** what tactical, civilian or exploratory problem it solves
- **Access + era + scientific status** (independent labels)
- **Mechanism / lore premise:** known laws versus explicitly invented rules
- **Inputs:** power, fuel, matter, time, specialized materials, crew and infrastructure
- **Outputs and measurable specs:** force, Δv, thermal budget, range,
  cooldown, activation time, reaction/momentum effects, limitations
- **Failure modes / counterplay:** detectability, jamming, interception,
  maintenance burden, hazards, vulnerabilities and escape routes
- **Game modes:** allowed in Arena, Flight Laboratory, Expeditions,
  Persistent Universe, or limited to a special experimental room
- **Server authority and performance:** shared-state consistency, persistence,
  determinism, simulation cost and exploit protection
- **Gameplay purpose:** why it creates interesting choices rather than
  eliminating difficulty or instantly invalidating other players

Where conservation laws are deliberately broken, name the specific
assumptions that replace them. The same rules must then apply to all
players and NPCs in a given scenario.

## Distinct game experiences

- **Orbital Arena:** accessible PvP/PvE combat with restrictive technology
  presets and real tactical momentum; no mandatory hours of waiting
- **Flight Laboratory:** private/saved experiments with time controls,
  gravitational slingshots and optional speculative devices
- **Expeditions:** mission-scale voyages, rescues, escorts, salvage,
  progression and risk
- **Persistent Universe:** stable shared authoritative time, ownership,
  exploration, warfare, industry and later civilizations

A server/room isolates simulation authority, participants and allowable
technology. Modes do not automatically require separate VMs. Arena, labs
and the persistent universe may enforce different timescales and tech
whitelists while sharing simulation primitives.

## Default conversation workflow

When a new technology is proposed, the design discussion should **first**
classify **BASIC vs UNLOCKABLE/SCENARIO-ONLY**, **Era I–V**, and **scientific
status**, briefly justify each, then propose specifications. Never assume
implementation or progression order solely from the label.
