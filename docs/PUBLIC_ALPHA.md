# Orbital Outlaws — open development and early access

## The promise

Develop publicly. Announce progress and provide a **free browser-based alpha**
to people who want to try orbital flight, combat, rescue, and the living
Veyra–Kestrel system before the full game is completed.

The first wave should be deliberately small (target **10–30 testers**),
experimental, and transparently labeled. Offer a feedback form or community
discussion, publish a changelog and known-issues list, and credit or recognize
early pioneers once the exact reward policy is decided. No reward promises
without an agreed policy; no pay-to-win mechanics.

Potential channels: the game's own website, itch.io, and relevant Reddit
communities. Community announcements should clearly disclose the current
simulator scope and how to provide constructive feedback.

## Two important milestones

1. **Public single-player preview:** Firebase serves the interactive browser
   sandbox. It deliberately does **not** open production player mutation APIs,
   store player accounts, or claim persistent multiplayer. The simulation is
   local to a browser session; progress may reset on refresh.
2. **Authenticated persistent alpha:** introduce Firebase Authentication,
   verify ID tokens or signed credentials on the API and WebSocket handshake,
   enforce server-side account-to-pilot ownership, isolate administrative
   commands, implement server-side rate limits and load-test concurrency,
   then open authenticated gameplay API routes. Only then promise persistence
   across devices or shared real-time multiplayer.

For now, sectors are *per pilot*. A shared universe needs additional server
engineering: cross-player visibility/encounters, authoritative event ordering,
concurrency and load control. A VM provides deployment capacity, **not** this
multiplayer functionality by itself.

## Prior to inviting testers

- Publish obvious "ALPHA · unfinished" labeling and a short controls guide.
- Validate narrow/mobile screen behavior and touch controls rather than
  claiming a fully playable mobile experience prematurely.
- Keep a visible known-issues list and versioned release notes.
- Provide abuse-reporting and feedback channels before shared online features.
- Document data retention and removal before accepting accounts.
- Establish backups and a successful recovery drill before storing player data.
- Establish billing budgets/alerts and basic CPU, memory, disk and error monitoring.
- Conduct an initial capacity test; VM sizing is a starting hypothesis.
