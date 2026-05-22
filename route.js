// route.js — waypoint constants and the 12-phase machine for Battle of Britain NAV
// (Temora 2026). All waypoints derived from briefing math via nav.js so the unit chain
// is auditable; the briefing's scenario wind (360°T / 30 kt) is *historical only* and is
// NOT consumed at runtime — it only justified Yankee's coordinates, which are now fixed
// by direct user identification on Google Earth + recon photo.

import { initialBearingTrue, destination, intersectGC, magToTrue, units } from './nav.js';

// ----- Fixed waypoints -----

// YTEM/YWWL/YYNG/YCTM from canonical sources (AIP / SkyVector / Wikipedia).
// YANKEE from user's own Google Earth ID against the page-10 recon photo:
//   33°49'17.95"S 146°56'03.42"E.
//   Cross-check: 14.6 NM at 298°T from YWWL — matches "Ca 26 km W of YWWL" caption to ±1 km;
//   Spitfire DR (4 min, 295°M, 250 mph TAS, scenario wind 360°/30) puts it ~1.2 NM away,
//   confirming the recon-photo crew's wind-corrected fix.
export const FIXED_WAYPOINTS = {
  YTEM: { id: 'YTEM', name: 'Temora YTEM', short: 'YTEM',
          lat: -34.421670, lon: 147.511670 },
  YWWL: { id: 'YWWL', name: 'West Wyalong YWWL', short: 'YWWL',
          lat: -33.937600, lon: 147.192200 },
  YYNG: { id: 'YYNG', name: 'Young YYNG', short: 'YYNG',
          lat: -34.255700, lon: 148.248000 },
  YCTM: { id: 'YCTM', name: 'Cootamundra YCTM', short: 'YCTM',
          lat: -34.624400, lon: 148.026900 },
  YANKEE: { id: 'YANKEE', name: 'Checkpoint Yankee', short: 'YANKEE',
            lat: -33.821653, lon: 146.934283,
            note: 'User Google Earth ID against recon photo' },
};

// ----- Derived waypoints (parameterised by mag variation) -----

// INSTALL: briefing item 3 — 15 sm from YTEM, ~5 NM starboard of YTEM→Yankee course.
//   smToNM(15) = 13.04 NM total slant; 5 NM perpendicular ⇒ √(13.04² − 5²) ≈ 12.04 NM along course.
//   Cross-check on day: ~2.5 sm east of Goldfields Way.
// INTERSECT: briefing item 9 — intersection of YWWL→YYNG track with the 034°M radial from YTEM.
export function deriveWaypoints(fixed, varE) {
  const { YTEM, YWWL, YYNG, YANKEE } = fixed;

  const ytemYankeeT = initialBearingTrue(YTEM, YANKEE);
  const installTotalNM = units.smToNM(15); // 15 sm
  const installRightNM = 5;                // 5 NM
  const installAlongNM = Math.sqrt(installTotalNM ** 2 - installRightNM ** 2);
  const onTrack = destination(YTEM, ytemYankeeT, installAlongNM);
  const installPos = destination(onTrack, (ytemYankeeT + 90) % 360, installRightNM);
  const INSTALL = {
    id: 'INSTALL', name: 'Mystery installation', short: 'INSTALL',
    lat: installPos.lat, lon: installPos.lon,
    note: `${installAlongNM.toFixed(1)} NM along YTEM→Yankee + ${installRightNM} NM right`,
  };

  const radialT = magToTrue(34, varE);
  const ywwlYyngT = initialBearingTrue(YWWL, YYNG);
  const ix = intersectGC(YTEM, radialT, YWWL, ywwlYyngT);
  const INTERSECT = ix
    ? {
        id: 'INTERSECT', name: '034°M radial × YWWL→YYNG', short: 'INTERSECT',
        lat: ix.lat, lon: ix.lon,
        note: `034°M (${radialT.toFixed(0)}°T) from YTEM × YWWL→YYNG (${ywwlYyngT.toFixed(0)}°T)`,
      }
    : null;

  return { ...fixed, INSTALL, INTERSECT };
}

// ----- 12-phase machine -----
//
// Phase fields:
//   id, n           — identifier and 1-based number for the status row
//   headline, sub   — large text on the in-flight card
//   showCDI         — whether DTK/TRK/drift + XTD strip render
//   from, to        — waypoint ids for the active leg (nav math)
//   targetIAS       — kt
//   secondaryDist   — waypoint id for a secondary "X NM to Y" readout
//   alerts          — [{ id, distFrom (wp id), atNM, headline }]; fired once each
//   quiz            — quiz id ('install' | 'yankee' | 'town')
//   showRecon       — true → Yankee photo button visible
//   showStudyCards  — true → Cootamundra cards open by default
//   showSummary     — true → final review screen
//   flashOnEnter    — true → fire flashAttention() in onEnter
//   advance         — { type: 'manual' | 'distFromBelow' | 'manualOrTimeout', ... }

export const PHASES = [
  {
    id: 'preflight', n: 1,
    headline: 'PRE-FLIGHT',
    sub: 'Confirm setup. Tap NEXT after engine start.',
    showCDI: false,
    advance: { type: 'manual' },
  },
  {
    id: 'to-yankee-1', n: 2,
    headline: 'YTEM → YANKEE',
    sub: 'Big Wing cruise. Watch right at 6 NM from installation.',
    showCDI: true, from: 'YTEM', to: 'YANKEE', targetIAS: 90,
    alerts: [
      { id: 'install-6nm', distFrom: 'INSTALL', atNM: 6,
        headline: 'INSTALLATION 6 NM — LOOK RIGHT' },
    ],
    advance: { type: 'distFromBelow', wp: 'INSTALL', nm: 3 },
  },
  {
    id: 'observe-install', n: 3,
    headline: 'OBSERVE INSTALLATION',
    sub: 'IDENTIFY — DO NOT ORBIT.',
    showCDI: false, targetIAS: 90,
    quiz: 'install', flashOnEnter: true,
    advance: { type: 'manualOrTimeout', timeoutSec: 90 },
  },
  {
    id: 'to-yankee-2', n: 4,
    headline: 'RESUME → YANKEE',
    sub: 'Track back to Yankee.',
    showCDI: true, from: 'INSTALL', to: 'YANKEE', targetIAS: 90,
    alerts: [
      { id: 'yankee-3nm', distFrom: 'YANKEE', atNM: 3,
        headline: 'YANKEE 3 NM — RECON PHOTO READY?' },
    ],
    advance: { type: 'distFromBelow', wp: 'YANKEE', nm: 0.7 },
  },
  {
    id: 'at-yankee', n: 5,
    headline: 'AT YANKEE',
    sub: 'SINGLE LEFT-HAND ORBIT. Identify against photo.',
    showCDI: false, targetIAS: 90,
    quiz: 'yankee', showRecon: true, flashOnEnter: true,
    advance: { type: 'manualOrTimeout', timeoutSec: 180 },
  },
  {
    id: 'to-ywwl', n: 6,
    headline: 'YANKEE → YWWL',
    sub: 'Big Wing disbands at YWWL.',
    showCDI: true, from: 'YANKEE', to: 'YWWL', targetIAS: 90,
    advance: { type: 'distFromBelow', wp: 'YWWL', nm: 0.7 },
  },
  {
    id: 'to-intersect', n: 7,
    headline: 'YWWL → YYNG',
    sub: 'Divert south at the 034°M radial intersection.',
    showCDI: true, from: 'YWWL', to: 'YYNG', targetIAS: 90,
    secondaryDist: 'INTERSECT',
    alerts: [
      { id: 'town-2nm', distFrom: 'INTERSECT', atNM: 2,
        headline: 'TOWN COMING UP — WATCH FOR SILOS' },
    ],
    advance: { type: 'distFromBelow', wp: 'INTERSECT', nm: 0.5 },
  },
  {
    id: 'at-intersect', n: 8,
    headline: 'PASS-OVER TOWN',
    sub: 'Capture observations, then divert south to YCTM.',
    showCDI: false, targetIAS: 90,
    quiz: 'town', flashOnEnter: true,
    advance: { type: 'manualOrTimeout', timeoutSec: 180 },
  },
  {
    id: 'to-yctm', n: 9,
    headline: '→ COOTAMUNDRA',
    sub: 'Track south to YCTM.',
    showCDI: true, from: 'INTERSECT', to: 'YCTM', targetIAS: 90,
    advance: { type: 'distFromBelow', wp: 'YCTM', nm: 0.7 },
  },
  {
    id: 'at-yctm', n: 10,
    headline: 'COOTAMUNDRA',
    sub: 'Review study cards, then track home.',
    showCDI: false, targetIAS: 90,
    showStudyCards: true, flashOnEnter: true,
    advance: { type: 'manual' },
  },
  {
    id: 'to-ytem', n: 11,
    headline: 'YCTM → YTEM',
    sub: 'Return for spot-landing contest.',
    showCDI: true, from: 'YCTM', to: 'YTEM', targetIAS: 90,
    alerts: [
      { id: 'spot-3nm', distFrom: 'YTEM', atNM: 3,
        headline: 'SPOT-LANDING PREP' },
    ],
    advance: { type: 'distFromBelow', wp: 'YTEM', nm: 0.5 },
  },
  {
    id: 'summary', n: 12,
    headline: 'POST-FLIGHT',
    sub: 'Review and copy answers.',
    showCDI: false,
    showSummary: true,
    advance: { type: 'manual' },
  },
];
