// sim.js — local-only flight simulator. DO NOT PUSH.
//
// Loaded by sim.html INSTEAD of app.js. We:
//   1. install a fake GeoWatcher on `globalThis.__simGeo__`,
//   2. dynamically import app.js (which reads __simGeo__ and uses the fake),
//   3. drive the position from a scripted route at 1 Hz with small lateral
//      errors so the CDI exercises,
//   4. auto-press BEGIN, quiz buttons, and NEXT PHASE on the right phases
//      with a configurable real-time pause at quiz waypoints.
//
// URL params:
//   ?speed=N         time multiplier for the simulated flight (default 1).
//                    1 = real time; 60 ≈ ride one-minute legs in one second.
//   ?quizPause=SEC   real wall-clock seconds to dwell on a quiz screen
//                    before auto-pressing NEXT PHASE (default 60).
//   ?xtdAmp=NM       cross-track oscillation amplitude (default 0.3).
//   ?varE=DEG        magnetic variation override for derived waypoints
//                    (default whatever the saved settings have, else 12).

import {
  destination, initialBearingTrue, haversineNM, normalize360, units,
} from './nav.js';
import { FIXED_WAYPOINTS, deriveWaypoints, PHASES } from './route.js';
// Side-effect import. We need app.js to register its DOMContentLoaded
// boot handler, but its `let geo = realGeo` doesn't read globalThis at
// init time — it reads inside boot(), which fires AFTER our body runs
// (after we've set __simGeo__). See sim.html for the localStorage reset
// that runs before this module graph evaluates.
import './app.js';

// ===== Params =====

const P = new URLSearchParams(location.search);
const SPEED        = Math.max(0.1, Number(P.get('speed')     ?? '1'));
const QUIZ_PAUSE_S = Math.max(0,   Number(P.get('quizPause') ?? '60'));
const XTD_AMP_NM   = Math.max(0,   Number(P.get('xtdAmp')    ?? '0.3'));
const VAR_E        =                Number(P.get('varE')     ?? '12');

const SIM_GS_KT   = 90;
const SIM_ALT_M   = 914;       // ~3000 ft
const TICK_MS     = 1000;
const ACC_M       = 5;         // pretend ●●●● GPS

// ===== Sim GeoWatcher (matches geo.js surface) =====

class SimGeoWatcher extends EventTarget {
  constructor() {
    super();
    this.last = null;
  }
  start() { /* sim loop drives this externally */ }
  stop()  {}
  qualityDots() { return 4; }
  push(fix) {
    this.last = fix;
    this.dispatchEvent(new CustomEvent('fix', { detail: fix }));
  }
}

const simGeo = new SimGeoWatcher();
globalThis.__simGeo__ = simGeo;

// ===== Route / waypoints =====

const wpts = deriveWaypoints(FIXED_WAYPOINTS, VAR_E);

// ===== Position state =====

let pos        = { lat: wpts.YTEM.lat, lon: wpts.YTEM.lon };
let prevPos    = null;
let lastT      = null;
let alongLegNM = 0;       // distance travelled along current leg's great circle
let lastLegId  = null;    // detect leg changes to reset alongLegNM
let xtdPhase   = 0;       // sinusoidal-XTD phase, advances in NM

// ===== Tick =====

function getCurrentPhase() {
  const idx = Number(localStorage.getItem('bobnav.phase.v1') ?? '0');
  return PHASES[Math.max(0, Math.min(PHASES.length - 1, idx))];
}

function legOf(ph) {
  if (!ph.from || !ph.to) return null;
  return { fromWp: wpts[ph.from], toWp: wpts[ph.to], id: `${ph.from}->${ph.to}` };
}

function tickPosition(now) {
  const ph = getCurrentPhase();

  if (ph.id === 'preflight') {
    pos = { lat: wpts.YTEM.lat, lon: wpts.YTEM.lon };
    prevPos = null;
    lastLegId = null;
    return { trkTrue: 0, gsKt: 0 };
  }

  const dt = lastT == null ? 1 : (now - lastT) / 1000;
  const simDt = dt * SPEED;

  const leg = legOf(ph);
  if (leg) return tickLeg(leg, simDt);
  return tickLoiter(ph, simDt, now);
}

function tickLeg(leg, simDt) {
  // Fly the leg's actual great circle so the path crosses every point
  // on it (including derived waypoints like INTERSECT), then add a
  // bounded sinusoidal lateral offset so the CDI exercises and shows
  // realistic ±XTD_AMP_NM deviations. This gives geofence triggers a
  // chance to fire on pass-through waypoints — the previous "always
  // re-aim from current pos" pursuit-curve missed INTERSECT entirely
  // because the curve never crossed the YWWL→YYNG great circle.
  const stepNM = (SIM_GS_KT / 3600) * simDt;

  if (leg.id !== lastLegId) {
    lastLegId = leg.id;
    alongLegNM = 0;        // start from the leg origin's great circle
    xtdPhase = 0;
  }
  const totalNM = haversineNM(leg.fromWp, leg.toWp);
  alongLegNM = Math.min(alongLegNM + stepNM, totalNM);
  xtdPhase += stepNM;

  const dtkT = initialBearingTrue(leg.fromWp, leg.toWp);

  if (alongLegNM >= totalNM) {
    prevPos = pos;
    pos = { lat: leg.toWp.lat, lon: leg.toWp.lon };
    return { trkTrue: dtkT, gsKt: SIM_GS_KT };
  }

  const onTrack = destination(leg.fromWp, dtkT, alongLegNM);
  // Sine wave ~12 NM per cycle keeps the needle moving without ever
  // pinning to a side; magnitude tracks XTD_AMP_NM.
  const xtdNM = XTD_AMP_NM * Math.sin((xtdPhase / 12) * 2 * Math.PI);
  const offsetBrgT = (dtkT + 90 + 360) % 360;
  prevPos = pos;
  pos = destination(onTrack, offsetBrgT, xtdNM);

  // Reported track from real movement — captures both the leg DTK and
  // the slight angle introduced by the XTD oscillation.
  let trkTrue = dtkT;
  if (prevPos && haversineNM(prevPos, pos) > 1e-6) {
    trkTrue = initialBearingTrue(prevPos, pos);
  }
  return { trkTrue: normalize360(trkTrue), gsKt: SIM_GS_KT };
}

function tickLoiter(ph, simDt, now) {
  // Hold near the relevant waypoint with a slow orbit so the GPS never
  // looks frozen. Loiter centre is phase-specific; we don't try to
  // simulate the actual orbit pattern, just give the GPS something to do.
  let centre;
  if      (ph.id === 'observe-install') centre = wpts.INSTALL;
  else if (ph.id === 'at-yankee')       centre = wpts.YANKEE;
  else if (ph.id === 'at-intersect')    centre = wpts.INTERSECT;
  else if (ph.id === 'at-yctm')         centre = wpts.YCTM;
  else                                   centre = pos;

  const t = now / 1000 * SPEED;        // orbit speed scales with sim speed
  const radiusNM = 0.05;
  const angle = (t / 30) * 360;        // 30 s per orbit
  pos = destination(centre, angle % 360, radiusNM);
  return { trkTrue: normalize360(angle + 90), gsKt: 30 };
}

function emitFix(now, derived) {
  simGeo.push({
    t: now,
    lat: pos.lat,
    lon: pos.lon,
    acc: ACC_M,
    altM: SIM_ALT_M,
    gsKt: derived.gsKt,
    trkTrue: derived.trkTrue,
  });
}

setInterval(() => {
  const now = Date.now();
  const derived = tickPosition(now);
  emitFix(now, derived);
  lastT = now;
}, TICK_MS);

// ===== Auto-pilot (UI driver) =====
//
// Watches phase transitions and presses buttons with the right cadence.
// All real wall-clock — the SPEED knob does NOT compress quiz pauses,
// because the human watching wants a real minute to see the UI.

let lastSeenPhaseId = null;

function autoPilot() {
  const ph = getCurrentPhase();
  if (ph.id === lastSeenPhaseId) return;
  lastSeenPhaseId = ph.id;
  console.info('[sim] phase →', ph.id);

  if (ph.id === 'preflight') {
    setTimeout(() => clickByText('BEGIN'), 1200);
    return;
  }
  if (ph.id === 'observe-install') {
    setTimeout(() => clickByText('Piggery'),     2000);
    setTimeout(() => clickByText('NEXT PHASE'),  QUIZ_PAUSE_S * 1000);
    return;
  }
  if (ph.id === 'at-yankee') {
    setTimeout(() => clickByText('NEXT PHASE'),  QUIZ_PAUSE_S * 1000);
    return;
  }
  if (ph.id === 'at-intersect') {
    setTimeout(() => townQuizSequence(),         2000);
    setTimeout(() => clickByText('NEXT PHASE'),  QUIZ_PAUSE_S * 1000);
    return;
  }
  if (ph.id === 'at-yctm') {
    setTimeout(() => clickByText('NEXT PHASE'),  QUIZ_PAUSE_S * 1000);
    return;
  }
  // Other phases auto-advance via geofence.
}

function townQuizSequence() {
  // Tap silos + 3 times → 3 silos.
  for (let i = 0; i < 3; i++) {
    setTimeout(() => clickButton((b) => b.classList.contains('counter-btn') && b.textContent.trim() === '+'),
               300 * (i + 1));
  }
  setTimeout(() => clickByText('NE'),      1500);
  setTimeout(() => clickByExactYesNo('Marked correctly on WAC?', 'Yes'), 2000);
  setTimeout(() => clickByExactYesNo('Railway active?',          'Yes'), 2500);
}

function clickByText(text) {
  return clickButton((b) =>
    b.offsetParent !== null
    && b.textContent.trim().toUpperCase() === text.toUpperCase());
}

// Pick the Yes/No directly under a given quiz-field label.
function clickByExactYesNo(labelText, choice) {
  const labels = [...document.querySelectorAll('.quiz-field label')];
  const lbl = labels.find((l) => l.textContent.trim() === labelText);
  if (!lbl) { console.warn('[sim] label not found:', labelText); return; }
  const btn = [...lbl.parentElement.querySelectorAll('button.choice')]
    .find((b) => b.textContent.trim() === choice);
  if (btn) btn.click(); else console.warn('[sim] choice not found:', labelText, choice);
}

function clickButton(predicate) {
  const btn = [...document.querySelectorAll('button')].find(predicate);
  if (btn) { btn.click(); return true; }
  console.warn('[sim] no button matched');
  return false;
}

// Poll for phase changes at a comfortable cadence — separate from the
// position tick so it survives even if a tick is missed.
setInterval(autoPilot, 500);

// Banner so it's obvious the sim is active.
window.addEventListener('DOMContentLoaded', () => {
  const banner = document.createElement('div');
  banner.textContent =
    `SIM speed×${SPEED} · quizPause ${QUIZ_PAUSE_S}s · xtdAmp ${XTD_AMP_NM} NM`;
  banner.style.cssText = `
    position: fixed; top: 4px; right: 8px; z-index: 9999;
    color: #FFB000; font: 12px/1.2 ui-monospace, Menlo, monospace;
    background: rgba(0,0,0,0.7); padding: 4px 8px; border-radius: 4px;
    pointer-events: none;
  `;
  document.body.appendChild(banner);
});

console.info('[sim] booted. speed=%s quizPause=%ss xtdAmp=%s NM varE=%s°',
  SPEED, QUIZ_PAUSE_S, XTD_AMP_NM, VAR_E);
