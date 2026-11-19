# Mobile cockpit — browser alpha

Mobile is a responsive presentation and input layer for **the existing
authoritative flight simulation**. It does not add a new physics engine,
separate mobile pilot or privileged game commands, and does not advance
the project to v2 (planetary ecology and civilization remain the v2 gate).

## Screen design

- **Phone / touch tablet:** the cockpit header has four actions:
  Instruments, System atlas, Profile and Settings. The busy desktop
  toolbar is reduced, with primary map controls still horizontally
  scrollable. The stellar atlas remains a separate responsive page.
- **Clear flight map:** panels start in the Instruments bottom drawer
  rather than covering the flight canvas. The drawer scrolls, is
  dismissible by its close button, backdrop, or Escape, and does not
  require scrolling past a giant desktop dashboard to inspect a ship.
  Desktop floating-panel settings are preserved in cloud preferences:
  the mobile drawer is a view-only docking override until a pilot
  deliberately changes a panel. Returning to desktop restores the
  stored dock/floating arrangement.
- **Touch helm:** five always-visible hold buttons at the bottom of the
  flight canvas: left RCS, stabilize, main engine, right RCS and fire.
  Buttons use the same held-input state as keyboard controls, so
  server fuel use, gimbals, rotation and firing semantics are unchanged.
  Releasing/cancelling a touch releases that input. Ship repairs,
  purchases and automated burns remain in the normal instruments and
  flight controls below the map.
- **Touch map:** one-finger drag pans, two-finger pinch zooms about
  the gesture midpoint, and a stationary tap selects contacts or an
  empty-space manual aim point. Touch taps are processed on release;
  a drag is not also treated as a targeting click. The desktop
  mouse, wheel, and keyboard actions are unchanged.
- **Profile:** registration and sign-in forms occupy the short-screen
  space first, with portrait selection retained when registering.
  Inputs use at least 16px text to reduce iOS Safari form zoom.
  Controls respect notches, safe-area insets, browser viewport resizing,
  landscape screens, and supported fullscreen operation.

For phones that do not support the browser element Fullscreen API,
the fullscreen control is hidden; the normal mobile canvas remains
playable instead of throwing an error.

## Testing

Automated tests in `tests/mobile-cockpit.test.cjs` exercise touch
taps, drags, two-finger zoom, cancelled gestures, mouse exclusion and
mobile UI wiring. The existing Node and Python tests plus the Vue
production build run in GitHub Actions.

Manual validation checklist after Firebase deployment:

1. Open `https://orbital-outlaws.web.app` in mobile Chrome or Safari;
   sign in, close the tab, reopen and verify remembered sign-in
2. In portrait, check canvas, five touch controls and toolbar fit
   without horizontal page scrolling
3. Hold engine + rotation with different fingers, release and verify
   input stops; test weapon fire and server-side fuel consumption
4. Pan with a finger, pinch with two fingers, then tap a target and
   verify selection is not triggered by pan or pinch
5. Open Instruments, check ship, Navigation, Telemetry, Comms and
   upgrades, then dismiss the drawer
6. Open Profile, change portrait/callsign/password, verify cloud
   preferences still restore across devices
7. Rotate to landscape, test tools, modal inputs and full-screen
   fallback. Confirm desktop layout remains unchanged on a large
   non-touch screen

## Deploy

Only frontend assets change. The existing Compute Engine API and
PostgreSQL do **not** need rebuilding for this update.

On Windows PowerShell at the repository root:

```powershell
git pull --ff-only
# Keep frontend/.env.production.local configured for your production API
# VITE_PUBLIC_PREVIEW=0
# VITE_API_BASE_URL=https://34-87-6-209.sslip.io
cd frontend
npm ci
npm run build
cd ..
firebase deploy --only hosting:orbital-outlaws --project axore-456421
```

Firebase Hosting serves the new `/legacy/touch-navigation.js`
automatically with the production Vite build. No Caddy changes, VM
firewall changes or additional HTTPS hostname are needed.
