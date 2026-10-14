// Keeps the screen on during a match (SPEC §8.7, docs/research/pwa.md §2 "Screen Wake Lock").
//
// A player thinking past the auto-lock time (30 s in Low Power Mode) would otherwise get a
// dark screen mid-match. navigator.wakeLock works in iOS home-screen apps since 18.4 and in
// Safari tabs. Rules that shape this file:
// - The system drops the lock whenever the page is hidden, and a request made while hidden is
//   rejected. So the wish ("keep awake") is remembered separately from the lock, and the lock
//   is asked for again on every return to visible while the wish stands.
// - Unsupported, denied (Low Power Mode on some versions, a permissions policy) or failing:
//   nothing is shown and nothing throws. The game works the same, only the screen may dim.

let wanted = false;
let sentinel = null;
let pending = null;
let listening = false;

function api() {
  try {
    const wl = typeof navigator !== 'undefined' ? navigator.wakeLock : null;
    return wl && typeof wl.request === 'function' ? wl : null;
  } catch {
    return null;
  }
}

function visible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

async function acquire() {
  const wl = api();
  if (!wl || !wanted || !visible() || (sentinel && !sentinel.released)) return;
  if (pending) return;
  try {
    pending = wl.request('screen');
    const lock = await pending;
    if (!wanted) {
      // keepAwake(false) arrived while the request was in flight.
      try { await lock.release(); } catch { /* already gone */ }
      return;
    }
    sentinel = lock;
    try {
      lock.addEventListener('release', () => {
        if (sentinel === lock) sentinel = null;
      });
    } catch { /* an old sentinel without events: `released` is checked instead */ }
  } catch {
    // NotAllowedError (hidden, policy, battery saver) or no support: silently stay without.
  } finally {
    pending = null;
  }
}

function release() {
  const lock = sentinel;
  sentinel = null;
  if (!lock) return;
  try {
    const p = lock.release();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* already released */ }
}

function onVisibility() {
  if (wanted && visible()) acquire();
}

/**
 * keepAwake(true) when a match starts or resumes, keepAwake(false) when it ends or the player
 * leaves it. Safe to call repeatedly, from anywhere, on any browser.
 */
export function keepAwake(on) {
  wanted = !!on;
  try {
    if (!listening && typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      listening = true;
      document.addEventListener('visibilitychange', onVisibility);
      // A page restored from the back/forward cache comes back without its lock.
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('pageshow', onVisibility);
      }
    }
    if (wanted) acquire();
    else release();
  } catch { /* never let the screen lock break the game */ }
}
