// js/board.js — the 15×15 board: three stacked canvases, a loupe, and the touch input.
// Contract: docs/SPEC.md §4.1 / §8.3; behaviour and numbers: docs/research/ux.md §1.2–§1.3, §3.
//
//   host
//    └─ div.omok-board (el)          square, touch-action:none; pointer listeners live here
//        └─ div.omok-board__layer    rounded frame + drop shadow; this is what shakes
//            ├─ canvas  board        static: theme art, grid, star points (theme/size change only)
//            ├─ canvas  stones       one sprite stamp per stone (redrawn whole only on remove/reset)
//            ├─ canvas  fx           preview, aim, last-move dot, rings, win line, X marks
//            └─ div     glow         2 pt inner glow in the current player's colour (CSS)
//   body
//    └─ canvas.omok-loupe            fixed, so it can float over the HUD without being clipped
//
// Rules of the house:
//   - DPR = min(devicePixelRatio, 3). Cell and margin are whole device pixels, so grid lines
//     and stone sprites land on the pixel grid and stay sharp.
//   - Nothing per frame uses shadowBlur, filters or gradients: stones are pre-rendered sprites
//     (one per colour per theme/size), glows are built into the sprites or layered strokes.
//   - Every animation is time-based (performance.now), so it finishes on time at 30 fps Low
//     Power Mode and at 120 Hz, and the fx canvas only clears the rectangles that animate.
//   - The board knows nothing about rules: opts.canPlace decides, opts.onCommit reports.
//
// The pure helpers at the top (geometry, pointToIdx, hysteresis, decideRelease, createInput,
// loupePlacement, winSegments, cubicBezier) are exported for tests/board.test.js.

import { N, BLACK, WHITE } from './rules.js';
import { getTheme, drawStone, pixelUnit, hexToRgb, roundRectPath } from './themes.js';

export { THEMES, THEME_IDS } from './themes.js';

// ---- numbers from the spec ---------------------------------------------------------------------

export const SPAN = 15.2;          // board side in cells: 14 gaps + 0.6 margin each side
export const MARGIN = 0.6;
export const STONE_R = 0.46;       // stone radius, cells
export const MAX_SIDE = 560;       // CSS px
export const HYSTERESIS = 0.6;     // cells the finger must leave the target by before it moves
export const STICKY = 0.75;        // cells: a non-drag release this close to the armed point commits
export const DRAG_PT = 8;          // CSS px of travel that turns a press into a drag
export const LOUPE_DELAY = 150;    // ms of holding still before the loupe shows anyway
export const CURSOR_GAP = 40;      // ms between cursor ticks while dragging
export const COMMIT_LOCK = 250;    // ms of ignored input after a commit (shared-phone 2P)
export const OFF_BOARD = 0.5;      // cells beyond the board edge where a drag stops aiming
export const LOUPE = Object.freeze({ size: 112, zoom: 2.2, lift: 96, border: 3, margin: 6 });

const DROP_MS = 110, IMPACT_MS = 220, LAST_RING_MS = 1200, DUST_MS = 180, REMOVE_MS = 160;
const WIN_LINE_MS = 280, WIN_STAGGER = 60, WIN_PULSE_MS = 180, X_MS = 700, SHAKE_MS = 180;
const ARM_PULSE_MS = 1200, ARM_PULSES = 2, PIXEL_BLINK_MS = 160;
const GHOST_ALPHA = 0.45;
const RED = '#FF3B30';
const INK = 'rgba(24,14,28,.55)';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

// ---- geometry ------------------------------------------------------------------------------------

// Board of `size` CSS px at `dpr`. Cell and margin are snapped to whole device pixels (the cell
// is floored, the leftover goes to the margin, so the margin is never under 0.6 cell).
export function geometry(size, dpr = 1) {
  const d = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const dev = Math.max(0, Math.floor((Number(size) || 0) * d + 1e-6));
  let cellDev = Math.floor(dev / SPAN);
  // flooring the margin can cost half a device pixel; give up one pixel of cell instead
  while (cellDev > 0 && Math.floor((dev - (N - 1) * cellDev) / 2) < MARGIN * cellDev) cellDev--;
  const padDev = Math.max(0, Math.floor((dev - (N - 1) * cellDev) / 2));
  const cell = cellDev / d;
  return { size: dev / d, dpr: d, dev, cellDev, padDev, cell, pad: padDev / d, r: cell * STONE_R };
}

export function cellCenter(idx, g) {
  return [g.pad + (idx % N) * g.cell, g.pad + ((idx / N) | 0) * g.cell];
}

// Nearest intersection to a point in board CSS px. Anywhere on the board (margin included)
// snaps to the closest point; more than OFF_BOARD cells outside the board square gives -1.
export function pointToIdx(px, py, g) {
  if (!(g && g.cell > 0)) return -1;
  const out = OFF_BOARD * g.cell;
  if (!(px >= -out && py >= -out && px <= g.size + out && py <= g.size + out)) return -1;
  const x = clamp(Math.round((px - g.pad) / g.cell), 0, N - 1);
  const y = clamp(Math.round((py - g.pad) / g.cell), 0, N - 1);
  return y * N + x;
}

// Snapping with hysteresis, one axis at a time: the column changes only when the finger is
// more than `band` cells from the current column's line, the row likewise. Per-axis keeps the
// dead band the same width along diagonals (a round radius would shrink it to ~0 there).
export function hysteresis(cur, px, py, g, band = HYSTERESIS) {
  const near = pointToIdx(px, py, g);
  if (near < 0 || cur < 0) return near;
  const fx = (px - g.pad) / g.cell, fy = (py - g.pad) / g.cell;
  let x = cur % N, y = (cur / N) | 0;
  if (Math.abs(fx - x) > band) x = clamp(Math.round(fx), 0, N - 1);
  if (Math.abs(fy - y) > band) y = clamp(Math.round(fy), 0, N - 1);
  return y * N + x;
}

export function withinSticky(idx, px, py, g, radius = STICKY) {
  if (idx < 0 || !(g && g.cell > 0)) return false;
  const [cx, cy] = cellCenter(idx, g);
  return Math.hypot(px - cx, py - cy) <= radius * g.cell;
}

// What a finger lifting off means (ux.md §1.2 step 3). canPlace(idx) → {ok} | {ok:false, reason}.
// → { action: 'commit'|'arm'|'occupied'|'forbidden'|'deny'|'cancel', idx, reason? }
export function decideRelease({ mode = 'double', dragging, prevArmed, target, x, y, geom, canPlace }) {
  const check = (i) => {
    const v = canPlace ? canPlace(i) : { ok: true };
    return v && typeof v === 'object' ? v : { ok: false, reason: 'over' };
  };
  // A tap back on (or near) the armed stone confirms it. Re-checked in case the position
  // changed underneath without anyone clearing the armed point.
  if (!dragging && prevArmed >= 0 && withinSticky(prevArmed, x, y, geom) && check(prevArmed).ok) {
    return { action: 'commit', idx: prevArmed };
  }
  if (target < 0) return { action: 'cancel', idx: -1 };          // dragged off the board
  const v = check(target);
  if (!v.ok) {
    const reason = v.reason || 'over';
    if (reason === 'occupied') return { action: 'occupied', idx: target, reason };
    if (reason === '33' || reason === '44') return { action: 'forbidden', idx: target, reason };
    return { action: 'deny', idx: target, reason };
  }
  if (mode === 'single' && !dragging) return { action: 'commit', idx: target };
  return { action: 'arm', idx: target };                           // a drag only ever arms
}

// ---- input state machine (pure: coordinates and times in, decisions out) -----------------------

// IDLE / PRESSING, with `armed` carried across presses. The DOM layer feeds it board-local
// CSS px and performance.now() times and acts on what comes back.
export function createInput({ canPlace, mode = 'double' } = {}) {
  const s = {
    phase: 'idle', mode: mode === 'single' ? 'single' : 'double',
    armed: -1, prevArmed: -1, target: -1,
    sx: 0, sy: 0, st: 0, dragging: false, loupe: false,
    locked: false, lockUntil: -Infinity, lastTick: -Infinity,
  };
  const endPress = () => {
    s.phase = 'idle'; s.target = -1; s.dragging = false; s.loupe = false; s.prevArmed = -1;
  };
  const noteTravel = (x, y) => {
    if (!s.dragging && Math.hypot(x - s.sx, y - s.sy) > DRAG_PT) s.dragging = true;
  };
  const api = {
    state: s,
    down(x, y, t, g) {
      if (s.phase !== 'idle' || s.locked || t < s.lockUntil) return false;
      const idx = pointToIdx(x, y, g);
      if (idx < 0) return false;
      s.phase = 'pressing';
      s.sx = x; s.sy = y; s.st = t;
      s.dragging = false; s.loupe = false;
      s.target = idx;
      s.prevArmed = s.armed;
      return true;
    },
    // → null when not pressing, else { changed, tick, loupe } (loupe: it should appear now)
    move(x, y, t, g) {
      if (s.phase !== 'pressing') return null;
      const out = { changed: false, tick: false, loupe: false };
      noteTravel(x, y);
      if (s.dragging && !s.loupe) { s.loupe = true; out.loupe = true; }
      const next = hysteresis(s.target, x, y, g);
      if (next !== s.target) {
        s.target = next;
        out.changed = true;
        if (next >= 0 && t - s.lastTick >= CURSOR_GAP) { s.lastTick = t; out.tick = true; }
      }
      return out;
    },
    // The 150 ms hold: true exactly once, when the loupe should appear without movement.
    poll(t) {
      if (s.phase === 'pressing' && !s.loupe && t - s.st >= LOUPE_DELAY) { s.loupe = true; return true; }
      return false;
    },
    up(x, y, t, g) {
      if (s.phase !== 'pressing') return null;
      noteTravel(x, y);
      s.target = hysteresis(s.target, x, y, g);
      const d = decideRelease({
        mode: s.mode, dragging: s.dragging, prevArmed: s.prevArmed, target: s.target, x, y, geom: g, canPlace,
      });
      if (d.action === 'commit') { s.armed = -1; s.lockUntil = t + COMMIT_LOCK; }
      else if (d.action === 'arm') s.armed = d.idx;
      else if (d.action === 'forbidden') s.armed = -1;
      else s.armed = s.prevArmed;          // occupied / deny / cancel leave the armed point alone
      d.dragged = s.dragging;
      endPress();
      return d;
    },
    cancel() {
      if (s.phase !== 'pressing') return false;
      s.armed = s.prevArmed;
      endPress();
      return true;
    },
    clearArmed() { s.armed = -1; s.prevArmed = -1; },
    commitArmed(t) {
      const i = s.armed;
      if (i < 0) return -1;
      if (s.phase === 'pressing') endPress();
      s.armed = -1;
      s.lockUntil = t + COMMIT_LOCK;
      return i;
    },
    setMode(m) { s.mode = m === 'single' ? 'single' : 'double'; },
    setLocked(on) { s.locked = !!on; if (s.locked) api.cancel(); },
  };
  return api;
}

// ---- loupe placement -----------------------------------------------------------------------------

// Centre of the loupe in viewport CSS px. 96 pt above the finger; when that would poke above
// the safe area, beside the finger at the same height, on the side away from the screen edge
// the finger is nearer to. Always clamped inside the viewport.
export function loupePlacement({ x, y, vw, vh, safeTop = 0, safeBottom = 0, size = LOUPE.size,
  lift = LOUPE.lift, margin = LOUPE.margin }) {
  const R = size / 2 + LOUPE.border;
  let cx = x, cy = y - lift, side = 'above';
  if (cy - R < safeTop + margin) {
    side = x > vw / 2 ? 'left' : 'right';
    cx = x + (side === 'left' ? -lift : lift);
    cy = y;
  }
  const fit = (v, lo, hi) => (hi < lo ? (lo + hi) / 2 : clamp(v, lo, hi));
  cx = fit(cx, margin + R, vw - margin - R);
  cy = fit(cy, safeTop + margin + R, vh - safeBottom - margin - R);
  return { cx, cy, side };
}

// ---- win line --------------------------------------------------------------------------------------

const toXY = (c) => (Array.isArray(c) ? [c[0] | 0, c[1] | 0] : [c % N, (c / N) | 0]);

function splitRuns(pts) {
  const segs = [];
  let cur = [], step = null;
  for (const p of pts) {
    const q = cur[cur.length - 1];
    if (q) {
      const dx = p[0] - q[0], dy = p[1] - q[1];
      const unit = Math.max(Math.abs(dx), Math.abs(dy)) === 1;
      if (unit && (!step || (step[0] === dx && step[1] === dy))) { cur.push(p); step = [dx, dy]; continue; }
      segs.push(cur);
      cur = []; step = null;
    }
    cur.push(p);
  }
  if (cur.length) segs.push(cur);
  return segs;
}

// Cells ([[x,y],…] or idx numbers, as rules.winningLine gives them) → straight runs. Two fives
// made at once can be passed together; they come back as two segments.
export function winSegments(cells) {
  const pts = Array.from(cells || [], toXY);
  if (!pts.length) return [];
  let segs = splitRuns(pts);
  if (segs.length > 1) {
    const sorted = splitRuns(pts.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]));
    if (sorted.length < segs.length) segs = sorted;
  }
  return segs.map((c) => ({ from: c[0], to: c[c.length - 1], cells: c }));
}

// ---- easing --------------------------------------------------------------------------------------

// CSS cubic-bezier(x1,y1,x2,y2) as a function of progress 0..1 (Newton, then bisection).
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const Y = (t) => ((ay * t + by) * t + cy) * t;
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) {
      const e = X(t) - p;
      if (Math.abs(e) < 1e-7) return Y(t);
      const d = dX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = p;
    for (let i = 0; i < 40 && hi - lo > 1e-7; i++) {
      if (X(t) < p) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return Y(t);
  };
}

export const dropEase = cubicBezier(0.2, 0.9, 0.3, 1.3);   // slight overshoot = the stone settles
const easeOut = (p) => 1 - (1 - p) * (1 - p);

// ---- injected stylesheet ---------------------------------------------------------------------------

const STYLE_ID = 'omok-board-style';
const CSS = `
.omok-board{position:relative;box-sizing:border-box;touch-action:none;-webkit-user-select:none;user-select:none;
  -webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;outline:none}
.omok-board__layer{position:absolute;inset:0;border-radius:var(--omok-radius,6px);box-shadow:var(--omok-shadow,none);
  background:var(--omok-backdrop,#C9A06A)}
.omok-board__layer>canvas{position:absolute;left:0;top:0;display:block;pointer-events:none}
.omok-board__glow{position:absolute;inset:0;border-radius:inherit;pointer-events:none;transition:box-shadow .25s ease}
.omok-board__board.omok-breathe{animation:omok-breathe 3s ease-in-out infinite}
@keyframes omok-breathe{0%,100%{opacity:1}50%{opacity:.85}}
html[data-motion="reduce"] .omok-board__board.omok-breathe{animation:none}
@media (prefers-reduced-motion:reduce){html:not([data-motion="full"]) .omok-board__board.omok-breathe{animation:none}}
.omok-loupe{position:fixed;left:0;top:0;z-index:70;pointer-events:none;display:none;will-change:transform}
`;

function injectStyle(doc) {
  if (!doc.head || doc.getElementById(STYLE_ID)) return;
  const st = doc.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  doc.head.appendChild(st);
}

// ---- the board ---------------------------------------------------------------------------------------

/**
 * createBoard(host, opts) — fills `host` with the largest square that fits (≤ 560 px), centred.
 * If the host has no height of its own (height:auto), the board takes the host's width and
 * gives the host its height. Keep the host and its ancestors free of transforms that scale.
 *
 * opts = { theme:'mat', input:'double'|'single', canPlace(idx)→{ok}|{ok:false,reason},
 *          onCommit(idx), onArm?(idx), onReject?(idx, reason), sfx?(name), shake?:bool|()=>bool }
 *   - onCommit only reports; the UI plays the move and then calls place().
 *   - a forbidden release ('33'/'44') already shows the red X and shakes; onReject is for the
 *     buzzer and the toast. 'occupied' calls sfx('occupied') and onReject(idx,'occupied').
 *   - sfx names: 'arm' | 'cursor' | 'occupied'.
 */
export function createBoard(host, opts = {}) {
  const doc = host.ownerDocument || globalThis.document;
  const view = doc.defaultView || globalThis;
  const o = {
    theme: 'mat', input: 'double', shake: true,
    canPlace: () => ({ ok: true }), onCommit: () => {}, onArm: null, onReject: null, sfx: null,
    ...opts,
  };
  injectStyle(doc);

  // ---- DOM ----
  const div = (cls) => { const d = doc.createElement('div'); d.className = cls; return d; };
  const canvas = (cls) => { const c = doc.createElement('canvas'); c.className = cls; c.width = 1; c.height = 1; return c; };
  const el = div('omok-board');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', '오목판');
  const layer = div('omok-board__layer');
  const cvBoard = canvas('omok-board__board');
  const cvStones = canvas('omok-board__stones');
  const cvFx = canvas('omok-board__fx');
  const glow = div('omok-board__glow');
  layer.append(cvBoard, cvStones, cvFx, glow);
  el.append(layer);
  host.append(el);
  try {
    if (view.getComputedStyle(host).position === 'static') host.style.position = 'relative';
  } catch { /* detached host: layout() will retry */ }
  const ctxB = cvBoard.getContext('2d');
  const ctxS = cvStones.getContext('2d');
  const ctxF = cvFx.getContext('2d');

  // ---- state ----
  let theme = getTheme(o.theme);
  let dpr = 1;
  let g = geometry(0, 1);
  const cells = new Int8Array(N * N);
  let last = -1;
  let turn = BLACK;
  let accent = '#FF4757';
  let forbidMarks = null;
  let sprites = null, loupeSprites = null;
  let drops = [], rings = [], dusts = [], removals = [], crosses = [];
  let win = null;
  let armedSince = 0;
  const armPulsing = (t) => t - armedSince < ARM_PULSE_MS * ARM_PULSES;
  let raf = 0, prevBoxes = [], fullDirty = true;
  let pointerId = null, loupeTimer = 0, client = { x: 0, y: 0 };
  let loupe = null, probe = null, shakeAnim = null;
  let destroyed = false;
  const winTimers = new Set();

  const safeCanPlace = (i) => {
    try {
      const v = o.canPlace(i);
      return v && typeof v === 'object' ? v : { ok: false, reason: 'over' };
    } catch (e) {
      console.error(e);
      return { ok: false, reason: 'error' };
    }
  };
  const input = createInput({ canPlace: safeCanPlace, mode: o.input });

  const sfx = (name) => { try { if (typeof o.sfx === 'function') o.sfx(name); } catch { /* sound is optional */ } };
  const mq = typeof view.matchMedia === 'function' ? view.matchMedia('(prefers-reduced-motion: reduce)') : null;
  // html[data-motion] is the app's setting ('reduce' | 'full' | 'auto'); without it, the OS.
  function reduced() {
    const m = doc.documentElement && doc.documentElement.dataset ? doc.documentElement.dataset.motion : '';
    if (m === 'reduce') return true;
    if (m && m !== 'auto') return false;
    return !!(mq && mq.matches);
  }
  const shakeOn = () => (typeof o.shake === 'function' ? !!o.shake() : o.shake !== false);

  // ---- layout ----

  function layout(force = false) {
    if (destroyed) return;
    let cs;
    try { cs = view.getComputedStyle(host); } catch { return; }
    const num = (v) => parseFloat(v) || 0;
    const pl = num(cs.paddingLeft), pr = num(cs.paddingRight), pt = num(cs.paddingTop), pb = num(cs.paddingBottom);
    // Out of flow while measuring, so an auto-height host reports its own height (0), not ours.
    const wasPos = el.style.position;
    el.style.position = 'absolute';
    const w = host.clientWidth - pl - pr;
    const h = host.clientHeight - pt - pb;
    if (!(w > 0)) { el.style.position = wasPos; return; }        // hidden or not laid out yet
    const d = Math.min(view.devicePixelRatio || 1, 3);
    const definite = h >= 1;
    let side = Math.min(w, definite ? h : w, MAX_SIDE);
    side = Math.floor(side * d + 1e-6) / d;
    const snap = (v) => Math.round(v * d) / d;
    if (definite) {
      el.style.left = snap(pl + (w - side) / 2) + 'px';
      el.style.top = snap(pt + (h - side) / 2) + 'px';
      el.style.margin = '0';
    } else {
      el.style.position = 'relative';
      el.style.left = ''; el.style.top = '';
      el.style.margin = '0 auto';
    }
    el.style.width = side + 'px';
    el.style.height = side + 'px';
    if (!force && d === dpr && Math.abs(side - g.size) < 1e-6) return;
    dpr = d;
    g = geometry(side, d);
    for (const cv of [cvBoard, cvStones, cvFx]) {
      cv.width = Math.max(1, g.dev);
      cv.height = Math.max(1, g.dev);
      cv.style.width = g.size + 'px';
      cv.style.height = g.size + 'px';
    }
    sprites = null;
    loupeSprites = null;
    paintBoard();
    paintStones();
    invalidate();
    if (loupe && loupe.shown) drawLoupe();
  }

  function applyTheme() {
    el.dataset.theme = theme.id;
    el.style.setProperty('--omok-radius', (theme.frame?.radius ?? 6) + 'px');
    el.style.setProperty('--omok-shadow', theme.frame?.shadow || 'none');
    el.style.setProperty('--omok-backdrop', theme.backdrop || '#000');
    cvBoard.classList.toggle('omok-breathe', !!theme.breathe);
  }

  function paintGlow() {
    const [r, gg, b] = hexToRgb(accent);
    el.style.setProperty('--omok-accent', accent);
    // SPEC §4: a 2 pt inner glow. Kept tight so it marks the turn without tinting the margin
    // art (tape, rails, bands) in the player's colour.
    glow.style.boxShadow = `inset 0 0 0 2px rgba(${r},${gg},${b},.95), inset 0 0 6px 1px rgba(${r},${gg},${b},.45)`;
  }

  // ---- painting: board and stones ----

  function paintBoard() {
    ctxB.setTransform(1, 0, 0, 1, 0, 0);
    ctxB.clearRect(0, 0, cvBoard.width, cvBoard.height);
    if (!(g.cell > 0)) return;
    ctxB.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxB.save();
    ctxB.beginPath();
    roundRectPath(ctxB, 0, 0, g.size, g.size, theme.frame?.radius ?? 0);
    ctxB.clip();
    try {
      theme.drawBoard(ctxB, g);
    } catch (e) {
      // A theme bug must not leave players without a board: plain lines on the backdrop.
      console.error(e);
      ctxB.fillStyle = theme.backdrop || '#C9A06A';
      ctxB.fillRect(0, 0, g.size, g.size);
      ctxB.fillStyle = '#222';
      for (let i = 0; i < N; i++) {
        const p = g.pad + i * g.cell;
        ctxB.fillRect(p - 0.5, g.pad, 1, g.cell * (N - 1));
        ctxB.fillRect(g.pad, p - 0.5, g.cell * (N - 1), 1);
      }
    }
    ctxB.restore();
  }

  const evenCeil = (v) => { const n = Math.ceil(v); return n % 2 ? n + 1 : n; };

  function buildSet(scale) {
    const rDev = g.cellDev * STONE_R * scale;
    const side = evenCeil(2.4 * rDev);
    const unit = theme.pixel ? pixelUnit(g) * scale : 1;
    const make = (color) => {
      const cv = doc.createElement('canvas');
      cv.width = side; cv.height = side;
      drawStone(cv.getContext('2d'), side / 2, side / 2, rDev, color, theme.stoneStyle, unit);
      return cv;
    };
    return { side, scale, [BLACK]: make(BLACK), [WHITE]: make(WHITE) };
  }

  function ensureSprites() {
    if (!sprites && g.cell > 0) sprites = buildSet(1);
    return sprites;
  }

  // Centre of intersection idx in board CSS px, on the device-pixel grid.
  const cx = (idx) => (g.padDev + (idx % N) * g.cellDev) / dpr;
  const cy = (idx) => (g.padDev + ((idx / N) | 0) * g.cellDev) / dpr;

  // Stamp a stone sprite (ctx in CSS units). At scale 1 it maps 1:1 onto device pixels.
  function stamp(ctx, idx, color, scale = 1, alpha = 1) {
    const sp = ensureSprites();
    if (!sp || !(color === BLACK || color === WHITE)) return;
    const s = (sp.side * scale) / dpr;
    const x = scale === 1 ? cx(idx) - sp.side / 2 / dpr : cx(idx) - s / 2;
    const y = scale === 1 ? cy(idx) - sp.side / 2 / dpr : cy(idx) - s / 2;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(sp[color], x, y, s, s);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  const dropping = (idx) => drops.some((d) => d.idx === idx);

  function paintStones() {
    ctxS.setTransform(1, 0, 0, 1, 0, 0);
    ctxS.clearRect(0, 0, cvStones.width, cvStones.height);
    if (!(g.cell > 0)) return;
    ctxS.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 0; i < cells.length; i++) if (cells[i] && !dropping(i)) stamp(ctxS, i, cells[i]);
  }

  // ---- fx layer ----

  function invalidate() { fullDirty = true; schedule(); }
  function schedule() {
    if (raf || destroyed) return;
    raf = typeof view.requestAnimationFrame === 'function'
      ? view.requestAnimationFrame(frame)
      : setTimeout(() => frame(), 16);
  }

  // Drop finished animations; finished drops are stamped onto the stone layer.
  function settle(t) {
    if (drops.length) {
      const done = drops.filter((d) => t - d.t0 >= DROP_MS);
      if (done.length) {
        drops = drops.filter((d) => t - d.t0 < DROP_MS);
        ctxS.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (const d of done) if (cells[d.idx] === d.color) stamp(ctxS, d.idx, d.color);
      }
    }
    rings = rings.filter((r) => t - r.t0 < r.dur + (r.delay || 0));
    dusts = dusts.filter((d) => t - d.t0 < DUST_MS);
    removals = removals.filter((r) => t - r.t0 < REMOVE_MS);
    crosses = crosses.filter((c) => t - c.t0 < X_MS);
  }

  const winDuration = (n) => Math.max(WIN_LINE_MS, (n - 1) * WIN_STAGGER + WIN_PULSE_MS);

  // Rectangles (board CSS px) that change from one frame to the next.
  function animBoxes(t) {
    const out = [];
    const box = (idx, ext) => out.push([cx(idx) - ext, cy(idx) - ext, ext * 2, ext * 2]);
    const c = g.cell;
    for (const d of drops) box(d.idx, c * 0.85);
    for (const r of removals) box(r.idx, c * 0.85);
    for (const r of rings) box(r.idx, c * (r.kind === 'impact' ? 1.35 : 1.0));
    for (const d of dusts) box(d.idx, c * 1.25);
    for (const x of crosses) box(x.idx, c * 0.6);
    const s = input.state;
    // The armed brackets pulse twice, then hold still: a player may sit on an armed stone for a
    // long time, and a pulse forever would keep the fx canvas redrawing at 60 fps.
    if (s.armed >= 0 && s.phase === 'idle' && !reduced() && armPulsing(t)) box(s.armed, c * 0.75);
    if (win) {
      const busy = t - win.t0 < winDuration(win.order.length) || (theme.pixel && !win.reduced);
      if (busy) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const i of win.order) {
          x0 = Math.min(x0, cx(i)); y0 = Math.min(y0, cy(i)); x1 = Math.max(x1, cx(i)); y1 = Math.max(y1, cy(i));
        }
        out.push([x0 - c, y0 - c, x1 - x0 + 2 * c, y1 - y0 + 2 * c]);
      }
    }
    return out;
  }

  function frame() {
    raf = 0;
    if (destroyed) return;
    const t = now();
    settle(t);
    const boxes = g.cell > 0 ? animBoxes(t) : [];
    const ctx = ctxF;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (fullDirty) {
      ctx.clearRect(0, 0, g.size, g.size);
      if (g.cell > 0) drawFx(ctx, t);
    } else {
      const dirty = prevBoxes.concat(boxes);
      if (dirty.length) {
        ctx.save();
        ctx.beginPath();
        for (const [x, y, w, h] of dirty) {
          // whole device pixels, so no half-cleared seam is left at the edge of a box
          const x0 = Math.floor(x * dpr) / dpr, y0 = Math.floor(y * dpr) / dpr;
          ctx.rect(x0, y0, Math.ceil((x + w) * dpr) / dpr - x0, Math.ceil((y + h) * dpr) / dpr - y0);
        }
        ctx.clip();
        ctx.clearRect(0, 0, g.size, g.size);
        drawFx(ctx, t);
        ctx.restore();
      }
    }
    fullDirty = false;
    prevBoxes = boxes;
    if (boxes.length) schedule();
  }

  function cross(ctx, x, y, half, width, color, alpha, underlay) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = theme.pixel ? 'square' : 'round';
    ctx.beginPath();
    ctx.moveTo(x - half, y - half); ctx.lineTo(x + half, y + half);
    ctx.moveTo(x + half, y - half); ctx.lineTo(x - half, y + half);
    if (underlay) { ctx.strokeStyle = underlay; ctx.lineWidth = width + 2.5; ctx.stroke(); }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  }

  // Corner brackets of a 1.1-cell square: the aim.
  function brackets(ctx, x, y, color, alpha, c = g.cell) {
    const h = c * 0.55, a = c * 0.3, w = Math.max(2.5, c * 0.1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = theme.pixel ? 'square' : 'round';
    ctx.lineJoin = theme.pixel ? 'miter' : 'round';
    ctx.beginPath();
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        ctx.moveTo(x + sx * h, y + sy * (h - a));
        ctx.lineTo(x + sx * h, y + sy * h);
        ctx.lineTo(x + sx * (h - a), y + sy * h);
      }
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = w + 2;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.restore();
  }

  function drawWinLine(ctx, t) {
    const c = g.cell;
    const p = win.reduced ? 1 : clamp((t - win.t0) / WIN_LINE_MS, 0, 1);
    const ext = c * 0.3, width = c * 0.16;
    for (const seg of win.segs) {
      if (seg.cells.length < 2) continue;
      const a = seg.from[1] * N + seg.from[0], b = seg.to[1] * N + seg.to[0];
      let x0 = cx(a), y0 = cy(a), x1 = cx(b), y1 = cy(b);
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
      x0 -= ux * ext; y0 -= uy * ext; x1 += ux * ext; y1 += uy * ext;
      const ex = x0 + (x1 - x0) * p, ey = y0 + (y1 - y0) * p;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(ex, ey);
      if (theme.pixel) {
        // 8-bit: ink bar with gold blocks marching along it
        const P = pixelUnit(g) / dpr;
        ctx.lineCap = 'butt';
        ctx.strokeStyle = '#0F380F';
        ctx.lineWidth = 4 * P;
        ctx.stroke();
        ctx.setLineDash([2 * P, 2 * P]);
        const phase = win.reduced ? 0 : Math.floor((t - win.t0) / PIXEL_BLINK_MS) % 2;
        ctx.lineDashOffset = phase * 2 * P;
        ctx.strokeStyle = '#FFD60A';
        ctx.lineWidth = 2 * P;
        ctx.stroke();
      } else {
        // glow as layered strokes: same look in WebKit and Chromium, no shadowBlur per frame
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255,176,0,.14)'; ctx.lineWidth = width + 9; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,176,0,.3)'; ctx.lineWidth = width + 4.5; ctx.stroke();
        ctx.strokeStyle = 'rgba(60,30,0,.35)'; ctx.lineWidth = width + 2; ctx.stroke();
        ctx.strokeStyle = '#FFD60A'; ctx.lineWidth = width; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,225,.85)'; ctx.lineWidth = width * 0.32; ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawFx(ctx, t) {
    const c = g.cell;
    const s = input.state;
    // 1. forbidden-point preview (setting "금수 자리 미리 표시")
    if (forbidMarks) {
      for (const i of forbidMarks) {
        if (i >= 0 && i < cells.length && !cells[i] && i !== s.armed && i !== s.target) {
          cross(ctx, cx(i), cy(i), c * 0.15, Math.max(1.2, c * 0.06), RED, 0.75, null);
        }
      }
    }
    // 2. while pressing: the row and column through the aim, for alignment
    if (s.phase === 'pressing' && s.target >= 0) {
      const lo = g.pad, hi = g.pad + (N - 1) * c, w = Math.max(2, c * 0.12);
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = accent;
      ctx.fillRect(cx(s.target) - w / 2, lo, w, hi - lo);
      ctx.fillRect(lo, cy(s.target) - w / 2, hi - lo, w);
      ctx.restore();
    }
    // 3. dust kicked up by a stone (mat), under the stones
    for (const d of dusts) {
      const p = clamp((t - d.t0) / DUST_MS, 0, 1), e = easeOut(p);
      for (const q of d.parts) {
        const dist = c * (0.42 + 0.55 * e * q.v);
        ctx.globalAlpha = 0.85 * (1 - p);
        ctx.fillStyle = q.col;
        ctx.beginPath();
        ctx.arc(cx(d.idx) + Math.cos(q.a) * dist, cy(d.idx) + Math.sin(q.a) * dist, c * (0.075 - 0.04 * p) * q.s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // 4. undo: the stone swells and fades
    for (const r of removals) {
      const p = clamp((t - r.t0) / REMOVE_MS, 0, 1);
      stamp(ctx, r.idx, r.color, 1 + 0.3 * p, 1 - p);
    }
    // 5. stones being placed
    for (const d of drops) {
      const p = clamp((t - d.t0) / DROP_MS, 0, 1);
      if (theme.pixel) {
        if (p < 0.34 || p >= 0.67) stamp(ctx, d.idx, d.color);   // two-frame flicker
      } else {
        const e = dropEase(p);
        stamp(ctx, d.idx, d.color, 1.35 - 0.35 * e, clamp(0.6 + 0.4 * e, 0, 1));
      }
    }
    // 6. win pulses: each stone of the line swells 1 → 1.12 → 1 as the line reaches it
    if (win && !win.reduced) {
      win.order.forEach((i, k) => {
        const q = (t - win.t0 - k * WIN_STAGGER) / WIN_PULSE_MS;
        if (q > 0 && q < 1 && cells[i]) stamp(ctx, i, cells[i], 1 + 0.12 * Math.sin(Math.PI * q));
      });
    }
    // 7. last move
    if (last >= 0 && cells[last] && !dropping(last)) {
      ctx.fillStyle = RED;
      if (theme.pixel) {
        const P = pixelUnit(g) / dpr;
        ctx.fillRect(cx(last) - P, cy(last) - P, 2 * P, 2 * P);
      } else {
        ctx.beginPath();
        ctx.arc(cx(last), cy(last), c * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 8. rings: the impact burst and the slower "here" echo
    for (const r of rings) {
      const p = clamp((t - r.t0 - (r.delay || 0)) / r.dur, 0, 1);
      if (t < r.t0 + (r.delay || 0)) continue;
      const e = easeOut(p);
      const rad = r.kind === 'impact' ? c * 1.2 * e : c * (0.5 + 0.4 * e);
      ctx.save();
      ctx.globalAlpha = (r.kind === 'impact' ? 0.5 : 0.55) * (1 - p);
      ctx.strokeStyle = theme.ring;
      ctx.lineWidth = r.kind === 'impact' ? Math.max(1.5, c * 0.08) : Math.max(1.2, c * 0.055);
      ctx.beginPath();
      if (theme.pixel) {
        const P = pixelUnit(g) / dpr, q = Math.max(P, Math.round(rad / P) * P);
        ctx.rect(cx(r.idx) - q, cy(r.idx) - q, 2 * q, 2 * q);
      } else {
        ctx.arc(cx(r.idx), cy(r.idx), Math.max(0.1, rad), 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.restore();
    }
    // 9. win line
    if (win) drawWinLine(ctx, t);
    // 10. preview stone and aim
    if (s.phase === 'pressing') {
      if (s.prevArmed >= 0 && s.prevArmed !== s.target && !cells[s.prevArmed]) stamp(ctx, s.prevArmed, turn, 1, 0.28);
      if (s.target >= 0) {
        if (!cells[s.target]) stamp(ctx, s.target, turn, 1, GHOST_ALPHA);
        brackets(ctx, cx(s.target), cy(s.target), accent, 1);
      }
    } else if (s.armed >= 0) {
      if (!cells[s.armed]) stamp(ctx, s.armed, turn, 1, GHOST_ALPHA);
      // 70–100 % on a 1.2 s cycle (ux.md §1.3) for ARM_PULSES cycles, then steady at full (where
      // the cosine ends anyway, so the stop is seamless); steady when motion is reduced
      const k = reduced() || !armPulsing(t) ? 1 : 0.85 + 0.15 * Math.cos(((t - armedSince) / ARM_PULSE_MS) * Math.PI * 2);
      brackets(ctx, cx(s.armed), cy(s.armed), accent, k);
    }
    // 11. forbidden attempt: red X that pops in and fades out over 700 ms
    for (const x of crosses) {
      const p = clamp((t - x.t0) / X_MS, 0, 1);
      const pop = p < 0.12 ? 1.3 - 0.3 * (p / 0.12) : 1;
      const alpha = p < 0.3 ? 1 : 1 - (p - 0.3) / 0.7;
      cross(ctx, cx(x.idx), cy(x.idx), c * 0.25 * pop, c * 0.12, RED, alpha, 'rgba(40,6,6,.5)');
    }
  }

  // ---- loupe ----

  const LOUPE_BOX = LOUPE.size + 2 * LOUPE.border + 16;    // lens + rim + room for its shadow

  function ensureLoupe() {
    if (loupe) return loupe;
    const cv = doc.createElement('canvas');
    cv.className = 'omok-loupe';
    cv.setAttribute('aria-hidden', 'true');
    (doc.body || doc.documentElement).appendChild(cv);
    loupe = { cv, ctx: cv.getContext('2d'), shown: false, dpr: 0 };
    return loupe;
  }

  function safeTop() {
    try {
      if (!probe) {
        probe = doc.createElement('div');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
        (doc.body || doc.documentElement).appendChild(probe);
      }
      return probe.offsetHeight || 0;
    } catch { return 0; }
  }

  function showLoupe() {
    if (!(g.cell > 0)) return;
    const L = ensureLoupe();
    L.shown = true;
    L.cv.style.display = 'block';
    drawLoupe();
    placeLoupe();
  }

  function hideLoupe() {
    if (!loupe || !loupe.shown) return;
    loupe.shown = false;
    loupe.cv.style.display = 'none';
  }

  function placeLoupe() {
    if (!loupe || !loupe.shown) return;
    const vv = view.visualViewport;
    const vw = vv ? vv.width : view.innerWidth, vh = vv ? vv.height : view.innerHeight;
    const p = loupePlacement({ x: client.x, y: client.y, vw, vh, safeTop: safeTop() });
    const half = LOUPE_BOX / 2;
    loupe.cv.style.transform = `translate3d(${(p.cx - half).toFixed(2)}px,${(p.cy - half).toFixed(2)}px,0)`;
  }

  // drawImage with the source rectangle clipped to the source canvas. Out-of-range source
  // rects are where WebKit and Chromium disagree (older WebKit draws nothing at all).
  function blitClipped(ctx, src, sx, sy, sw, sh, dx, dy, dw, dh) {
    const kx = dw / sw, ky = dh / sh;
    const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
    const x1 = Math.min(src.width, sx + sw), y1 = Math.min(src.height, sy + sh);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, dx + (x0 - sx) * kx, dy + (y0 - sy) * ky, (x1 - x0) * kx, (y1 - y0) * ky);
  }

  function drawLoupe() {
    if (!loupe || !loupe.shown) return;
    const L = loupe, d = dpr, box = LOUPE_BOX;
    if (L.dpr !== d) {
      L.dpr = d;
      L.cv.width = Math.ceil(box * d);
      L.cv.height = Math.ceil(box * d);
      L.cv.style.width = box + 'px';
      L.cv.style.height = box + 'px';
    }
    const ctx = L.ctx;
    const R = LOUPE.size / 2, m = box / 2, z = LOUPE.zoom;
    const t = input.state.target;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, box, box);
    // shadow under the lens
    const sh = ctx.createRadialGradient(m, m + 4, R, m, m + 4, R + 9);
    sh.addColorStop(0, 'rgba(0,0,0,.42)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.beginPath(); ctx.arc(m, m + 4, R + 9, 0, Math.PI * 2); ctx.fill();
    // lens: the board and stones, magnified around the snapped point
    ctx.save();
    ctx.beginPath(); ctx.arc(m, m, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = theme.backdrop || '#000';
    ctx.fillRect(0, 0, box, box);
    if (t >= 0) {
      const px = cx(t), py = cy(t), half = R / z;
      ctx.imageSmoothingEnabled = !theme.pixel;
      if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
      for (const src of [cvBoard, cvStones]) {
        blitClipped(ctx, src, (px - half) * d, (py - half) * d, 2 * half * d, 2 * half * d, m - R, m - R, 2 * R, 2 * R);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.translate(m, m);
      ctx.scale(z, z);
      ctx.translate(-px, -py);
      if (!cells[t]) {
        if (!loupeSprites) loupeSprites = buildSet(z);
        const sp = loupeSprites, s = sp.side / (d * z);
        ctx.globalAlpha = GHOST_ALPHA;
        ctx.drawImage(sp[turn], px - s / 2, py - s / 2, s, s);
        ctx.globalAlpha = 1;
      }
      brackets(ctx, px, py, accent, 1);
    }
    ctx.restore();
    // fine crosshair, broken around the stone so it never hides it
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    const gap = g.cell * z * 0.68;
    ctx.beginPath();
    ctx.moveTo(m - R + 4, m); ctx.lineTo(m - gap, m);
    ctx.moveTo(m + gap, m); ctx.lineTo(m + R - 4, m);
    ctx.moveTo(m, m - R + 4); ctx.lineTo(m, m - gap);
    ctx.moveTo(m, m + gap); ctx.lineTo(m, m + R - 4);
    ctx.stroke();
    ctx.restore();
    // rim: the player's colour with an ink edge, like every sticker in the app
    ctx.beginPath(); ctx.arc(m, m, R + LOUPE.border / 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#2A1E2F'; ctx.lineWidth = LOUPE.border + 2; ctx.stroke();
    ctx.strokeStyle = accent; ctx.lineWidth = LOUPE.border; ctx.stroke();
    ctx.beginPath(); ctx.arc(m, m, R - 0.5, Math.PI * 1.05, Math.PI * 1.55);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // ---- input (DOM side) ----

  // Board-local CSS px from client coordinates. The haptic <label> overlay is usually the event
  // target, so offsetX would be relative to it: always clientX/Y minus our own rect. The rect is
  // the outer element's, which never shakes, so a tap during a shake still lands true.
  function local(e) {
    const r = el.getBoundingClientRect();
    const k = r.width > 0 ? g.size / r.width : 1;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
  }

  function endPress() {
    pointerId = null;
    clearTimeout(loupeTimer);
    loupeTimer = 0;
    hideLoupe();
  }

  function onDown(e) {
    if (destroyed || pointerId !== null || e.isPrimary === false) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!(g.cell > 0)) return;
    const [x, y] = local(e);
    if (!input.down(x, y, now(), g)) return;
    pointerId = e.pointerId;
    client = { x: e.clientX, y: e.clientY };
    // Touch pointers are already captured by whatever they landed on (usually the haptic
    // <label>), and their moves bubble up to us. Re-capturing them here could move the tap's
    // click away from that label and silence the haptic tick, so only mouse/pen are captured
    // (to keep a desktop drag alive when it leaves the board).
    if (e.pointerType !== 'touch') {
      try { el.setPointerCapture(e.pointerId); } catch { /* the press still works without capture */ }
    }
    clearTimeout(loupeTimer);
    loupeTimer = setTimeout(() => {
      loupeTimer = 0;
      if (input.poll(now())) showLoupe();
    }, LOUPE_DELAY);
    invalidate();
  }

  function onMove(e) {
    if (e.pointerId !== pointerId) return;
    client = { x: e.clientX, y: e.clientY };
    const [x, y] = local(e);
    const r = input.move(x, y, now(), g);
    if (!r) return;
    if (r.tick) sfx('cursor');
    if (r.loupe) showLoupe();
    else if (r.changed && loupe && loupe.shown) drawLoupe();
    placeLoupe();
    if (r.changed) invalidate();
  }

  function onUp(e) {
    if (e.pointerId !== pointerId) return;
    const [x, y] = local(e);
    const d = input.up(x, y, now(), g);
    endPress();
    if (!d) return;
    switch (d.action) {
      case 'commit':
        invalidate();
        o.onCommit(d.idx);
        break;
      case 'arm':
        armedSince = now();
        sfx('arm');
        invalidate();
        if (typeof o.onArm === 'function') o.onArm(d.idx);
        break;
      case 'occupied':
        sfx('occupied');
        invalidate();
        if (typeof o.onReject === 'function') o.onReject(d.idx, 'occupied');
        break;
      case 'forbidden':
        api.flashForbidden(d.idx);
        if (typeof o.onReject === 'function') o.onReject(d.idx, d.reason);
        break;
      case 'deny':
        invalidate();
        if (typeof o.onReject === 'function') o.onReject(d.idx, d.reason);
        break;
      default:
        invalidate();
    }
  }

  function onCancel(e) {
    if (e.pointerId !== pointerId) return;
    input.cancel();
    endPress();
    invalidate();
  }

  function cancelPress() {
    if (pointerId === null && input.state.phase !== 'pressing') return;
    input.cancel();
    endPress();
  }

  const onContext = (e) => e.preventDefault();

  // iOS can drop canvas backing stores of a backgrounded web app; repaint on the way back.
  function onVisibility() {
    if (doc.visibilityState === 'hidden') { cancelPress(); invalidate(); return; }
    paintBoard();
    paintStones();
    invalidate();
  }
  const onPageShow = (e) => { if (e.persisted) { paintBoard(); paintStones(); invalidate(); } };
  const onWindowResize = () => layout(false);

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('lostpointercapture', onCancel);
  el.addEventListener('contextmenu', onContext);
  doc.addEventListener('visibilitychange', onVisibility);
  view.addEventListener('pageshow', onPageShow);
  view.addEventListener('resize', onWindowResize);
  let observer = null;
  if (typeof view.ResizeObserver === 'function') {
    observer = new view.ResizeObserver(() => layout(false));
    observer.observe(host);
  }

  // ---- public API ----

  const api = {
    el,

    // Whole position at once (new round, undo, resume, debug shots). Clears the armed point,
    // any press, the win line and running animations; keeps the forbidden-mark preview, and
    // keeps an undo fade that is still running for a point that is now empty, so the UI can
    // do remove(idx) and then setPosition(board, previousLast) to move the red dot back.
    setPosition(board, lastIdx = -1) {
      cancelPress();
      input.clearArmed();
      cells.fill(0);
      if (board) for (let i = 0; i < cells.length && i < board.length; i++) cells[i] = board[i] === BLACK || board[i] === WHITE ? board[i] : 0;
      last = lastIdx >= 0 && lastIdx < cells.length && cells[lastIdx] ? lastIdx : -1;
      drops = []; rings = []; dusts = []; crosses = [];
      removals = removals.filter((r) => !cells[r.idx]);
      win = null;
      winTimers.forEach((f) => f());
      paintStones();
      invalidate();
    },

    place(idx, color, { animate = true } = {}) {
      if (!(idx >= 0 && idx < cells.length) || !(color === BLACK || color === WHITE)) return;
      cells[idx] = color;
      last = idx;
      input.clearArmed();
      drops = drops.filter((d) => d.idx !== idx);
      const t = now();
      if (animate && g.cell > 0) {
        drops.push({ idx, color, t0: t });
        rings.push({ idx, t0: t, dur: IMPACT_MS, kind: 'impact' });
        rings.push({ idx, t0: t, delay: DROP_MS, dur: LAST_RING_MS, kind: 'last' });
        if (theme.dust && !reduced()) {
          let seed = (idx * 2654435761) >>> 0;
          const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
          const parts = [];
          for (let k = 0; k < 6; k++) {
            parts.push({ a: (k / 6) * Math.PI * 2 + rnd() * 0.8, v: 0.6 + rnd() * 0.6, s: 0.7 + rnd() * 0.6, col: theme.dust[k % 2] });
          }
          dusts.push({ idx, t0: t, parts });
        }
      } else if (g.cell > 0) {
        ctxS.setTransform(dpr, 0, 0, dpr, 0, 0);
        stamp(ctxS, idx, color);
      }
      invalidate();
    },

    remove(idx, { animate = true } = {}) {
      if (!(idx >= 0 && idx < cells.length)) return;
      const color = cells[idx];
      cells[idx] = 0;
      if (last === idx) last = -1;
      drops = drops.filter((d) => d.idx !== idx);
      rings = rings.filter((r) => r.idx !== idx);
      paintStones();
      if (animate && color && g.cell > 0) removals.push({ idx, color, t0: now() });
      invalidate();
    },

    // Whose turn: the preview stone's colour, and the accent of aim, loupe and inner glow.
    // A change of colour drops whatever the previous player had armed.
    setTurn(color, acc) {
      const c = color === WHITE ? WHITE : BLACK;
      if (c !== turn) { cancelPress(); input.clearArmed(); }
      turn = c;
      if (typeof acc === 'string' && acc) accent = acc;
      paintGlow();
      if (loupe && loupe.shown) drawLoupe();
      invalidate();
    },

    setLocked(on) {
      if (on) cancelPress();
      input.setLocked(on);
      invalidate();
    },

    armed() { return input.state.armed; },

    clearArmed() {
      cancelPress();
      input.clearArmed();
      invalidate();
    },

    // Timer ran out with a stone armed: returns that point (or -1) and locks input for 250 ms.
    // It does NOT call onCommit; the caller plays the returned point.
    commitArmed() {
      const i = input.state.armed;
      if (i < 0) return -1;
      if (!safeCanPlace(i).ok) { api.clearArmed(); return -1; }
      cancelPress();
      input.commitArmed(now());
      invalidate();
      return i;
    },

    // Gold line through the winning cells; resolves when the line and the pulses are done
    // (~420 ms for five). The line stays until the next setPosition().
    showWin(list) {
      const segs = winSegments(list);
      if (!segs.length) return Promise.resolve();
      cancelPress();
      input.clearArmed();
      const order = segs.flatMap((s) => s.cells).map(([x, y]) => y * N + x);
      const red = reduced();
      win = { segs, order, t0: now(), reduced: red };
      invalidate();
      const ms = red ? 0 : winDuration(order.length);
      return new Promise((resolve) => {
        let timer = 0;
        const done = () => { clearTimeout(timer); winTimers.delete(done); resolve(); };
        winTimers.add(done);
        timer = setTimeout(done, ms + 20);
      });
    },

    flashForbidden(idx) {
      if (!(idx >= 0 && idx < cells.length)) return;
      crosses = crosses.filter((x) => x.idx !== idx);
      crosses.push({ idx, t0: now() });
      if (!reduced() && shakeOn() && typeof layer.animate === 'function') {
        try {
          if (shakeAnim) shakeAnim.cancel();
          const k = [0, 6, -6, 5, -5, 3, -2, 0].map((v) => ({ transform: `translate3d(${v}px,0,0)` }));
          shakeAnim = layer.animate(k, { duration: SHAKE_MS, easing: 'linear' });
        } catch { /* no Web Animations: the X alone still says no */ }
      }
      invalidate();
    },

    setForbiddenMarks(list) {
      forbidMarks = list && list.length ? Array.from(list) : null;
      invalidate();
    },

    setTheme(id) {
      const next = getTheme(id);
      if (next === theme) return;
      cancelPress();
      theme = next;
      applyTheme();
      sprites = null;
      loupeSprites = null;
      paintBoard();
      paintStones();
      invalidate();
    },

    setInput(mode) { input.setMode(mode); },

    resize() { layout(false); },

    destroy() {
      if (destroyed) return;
      cancelPress();
      destroyed = true;
      if (raf) {
        if (typeof view.cancelAnimationFrame === 'function') view.cancelAnimationFrame(raf);
        clearTimeout(raf);
        raf = 0;
      }
      winTimers.forEach((f) => f());
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('lostpointercapture', onCancel);
      el.removeEventListener('contextmenu', onContext);
      doc.removeEventListener('visibilitychange', onVisibility);
      view.removeEventListener('pageshow', onPageShow);
      view.removeEventListener('resize', onWindowResize);
      if (observer) observer.disconnect();
      if (shakeAnim) { try { shakeAnim.cancel(); } catch { /* already gone */ } }
      // iOS keeps canvas memory until the element is collected; give it back now.
      for (const cv of [cvBoard, cvStones, cvFx, loupe && loupe.cv]) {
        if (cv) { cv.width = 0; cv.height = 0; }
      }
      if (loupe) loupe.cv.remove();
      if (probe) probe.remove();
      el.remove();
    },
  };

  applyTheme();
  paintGlow();
  layout(true);
  return api;
}
