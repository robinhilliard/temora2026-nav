// flash.js — full-screen amber flash + vibrate to grab attention from the right
// side of the panel. One flash per event; deduplication is the caller's job.

let flashEl = null;

function ensureEl() {
  if (!flashEl) flashEl = document.getElementById('flash');
  return flashEl;
}

export function flashAttention() {
  const el = ensureEl();
  if (el) {
    el.classList.add('active');
    setTimeout(() => el.classList.remove('active'), 300);
  }
  if ('vibrate' in navigator) {
    try { navigator.vibrate(400); } catch (_) {}
  }
}
