// geo.js — geolocation watcher with smoothing for ground speed and track.
// iPad Cellular models include real GNSS so high-accuracy mode gives true GPS positions.

import { units, normalize360, haversineNM } from './nav.js';

const WINDOW = 5; // rolling-fix smoothing window

class GeoWatcher extends EventTarget {
  constructor() {
    super();
    this.fixes = [];
    this.last = null;
    this.watchId = null;
    this.permission = 'prompt';
    this.error = null;
  }

  start() {
    if (this.watchId !== null) return;
    if (!('geolocation' in navigator)) {
      this.error = { code: -1, message: 'Geolocation not supported' };
      this.dispatchEvent(new CustomEvent('error', { detail: this.error }));
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._onFix(pos),
      (err) => this._onError(err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 8000 }
    );
  }

  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  _onFix(pos) {
    this.error = null;
    const c = pos.coords;
    const fix = {
      t: pos.timestamp,
      lat: c.latitude,
      lon: c.longitude,
      acc: c.accuracy,                                // m
      altM: c.altitude,                               // m or null
      gsKtRaw: c.speed != null ? units.mpsToKt(c.speed) : null,
      trkTrueRaw: c.heading,                          // °T or null/NaN
    };
    this.fixes.push(fix);
    if (this.fixes.length > WINDOW) this.fixes.shift();
    this.last = this._derive();
    this.dispatchEvent(new CustomEvent('fix', { detail: this.last }));
  }

  _onError(err) {
    this.error = { code: err.code, message: err.message };
    this.dispatchEvent(new CustomEvent('error', { detail: this.error }));
  }

  // Smooth GS and track from the rolling window. Fall back to consecutive-fix
  // derivation when the API doesn't supply speed/heading (depends on hardware).
  _derive() {
    const fixes = this.fixes;
    const newest = fixes[fixes.length - 1];
    if (!newest) return null;

    let gsKt = newest.gsKtRaw;
    let trkTrue = newest.trkTrueRaw;

    if (fixes.length >= 2) {
      // Derive bearing/GS from each consecutive pair, then average.
      const samples = [];
      for (let i = 1; i < fixes.length; i++) {
        const a = fixes[i - 1], b = fixes[i];
        const dt = (b.t - a.t) / 1000;
        if (dt <= 0) continue;
        const distNM = haversineNM(a, b);
        if (distNM < 0.005) continue; // less than ~9 m, too noisy for bearing
        const sgs = (distNM / dt) * 3600; // NM/hr = kt
        const sbrg = bearingDeg(a, b);
        samples.push({ gs: sgs, brg: sbrg });
      }
      if (samples.length) {
        gsKt = mean(samples.map((s) => s.gs));
        trkTrue = circularMean(samples.map((s) => s.brg));
      }
    }

    return {
      t: newest.t,
      lat: newest.lat,
      lon: newest.lon,
      acc: newest.acc,
      altM: newest.altM,
      gsKt: gsKt != null && Number.isFinite(gsKt) ? gsKt : 0,
      trkTrue: trkTrue != null && Number.isFinite(trkTrue) ? normalize360(trkTrue) : null,
    };
  }

  qualityDots() {
    if (!this.last) return 0;
    const a = this.last.acc;
    if (a == null) return 0;
    if (a <= 10) return 4;
    if (a <= 25) return 3;
    if (a <= 50) return 2;
    if (a <= 100) return 1;
    return 0;
  }
}

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function circularMean(degs) {
  let sx = 0, sy = 0;
  for (const d of degs) {
    sx += Math.cos((d * Math.PI) / 180);
    sy += Math.sin((d * Math.PI) / 180);
  }
  return normalize360((Math.atan2(sy / degs.length, sx / degs.length) * 180) / Math.PI);
}

function bearingDeg(a, b) {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const dλ = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return normalize360((Math.atan2(y, x) * 180) / Math.PI);
}

export const geo = new GeoWatcher();
