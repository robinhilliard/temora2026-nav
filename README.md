# BoB NAV — Temora 2026

In-cockpit nav companion for the Battle of Britain NAV exercise at the
Airtourer Association Convention, Temora NSW, May 2026 (Victa Airtourer 115,
solo, left seat, iPad mounted right of panel).

The app is a static PWA. There is no server, no build step, no dependencies.
HTML + CSS + ES modules served straight from GitHub Pages, cached by a service
worker so it keeps working out of cell range.

## What it does

- Big high-contrast cockpit UI calibrated for arm's-reach viewing in sun.
- 12 named flight phases driven by a route-aware state machine that
  auto-advances on geofence triggers (e.g. within 3 NM of Mystery Installation,
  within 0.7 NM of Yankee, etc.) and supports a manual `NEXT PHASE` override.
- Live CDI: desired track, GPS ground track, drift in degrees, and a fly-to-
  needle cross-track strip with a numeric "x.x NM L/R" readout.
- Ground-speed + ETA + distance numerics in 110 pt font.
- Quizzes captured at the right moment (mystery installation, Yankee
  landmarks, pass-over town) with `localStorage` persistence.
- Cootamundra study cards (items 10–13) pre-loaded from
  [`quiz_answers.md`](./quiz_answers.md) for the visit at YCTM.
- Full-screen amber flash + `navigator.vibrate()` on alerts and phase
  transitions so it grabs attention from the right side of the panel.
- Wake Lock API keeps the screen on while the page is foreground.
- Post-flight summary with one-tap "Copy answers" so you can paste the lot
  straight into the post-flight review.

## Files

- [`index.html`](./index.html) — PWA shell with iPad meta tags.
- [`styles.css`](./styles.css) — black/white/amber, big fonts, big tap targets.
- [`app.js`](./app.js) — bootstrap, state, render loop, phase machine.
- [`nav.js`](./nav.js) — units, haversine, bearings, cross-track, intersection,
  wind triangle.
- [`geo.js`](./geo.js) — `watchPosition` with 5-fix rolling smoothing.
- [`wake.js`](./wake.js) — Wake Lock API.
- [`flash.js`](./flash.js) — amber flash + vibrate.
- [`route.js`](./route.js) — fixed and derived waypoints, 12-phase definitions.
- [`quiz.js`](./quiz.js) — quizzes, study cards, persistence.
- [`sw.js`](./sw.js) — service worker (offline cache).
- [`manifest.webmanifest`](./manifest.webmanifest) — PWA metadata.
- [`assets/`](./assets/) — Yankee recon photo, recon pages 8–9, PWA icons.
- [`instructions.md`](./instructions.md) — pilot's transcription of the
  briefing pack (source of truth for waypoints).
- [`quiz_answers.md`](./quiz_answers.md) — pre-flight research notes for the
  Cootamundra history quiz.

## iPad install (one-time, do this on the ground)

1. Open Safari on the iPad and navigate to the Pages URL (e.g.
   `https://<user>.github.io/temora2026-nav/`).
2. Tap **Share** (square with arrow up) → **Add to Home Screen**.
3. Open the app from the home-screen icon. Safari now runs it in standalone
   mode (no chrome) and the service worker pre-caches the route, photo, and
   study cards.
4. Confirm the **GPS** indicator in the top status row goes to ●●●● (≤10 m
   accuracy) once you have sky view. The icon next to it is a placeholder for
   the wake-lock state — Safari will keep the screen on until you swipe away.

## Pre-flight on the iPad

1. Open the app. You're on the **PRE-FLIGHT** screen.
2. Confirm/edit:
   - TAS, planned IAS, wind FROM (°T), wind speed, magnetic variation.
   - Waypoint coordinates (Yankee, Installation, Intersection are derived
     but editable).
3. Tap **BEGIN**. Phase 2 (`YTEM → YANKEE`) is now active.
4. Once airborne with GS > 30 kt the Flight Elapsed Timer auto-starts.

## In-flight UX

- Each phase shows a large headline, a one-line subhead with the action item,
  the CDI block (track + cross-track), and big distance / ETA / GS numerics.
- Approach alerts flash the screen amber + vibrate ~6 NM before the next
  decision point.
- Quizzes overlay the in-flight card; tap-to-answer or use the on-screen
  number keypad. Answers save instantly to `localStorage`.
- The **STUDY** button at any point opens the Cootamundra cards.
- Phase auto-advance happens at the geofence triggers in
  [`route.js`](./route.js) — manual `NEXT PHASE` is always available if GPS
  is unreliable or you want to skip ahead.

## Quiz prompt schedule

| Phase | Trigger | Prompt |
|-------|---------|--------|
| 2 → 3 | within 3 NM of Mystery Installation | flash + open install quiz card |
| 4 → 5 | within 0.7 NM of Yankee | flash + open Yankee photo + landmarks card |
| 7 → 8 | within 0.5 NM of 034°M intersection | flash + open pass-over town card |
| 9 → 10 | within 0.7 NM of YCTM | flash + auto-open study cards |
| 11 → 12 | within 0.5 NM of YTEM | flash "SPOT-LANDING PREP" |

## Math conventions

- All internal nav math uses canonical units: NM, kt, °T (true), m (altitude).
- All briefing inputs (mph, sm, km) and API outputs (m/s, °T heading) are
  converted at the boundary in [`nav.js`](./nav.js) `units` and [`geo.js`](./geo.js).
- Display uses °M with the user-configured east variation (default 12°E for
  YTEM area, May 2026 WMM2020 = 11.7°E).
- CDI sign: positive cross-track = right of track, needle deflects LEFT
  (traditional fly-to-needle CDI).

## Deployment (GitHub Pages)

```sh
git init
git add .
git commit -m "BoB NAV companion — Temora 2026"
# Create the GitHub repo via the web UI or `gh repo create`
git remote add origin https://github.com/<user>/temora2026-nav.git
git push -u origin main
# Enable Pages in repo settings → Pages → Source: deploy from branch `main`
```

## Local development

Static files; any web server works:

```sh
python3 -m http.server 8765
open http://localhost:8765/
```

The service worker is gated to HTTPS, so on `localhost` it does not register
(but the page works fine without it). On `https://*.github.io/` it caches the
shell on first load.
