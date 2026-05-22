// nav.js — units, geo math, magnetic conversion.
// All exported functions are pure. Canonical units: NM, kt, °T (math) / °M (display).

// ----- Units -----

export const units = {
  mphToKt: (mph) => mph * 0.8689762,
  ktToMph: (kt) => kt / 0.8689762,
  smToNM: (sm) => sm * 0.8689762,
  nmToSm: (nm) => nm / 0.8689762,
  kmToNM: (km) => km / 1.852,
  nmToKm: (nm) => nm * 1.852,
  mpsToKt: (mps) => mps * 1.9438445,
  ktToMps: (kt) => kt / 1.9438445,
  ftToM: (ft) => ft * 0.3048,
  mToFt: (m) => m / 0.3048,
};

// ----- Angle helpers -----

const deg2rad = (d) => (d * Math.PI) / 180;
const rad2deg = (r) => (r * 180) / Math.PI;

// Normalize angle to [0, 360).
export const normalize360 = (d) => ((d % 360) + 360) % 360;

// Normalize angle difference to (-180, +180].
export const normalize180 = (d) => {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  return x === -180 ? 180 : x;
};

// Magnetic ↔ True. varE positive = east variation (M = T - varE).
export const trueToMag = (trueDeg, varE) => normalize360(trueDeg - varE);
export const magToTrue = (magDeg, varE) => normalize360(magDeg + varE);

// ----- Great-circle math (WGS84-equivalent, treated as sphere) -----

const R_NM = 3440.065; // mean Earth radius in NM

// Great-circle distance in NM between two {lat, lon} points (degrees).
export function haversineNM(a, b) {
  const φ1 = deg2rad(a.lat), φ2 = deg2rad(b.lat);
  const dφ = deg2rad(b.lat - a.lat);
  const dλ = deg2rad(b.lon - a.lon);
  const s = Math.sin(dφ / 2) ** 2 +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return R_NM * c;
}

// Initial true bearing (°T) from a → b along the great circle.
export function initialBearingTrue(a, b) {
  const φ1 = deg2rad(a.lat), φ2 = deg2rad(b.lat);
  const dλ = deg2rad(b.lon - a.lon);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return normalize360(rad2deg(Math.atan2(y, x)));
}

// Signed cross-track distance in NM from point p to the great circle a→b.
// Positive = right of track, negative = left of track.
export function crossTrackNM(p, a, b) {
  const δ13 = haversineNM(a, p) / R_NM; // angular dist a→p
  const θ13 = deg2rad(initialBearingTrue(a, p));
  const θ12 = deg2rad(initialBearingTrue(a, b));
  const xt = Math.asin(Math.sin(δ13) * Math.sin(θ13 - θ12));
  return xt * R_NM;
}

// Along-track distance from a toward b at point p (NM, can be > leg length once past b).
export function alongTrackNM(p, a, b) {
  const δ13 = haversineNM(a, p) / R_NM;
  const xtRad = crossTrackNM(p, a, b) / R_NM;
  return Math.acos(Math.cos(δ13) / Math.cos(xtRad)) * R_NM;
}

// Destination point given start, true bearing (°T), and distance (NM).
export function destination(start, bearingT, distNM) {
  const φ1 = deg2rad(start.lat), λ1 = deg2rad(start.lon);
  const θ = deg2rad(bearingT);
  const δ = distNM / R_NM;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) +
                       Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
                             Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: rad2deg(φ2), lon: rad2deg(((λ2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) };
}

// Intersection of two great-circle paths defined by point + true bearing.
// Returns the nearer of the two solutions, or null if undefined (parallel/coincident).
export function intersectGC(a, brgA, b, brgB) {
  const φ1 = deg2rad(a.lat), λ1 = deg2rad(a.lon);
  const φ2 = deg2rad(b.lat), λ2 = deg2rad(b.lon);
  const θ13 = deg2rad(brgA), θ23 = deg2rad(brgB);

  const dφ = φ2 - φ1, dλ = λ2 - λ1;
  const δ12 = 2 * Math.asin(Math.sqrt(Math.sin(dφ / 2) ** 2 +
                Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2));
  if (Math.abs(δ12) < 1e-12) return { lat: a.lat, lon: a.lon };

  let θa = Math.acos((Math.sin(φ2) - Math.sin(φ1) * Math.cos(δ12)) /
                     (Math.sin(δ12) * Math.cos(φ1)));
  if (Number.isNaN(θa)) θa = 0;
  const θb = Math.acos((Math.sin(φ1) - Math.sin(φ2) * Math.cos(δ12)) /
                       (Math.sin(δ12) * Math.cos(φ2)));

  const θ12 = Math.sin(λ2 - λ1) > 0 ? θa : 2 * Math.PI - θa;
  const θ21 = Math.sin(λ2 - λ1) > 0 ? 2 * Math.PI - θb : θb;

  const α1 = θ13 - θ12;
  const α2 = θ21 - θ23;

  if (Math.sin(α1) === 0 && Math.sin(α2) === 0) return null;
  if (Math.sin(α1) * Math.sin(α2) < 0) return null;

  const α3 = Math.acos(-Math.cos(α1) * Math.cos(α2) +
                       Math.sin(α1) * Math.sin(α2) * Math.cos(δ12));
  const δ13 = Math.atan2(Math.sin(δ12) * Math.sin(α1) * Math.sin(α2),
                         Math.cos(α2) + Math.cos(α1) * Math.cos(α3));
  const φ3 = Math.asin(Math.sin(φ1) * Math.cos(δ13) +
                       Math.cos(φ1) * Math.sin(δ13) * Math.cos(θ13));
  const dλ13 = Math.atan2(Math.sin(θ13) * Math.sin(δ13) * Math.cos(φ1),
                          Math.cos(δ13) - Math.sin(φ1) * Math.sin(φ3));
  const λ3 = λ1 + dλ13;
  return {
    lat: rad2deg(φ3),
    lon: rad2deg(((λ3 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI),
  };
}

// Track error: signed degrees in (-180, +180]. Positive = need to turn right.
export function trackError(desiredT, actualT) {
  return normalize180(desiredT - actualT);
}

// ----- Wind triangle -----

// Given true course, TAS, wind direction (°T from), wind speed (kt) — compute heading + GS.
// Returns { headingT, groundSpeedKt } or null if wind exceeds TAS (no solution).
export function windTriangle(courseT, tasKt, windFromT, windKt) {
  if (windKt >= tasKt) return null;
  // Wind angle: angle between wind-from and course.
  const wca = deg2rad(windFromT - courseT);
  const sinWCA = Math.sin(wca);
  // sin(wind_correction_angle) = (windSpeed/TAS) * sin(wind_relative_to_course)
  const corrSin = (windKt / tasKt) * sinWCA;
  if (Math.abs(corrSin) > 1) return null;
  const corrAngle = Math.asin(corrSin);
  const headingT = normalize360(courseT + rad2deg(corrAngle));
  // Ground speed via law of cosines.
  const groundSpeedKt = tasKt * Math.cos(corrAngle) - windKt * Math.cos(wca);
  return { headingT, groundSpeedKt };
}
