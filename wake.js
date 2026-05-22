// wake.js — keep the iPad screen on while the app is foreground.
// Uses the Wake Lock API (iOS Safari ≥ 16.4). Re-acquires on tab visibility change.

let lock = null;
let acquired = false;

async function acquire() {
  try {
    if ('wakeLock' in navigator) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { acquired = false; });
      acquired = true;
    }
  } catch (e) {
    acquired = false;
  }
}

export function startWakeLock() {
  acquire();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !acquired) acquire();
  });
}

export function isAwake() { return acquired; }
