// js/ui/dom.js — tiny DOM, timing and randomness helpers shared by every screen.
// No framework: screens build their markup with h() / html strings and own their listeners.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

// h('div.cls.cls2', {attrs}, ...children) — children may be strings, nodes, arrays or null.
export function h(tag, attrs, ...kids) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('--')) el.style.setProperty(k, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export function frag(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Restart a CSS animation on an element by toggling a class.
export function replay(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// ---- cancellable timers -------------------------------------------------------------------
// A Timers bag belongs to one screen; destroy() cancels everything it started, so a screen that
// is left half-way through a sequence never fires into a dead DOM.
export function createTimers() {
  const ids = new Set();
  const rafs = new Set();
  let dead = false;
  return {
    set(fn, ms) {
      if (dead) return 0;
      const id = setTimeout(() => { ids.delete(id); if (!dead) fn(); }, Math.max(0, ms));
      ids.add(id);
      return id;
    },
    clear(id) { if (id) { clearTimeout(id); ids.delete(id); } },
    wait(ms) { return new Promise((res) => { this.set(res, ms); }); },
    raf(fn) {
      if (dead) return 0;
      const id = requestAnimationFrame((t) => { rafs.delete(id); if (!dead) fn(t); });
      rafs.add(id);
      return id;
    },
    cancelRaf(id) { if (id) { cancelAnimationFrame(id); rafs.delete(id); } },
    clearAll() {
      for (const id of ids) clearTimeout(id);
      for (const id of rafs) cancelAnimationFrame(id);
      ids.clear(); rafs.clear();
    },
    destroy() { dead = true; this.clearAll(); },
    get dead() { return dead; },
  };
}

// ---- seeded randomness (debug shots and deterministic tests) -----------------------------------
export function seeded(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// Promise that resolves on the next animation frame (or after 50 ms when frames are throttled).
export function nextFrame() {
  return new Promise((res) => {
    let done = false;
    const fin = () => { if (!done) { done = true; res(); } };
    requestAnimationFrame(fin);
    setTimeout(fin, 50);
  });
}

export const reducedMotion = () => document.documentElement.dataset.motion === 'reduce';

// Korean particle helper: 이/가, 을/를, 은/는 after a name.
export function josa(word, pair) {
  const s = String(word || '');
  const code = s.charCodeAt(s.length - 1);
  const has = code >= 0xAC00 && code <= 0xD7A3 && (code - 0xAC00) % 28 !== 0;
  const [withB, withoutB] = pair.split('/');
  return s + (has ? withB : withoutB);
}

// ---- timelines -----------------------------------------------------------------------------
// seq.at(ms, fn) … seq.run(): every step fires once, at its time or when skipTo() passes it.
// Used for the K.O. / VS / round sequences so a tap-to-skip (or a debug shot) can jump ahead and
// still leave the screen in exactly the state the full timeline would have.
export function createSeq(timers) {
  const steps = [];
  let t0 = 0;
  let running = false;
  const fire = (s) => { if (s.done) return; s.done = true; s.fn(); };
  return {
    at(ms, fn) { steps.push({ ms: Math.max(0, Math.round(ms)), fn, done: false }); return this; },
    run() {
      running = true;
      t0 = performance.now();
      steps.sort((a, b) => a.ms - b.ms);
      for (const s of steps) {
        if (s.ms === 0) fire(s);
        else timers.set(() => fire(s), s.ms);
      }
      return this;
    },
    skipTo(ms) {
      steps.sort((a, b) => a.ms - b.ms);
      for (const s of steps) if (s.ms <= ms) fire(s);
    },
    elapsed() { return running ? performance.now() - t0 : 0; },
    get done() { return steps.every((s) => s.done); },
  };
}
