// Key-click haptics (SPEC section 8). Progressive enhancement only: the game must feel
// complete with the visual press and the beep alone.
//
// iOS has no vibration API. The one thing that still ticks is the system haptic of
// <input type="checkbox" switch>, and since iOS 26.5 only for a trusted tap: a real finger
// landing on a <label> that wraps the switch. A scripted .click() is forwarded as untrusted
// and stays silent, so nothing in this file ever calls it. Consequences the rest of the app
// must live with: one tick per tap, at finger-up, and never for timers or events.

const g = globalThis;

let enabled = true;
// Weak on purpose: screens are rebuilt on every navigation, and a strong registry of hosts or
// labels would keep every detached screen (and everything its closures hold) alive forever.
// setHapticsEnabled finds the live labels through the document instead.
const hosts = new WeakSet();
const LABEL_SELECTOR = 'label[data-haptic-trigger]';
const PIN_TAG = 'haptic-pin';

// <input type="checkbox" switch> arrived in Safari 17.4. Before that the hidden control is a
// plain checkbox that never ticks, so iOS 16 – 17.3 gets no overlay at all (and the 진동 setting
// is hidden: hapticsKind() says 'none'). Read on demand rather than once at import: it is one
// property lookup, and the tests swap the globals.
function hasSwitch() {
  const I = g.HTMLInputElement;
  return typeof I === 'function' && !!I.prototype && 'switch' in I.prototype;
}

function isIOS() {
  const n = g.navigator;
  if (!n) return false;
  // iPadOS reports itself as a Mac; the touch points give it away.
  return /iPad|iPhone|iPod/.test(n.userAgent || '') ||
    (n.platform === 'MacIntel' && n.maxTouchPoints > 1);
}

// The label is position:absolute; inset:0, so the host has to be its containing block. If it is
// not, the label takes the box of the nearest positioned ancestor — a whole screen or sheet —
// and, being last in the DOM, swallows every tap on it (설정 stuck, setup options dead).
// The host's computed position can only be read once it is in the document: WebKit answers ''
// for a detached element, and every control is built detached (js/ui/widgets.js). So the check
// runs on connection, and anything not positioned by its own CSS ('static', or '' if an engine
// still has nothing to say) is pinned to position:relative. Hosts placed by their CSS
// (relative / absolute / fixed / sticky) are left alone.
const microtask = (fn) => (typeof g.queueMicrotask === 'function' ? g.queueMicrotask(fn) : Promise.resolve().then(fn));
let pending = [];
function pinHosts() {
  const list = pending;
  pending = [];
  // All reads first, then all writes: one style pass for a whole screen of controls.
  const todo = [];
  for (const [el, view] of list) {
    if (!el.isConnected) continue;
    try {
      const pos = view.getComputedStyle(el).position;
      if (!pos || pos === 'static') todo.push(el);
    } catch { /* not an element of that window */ }
  }
  for (const el of todo) el.style.position = 'relative';
}
function queuePin(el, view) {
  if (typeof view.getComputedStyle !== 'function') return;
  // Batched to a microtask: before the next paint and before any tap can land, and the list
  // is emptied every time, so a host is never held after that.
  if (!pending.length) microtask(pinHosts);
  pending.push([el, view]);
}

// The connection signal: a tiny custom element inside the label. Its connectedCallback runs on
// every insertion of the host's tree into the document (and again when the observer below
// re-appends the label), at the exact moment the computed position becomes meaningful. It has
// no box, holds nothing, and is not a labelable control, so the label still forwards to the switch.
function pinMarker(doc, view) {
  try {
    const reg = view.customElements;
    const HE = view.HTMLElement;
    if (!reg || typeof reg.define !== 'function' || typeof HE !== 'function') return null;
    if (!reg.get(PIN_TAG)) {
      reg.define(PIN_TAG, class HapticPin extends HE {
        connectedCallback() {
          const label = this.parentNode;
          const host = label && label.parentNode;
          if (host && host.nodeType === 1) queuePin(host, (this.ownerDocument && this.ownerDocument.defaultView) || view);
        }
      });
    }
    const m = doc.createElement(PIN_TAG);
    m.hidden = true;
    m.style.display = 'none';
    return m;
  } catch {
    return null;
  }
}
// Without custom elements: try again right after the current task (the screen is usually
// attached by the same code that built it), then for a few frames.
function pinLater(el, view) {
  const raf = typeof view.requestAnimationFrame === 'function' ? view.requestAnimationFrame.bind(view) : null;
  let tries = 0;
  const check = () => {
    if (el.isConnected) { queuePin(el, view); return; }
    if (raf && ++tries <= 30) raf(check);
  };
  microtask(check);
}

function attachSwitch(el, doc) {
  const label = doc.createElement('label');
  label.setAttribute('data-haptic-trigger', '');
  label.setAttribute('aria-hidden', 'true');
  const ls = label.style;
  ls.position = 'absolute';
  ls.inset = '0';
  ls.display = 'block';
  ls.margin = '0';
  ls.touchAction = 'manipulation';
  // A square label over a round key would make the corners tappable.
  ls.borderRadius = 'inherit';
  ls.setProperty('-webkit-tap-highlight-color', 'transparent');
  if (!enabled) ls.pointerEvents = 'none';

  // The switch itself must stay out from under the finger (WebKit treats a touch on it as
  // handled) and must keep its native appearance: no appearance reset, no display:none.
  // visibility:hidden keeps it alive for the label and out of hit-testing and tab order.
  const sw = doc.createElement('input');
  sw.type = 'checkbox';
  sw.setAttribute('switch', '');
  sw.tabIndex = -1;
  const ss = sw.style;
  ss.position = 'absolute';
  ss.width = '1px';
  ss.height = '1px';
  ss.margin = '0';
  ss.visibility = 'hidden';
  // The label's click is forwarded to the switch as a second click event. Stop that one
  // here so the host sees exactly one click per tap (the label's own, which bubbles).
  sw.addEventListener('click', (e) => e.stopPropagation());
  label.appendChild(sw);

  const view = doc.defaultView || g;
  // Pin the host once it is in the document (see pinHosts): the marker reports every
  // connection, including this append when the host is already in the page.
  const marker = pinMarker(doc, view);
  if (marker) label.appendChild(marker);
  el.appendChild(label);
  if (!marker) {
    if (el.isConnected) queuePin(el, view);
    else pinLater(el, view);
  }

  // If the host's content is rewritten (textContent / innerHTML), the overlay goes with it.
  // Put it back, last, so it stays on top.
  const MO = view.MutationObserver || g.MutationObserver;
  if (typeof MO === 'function') {
    new MO(() => { if (label.parentNode !== el) el.appendChild(label); })
      .observe(el, { childList: true });
  }
}

/**
 * Give a tappable element a haptic tick. Safe to call more than once and on any platform.
 * The host keeps its own pointer / click handlers; they still fire once per tap.
 */
export function attachHaptic(el) {
  if (!el || hosts.has(el)) return;
  const doc = el.ownerDocument || g.document;
  if (!doc || typeof doc.createElement !== 'function') return;
  hosts.add(el);
  try {
    if (isIOS()) {
      if (hasSwitch()) attachSwitch(el, doc);
      return;
    }
    const n = g.navigator;
    if (n && typeof n.vibrate === 'function' && typeof el.addEventListener === 'function') {
      // Android. Chrome ignores vibrate() until the page has had one full tap; that first
      // silent press is acceptable.
      el.addEventListener('pointerdown', (e) => {
        if (!enabled || e.isPrimary === false) return;
        // Before the first full tap the call is refused anyway, and Chrome logs a warning
        // for every attempt; ask first where the browser can tell us.
        const ua = n.userActivation;
        if (ua && ua.hasBeenActive === false) return;
        try { n.vibrate(8); } catch { /* blocked */ }
      }, { passive: true });
    }
  } catch { /* haptics are optional */ }
}

export function setHapticsEnabled(on) {
  enabled = !!on;
  // With the label out of hit-testing the finger lands on the host directly: same handlers,
  // no switch toggle, no tick. '' rather than 'auto' so a host that disables its own
  // pointer events is not overridden.
  // Only labels in the document can be tapped, so only those need the switch; one created
  // later reads `enabled` when attachSwitch builds it. Nothing here holds a label.
  const doc = g.document;
  if (!doc || typeof doc.querySelectorAll !== 'function') return;
  try {
    for (const label of doc.querySelectorAll(LABEL_SELECTOR)) label.style.pointerEvents = enabled ? '' : 'none';
  } catch { /* haptics are optional */ }
}

/**
 * 'switch' (iOS 17.4+ label overlay) | 'vibrate' (Android) | 'none' (nothing can tick here,
 * e.g. iOS before 17.4) — for the 진동 setting (hidden on 'none') or a self-check.
 */
export function hapticsKind() {
  if (isIOS()) return hasSwitch() ? 'switch' : 'none';
  const n = g.navigator;
  return n && typeof n.vibrate === 'function' ? 'vibrate' : 'none';
}
