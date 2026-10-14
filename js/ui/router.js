// js/ui/router.js — one screen at a time inside #app.
// A screen module exports create(params) → { el, mount?(), destroy(), onHide?(), onShow?(),
// onLandscape?(on), quiet?() } . quiet() === true means a reload into an update would cost nothing.

import { closeAll } from './sheet.js';
import { clearToasts } from './toast.js';
import { guardTaps, endGuardAt, triggeringTap, sinceTouch, TAP_GUARD_MS } from './widgets.js';

const registry = new Map();
let current = null;
let currentName = '';
let seq = 0;

// Ghost-tap guard: the second tap of a double tap (80–250 ms after the first) must not land on the
// screen the first tap just opened (title → menu share, 결과 캐릭터 변경 → select 뒤로 …). While
// the incoming screen is .is-guarded it drops every gesture that starts on it (widgets.js
// guardTaps: swallowed in the capture phase, so the control still shows its press but does
// nothing, makes no sound and no haptic tick). The window runs TAP_GUARD_MS from the pointerdown of
// the tap that opened the screen, so a deliberate tap is taken right after it; a screen a timer
// opened (VS → battle, K.O. → result) is guarded QUIET_MS (widgets.js) from its first frame. The
// first screen (and any transition:'none' jump) is guarded only after a recent touch (the install
// gate's 설치 없이 해보기).
let screenGuard = null;
export function guardInput(el, { from = null, ms = TAP_GUARD_MS } = {}) {
  if (!el) return null;
  el.classList.add('is-guarded');
  // Listening on the parent puts the guard ahead of the screen's own listeners on its root
  // element (title's tap, VS's skip), whatever an engine's order for listeners at the target.
  const host = el.parentNode && el.parentNode.nodeType === 1 ? el.parentNode : el;
  const g = guardTaps(el, host);
  endGuardAt(g, from != null ? from + ms : null, () => el.classList.remove('is-guarded'));
  return g;
}

export function register(name, create) { registry.set(name, create); }
export const currentScreen = () => current;
export const screenName = () => currentName;

export function go(name, params = {}, { transition = 'fade' } = {}) {
  const create = registry.get(name);
  if (!create) throw new Error(`unknown screen ${name}`);
  const root = document.getElementById('app');
  const old = current;
  const oldName = currentName;
  const my = ++seq;
  // The tap that asked for this change (read before anything below can take time).
  const tap = triggeringTap();
  closeAll();
  if (name !== oldName) clearToasts();
  if (screenGuard) { screenGuard.release(); screenGuard = null; }
  const scr = create(params);
  current = scr;
  currentName = name;
  scr.el.classList.add('scr', `scr--${name}`);
  root.dataset.screen = name;
  if (old) {
    const oel = old.el;
    try { old.destroy(); } catch (err) { console.error(err); }
    oel.classList.add('scr--out');
    oel.setAttribute('aria-hidden', 'true');
    const kill = () => oel.remove();
    if (transition === 'none' || document.documentElement.dataset.motion === 'reduce') kill();
    else setTimeout(kill, transition === 'wipe' ? 320 : 180);
  }
  if (transition !== 'none') scr.el.classList.add(`scr--in-${transition}`);
  // Every user-driven change fades or wipes. transition 'none' is boot / debug shots / test hooks:
  // guarded only right after a touch.
  const guard = (!!old && transition !== 'none') || tap != null || sinceTouch() < 600;
  root.append(scr.el);
  if (guard) screenGuard = guardInput(scr.el, { from: tap });
  if (typeof scr.mount === 'function') scr.mount();
  if (transition !== 'none') setTimeout(() => { if (seq === my) scr.el.classList.remove(`scr--in-${transition}`); }, 400);
  return scr;
}

export function call(method, ...args) {
  if (current && typeof current[method] === 'function') {
    try { return current[method](...args); } catch (err) { console.error(err); }
  }
  return undefined;
}
