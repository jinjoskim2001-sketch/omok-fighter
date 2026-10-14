// js/board.js + js/themes.js: geometry, snapping, the input state machine, the theme table, and
// createBoard() driven through a minimal fake DOM. Nothing here looks at pixels; the look is
// checked by eye with tools/demo-board.html (and the Playwright shots taken from it).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  geometry, cellCenter, pointToIdx, hysteresis, withinSticky, decideRelease, createInput,
  loupePlacement, winSegments, cubicBezier, dropEase, createBoard,
  SPAN, MARGIN, STONE_R, HYSTERESIS, STICKY, DRAG_PT, LOUPE_DELAY, CURSOR_GAP, COMMIT_LOCK, LOUPE, MAX_SIDE,
  THEMES as THEMES_FROM_BOARD, THEME_IDS as IDS_FROM_BOARD,
} from '../js/board.js';
import { THEMES, THEME_IDS, DEFAULT_THEME, getTheme, drawStone, pixelUnit, hexToRgb, mulberry32 } from '../js/themes.js';
import { N } from '../js/rules.js';

const idx = (x, y) => y * N + x;

// ---- the numbers the spec fixes ----------------------------------------------------------------

test('spec constants', () => {
  assert.equal(SPAN, 15.2);
  assert.equal(MARGIN, 0.6);
  assert.equal(STONE_R, 0.46);
  assert.equal(HYSTERESIS, 0.6);
  assert.equal(STICKY, 0.75);
  assert.equal(DRAG_PT, 8);
  assert.equal(LOUPE_DELAY, 150);
  assert.equal(CURSOR_GAP, 40);
  assert.equal(COMMIT_LOCK, 250);
  assert.equal(MAX_SIDE, 560);
  assert.deepEqual([LOUPE.size, LOUPE.zoom, LOUPE.lift, LOUPE.border], [112, 2.2, 96, 3]);
});

// ---- geometry ------------------------------------------------------------------------------------

test('geometry: cell and margin are whole device pixels and the margin is at least 0.6 cell', () => {
  for (const dpr of [1, 2, 3]) {
    for (let size = 200; size <= 560; size += 7.3) {
      const g = geometry(size, dpr);
      assert.ok(Number.isInteger(g.cellDev) && Number.isInteger(g.padDev), `${size}@${dpr}`);
      assert.equal(g.cell, g.cellDev / dpr);
      assert.equal(g.pad, g.padDev / dpr);
      assert.ok(g.pad >= MARGIN * g.cell - 1e-9, `margin ${g.pad / g.cell} cells at ${size}@${dpr}`);
      assert.ok(g.size <= size + 1e-9 && g.size > size - 1 / dpr - 1e-9, `size snapped down at most one device px`);
      assert.ok(g.padDev * 2 + (N - 1) * g.cellDev <= g.dev, 'grid fits');
      assert.ok(g.cellDev >= Math.floor(g.dev / SPAN) - 1, 'the cell gives up at most one device px');
      assert.ok(Math.abs(g.r - g.cell * STONE_R) < 1e-9);
    }
  }
});

test('geometry: the iPhone sizes from ux.md §1.1', () => {
  // 375-pt phones: 363-pt board, ~23.9-pt cells (snapped to 71 device px = 23.67 pt at 3x)
  let g = geometry(363, 3);
  assert.deepEqual([g.dev, g.cellDev, g.padDev], [1089, 71, 47]);
  g = geometry(381, 3);
  assert.deepEqual([g.cellDev, g.padDev], [75, 46]);
  assert.ok(Math.abs(g.cell - 25) < 1e-9);
  g = geometry(0, 3);
  assert.equal(g.cell, 0);
  assert.equal(pointToIdx(10, 10, g), -1);
  assert.deepEqual(geometry(300, NaN).dpr, 1);
});

test('cellCenter and pointToIdx agree on every intersection', () => {
  for (const [size, dpr] of [[363, 3], [381, 3], [428, 3], [300, 2], [560, 1]]) {
    const g = geometry(size, dpr);
    for (let i = 0; i < N * N; i++) {
      const [x, y] = cellCenter(i, g);
      assert.equal(pointToIdx(x, y, g), i);
      // anywhere within half a cell (minus a hair) still resolves to it
      assert.equal(pointToIdx(x + g.cell * 0.49, y - g.cell * 0.49, g), i);
    }
  }
});

test('pointToIdx: margins snap to the edge, far outside is -1', () => {
  const g = geometry(381, 3);
  assert.equal(pointToIdx(0, 0, g), idx(0, 0));
  assert.equal(pointToIdx(g.size, g.size, g), idx(14, 14));
  assert.equal(pointToIdx(-g.cell * 0.45, g.size / 2, g), idx(0, 7));
  assert.equal(pointToIdx(-g.cell * 0.55, g.size / 2, g), -1);
  assert.equal(pointToIdx(g.size / 2, g.size + g.cell * 0.55, g), -1);
  assert.equal(pointToIdx(NaN, 3, g), -1);
});

// ---- hysteresis and the sticky radius ----------------------------------------------------------------

test('hysteresis: the target holds within 0.6 cell and moves beyond it', () => {
  const g = geometry(381, 3);
  const cur = idx(7, 7);
  const [cx, cy] = cellCenter(cur, g);
  assert.equal(hysteresis(cur, cx + g.cell * 0.55, cy, g), cur, 'past the midpoint but inside the band');
  assert.equal(hysteresis(cur, cx + g.cell * 0.65, cy, g), idx(8, 7));
  assert.equal(hysteresis(cur, cx, cy - g.cell * 0.65, g), idx(7, 6));
  assert.equal(hysteresis(cur, cx - g.cell * 1.7, cy, g), idx(5, 7), 'a fast jump lands on the nearest point');
  // per axis: x crosses the band, y stays inside it although it is past the midpoint
  assert.equal(hysteresis(cur, cx + g.cell * 0.7, cy + g.cell * 0.55, g), idx(8, 7));
  assert.equal(hysteresis(cur, cx + g.cell * 0.7, cy + g.cell * 0.62, g), idx(8, 8));
  // no current target: plain nearest; off the board: none
  assert.equal(hysteresis(-1, cx + g.cell * 0.55, cy, g), idx(8, 7));
  assert.equal(hysteresis(cur, -g.cell, cy, g), -1);
  assert.equal(hysteresis(cur, cx + g.cell * 0.7, cy, g, 0.8), cur, 'band is a parameter');
});

test('withinSticky: 0.75 cell radius around the armed point', () => {
  const g = geometry(363, 3);
  const a = idx(3, 4);
  const [cx, cy] = cellCenter(a, g);
  assert.equal(withinSticky(a, cx + g.cell * 0.74, cy, g), true);
  assert.equal(withinSticky(a, cx + g.cell * 0.76, cy, g), false);
  assert.equal(withinSticky(a, cx + g.cell * 0.5, cy + g.cell * 0.5, g), true);   // 0.707
  assert.equal(withinSticky(a, cx + g.cell * 0.55, cy + g.cell * 0.55, g), false); // 0.778
  assert.equal(withinSticky(-1, cx, cy, g), false);
});

// ---- release decisions ---------------------------------------------------------------------------------

test('decideRelease: every branch of ux.md §1.2 step 3', () => {
  const g = geometry(381, 3);
  const at = (x, y) => cellCenter(idx(x, y), g);
  const verdicts = { [idx(1, 1)]: { ok: false, reason: 'occupied' }, [idx(2, 2)]: { ok: false, reason: '33' },
    [idx(3, 3)]: { ok: false, reason: '44' }, [idx(4, 4)]: { ok: false, reason: 'over' } };
  const canPlace = (i) => verdicts[i] || { ok: true };
  const base = { mode: 'double', dragging: false, prevArmed: -1, geom: g, canPlace };
  const rel = (o) => {
    const [x, y] = o.at || at(o.tx ?? 7, o.ty ?? 7);
    return decideRelease({ ...base, target: o.target ?? idx(o.tx ?? 7, o.ty ?? 7), x, y, ...o });
  };
  assert.deepEqual(rel({}), { action: 'arm', idx: idx(7, 7) });
  assert.deepEqual(rel({ prevArmed: idx(7, 7) }), { action: 'commit', idx: idx(7, 7) });
  // sticky: released 0.7 cell off the armed point (target already moved to the neighbour)
  const [ax, ay] = at(7, 7);
  assert.deepEqual(rel({ prevArmed: idx(7, 7), target: idx(8, 7), at: [ax + g.cell * 0.7, ay] }), { action: 'commit', idx: idx(7, 7) });
  assert.deepEqual(rel({ prevArmed: idx(7, 7), target: idx(8, 7), at: [ax + g.cell * 0.8, ay] }), { action: 'arm', idx: idx(8, 7) });
  // a drag never commits, even back onto the armed point
  assert.deepEqual(rel({ prevArmed: idx(7, 7), dragging: true }), { action: 'arm', idx: idx(7, 7) });
  // the armed point went bad underneath: fall through to the target's own verdict
  assert.deepEqual(rel({ prevArmed: idx(2, 2), tx: 2, ty: 2 }), { action: 'forbidden', idx: idx(2, 2), reason: '33' });
  assert.deepEqual(rel({ tx: 1, ty: 1 }), { action: 'occupied', idx: idx(1, 1), reason: 'occupied' });
  assert.deepEqual(rel({ tx: 3, ty: 3 }), { action: 'forbidden', idx: idx(3, 3), reason: '44' });
  assert.deepEqual(rel({ tx: 4, ty: 4 }), { action: 'deny', idx: idx(4, 4), reason: 'over' });
  assert.deepEqual(rel({ target: -1, at: [-50, -50] }), { action: 'cancel', idx: -1 });
  // single-tap mode: a tap commits, a drag still only arms
  assert.deepEqual(rel({ mode: 'single' }), { action: 'commit', idx: idx(7, 7) });
  assert.deepEqual(rel({ mode: 'single', dragging: true }), { action: 'arm', idx: idx(7, 7) });
  // a canPlace that returns garbage is treated as "not now"
  assert.deepEqual(decideRelease({ ...base, canPlace: () => undefined, target: idx(7, 7), x: ax, y: ay }),
    { action: 'deny', idx: idx(7, 7), reason: 'over' });
});

// ---- the input state machine -----------------------------------------------------------------------------

function machine(opts = {}) {
  const g = geometry(381, 3);
  const verdicts = new Map();
  const m = createInput({ canPlace: (i) => verdicts.get(i) || { ok: true }, ...opts });
  let t = 1000;
  const xy = (x, y, dx = 0, dy = 0) => { const [cx, cy] = cellCenter(idx(x, y), g); return [cx + dx * g.cell, cy + dy * g.cell]; };
  const tap = (x, y, dx = 0, dy = 0, hold = 60) => {
    const [px, py] = xy(x, y, dx, dy);
    if (!m.down(px, py, t, g)) { t += hold; return null; }
    t += hold;
    m.poll(t);
    const d = m.up(px, py, t, g);
    t += 300;
    return d;
  };
  return { m, g, verdicts, xy, tap, time: { get: () => t, add: (ms) => { t += ms; } } };
}

test('input: tap arms, a second tap commits, then input is locked for 250 ms', () => {
  const { m, g, xy, tap, time } = machine();
  assert.deepEqual(tap(7, 7), { action: 'arm', idx: idx(7, 7), dragged: false });
  assert.equal(m.state.armed, idx(7, 7));
  assert.equal(m.state.phase, 'idle');
  const [px, py] = xy(7, 7);
  assert.equal(m.down(px, py, time.get(), g), true);
  const d = m.up(px, py, time.get() + 50, g);
  assert.equal(d.action, 'commit');
  assert.equal(m.state.armed, -1);
  const t0 = time.get() + 50;
  assert.equal(m.down(px, py, t0 + 100, g), false, 'locked right after a commit');
  assert.equal(m.down(px, py, t0 + COMMIT_LOCK - 1, g), false);
  assert.equal(m.down(px, py, t0 + COMMIT_LOCK, g), true, 'open again after 250 ms');
});

test('input: tapping elsewhere moves the armed point; occupied keeps it; forbidden clears it', () => {
  const { m, verdicts, tap } = machine();
  tap(7, 7);
  assert.equal(tap(9, 9).action, 'arm');
  assert.equal(m.state.armed, idx(9, 9));
  verdicts.set(idx(3, 3), { ok: false, reason: 'occupied' });
  assert.equal(tap(3, 3).action, 'occupied');
  assert.equal(m.state.armed, idx(9, 9), 'occupied tap leaves the armed point alone');
  verdicts.set(idx(4, 4), { ok: false, reason: '33' });
  assert.deepEqual(tap(4, 4), { action: 'forbidden', idx: idx(4, 4), reason: '33', dragged: false });
  assert.equal(m.state.armed, -1, 'forbidden tap returns to IDLE');
});

test('input: a tap 0.7 cell off the armed point still commits it (sticky radius)', () => {
  const { tap } = machine();
  tap(5, 5);
  const d = tap(5, 5, 0.7, 0);
  assert.equal(d.action, 'commit');
  assert.equal(d.idx, idx(5, 5));
});

test('input: a drag shows the loupe at once, ticks the cursor at most every 40 ms, and only arms', () => {
  const { m, g, xy, tap, time } = machine();
  tap(7, 7);                                       // something armed
  const [sx, sy] = xy(7, 7);
  let t = time.get();
  assert.equal(m.down(sx, sy, t, g), true);
  let r = m.move(sx + 5, sy, t += 10, g);
  assert.deepEqual(r, { changed: false, tick: false, loupe: false }, 'under 8 pt: still a tap');
  r = m.move(sx + 9, sy, t += 10, g);
  assert.equal(r.loupe, true, 'past 8 pt the loupe shows without waiting');
  assert.equal(m.state.dragging, true);
  r = m.move(sx + g.cell * 1.0, sy, t += 10, g);
  assert.deepEqual([r.changed, r.tick], [true, true]);
  r = m.move(sx + g.cell * 2.0, sy, t += 10, g);
  assert.deepEqual([r.changed, r.tick], [true, false], 'second change within 40 ms: no tick');
  r = m.move(sx + g.cell * 3.0, sy, t += 40, g);
  assert.deepEqual([r.changed, r.tick], [true, true]);
  // back onto the armed point and release: re-arms, never commits
  m.move(sx, sy, t += 10, g);
  const d = m.up(sx, sy, t += 10, g);
  assert.equal(d.action, 'arm');
  assert.equal(d.dragged, true);
  assert.equal(m.state.armed, idx(7, 7));
});

test('input: the loupe appears after a 150 ms hold, exactly once', () => {
  const { m, g, xy } = machine();
  const [x, y] = xy(2, 2);
  m.down(x, y, 0, g);
  assert.equal(m.poll(149), false);
  assert.equal(m.poll(150), true);
  assert.equal(m.poll(400), false);
  // a long press without movement is still a tap: releasing on the armed point commits
  m.up(x, y, 500, g);
  m.down(x, y, 900, g);
  m.poll(1200);
  assert.equal(m.up(x, y, 1300, g).action, 'commit');
});

test('input: cancel restores what was armed; dragging off the board cancels too', () => {
  const { m, g, xy, tap, time } = machine();
  tap(6, 6);
  const [x, y] = xy(10, 10);
  m.down(x, y, time.get(), g);
  assert.equal(m.cancel(), true);
  assert.equal(m.state.armed, idx(6, 6));
  assert.equal(m.cancel(), false, 'nothing to cancel twice');
  m.down(x, y, time.get() + 10, g);
  m.move(-g.cell * 2, y, time.get() + 20, g);
  assert.equal(m.state.target, -1);
  const d = m.up(-g.cell * 2, y, time.get() + 30, g);
  assert.equal(d.action, 'cancel');
  assert.equal(m.state.armed, idx(6, 6));
});

test('input: setLocked ignores presses and cancels one in progress', () => {
  const { m, g, xy, tap, time } = machine();
  tap(6, 6);
  const [x, y] = xy(8, 8);
  m.down(x, y, time.get(), g);
  m.setLocked(true);
  assert.equal(m.state.phase, 'idle');
  assert.equal(m.state.armed, idx(6, 6));
  assert.equal(m.up(x, y, time.get() + 10, g), null, 'the release of a cancelled press does nothing');
  assert.equal(m.down(x, y, time.get() + 20, g), false);
  m.setLocked(false);
  assert.equal(m.down(x, y, time.get() + 30, g), true);
});

test('input: single-tap mode, commitArmed and clearArmed', () => {
  const { m, g, xy, tap, time } = machine({ mode: 'single' });
  assert.equal(tap(3, 9).action, 'commit');
  m.setMode('double');
  tap(4, 9);
  assert.equal(m.state.armed, idx(4, 9));
  const t = time.get();
  assert.equal(m.commitArmed(t), idx(4, 9));
  assert.equal(m.state.armed, -1);
  assert.equal(m.commitArmed(t), -1);
  const [x, y] = xy(1, 1);
  assert.equal(m.down(x, y, t + 100, g), false, 'commitArmed locks like a tap commit');
  tap(5, 9);
  m.clearArmed();
  assert.equal(m.state.armed, -1);
  m.setMode('nonsense');
  assert.equal(m.state.mode, 'double');
});

// ---- loupe placement -------------------------------------------------------------------------------------

test('loupePlacement: 96 pt above, or beside the finger when the top is too close', () => {
  const R = LOUPE.size / 2 + LOUPE.border;
  let p = loupePlacement({ x: 200, y: 500, vw: 393, vh: 852 });
  assert.deepEqual(p, { cx: 200, cy: 404, side: 'above' });
  p = loupePlacement({ x: 300, y: 120, vw: 393, vh: 852, safeTop: 47 });
  assert.equal(p.side, 'left');
  assert.equal(p.cx, 204);
  assert.equal(p.cy, Math.max(120, 47 + LOUPE.margin + R));
  p = loupePlacement({ x: 60, y: 140, vw: 375, vh: 667 });
  assert.equal(p.side, 'right');
  assert.equal(p.cx, 156);
  // never outside the viewport
  for (const [x, y] of [[0, 0], [375, 667], [5, 300], [370, 300]]) {
    const q = loupePlacement({ x, y, vw: 375, vh: 667, safeTop: 20 });
    assert.ok(q.cx - R >= LOUPE.margin - 1e-9 && q.cx + R <= 375 - LOUPE.margin + 1e-9, `x ${x},${y}`);
    assert.ok(q.cy - R >= 20 + LOUPE.margin - 1e-9 && q.cy + R <= 667 - LOUPE.margin + 1e-9, `y ${x},${y}`);
  }
});

// ---- win line ------------------------------------------------------------------------------------------------

test('winSegments: one run, two runs, idx input, any direction', () => {
  const one = winSegments([[3, 3], [4, 4], [5, 5], [6, 6], [7, 7]]);
  assert.equal(one.length, 1);
  assert.deepEqual([one[0].from, one[0].to], [[3, 3], [7, 7]]);
  const anti = winSegments([[9, 2], [8, 3], [7, 4], [6, 5], [5, 6]]);
  assert.equal(anti.length, 1);
  assert.equal(anti[0].cells.length, 5);
  const fromIdx = winSegments([idx(0, 14), idx(1, 14), idx(2, 14), idx(3, 14), idx(4, 14)]);
  assert.deepEqual([fromIdx[0].from, fromIdx[0].to], [[0, 14], [4, 14]]);
  // a double five (two lines handed over together)
  const two = winSegments([[2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [4, 3], [4, 4], [4, 5], [4, 6], [4, 8]]);
  assert.ok(two.length >= 2);
  assert.equal(two.reduce((n, s) => n + s.cells.length, 0), 10);
  // shuffled cells of one line are sorted back into one run
  assert.equal(winSegments([[5, 5], [3, 5], [4, 5], [7, 5], [6, 5]]).length, 1);
  assert.deepEqual(winSegments([]), []);
  assert.deepEqual(winSegments(null), []);
});

// ---- easing ----------------------------------------------------------------------------------------------------

test('cubicBezier matches CSS: endpoints, linear, and the stone-drop overshoot', () => {
  const lin = cubicBezier(0, 0, 1, 1);
  for (const p of [0.1, 0.33, 0.5, 0.9]) assert.ok(Math.abs(lin(p) - p) < 1e-5);
  const ease = cubicBezier(0.25, 0.1, 0.25, 1);       // CSS 'ease'
  assert.ok(Math.abs(ease(0.5) - 0.8024) < 1e-3);
  assert.equal(dropEase(0), 0);
  assert.equal(dropEase(1), 1);
  let max = 0;
  for (let p = 0; p <= 1; p += 0.01) max = Math.max(max, dropEase(p));
  assert.ok(max > 1.02, 'cubic-bezier(.2,.9,.3,1.3) overshoots, so 1.35→1 dips below 1 and settles');
});

// ---- themes --------------------------------------------------------------------------------------------------

test('theme table: five stages with every field board.js and the UI read', () => {
  assert.deepEqual(THEME_IDS, ['mat', 'neon', 'dojo', 'pixel', 'wood']);
  assert.equal(DEFAULT_THEME, 'mat');
  assert.equal(THEMES_FROM_BOARD, THEMES);
  assert.equal(IDS_FROM_BOARD, THEME_IDS);
  assert.deepEqual(Object.keys(THEMES), THEME_IDS);
  const names = new Set();
  for (const id of THEME_IDS) {
    const t = THEMES[id];
    assert.equal(t.id, id);
    assert.ok(Object.isFrozen(t));
    assert.ok(typeof t.name === 'string' && /[가-힣]/.test(t.name), `${id} has a Korean name`);
    names.add(t.name);
    assert.match(t.accent, /^#[0-9A-F]{6}$/i);
    assert.match(t.ring, /^#[0-9A-F]{6}$/i);
    assert.match(t.backdrop, /^#[0-9A-F]{6}$/i);
    assert.ok(typeof t.pageBg === 'string' && t.pageBg.length > 6);
    assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(t.pageBg), 'no network fetch in a page background');
    assert.equal(typeof t.drawBoard, 'function');
    assert.ok(t.stoneStyle && (t.stoneStyle.kind === 'gloss' || t.stoneStyle.kind === 'pixel'));
    assert.ok(['mat', 'neon', 'pixel', 'wood', 'dojo'].includes(t.placeSound));
    assert.ok(t.frame && typeof t.frame.radius === 'number' && typeof t.frame.shadow === 'string');
  }
  assert.equal(names.size, 5);
  assert.equal(THEMES.mat.name, '배틀 장판');
  assert.ok(THEMES.neon.stoneStyle.blackRim, 'black stones need a rim on the dark neon board');
  assert.equal(getTheme('nope'), THEMES.mat);
  assert.equal(getTheme('pixel'), THEMES.pixel);
});

test('hexToRgb and the fixed-seed PRNG', () => {
  assert.deepEqual(hexToRgb('#FF4757'), [255, 71, 87]);
  assert.deepEqual(hexToRgb('2e9bff'), [46, 155, 255]);
  assert.deepEqual(hexToRgb('#abc'), [170, 187, 204]);
  assert.deepEqual(hexToRgb('nope'), [255, 255, 255]);
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

// ---- fake canvas / DOM ----------------------------------------------------------------------------------------

function fakeContext(log, canvas = { width: 1, height: 1 }) {
  const gradient = { addColorStop() {} };
  const state = {};
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'canvas') return canvas;
      if (prop === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return (...a) => { log && log.push(`${prop}:${a.map((v) => v.toFixed(3)).join(',')}`); return gradient; };
      }
      if (prop === 'createPattern') return () => ({});
      if (prop === 'measureText') return () => ({ width: 0 });
      return (...a) => { log && log.push(`${String(prop)}:${a.map((v) => (typeof v === 'number' ? v.toFixed(3) : typeof v)).join(',')}`); };
    },
    set(target, prop, value) { target[prop] = value; log && log.push(`=${String(prop)}`); return true; },
  });
}

class FakeEl {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.dataset = {};
    this.className = '';
    this.attrs = {};
    this.width = 0; this.height = 0;
    this.clientWidth = 0; this.clientHeight = 0;
    const props = {};
    this.style = new Proxy(props, {
      get: (t, p) => (p === 'setProperty' ? (k, v) => { t[k] = v; } : p === 'getPropertyValue' ? (k) => t[k] || '' : t[p] ?? ''),
      set: (t, p, v) => { t[p] = v; return true; },
    });
    const cls = new Set();
    this.classList = { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c), add: (c) => cls.add(c) };
    this.animations = 0;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...els) { for (const e of els) this.appendChild(e); }
  appendChild(e) { e.parentNode = this; this.children.push(e); return e; }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; } }
  addEventListener(type, fn) { (this.listeners[type] ||= new Set()).add(fn); }
  removeEventListener(type, fn) { this.listeners[type]?.delete(fn); }
  fire(type, e) { for (const fn of this.listeners[type] || []) fn(e); }
  getContext() { return (this.ctx ||= fakeContext(null, this)); }
  getBoundingClientRect() {
    const w = parseFloat(this.style.width) || 0, h = parseFloat(this.style.height) || 0;
    return { left: 0, top: 0, width: w, height: h, right: w, bottom: h };
  }
  setPointerCapture() {}
  animate() { this.animations++; return { cancel() {} }; }
  get offsetHeight() { return 0; }
}

function fakeDom({ width = 381, height = 381, dpr = 3 } = {}) {
  const frames = [];
  const doc = {
    listeners: {},
    visibilityState: 'visible',
    createElement: (tag) => new FakeEl(doc, tag),
    getElementById: (id) => doc.head.children.find((c) => c.id === id) || null,
    addEventListener(t, fn) { (doc.listeners[t] ||= new Set()).add(fn); },
    removeEventListener(t, fn) { doc.listeners[t]?.delete(fn); },
  };
  doc.head = new FakeEl(doc, 'head');
  doc.body = new FakeEl(doc, 'body');
  doc.documentElement = new FakeEl(doc, 'html');
  const view = {
    devicePixelRatio: dpr, innerWidth: 393, innerHeight: 852,
    listeners: {},
    getComputedStyle: () => ({ position: 'relative', paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px' }),
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => {},
    addEventListener(t, fn) { (view.listeners[t] ||= new Set()).add(fn); },
    removeEventListener(t, fn) { view.listeners[t]?.delete(fn); },
  };
  doc.defaultView = view;
  const host = new FakeEl(doc, 'div');
  host.clientWidth = width;
  host.clientHeight = height;
  // Run the frames queued so far (a few rounds). Animations such as the armed pulse keep asking
  // for frames, so draining until empty would never end.
  const flush = (rounds = 3) => { for (let k = 0; k < rounds && frames.length; k++) frames.splice(0).forEach((fn) => fn(0)); };
  return { doc, view, host, flush };
}

// performance.now() under test control (the board reads globalThis.performance at call time)
const realPerf = globalThis.performance;
let clock = 10_000;
function useClock() {
  Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
}
function restoreClock() {
  Object.defineProperty(globalThis, 'performance', { value: realPerf, configurable: true, writable: true });
}

test('themes: every drawBoard and drawStone runs against a 2D context, deterministically', () => {
  const saved = globalThis.document;
  const { doc } = fakeDom();
  globalThis.document = doc;
  try {
    for (const id of THEME_IDS) {
      for (const [size, dpr] of [[363, 3], [381, 3], [300, 2]]) {
        const g = geometry(size, dpr);
        const a = [], b = [];
        THEMES[id].drawBoard(fakeContext(a), g);
        THEMES[id].drawBoard(fakeContext(b), g);
        assert.ok(a.length > 50, `${id} draws something`);
        assert.deepEqual(a, b, `${id} is the same every time (fixed seeds)`);
        for (const color of [1, 2]) {
          const s = [];
          drawStone(fakeContext(s), 40, 40, g.cellDev * STONE_R, color, THEMES[id].stoneStyle, pixelUnit(g));
          assert.ok(s.length > 3, `${id} stone ${color}`);
        }
      }
    }
    assert.equal(pixelUnit(geometry(363, 3)), 6);
    assert.equal(pixelUnit(geometry(100, 1)), 1);
  } finally {
    globalThis.document = saved;
  }
});

// ---- createBoard through the fake DOM ----------------------------------------------------------------------

function mount(opts = {}, dom = {}) {
  const d = fakeDom(dom);
  const calls = { commit: [], arm: [], reject: [], sfx: [] };
  const verdicts = new Map();
  const board = createBoard(d.host, {
    canPlace: (i) => verdicts.get(i) || { ok: true },
    onCommit: (i) => calls.commit.push(i),
    onArm: (i) => calls.arm.push(i),
    onReject: (i, r) => calls.reject.push([i, r]),
    sfx: (n) => calls.sfx.push(n),
    ...opts,
  });
  const g = geometry(parseFloat(board.el.style.width), d.view.devicePixelRatio);
  const pt = (x, y) => { const [cx, cy] = cellCenter(idx(x, y), g); return { clientX: cx, clientY: cy }; };
  const ev = (p, extra = {}) => ({ pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, ...p, ...extra });
  const tap = (x, y) => {
    const p = pt(x, y);
    board.el.fire('pointerdown', ev(p));
    clock += 60;
    board.el.fire('pointerup', ev(p));
    clock += 300;
    d.flush();
  };
  return { ...d, board, calls, verdicts, g, pt, ev, tap };
}

test('createBoard: the API of SPEC §8.3, mounted into the host', () => {
  useClock();
  try {
    const { board, host, doc, flush } = mount();
    for (const k of ['setPosition', 'place', 'remove', 'setTurn', 'setLocked', 'armed', 'clearArmed', 'commitArmed',
      'showWin', 'flashForbidden', 'setForbiddenMarks', 'setTheme', 'setInput', 'resize', 'destroy']) {
      assert.equal(typeof board[k], 'function', k);
    }
    assert.equal(board.el.parentNode, host);
    assert.equal(board.el.className, 'omok-board');
    const layer = board.el.children[0];
    assert.equal(layer.children.filter((c) => c.tagName === 'CANVAS').length, 3, 'board / stones / fx');
    assert.equal(board.el.style.width, '381px');
    assert.equal(layer.children[0].width, 1143, 'backing store at DPR 3');
    assert.ok(doc.getElementById('omok-board-style'), 'stylesheet injected once');
    assert.equal(board.el.dataset.theme, 'mat');
    assert.equal(board.armed(), -1);
    const b = new Int8Array(N * N);
    b[idx(7, 7)] = 1; b[idx(8, 7)] = 2;
    board.setPosition(b, idx(8, 7));
    board.place(idx(9, 9), 1);
    board.place(idx(9, 10), 2, { animate: false });
    board.remove(idx(9, 10));
    board.setTurn(2, '#2E9BFF');
    assert.equal(board.el.style['--omok-accent'], '#2E9BFF');
    board.setForbiddenMarks([idx(1, 1)]);
    board.setForbiddenMarks(null);
    board.setTheme('neon');
    assert.equal(board.el.dataset.theme, 'neon');
    board.setTheme('pixel');
    clock += 2000;
    flush();
    board.resize();
    board.destroy();
    assert.equal(board.el.parentNode, null);
    board.destroy();     // twice is harmless
  } finally {
    restoreClock();
  }
});

test('createBoard: tap arms with sfx, second tap commits once, then a 250 ms lock', () => {
  useClock();
  try {
    const { board, calls, tap, pt, ev } = mount();
    tap(7, 7);
    assert.equal(board.armed(), idx(7, 7));
    assert.deepEqual(calls.arm, [idx(7, 7)]);
    assert.deepEqual(calls.sfx, ['arm']);
    assert.deepEqual(calls.commit, []);
    const p = pt(7, 7);
    board.el.fire('pointerdown', ev(p));
    board.el.fire('pointerup', ev(p));
    assert.deepEqual(calls.commit, [idx(7, 7)]);
    assert.equal(board.armed(), -1);
    board.el.fire('pointerdown', ev(pt(3, 3)));
    board.el.fire('pointerup', ev(pt(3, 3)));
    assert.equal(board.armed(), -1, 'locked for 250 ms');
    clock += 260;
    tap(3, 3);
    assert.equal(board.armed(), idx(3, 3));
    board.destroy();
  } finally {
    restoreClock();
  }
});

test('createBoard: secondary pointers, right clicks and other pointer ids are ignored', () => {
  useClock();
  try {
    const { board, pt, ev } = mount();
    board.el.fire('pointerdown', ev(pt(7, 7), { isPrimary: false }));
    board.el.fire('pointerup', ev(pt(7, 7), { isPrimary: false }));
    assert.equal(board.armed(), -1);
    board.el.fire('pointerdown', ev(pt(7, 7), { pointerType: 'mouse', button: 2 }));
    board.el.fire('pointerup', ev(pt(7, 7), { pointerType: 'mouse', button: 2 }));
    assert.equal(board.armed(), -1);
    board.el.fire('pointerdown', ev(pt(7, 7)));
    board.el.fire('pointerup', ev(pt(7, 7), { pointerId: 9 }));   // someone else's finger
    assert.equal(board.armed(), -1);
    board.el.fire('pointerup', ev(pt(7, 7)));
    assert.equal(board.armed(), idx(7, 7));
    board.destroy();
  } finally {
    restoreClock();
  }
});

test('createBoard: occupied says "톡", forbidden shakes and reports, lock and cancel', () => {
  useClock();
  try {
    const { board, calls, verdicts, tap, pt, ev } = mount();
    tap(5, 5);
    verdicts.set(idx(6, 6), { ok: false, reason: 'occupied' });
    tap(6, 6);
    assert.deepEqual(calls.reject.at(-1), [idx(6, 6), 'occupied']);
    assert.equal(calls.sfx.at(-1), 'occupied');
    assert.equal(board.armed(), idx(5, 5));
    verdicts.set(idx(8, 8), { ok: false, reason: '33' });
    const layer = board.el.children[0];
    const before = layer.animations;
    tap(8, 8);
    assert.deepEqual(calls.reject.at(-1), [idx(8, 8), '33']);
    assert.equal(board.armed(), -1);
    assert.equal(layer.animations, before + 1, 'the board shook');
    // no shake when the app asks for reduced motion, or when shake is off
    board.el.ownerDocument.documentElement.dataset.motion = 'reduce';
    board.flashForbidden(idx(8, 8));
    assert.equal(layer.animations, before + 1);
    delete board.el.ownerDocument.documentElement.dataset.motion;
    // a press in progress is dropped by setLocked(true)
    board.el.fire('pointerdown', ev(pt(2, 2)));
    board.setLocked(true);
    board.el.fire('pointerup', ev(pt(2, 2)));
    assert.equal(board.armed(), -1);
    tap(2, 2);
    assert.equal(board.armed(), -1, 'locked');
    board.setLocked(false);
    tap(2, 2);
    assert.equal(board.armed(), idx(2, 2));
    // pointercancel puts things back
    board.el.fire('pointerdown', ev(pt(9, 9)));
    board.el.fire('pointercancel', ev(pt(9, 9)));
    assert.equal(board.armed(), idx(2, 2));
    board.destroy();
  } finally {
    restoreClock();
  }
});

test('createBoard: shake can be switched off by the app', () => {
  useClock();
  try {
    const { board } = mount({ shake: () => false });
    const layer = board.el.children[0];
    board.flashForbidden(idx(1, 1));
    assert.equal(layer.animations, 0);
    board.destroy();
  } finally {
    restoreClock();
  }
});

test('createBoard: setTurn to the other colour, setPosition and commitArmed drop the armed point', () => {
  useClock();
  try {
    const { board, calls, verdicts, tap } = mount();
    tap(4, 4);
    board.setTurn(1, '#FF4757');
    assert.equal(board.armed(), idx(4, 4), 'same colour: kept');
    board.setTurn(2, '#2E9BFF');
    assert.equal(board.armed(), -1, 'turn changed: dropped');
    tap(4, 4);
    board.setPosition(new Int8Array(N * N), -1);
    assert.equal(board.armed(), -1);
    tap(4, 4);
    assert.equal(board.commitArmed(), idx(4, 4));
    assert.deepEqual(calls.commit, [], 'commitArmed reports by return value, not onCommit');
    assert.equal(board.commitArmed(), -1);
    clock += 300;
    tap(6, 4);
    verdicts.set(idx(6, 4), { ok: false, reason: '33' });
    assert.equal(board.commitArmed(), -1, 'an armed point that went bad is not played');
    assert.equal(board.armed(), -1);
    board.destroy();
  } finally {
    restoreClock();
  }
});

test('createBoard: single-tap input and setInput', () => {
  useClock();
  try {
    const { board, calls, tap } = mount({ input: 'single' });
    tap(7, 7);
    assert.deepEqual(calls.commit, [idx(7, 7)]);
    board.setInput('double');
    tap(9, 9);
    assert.equal(board.armed(), idx(9, 9));
    assert.equal(calls.commit.length, 1);
    board.destroy();
  } finally {
    restoreClock();
  }
});

test('createBoard: showWin resolves after the line and the pulses, and early on setPosition', async () => {
  const { board } = mount();
  const b = new Int8Array(N * N);
  for (let x = 3; x < 8; x++) b[idx(x, 7)] = 1;
  board.setPosition(b, idx(7, 7));
  const t0 = Date.now();
  await board.showWin([[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]]);
  const took = Date.now() - t0;
  assert.ok(took >= 400 && took < 1500, `~420 ms (took ${took})`);
  const p = board.showWin([[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]]);
  board.setPosition(new Int8Array(N * N), -1);
  await p;   // would hang if setPosition did not settle it
  await board.showWin([]);
  board.destroy();
});

test('createBoard: an auto-height host gets a square board from its width, capped at 560', () => {
  const { board } = mount({}, { width: 393, height: 0 });
  assert.equal(board.el.style.position, 'relative');
  assert.equal(board.el.style.width, '393px');
  board.destroy();
  const big = mount({}, { width: 900, height: 700 });
  assert.equal(big.board.el.style.width, '560px');
  assert.equal(big.board.el.style.position, 'absolute');
  assert.equal(big.board.el.style.left, '170px');
  assert.equal(big.board.el.style.top, '70px');
  big.board.destroy();
});
