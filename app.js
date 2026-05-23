// app.js — bootstrap, state, render loop, phase machine and UI for the BoB NAV
// companion. Single file; keeps the data flow visible.

import {
  units, normalize360, magToTrue, trueToMag,
  haversineNM, initialBearingTrue, crossTrackNM, trackError, windTriangle,
} from './nav.js';
import { geo as realGeo } from './geo.js';
// `globalThis.__simGeo__` lets a local-only sim harness swap in a fake
// GeoWatcher (same surface: addEventListener('fix'/'error'), start(),
// stop(), qualityDots()). Resolved inside boot() so a sim module that
// statically imports this file can install the override after our
// top-level evaluates but before DOMContentLoaded fires. No-op in
// production where __simGeo__ is undefined.
let geo = realGeo;
import { startWakeLock } from './wake.js';
import { flashAttention } from './flash.js';
import { FIXED_WAYPOINTS, deriveWaypoints, PHASES } from './route.js';
import {
  QUIZZES, STUDY_CARDS,
  loadAnswers, saveAnswer,
  loadSettings, saveSettings,
  loadPhaseIndex, savePhaseIndex,
} from './quiz.js';

// ===== Defaults =====

const DEFAULT_SETTINGS = {
  tasKt: 95,
  iasKt: 90,
  windFromT: 90,    // 3000 ft area forecast for 23 May 2026: easterly 10 kt
  windKt: 10,
  varE: 12,         // WMM2020 model gives 11.7°E at YTEM May 2026; round up for ease
  waypoints: {},
  takeoffAt: null,
};

// ===== State =====

const state = {
  settings: { ...DEFAULT_SETTINGS, ...(loadSettings() || {}) },
  // Clamp to current PHASES bounds so a stale saved index from a prior
  // version (e.g. when YCTM phases existed and the route was longer)
  // doesn't put currentPhase() out of bounds on first render.
  phaseIndex: Math.min(loadPhaseIndex(), PHASES.length - 1),
  fix: null,
  waypoints: null,
  alertsFired: new Set(),
  phaseEnteredAt: Date.now(),
  quizAnswers: loadAnswers(),
  answersDraft: {},
  fetStartAt: null,    // FET starts on takeoff detection; set elsewhere
  modal: null,         // 'photo' | 'study' | null
};

function rebuildWaypoints() {
  const overrides = state.settings.waypoints || {};
  const fixed = {};
  for (const id in FIXED_WAYPOINTS) {
    fixed[id] = { ...FIXED_WAYPOINTS[id] };
    if (overrides[id]) Object.assign(fixed[id], overrides[id]);
  }
  state.waypoints = deriveWaypoints(fixed, state.settings.varE);
  if (overrides.INSTALL && state.waypoints.INSTALL) Object.assign(state.waypoints.INSTALL, overrides.INSTALL);
  if (overrides.INTERSECT && state.waypoints.INTERSECT) Object.assign(state.waypoints.INTERSECT, overrides.INTERSECT);
}

// ===== Phase helpers =====

function currentPhase() { return PHASES[state.phaseIndex]; }

function setPhase(i, opts = {}) {
  if (i < 0 || i >= PHASES.length) return;
  state.phaseIndex = i;
  state.phaseEnteredAt = Date.now();
  state.alertsFired = new Set();
  savePhaseIndex(i);
  const ph = PHASES[i];
  if (ph.flashOnEnter && !opts.silent) flashAttention();
  if (ph.id === 'summary') state.modal = null;
  render();
}

function nextPhase() { setPhase(state.phaseIndex + 1); }
function prevPhase() { setPhase(state.phaseIndex - 1, { silent: true }); }

// ===== Nav-derived live values for rendering =====

function leg() {
  const ph = currentPhase();
  if (!ph.showCDI || !state.fix || !ph.from || !ph.to) return null;
  const a = state.waypoints[ph.from], b = state.waypoints[ph.to];
  const p = { lat: state.fix.lat, lon: state.fix.lon };
  const distToB = haversineNM(p, b);
  const dtkT = initialBearingTrue(p, b);
  const dtkM = trueToMag(dtkT, state.settings.varE);
  const trkT = state.fix.trkTrue;
  const trkM = trkT != null ? trueToMag(trkT, state.settings.varE) : null;
  const drift = trkT != null ? trackError(dtkT, trkT) : null;  // +ve = need to turn right
  const xtdNM = crossTrackNM(p, a, b);                          // +ve = right of track
  const gsKt = state.fix.gsKt;
  const etaSec = gsKt > 5 ? (distToB / gsKt) * 3600 : null;
  return { a, b, distToB, dtkT, dtkM, trkM, drift, xtdNM, gsKt, etaSec };
}

function distToWp(id) {
  if (!state.fix || !state.waypoints[id]) return null;
  return haversineNM({ lat: state.fix.lat, lon: state.fix.lon }, state.waypoints[id]);
}

// ===== Phase auto-advance + alert firing =====

function tick() {
  const ph = currentPhase();
  if (!ph) return;

  // Alerts
  if (ph.alerts && state.fix) {
    for (const al of ph.alerts) {
      if (state.alertsFired.has(al.id)) continue;
      const d = distToWp(al.distFrom);
      if (d != null && d <= al.atNM) {
        state.alertsFired.add(al.id);
        flashAttention();
      }
    }
  }

  // Auto-advance
  const adv = ph.advance;
  if (adv?.type === 'distFromBelow') {
    const d = distToWp(adv.wp);
    if (d != null && d <= adv.nm) {
      nextPhase();
      return;
    }
  } else if (adv?.type === 'manualOrTimeout') {
    if (Date.now() - state.phaseEnteredAt >= adv.timeoutSec * 1000) {
      nextPhase();
      return;
    }
  }

  // Takeoff detection — once GS exceeds 30 kt while already past setup, mark FET start.
  // We deliberately don't auto-advance from setup: tap BEGIN explicitly so we don't
  // accidentally trigger from a car ride to the field.
  if (state.fetStartAt == null && state.fix && state.fix.gsKt > 30 && state.phaseIndex > 0) {
    state.fetStartAt = Date.now();
    state.settings.takeoffAt = state.fetStartAt;
    saveSettings(state.settings);
  }
}

// ===== Geo handler =====

function onFix(ev) {
  state.fix = ev.detail;
  tick();
  render();
}

function onGeoError(ev) {
  state.fix = null;
  render();
}

// ===== Rendering =====

const $ = (id) => document.getElementById(id);
// Flatten + drop null/false from a child list. Without this, a missed `...`
// spread on a `.map()` result coerces the array to a string and renders as
// `[object HTMLSpanElement],...` — caused a real CDI bug in the wild.
const flattenKids = (kids) => {
  const out = [];
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) out.push(...flattenKids(k));
    else out.push(k);
  }
  return out;
};
const setKids = (root, ...kids) => root.replaceChildren(...flattenKids(kids));
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'on' && typeof v === 'object') for (const ev in v) el.addEventListener(ev, v[ev]);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (v === false || v == null) {}
    else el.setAttribute(k, v);
  }
  for (const k of flattenKids(kids)) {
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
};

function render() {
  // Decide top-level screen.
  const ph = currentPhase();
  const isSetup = ph.id === 'preflight';
  const isSummary = ph.id === 'summary';
  const isFlight = !isSetup && !isSummary;

  $('screen-setup').classList.toggle('hidden', !isSetup);
  $('screen-flight').classList.toggle('hidden', !isFlight);
  $('screen-summary').classList.toggle('hidden', !isSummary);

  if (isSetup) renderSetup();
  if (isFlight) renderFlight();
  if (isSummary) renderSummary();

  $('modal-photo').classList.toggle('hidden', state.modal !== 'photo');
  $('modal-study').classList.toggle('hidden', state.modal !== 'study');
  if (state.modal === 'study') renderStudy();
  if (state.modal === 'photo') renderPhoto();
}

// ----- Setup screen -----

function renderSetup() {
  const root = $('screen-setup');
  const s = state.settings;
  rebuildWaypoints();
  const wp = state.waypoints;

  const formatLatLon = (w) => `${w.lat.toFixed(6)}, ${w.lon.toFixed(6)}`;
  const wpRow = (id) => {
    const w = wp[id];
    if (!w) return null;
    return h('div', { class: 'wp-row' },
      h('div', { class: 'wp-id' }, w.short || w.id),
      h('div', { class: 'wp-name' }, w.name),
      h('div', { class: 'wp-coord' }, formatLatLon(w)),
      w.note ? h('div', { class: 'wp-note' }, w.note) : null,
    );
  };

  setKids(root,
    h('h1', {}, 'BoB NAV — Temora 2026'),
    h('p', { class: 'tagline' }, 'Battle of Britain NAV companion. Confirm settings, then BEGIN.'),

    h('section', {},
      h('h2', {}, 'Aircraft & wind'),
      numberRow('TAS (kt)', 'tasKt', s.tasKt, 60, 140),
      numberRow('Planned IAS (kt)', 'iasKt', s.iasKt, 60, 140),
      numberRow('Wind FROM (°T)', 'windFromT', s.windFromT, 0, 360),
      numberRow('Wind speed (kt)', 'windKt', s.windKt, 0, 60),
      numberRow('Magnetic variation (°E)', 'varE', s.varE, 0, 30),
    ),

    h('section', {},
      h('h2', {}, 'Waypoints (tap to edit)'),
      ...['YTEM','YWWL','YYNG','YCTM','YANKEE','INSTALL','INTERSECT'].map(wpRow).filter(Boolean),
      h('p', { class: 'small' },
        'Yankee is your Google Earth ID against the recon photo. Installation is computed from "15 sm from YTEM, 5 NM right of YTEM→Yankee course". Intersection is the great-circle crossing of the 034°M radial from YTEM with the YWWL→YYNG track. All editable on the day.'),
    ),

    h('section', {},
      h('h2', {}, 'Plan summary'),
      planSummary(),
    ),

    h('section', {},
      h('h2', {}, 'Pre-flight review'),
      h('p', { class: 'small' },
        'In flight you will tap and write — never type. The Cootamundra answers (items 10-13) are pre-loaded; review them now.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn-secondary',
          on: { click: () => { state.modal = 'study'; render(); } } },
          'COOTAMUNDRA STUDY CARDS'),
        h('button', { class: 'btn-secondary',
          on: { click: () => { state.modal = 'photo'; render(); } } },
          'YANKEE RECON PHOTO'),
      ),
    ),

    h('div', { class: 'btn-row' },
      h('button', { class: 'btn-secondary', on: { click: resetAll } }, 'Reset all'),
      h('button', { class: 'btn-primary', on: { click: () => { saveSettings(state.settings); nextPhase(); } } }, 'BEGIN'),
    ),
  );
}

function numberRow(label, key, value, min, max) {
  return h('label', { class: 'num-row' },
    h('span', {}, label),
    h('input', {
      type: 'number', inputmode: 'decimal', step: 'any',
      min: String(min), max: String(max), value: String(value),
      on: {
        input: (e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) {
            state.settings[key] = v;
            saveSettings(state.settings);
            rebuildWaypoints();
            // Re-render plan summary live without reflowing whole form.
            const ps = document.querySelector('#screen-setup .plan-summary');
            if (ps) ps.replaceWith(planSummary());
          }
        },
      },
    }),
  );
}

function planSummary() {
  const wp = state.waypoints;
  const s = state.settings;
  if (!wp) return h('div', { class: 'plan-summary' });
  const legs = [
    ['YTEM','YANKEE'],
    ['YANKEE','YWWL'],
    ['YWWL','INTERSECT'],
    ['INTERSECT','YTEM'],
  ];
  const rows = legs.map(([a, b]) => {
    if (!wp[a] || !wp[b]) return null;
    const d = haversineNM(wp[a], wp[b]);
    const trkT = initialBearingTrue(wp[a], wp[b]);
    const trkM = trueToMag(trkT, s.varE);
    const wt = windTriangle(trkT, s.tasKt, s.windFromT, s.windKt);
    const hdgM = wt ? trueToMag(wt.headingT, s.varE) : null;
    const gs = wt ? wt.groundSpeedKt : s.tasKt;
    const eteMin = (d / gs) * 60;
    return h('tr', {},
      h('td', {}, `${wp[a].short || a} → ${wp[b].short || b}`),
      h('td', {}, `${d.toFixed(1)} NM`),
      h('td', {}, `${trkM.toFixed(0)}°M`),
      h('td', {}, hdgM ? `${hdgM.toFixed(0)}°M` : '—'),
      h('td', {}, `${gs.toFixed(0)} kt`),
      h('td', {}, `${eteMin.toFixed(0)} min`),
    );
  }).filter(Boolean);
  return h('div', { class: 'plan-summary' },
    h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'Leg'),
        h('th', {}, 'Dist'),
        h('th', {}, 'TRK'),
        h('th', {}, 'HDG'),
        h('th', {}, 'GS'),
        h('th', {}, 'ETE'),
      )),
      h('tbody', {}, ...rows),
    ),
  );
}

function resetAll() {
  if (!confirm('Reset all settings and answers?')) return;
  localStorage.clear();
  location.reload();
}

// ----- Flight screen -----

function renderFlight() {
  const root = $('screen-flight');
  const ph = currentPhase();
  const lg = leg();
  const fix = state.fix;
  const dots = geo.qualityDots();
  const fet = state.fetStartAt ? formatHMS(Date.now() - state.fetStartAt) : '--:--';
  const headlineAlerted = (ph.alerts || []).find((a) => state.alertsFired.has(a.id));
  const headline = headlineAlerted ? headlineAlerted.headline : ph.headline;

  // Phase elements that only render when present
  const cdi = ph.showCDI ? renderCDI(lg) : null;
  const numerics = ph.showCDI ? renderNumerics(lg, ph) : null;
  const secondary = (ph.secondaryDist && distToWp(ph.secondaryDist) != null)
    ? h('div', { class: 'secondary' },
        `→ ${state.waypoints[ph.secondaryDist]?.short || ph.secondaryDist}: `,
        h('strong', {}, `${distToWp(ph.secondaryDist).toFixed(1)} NM`))
    : null;

  const quiz = ph.quiz ? renderQuizCard(QUIZZES[ph.quiz]) : null;
  const reconBtn = ph.showRecon
    ? h('div', { class: 'btn-row' },
        h('button', { class: 'btn-secondary',
          on: { click: () => { state.modal = 'photo'; render(); } } },
          'YANKEE PHOTO'))
    : null;

  setKids(root,
    h('div', { class: 'status-row' },
      h('span', {}, `Phase ${ph.n} / ${PHASES.length}`),
      h('span', {}, fet),
      h('span', {}, 'GPS ' + '●'.repeat(dots) + '○'.repeat(4 - dots)),
      h('span', {}, '☼'),
    ),

    h('h1', { class: headlineAlerted ? 'headline alert' : 'headline' }, headline),
    h('p',  { class: 'subhead' }, ph.sub),

    cdi,
    numerics,
    secondary,
    reconBtn,
    quiz,

    h('div', { class: 'btn-row btn-row-bottom' },
      h('button', { class: 'btn-secondary', on: { click: prevPhase } }, 'PREV'),
      h('button', { class: 'btn-primary',   on: { click: nextPhase } }, 'NEXT PHASE'),
    ),
  );
}

function renderCDI(lg) {
  if (!lg) {
    return h('div', { class: 'cdi-block no-fix' },
      h('div', { class: 'track-row' }, 'Awaiting GPS fix…'));
  }
  const driftStr = lg.drift == null ? '—' :
    `${lg.drift > 0 ? '+' : ''}${lg.drift.toFixed(0)}° ${lg.drift > 0 ? 'R' : (lg.drift < 0 ? 'L' : '')}`;
  const driftCls = lg.drift != null && Math.abs(lg.drift) > 5 ? 'drift alert' : 'drift';

  // CDI horizontal, traditional fly-to-needle convention. ±1 NM full scale.
  // Aircraft right of track ⇒ needle deflects LEFT (course is to your left, fly left).
  const xtdClamp = Math.max(-1, Math.min(1, lg.xtdNM));
  const pct = 50 - xtdClamp * 50; // 0..100, 50 = on track

  return h('div', { class: 'cdi-block' },
    h('div', { class: 'track-row' },
      h('span', {}, h('label', {}, 'DTK '), h('strong', {}, `${lg.dtkM.toFixed(0)}°M`)),
      h('span', {}, h('label', {}, 'TRK '), h('strong', {}, lg.trkM != null ? `${lg.trkM.toFixed(0)}°M` : '—')),
      h('span', { class: driftCls }, driftStr),
    ),
    h('div', { class: 'cdi' },
      h('div', { class: 'cdi-scale' },
        ...['L', '·', '·', '·', '·', '·', '·', '·', '·', 'R'].map((c, i) =>
          h('span', { class: i === 4 || i === 5 ? 'cdi-c' : 'cdi-d' }, c)),
        h('div', { class: 'cdi-needle', style: `left:${pct}%` }),
      ),
      h('div', { class: 'cdi-numeric' },
        Math.abs(lg.xtdNM) < 0.05 ? 'ON TRACK' :
        `${Math.abs(lg.xtdNM).toFixed(1)} NM ${lg.xtdNM > 0 ? 'RIGHT' : 'LEFT'}`),
    ),
  );
}

function renderNumerics(lg, ph) {
  const dist = lg ? `${lg.distToB.toFixed(1)}` : '—';
  const eta = lg && lg.etaSec ? formatMS(lg.etaSec * 1000) : '—';
  const gs = lg && lg.gsKt != null ? `${lg.gsKt.toFixed(0)}` : '—';
  return h('div', { class: 'numerics' },
    h('div', { class: 'num-cell' }, h('div', { class: 'num-val' }, dist), h('div', { class: 'num-lab' }, 'NM TO GO')),
    h('div', { class: 'num-cell' }, h('div', { class: 'num-val' }, eta),  h('div', { class: 'num-lab' }, 'ETA')),
    h('div', { class: 'num-cell' }, h('div', { class: 'num-val' }, gs),   h('div', { class: 'num-lab' }, 'KT GS')),
    h('div', { class: 'num-target' }, `IAS target ${ph.targetIAS} kt`),
  );
}

// ----- Quiz card -----

function renderQuizCard(q) {
  if (!q) return null;
  const draft = state.answersDraft[q.id] || ((state.quizAnswers[q.id]?.value) ?? {});

  if (q.type === 'singleChoice') {
    return h('div', { class: 'quiz' },
      h('div', { class: 'quiz-title' }, q.title),
      h('div', { class: 'quiz-options' },
        ...q.options.map((opt) =>
          h('button', {
            class: 'quiz-opt' + (draft === opt.id ? ' selected' : ''),
            on: { click: () => {
              state.answersDraft[q.id] = opt.id;
              saveAnswer(q.id, opt.id);
              state.quizAnswers = loadAnswers();
              render();
            } },
          }, opt.label)
        ),
      ),
    );
  }

  if (q.type === 'multiField') {
    return h('div', { class: 'quiz' },
      h('div', { class: 'quiz-title' }, q.title),
      ...q.fields.map((f) => h('div', { class: 'quiz-field' },
        h('label', {}, f.label),
        renderQuizField(q, f, draft),
      )),
    );
  }

  return null;
}

function renderQuizField(q, f, draft) {
  const val = draft && draft[f.id] != null ? draft[f.id] : '';

  const setField = (v) => {
    const d = state.answersDraft[q.id] || { ...(state.quizAnswers[q.id]?.value || {}) };
    d[f.id] = v;
    state.answersDraft[q.id] = d;
  };

  const persist = () => {
    saveAnswer(q.id, { ...(state.quizAnswers[q.id]?.value || {}), ...state.answersDraft[q.id] });
    state.quizAnswers = loadAnswers();
    render();
  };

  if (f.kind === 'choice') {
    return h('div', { class: 'choice-row' },
      ...f.options.map((opt) => h('button', {
        class: 'choice' + (val === opt ? ' selected' : ''),
        on: { click: () => { setField(opt); persist(); } },
      }, opt)),
    );
  }

  if (f.kind === 'counter') {
    const cur = Number.isFinite(parseInt(val, 10)) ? parseInt(val, 10) : 0;
    const max = f.max ?? 99;
    const setN = (n) => {
      const c = Math.max(0, Math.min(max, n));
      setField(String(c));
      persist();
    };
    return h('div', { class: 'counter-row' },
      h('button', { class: 'counter-btn', on: { click: () => setN(cur - 1) } }, '−'),
      h('div', { class: 'counter-val' }, String(cur)),
      h('button', { class: 'counter-btn', on: { click: () => setN(cur + 1) } }, '+'),
    );
  }

  // Fallback (only used by setup, never in-flight): plain text input.
  return h('input', {
    type: 'text', value: String(val ?? ''),
    on: { input: (e) => setField(e.target.value) },
  });
}

// ----- Modals -----

function renderPhoto() {
  const root = $('modal-photo');
  setKids(root,
    h('div', { class: 'modal-inner' },
      h('img', { src: 'assets/yankee.jpg', alt: 'Checkpoint Yankee recon photo' }),
      h('button', { class: 'btn-primary', on: { click: () => { state.modal = null; render(); } } }, 'CLOSE'),
    ),
  );
}

function renderStudy() {
  const root = $('modal-study');
  setKids(root,
    h('div', { class: 'modal-inner study' },
      h('h2', {}, 'Cootamundra study cards (10–13)'),
      ...STUDY_CARDS.map((card) => h('article', { class: 'study-card' },
        h('h3', {}, card.title),
        ...card.body.map((line) => h('p', {}, line)),
      )),
      h('button', { class: 'btn-primary', on: { click: () => { state.modal = null; render(); } } }, 'CLOSE'),
    ),
  );
}

// ----- Summary screen -----

function renderSummary() {
  const root = $('screen-summary');
  const a = state.quizAnswers;

  const installLabel = a.install
    ? QUIZZES.install.options.find((o) => o.id === a.install.value)?.label || '—'
    : '—';

  const fmtField = (q, fid) => a[q]?.value?.[fid] ?? '—';

  const text = [
    'BoB NAV — Temora 2026 — Answers',
    `Generated: ${new Date().toLocaleString()}`,
    '',
    `Item 4. Mystery installation: ${installLabel}`,
    '',
    'Item 6. Yankee landmarks & forced-landing sites: see scratch pad.',
    '',
    'Items 7-9. Pass-over town:',
    '  Town:           (scratch pad)',
    `  Silos visible:  ${fmtField('town','silos')}`,
    `  Quadrant:       ${fmtField('town','quadrant')}`,
    `  On WAC?:        ${fmtField('town','wac')}`,
    '  Grain:          (scratch pad)',
    `  Railway active: ${fmtField('town','rail')}`,
    '',
    'Items 10-13. Cootamundra (pre-flight research):',
    "  10a. \"XXXXXXX Paddocks\":   Quinlan's Paddock",
    '  10b. DH-6 pilot 5/4/1919:  unknown — confirm against field plaques',
    '  11.  1930s rest-stop:      Smith bros (Vimy 1920), Hinkler (Avian 1928),',
    '                              KLM Uiver (DC-2 1934), Kingsford Smith',
    '                              (Southern Cross VH-USU)',
    '  12.  RAAF aircraft 40-46:  Avro Anson (No. 1 AOS, 25 Jun 1940)',
    '  13.  Strike incorrect:     Airland, Trans Australian Airlines,',
    '                              Australian National Airways, REX Airlines',
  ].join('\n');

  setKids(root,
    h('h1', {}, 'POST-FLIGHT SUMMARY'),
    h('section', {},
      h('h2', {}, 'Item 4 — Installation'),
      h('p', {}, installLabel),
    ),
    h('section', {},
      h('h2', {}, 'Item 6 — Yankee'),
      h('p', {}, h('em', {}, 'Landmarks + forced-landing sites: see scratch pad.')),
    ),
    h('section', {},
      h('h2', {}, 'Items 7-9 — Pass-over town'),
      h('p', {}, h('strong', {}, 'Town: '), h('em', {}, '(scratch pad)')),
      h('p', {}, h('strong', {}, 'Silos visible: '), fmtField('town','silos')),
      h('p', {}, h('strong', {}, 'Quadrant: '), fmtField('town','quadrant')),
      h('p', {}, h('strong', {}, 'On WAC?: '), fmtField('town','wac')),
      h('p', {}, h('strong', {}, 'Grain: '), h('em', {}, '(scratch pad)')),
      h('p', {}, h('strong', {}, 'Railway active?: '), fmtField('town','rail')),
    ),
    h('section', {},
      h('h2', {}, 'Items 10-13 — Cootamundra'),
      h('p', {}, h('em', {}, 'Pre-flight research, included in COPY ANSWERS:')),
      h('button', { class: 'btn-secondary',
        on: { click: () => { state.modal = 'study'; render(); } } },
        'OPEN STUDY CARDS'),
    ),
    h('div', { class: 'btn-row btn-row-bottom' },
      h('button', { class: 'btn-secondary', on: { click: prevPhase } }, 'BACK'),
      h('button', { class: 'btn-secondary', on: { click: resetAll } }, 'RESTART'),
      h('button', { class: 'btn-primary', on: { click: async () => {
        try { await navigator.clipboard.writeText(text); alert('Copied to clipboard.'); }
        catch { prompt('Copy this text:', text); }
      } } }, 'COPY ANSWERS'),
    ),
  );
}

// ===== Helpers =====

function formatMS(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function formatHMS(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`
    : `${m}:${String(r).padStart(2,'0')}`;
}

// ===== Boot =====

function boot() {
  geo = globalThis.__simGeo__ || realGeo;
  rebuildWaypoints();
  state.fetStartAt = state.settings.takeoffAt || null;
  startWakeLock();
  geo.addEventListener('fix', onFix);
  geo.addEventListener('error', onGeoError);
  geo.start();

  // Tick at 1 Hz for FET, alerts, and timeout-based phase advance.
  setInterval(() => {
    tick();
    const ph = currentPhase();
    if (ph.id === 'preflight' || ph.id === 'summary') return;
    // Don't disturb a text input in mid-edit.
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    render();
  }, 1000);

  // Initial render.
  render();
}

window.addEventListener('DOMContentLoaded', boot);
