// quiz.js — quiz definitions, study cards, and localStorage persistence.

const STORE_KEY = 'bobnav.answers.v1';
const SETTINGS_KEY = 'bobnav.settings.v1';
const PHASE_KEY = 'bobnav.phase.v1';

export const QUIZZES = {
  install: {
    id: 'install',
    title: 'Mystery installation',
    type: 'singleChoice',
    options: [
      { id: 'munitions',  label: 'Munitions dump' },
      { id: 'solar',      label: 'Solar farm' },
      { id: 'piggery',    label: 'Piggery' },
      { id: 'pow',        label: 'POW camp' },
      { id: 'greenhouses',label: 'Green houses' },
    ],
  },
  // No yankee quiz card in flight — pilot writes landmarks + landing sites on
  // a scratch pad. The recon photo is reachable from the AT YANKEE phase.
  town: {
    id: 'town',
    title: 'Pass-over town (tap only — town + grain on scratch pad)',
    type: 'multiField',
    fields: [
      { id: 'silos',    label: 'Silos visible',
        kind: 'counter', max: 20 },
      { id: 'quadrant', label: 'Quadrant of road intersection',
        kind: 'choice', options: ['NE', 'NW', 'SE', 'SW'] },
      { id: 'wac',      label: 'Marked correctly on WAC?',
        kind: 'choice', options: ['Yes', 'No'] },
      { id: 'rail',     label: 'Railway active?',
        kind: 'choice', options: ['Yes', 'No'] },
    ],
  },
};

// ----- Persistence -----

export function loadAnswers() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
  catch { return {}; }
}

export function saveAnswer(quizId, value) {
  const all = loadAnswers();
  all[quizId] = { value, t: Date.now() };
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
}

export function clearAnswers() {
  localStorage.removeItem(STORE_KEY);
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadPhaseIndex() {
  const v = parseInt(localStorage.getItem(PHASE_KEY) || '0', 10);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

export function savePhaseIndex(i) {
  localStorage.setItem(PHASE_KEY, String(i));
}

// ----- Cootamundra study cards (items 10-13, pre-researched in quiz_answers.md) -----

export const STUDY_CARDS = [
  {
    title: 'Item 10a — "XXXXXXX Paddocks"',
    body: [
      "Quinlan's Paddock.",
      'Australian government bought ~30 ha (75 acres) of Quinlan\'s paddock 1921 — Cootamundra was one of NSW\'s earliest rural aerodromes.',
      'Hint cross-check: Quinlan Drive runs along the south side of Cootamundra Airport.',
    ],
  },
  {
    title: 'Item 10b — DH-6 pilot, 5 Apr 1919',
    body: [
      'Unknown from web sources — confirm against field plaques at Cootamundra Airfield (No. 1 AOS plaque, RAAF memorial).',
      'Likely sources: Caskie, "Cootamundra (1901-1924): Past Imperfect" (2000); Cootamundra Herald 5-12 Apr 1919 on Trove.',
    ],
  },
  {
    title: 'Item 11 — 1930s rest-stop visitors',
    body: [
      'CIRCLE (landed at Cootamundra):',
      '• Sir Ross & Sir Keith Smith — Vickers Vimy G-EAOU, 23 Feb 1920 (post-race victory tour)',
      '• Bert Hinkler — Avro Avian, March 1928 (~30 min stop)',
      '• KLM Uiver — Douglas DC-2, late 1934 (return ferry to Netherlands)',
      '• Sir Charles Kingsford Smith — Southern Cross VH-USU (probably; aircraft carried VH- marks 1931-34)',
      '',
      'STRIKE:',
      '• PG Taylor / DH-6 — career was Southern Cross / Faith in Australia; not DH-6',
      '• Freda Thompson / Hornet Moth — her 1934 flight was a Moth Major, not a Hornet Moth',
      '• Amelia Earhart / Vega — never reached mainland Australia (lost 1937)',
      '• Dick Smith / JetRanger — 1982-83, not 1930s; route excluded Cootamundra',
    ],
  },
  {
    title: 'Item 12 — RAAF aircraft, 1940-46',
    body: [
      'Confirmed: Avro Anson (No. 1 AOS, primary navigator trainer; first arrived 25 Jun 1940; airfield memorial topped by a steel Anson).',
      'Also operated: No. 60 Sqn, No. 73 (Reserve) Sqn — types not authoritatively listed online.',
      'NOTE: Fairey Battle, Lockheed Ventura, Fairey Gannet, DH.82 Tiger Moth, DH.83 Fox Moth all post-Dec-1943 (after No. 1 AOS moved to Evans Head) — out of scope for "operated from Cootamundra".',
    ],
  },
  {
    title: 'Item 13 — Regional airlines (strike incorrect)',
    body: [
      'KEEP:',
      '• Butler Air Transport (base 1934-38; YCTM terminal named after Arthur Butler)',
      '• Larkin Aircraft Services / LASCO (AAS via Cootamundra, 1924-25)',
      '• Masling (Cootamundra-based aviation co. from Nov 1982)',
      '• East-West Airlines (took over Madsen Sydney-YCTM aircraft 1950)',
      '• Australian Aerial Services (Adelaide-Sydney via YCTM, 2 Jun 1924)',
      '',
      'STRIKE:',
      '• Airland (no record in any aviation-history source)',
      '• Trans Australian Airlines (trunk operator; no YCTM service)',
      '• Australian National Airways (Sydney-Melbourne via Canberra, not YCTM)',
      '• REX Airlines (post-2002; network excludes YCTM)',
    ],
  },
];
