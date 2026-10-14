// js/ui/widgets.js — sticker buttons, segmented pickers and switches used across screens.
// Every control gets the iOS haptic tick (js/haptics.js label overlay) and a menu blip.
// Also the input guard shared by screens (router.js), layers (sheet.js) and select steps, and how
// far each fighter's art reaches outside its square (menu duo, select previews).

import { h, esc } from './dom.js';
import { audio } from '../audio.js';
import { attachHaptic } from '../haptics.js';

export function sfx(name, opts) {
  try { audio.play(name, opts); } catch { /* audio is optional */ }
}

export function haptic(el) {
  try { attachHaptic(el); } catch { /* optional */ }
  return el;
}

// ---- input guard (ghost taps) ------------------------------------------------------------
// The second tap of a double tap lands 80–250 ms after the first. It must not act on what the
// first tap just opened (title → menu share, 한 판 붙자 → a setup option, 무르기 → the approval
// dialog, 1P 결정 → 2P's pick …). Windows count from the pointerdown of the tap that opened the
// thing, so a deliberate tap is taken as soon as the window (and the enter animation) is over.
export const TAP_GUARD_MS = 280;
/** Guard window for something no tap opened (a timer did), from its first frame. */
export const QUIET_MS = 250;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
// When a pointer event happened. Its timeStamp is on performance.now()'s clock, and for input that
// queued up behind a slow screen build it is earlier than the dispatch; an epoch-based or odd
// stamp falls back to the dispatch time.
export function eventTime(e) {
  const t = e && e.timeStamp, n = now();
  return typeof t === 'number' && t > 0 && t <= n + 50 && n - t < 5000 ? t : n;
}
let lastDown = -1e9;   // pointerdown of the latest gesture
let lastUp = -1e9;     // its pointerup / click
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const opts = { capture: true, passive: true };
  window.addEventListener('pointerdown', (e) => { lastDown = eventTime(e); }, opts);
  window.addEventListener('pointerup', () => { lastUp = now(); }, opts);
  window.addEventListener('click', () => { lastUp = now(); }, opts);
}
/**
 * The pointerdown time of the tap that is causing what happens now (inside a click / pointerup
 * handler, or a timer one just set, like the title's 60 ms), or null when nothing was just tapped.
 * A keyboard click counts from the click itself.
 */
export function triggeringTap(within = 200) {
  if (!(now() - lastUp < within) || lastDown > lastUp) return null;
  return lastUp - lastDown < 1500 ? lastDown : lastUp;
}
/** ms since the latest pointerdown. */
export const sinceTouch = () => now() - lastDown;

/**
 * Drop every gesture that starts on `el` while it is guarded, in the capture phase at `host` (el
 * or an ancestor, so even listeners on el itself never see it): pointerdown, pointerup and the
 * click, so no action, no sound and no haptic tick (the click is cancelled, so a haptic <label>
 * never forwards it to its switch). Unlike pointer-events:none, the control under the finger still
 * shows its :active press, so an early tap reads as pressed-but-not-yet rather than missed.
 * After end(), only gestures that began before it are dropped, and a gesture that began before
 * `el` existed never acts on it (a finger already down when the screen changed); hold() guards
 * again (select's step changes). Returns { end(), hold(), release(), active }.
 */
export function guardTaps(el, host = el) {
  let endedAt = Infinity;
  const live = new Set();      // pointers that went down on el after the guard
  let eatClickUntil = 0;
  const mine = (e) => host === el || (!!e.target && el.contains(e.target));
  const kill = (e) => { e.stopImmediatePropagation(); };
  const onDown = (e) => {
    if (!mine(e)) return;
    eatClickUntil = 0;
    if (eventTime(e) < endedAt) { live.delete(e.pointerId); kill(e); } else live.add(e.pointerId);
  };
  const onUp = (e) => {
    if (!mine(e) || live.delete(e.pointerId)) return;
    eatClickUntil = now() + 600;   // its click follows
    kill(e);
  };
  const onCancel = (e) => { if (mine(e) && !live.delete(e.pointerId)) kill(e); };
  const onClick = (e) => {
    if (!mine(e)) return;
    if (now() < endedAt || now() < eatClickUntil) {
      eatClickUntil = 0;
      e.preventDefault();
      kill(e);
    }
  };
  const types = [['pointerdown', onDown], ['pointerup', onUp], ['pointercancel', onCancel], ['click', onClick]];
  for (const [t, f] of types) host.addEventListener(t, f, true);
  return {
    end() { if (endedAt === Infinity) endedAt = now(); },
    hold() { endedAt = Infinity; },
    release() { for (const [t, f] of types) host.removeEventListener(t, f, true); },
    get active() { return endedAt === Infinity; },
  };
}

const onFrame = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 0));
/**
 * End guard `g` once performance.now() reaches `t` (then call `then`), on a frame: input that
 * queued up meanwhile (behind a slow screen build) is dispatched, and dropped, first. A hidden tab
 * paints no frames, so it also ends by itself 1 s later. `t` null: QUIET_MS from the next frame.
 * Returns cancel().
 */
export function endGuardAt(g, t, then) {
  let done = false;
  const end = () => { if (!done) { done = true; g.end(); if (then) then(); } };
  const wait = (at) => { if (done) return; const left = at - now(); if (left > 1) setTimeout(() => wait(at), left); else onFrame(end); };
  if (t == null) onFrame(() => wait(now() + QUIET_MS)); else wait(t);
  setTimeout(end, Math.max(0, (t == null ? now() + QUIET_MS : t) - now()) + 1000);
  return () => { done = true; };
}
// ---- how far each fighter's art reaches -----------------------------------------------------
// Horizontal extent [left, right] and top of the visible art, as fractions of the square stage
// side (0 = its left / top edge, 1 = its right / bottom edge), measured over the idle loop and
// the fidgets (opacity ≥ .2, both directions, Chromium and WebKit) plus ≈ .01. The art is never
// mirrored: 까꿍's 청사초롱 always hangs on its right, past the square.
const REACH = {
  bulttong: [0.13, 0.90, 0.06],
  nyangja: [0.13, 0.93, 0.05],
  bigom: [0.19, 0.81, 0.10],
  beonjjeok: [0.19, 0.81, 0.08],
  jaepjaep: [0.19, 0.81, -0.02],
  ppibik: [0.18, 0.82, -0.02],
  kkakkung: [0.17, 1.08, -0.04],
  taenggeul: [0.14, 0.86, 0.02],
};
const REACH_ANY = [0.1, 0.95, -0.05];
/** [left, right, top] of a fighter's art, in stage sides (see REACH). */
export const artReach = (id) => REACH[id] || REACH_ANY;

// Big sticker button. opts: { cls, sub, icon, sound, onClick, disabled, aria }
export function btn(label, opts = {}) {
  const { cls = '', sub = '', icon = '', sound = 'menu', onClick, disabled = false, aria, type = 'button' } = opts;
  const el = h(`button.btn${cls ? '.' + cls.split(' ').filter(Boolean).join('.') : ''}`, { type, 'aria-label': aria || null });
  el.innerHTML =
    (icon ? `<span class="btn__icon" aria-hidden="true">${icon}</span>` : '') +
    `<span class="btn__label">${esc(label)}</span>` +
    (sub ? `<span class="btn__sub">${esc(sub)}</span>` : '');
  if (disabled) el.disabled = true;
  if (onClick) {
    el.addEventListener('click', (e) => {
      if (el.disabled) return;
      if (sound) sfx(sound);
      onClick(e);
    });
  }
  haptic(el);
  return el;
}

// Segmented picker. options: [{value, label, sub?, swatch?, aria?}] → el with .value / onChange.
export function seg(options, value, onChange, { cls = '', cols = 0, name = '' } = {}) {
  const el = h(`div.seg${cls ? '.' + cls : ''}`, { role: 'radiogroup', 'aria-label': name || null });
  if (cols) el.style.setProperty('--cols', cols);
  let cur = value;
  const items = options.map((o) => {
    const b = h('button.seg__opt', { type: 'button', role: 'radio', 'data-value': String(o.value), 'aria-label': o.aria || null });
    b.innerHTML = (o.swatch ? `<span class="seg__sw" style="background:${esc(o.swatch)}"></span>` : '') +
      `<span class="seg__l">${esc(o.label)}</span>` + (o.sub ? `<span class="seg__s">${esc(o.sub)}</span>` : '');
    b.addEventListener('click', () => {
      if (cur === o.value) return;
      cur = o.value;
      sync();
      sfx('cursor');
      onChange(o.value);
    });
    haptic(b);
    el.append(b);
    return [o.value, b];
  });
  function sync() {
    for (const [v, b] of items) {
      const on = v === cur;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }
  sync();
  el.setValue = (v) => { cur = v; sync(); };
  return el;
}

// On/off switch row control.
export function toggle(on, onChange, { label = '' } = {}) {
  const el = h('button.tgl', { type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label || null });
  el.innerHTML = '<span class="tgl__knob"></span>';
  let cur = !!on;
  const sync = () => { el.classList.toggle('is-on', cur); el.setAttribute('aria-checked', cur ? 'true' : 'false'); };
  sync();
  el.addEventListener('click', () => {
    cur = !cur;
    sync();
    sfx(cur ? 'ok' : 'cancel');
    onChange(cur);
  });
  el.setValue = (v) => { cur = !!v; sync(); };
  haptic(el);
  return el;
}

// Small stone glyph (흑/백) as inline HTML.
export const stoneIcon = (color, cls = '') =>
  `<i class="stone ${color === 1 ? 'stone--b' : 'stone--w'} ${cls}" aria-hidden="true"></i>`;

export const ICONS = {
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5 3.5 10 9 15v-3.2c4.6 0 7.6 1.3 9.6 4.9-.6-5.2-3.6-8.4-9.6-8.9V5Z"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 4.5 8 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C6.5 5 2.7 9.4 1.5 12c1.2 2.6 5 7 10.5 7s9.3-4.4 10.5-7C21.3 9.4 17.5 5 12 5Zm0 11.2a4.2 4.2 0 1 1 0-8.4 4.2 4.2 0 0 1 0 8.4Z"/><circle cx="12" cy="12" r="2.1"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.6L12.5 5v14l-4.9-4.5H4z"/><path d="M15.5 8.5c1.6 1.9 1.6 5.1 0 7M18.3 6c3 3.3 3 8.7 0 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.6L12.5 5v14l-4.9-4.5H4z"/><path d="m16 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 7.8 7.7l1.6 1.6 1.5-1.5V15h2.2V7.8l1.5 1.5 1.6-1.6z"/><path d="M5 11h3v2H7v6h10v-6h-1v-2h3v10H5z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.4A5 5 0 0 1 13 14.8V17h3v3H8v-3h3v-2.2A5 5 0 0 1 8.4 12H8a4 4 0 0 1-4-4V5h3zm0 4H6v1a2 2 0 0 0 1 1.7zm10 0v2.7A2 2 0 0 0 18 8V7z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 2h3.4l.5 2.7 1.9.8 2.3-1.6 2.4 2.4-1.6 2.3.8 1.9 2.7.5v3.4l-2.7.5-.8 1.9 1.6 2.3-2.4 2.4-2.3-1.6-1.9.8-.5 2.7h-3.4l-.5-2.7-1.9-.8-2.3 1.6-2.4-2.4 1.6-2.3-.8-1.9L2 13.7v-3.4l2.7-.5.8-1.9-1.6-2.3 2.4-2.4 2.3 1.6 1.9-.8zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>',
  cpu: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="7" width="14" height="12" rx="3"/><circle cx="12" cy="3.8" r="1.8"/><path d="M11.2 5h1.6v2.5h-1.6z"/><circle cx="9.3" cy="12.4" r="1.6" fill="#FFF4DE"/><circle cx="14.7" cy="12.4" r="1.6" fill="#FFF4DE"/><path d="M9.5 16h5" stroke="#FFF4DE" stroke-width="1.6" stroke-linecap="round"/></svg>',
  duo: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3.4"/><circle cx="16.5" cy="8.8" r="2.9"/><path d="M2 19.5c.4-4 2.8-6 6-6s5.6 2 6 6zM14.6 13.7c.6-.2 1.2-.3 1.9-.3 2.8 0 4.9 1.8 5.3 5.6h-6.1c-.1-2-.5-3.8-1.1-5.3z"/></svg>',
};
