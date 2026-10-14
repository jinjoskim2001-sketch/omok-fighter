// js/themes.js — the five board stages (docs/SPEC.md §5, docs/research/ux.md §3).
//
// A theme knows how to paint three things and nothing else:
//   drawBoard(ctx, geom)  the static board, once per theme / size change (never per frame)
//   drawStone(...)        one stone, once per theme / size into an off-screen sprite (board.js)
//   pageBg                the battle screen's CSS background, applied by the UI
// plus the colours board.js needs for its overlays. No DOM access at import time, so this
// module loads in Node for the tests.
//
// drawBoard contract: ctx is already scaled to CSS px (setTransform(dpr,…)) and clipped to the
// board's rounded square; geom = geometry() from board.js, i.e. { size, cell, pad, dpr, dev,
// cellDev, padDev, r }. Intersection i sits at pad + i*cell, and pad/cell are whole device
// pixels, so a theme that wants a razor-sharp line draws it in device px (see crispGrid).
// Everything random uses a fixed seed: the board must look the same on every launch, resize
// and device, or a hand-drawn line would "move" between rounds.

export const THEME_IDS = ['mat', 'neon', 'dojo', 'pixel', 'wood'];
export const DEFAULT_THEME = 'mat';

const LINES = 15;
const STAR_POINTS = [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]];

// ---- small helpers ------------------------------------------------------------------------------

// Fixed-seed PRNG (same as pumal's lcd.js grain).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Off-screen canvases come from the document of the canvas being painted (right in an iframe,
// and in the tests' fake DOM), falling back to the global document.
let canvasDoc = null;
function makeCanvas(w, h) {
  const c = (canvasDoc || globalThis.document).createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function hexToRgb(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Rounded rectangle path, written by hand because CanvasRenderingContext2D.roundRect is
// missing on older iOS (same reasoning as pumal's lcd.js).
export function roundRectPath(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  if (rr) g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr);
  if (rr) g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h);
  if (rr) g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr);
  if (rr) g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}

const at = (g, i) => g.pad + i * g.cell;

// Straight grid as filled device-pixel rectangles: every line is exactly `w` device px wide
// whatever the DPR, with no anti-aliased half pixels. All rects go into ONE path and one
// fill(), so a translucent colour does not double up where lines cross.
function crispGrid(ctx, g, color, lineCss, borderCss) {
  const d = g.dpr;
  const lw = Math.max(1, Math.round(lineCss * d));
  const bw = Math.max(1, Math.round(borderCss * d));
  const p = g.padDev, c = g.cellDev, span = (LINES - 1) * c;
  const half = (t) => Math.floor(t / 2);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  for (let i = 0; i < LINES; i++) {
    const t = i === 0 || i === LINES - 1 ? bw : lw;
    const o = p + i * c - half(t);
    ctx.rect(o, p - half(bw), t, span + bw);       // vertical
    ctx.rect(p - half(bw), o, span + bw, t);       // horizontal
  }
  ctx.fillStyle = color;
  ctx.fill('nonzero');
  ctx.restore();
}

// A full-board fill in device px with a pattern made from a tiny canvas (grain, flutes,
// scanlines). Done in device space so a 1-px pattern stays 1 device px at DPR 3.
function devicePatternFill(ctx, g, tile) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const pat = ctx.createPattern(tile, 'repeat');
  if (pat) {
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, g.dev, g.dev);
  }
  ctx.restore();
}

function noiseTile(size, seed, dark, light, amp) {
  const cv = makeCanvas(size, size);
  const x = cv.getContext('2d');
  const img = x.createImageData(size, size);
  const d = img.data;
  const rnd = mulberry32(seed);
  for (let i = 0; i < d.length; i += 4) {
    const v = rnd() * 2 - 1;
    const c = v < 0 ? dark : light;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    d[i + 3] = Math.round(Math.abs(v) * v * v * amp * 255);   // mostly faint, a few strong specks
  }
  x.putImageData(img, 0, 0);
  return cv;
}

// Large, soft unevenness (paper pulp, damp spots): a tiny random tile stretched over the board
// with smoothing on, so it becomes blotches rather than grain.
function mottle(ctx, g, seed, cells, dark, light, amp) {
  const cv = makeCanvas(cells, cells);
  const x = cv.getContext('2d');
  const img = x.createImageData(cells, cells);
  const d = img.data;
  const rnd = mulberry32(seed);
  for (let i = 0; i < d.length; i += 4) {
    const v = rnd() * 2 - 1;
    const c = v < 0 ? dark : light;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    d[i + 3] = Math.round(Math.abs(v) * amp * 255);
  }
  x.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cv, 0, 0, cells, cells, -g.size * 0.03, -g.size * 0.03, g.size * 1.06, g.size * 1.06);
  ctx.restore();
}

// ---- 배틀 장판 (mat): a b-boy cardboard battle mat ---------------------------------------------
// Kraft liner over corrugation, rubber scuffs from spins, a spray-painted cypher ring,
// a hand-drawn marker grid, silver duct tape holding the corners down and two crew stickers.

const KRAFT = '#C9A06A';
const MARKER = [30, 26, 22];

function matFlutes(ctx, g) {
  const w = Math.max(3, Math.round(7 * g.dpr));
  const cv = makeCanvas(w, 1);
  const x = cv.getContext('2d');
  for (let i = 0; i < w; i++) {
    const s = Math.cos(((i + 0.5) / w) * Math.PI * 2);
    x.fillStyle = s < 0 ? rgba([70, 42, 14], 0.06 * -s) : rgba([255, 238, 205], 0.05 * s);
    x.fillRect(i, 0, 1, 1);
  }
  devicePatternFill(ctx, g, cv);
}

function matFibers(ctx, g, rnd) {
  const S = g.size;
  const count = Math.round((S * S) / 42);
  const buckets = [
    { c: 'rgba(238,208,156,.30)', p: new Path2DLike() },
    { c: 'rgba(248,226,186,.22)', p: new Path2DLike() },
    { c: 'rgba(118,78,38,.20)', p: new Path2DLike() },
    { c: 'rgba(92,58,26,.13)', p: new Path2DLike() },
  ];
  for (let k = 0; k < count; k++) {
    const b = buckets[(rnd() * buckets.length) | 0];
    const x = rnd() * S, y = rnd() * S;
    const len = 1.2 + rnd() * rnd() * 6;
    const a = rnd() * Math.PI;
    b.p.add(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
  }
  ctx.lineWidth = Math.max(0.45, 1 / g.dpr);
  ctx.lineCap = 'round';
  for (const b of buckets) {
    ctx.beginPath();
    b.p.replay(ctx);
    ctx.strokeStyle = b.c;
    ctx.stroke();
  }
}

// Collects line segments so one beginPath/stroke covers thousands of fibres.
function Path2DLike() { this.s = []; }
Path2DLike.prototype.add = function (x0, y0, x1, y1) { this.s.push(x0, y0, x1, y1); };
Path2DLike.prototype.replay = function (ctx) {
  const s = this.s;
  for (let i = 0; i < s.length; i += 4) { ctx.moveTo(s[i], s[i + 1]); ctx.lineTo(s[i + 2], s[i + 3]); }
};

function blot(ctx, x, y, r, rgb, a) {
  const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(rgb, a));
  gr.addColorStop(0.6, rgba(rgb, a * 0.45));
  gr.addColorStop(1, rgba(rgb, 0));
  ctx.fillStyle = gr;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function matWear(ctx, g, rnd) {
  const S = g.size, c = g.cell;
  // polished, lighter patches where feet slide, and darker grime blots
  for (let k = 0; k < 3; k++) blot(ctx, S * (0.2 + rnd() * 0.6), S * (0.2 + rnd() * 0.6), c * (2 + rnd() * 2.5), [255, 236, 200], 0.10);
  for (let k = 0; k < 4; k++) blot(ctx, S * rnd(), S * rnd(), c * (1.2 + rnd() * 2), [92, 58, 26], 0.08 + rnd() * 0.06);
  // rubber skid arcs left by windmills and headspins
  ctx.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const cx = S * (0.15 + rnd() * 0.7), cy = S * (0.15 + rnd() * 0.7);
    const r = c * (1.6 + rnd() * 2.6), a0 = rnd() * Math.PI * 2, span = 0.7 + rnd() * 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a0 + span);
    ctx.strokeStyle = 'rgba(58,36,18,.075)';
    ctx.lineWidth = c * (0.14 + rnd() * 0.22);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r + c * 0.05, a0 + span * 0.15, a0 + span * 0.8);
    ctx.strokeStyle = 'rgba(40,24,10,.07)';
    ctx.lineWidth = Math.max(0.6, c * 0.035);
    ctx.stroke();
  }
}

// The cypher: a battle circle in white spray paint, rough and oversprayed.
function matCypher(ctx, g, rnd) {
  const S = g.size, c = g.cell;
  const cx = S / 2, cy = S / 2, R = c * 4.62;
  ctx.lineCap = 'round';
  const segs = 72;
  for (let pass = 0; pass < 3; pass++) {
    const width = c * [0.62, 0.36, 0.2][pass];
    const alpha = [0.035, 0.06, 0.08][pass];
    for (let k = 0; k < segs; k++) {
      if (pass > 0 && rnd() < 0.06) continue;              // the can sputters now and then
      const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1.15) / segs) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R + (rnd() - 0.5) * c * 0.06, a0, a1);
      ctx.strokeStyle = `rgba(255,250,240,${(alpha * (0.75 + rnd() * 0.5)).toFixed(3)})`;
      ctx.lineWidth = width * (0.85 + rnd() * 0.3);
      ctx.stroke();
    }
  }
  // overspray specks
  ctx.fillStyle = 'rgba(255,250,240,.16)';
  ctx.beginPath();
  for (let k = 0; k < 420; k++) {
    const a = rnd() * Math.PI * 2, d = R + (rnd() + rnd() + rnd() - 1.5) * c * 0.55;
    const s = 0.25 + rnd() * 0.55;
    ctx.moveTo(cx + Math.cos(a) * d + s, cy + Math.sin(a) * d);
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s, 0, Math.PI * 2);
  }
  ctx.fill();
}

// A cup ring someone left at the side of the cypher.
function matStain(ctx, g, rnd) {
  const c = g.cell;
  const x = at(g, 11.5), y = at(g, 12.55), r = c * 0.82;
  ctx.fillStyle = 'rgba(120,70,25,.035)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.lineCap = 'round';
  for (let k = 0; k < 2; k++) {
    ctx.beginPath();
    const a0 = rnd() * Math.PI, span = Math.PI * (1.3 + rnd() * 0.6);
    ctx.arc(x + k * c * 0.05, y - k * c * 0.03, r * (1 - k * 0.04), a0, a0 + span);
    ctx.strokeStyle = `rgba(104,58,20,${k ? 0.08 : 0.15})`;
    ctx.lineWidth = c * (k ? 0.03 : 0.05);
    ctx.stroke();
  }
}

function matEdge(ctx, g) {
  const S = g.size, w = g.cell * 0.42;
  const sides = [
    [0, 0, 0, w, 0, 0, S, w], [0, S, 0, S - w, 0, S - w, S, w],
    [0, 0, w, 0, 0, 0, w, S], [S, 0, S - w, 0, S - w, 0, w, S],
  ];
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of sides) {
    const gr = ctx.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(74,46,18,.30)');
    gr.addColorStop(1, 'rgba(74,46,18,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(rx, ry, rw, rh);
  }
  const one = 1 / g.dpr;
  ctx.lineWidth = Math.max(one, 1);
  ctx.strokeStyle = 'rgba(255,236,200,.28)';
  ctx.beginPath(); roundRectPath(ctx, 1.5, 1.5, S - 3, S - 3, 4); ctx.stroke();
  ctx.strokeStyle = 'rgba(60,36,14,.55)';
  ctx.beginPath(); roundRectPath(ctx, 0.5, 0.5, S - 1, S - 1, 5); ctx.stroke();
}

// One hand-drawn marker stroke: a quadratic that bows at most `wob` px off the straight line.
function wobblyLine(ctx, x0, y0, x1, y1, rnd, wob) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
  const off = (rnd() * 2 - 1) * wob;
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2 + nx * off * 2, (y0 + y1) / 2 + ny * off * 2, x1, y1);
}

function matGrid(ctx, g, rnd) {
  const c = g.cell, a = at(g, 0), b = at(g, LINES - 1);
  const j = (s) => (rnd() * 2 - 1) * s;
  const inner = [], border = [];
  for (let i = 1; i < LINES - 1; i++) {
    const p = at(g, i);
    inner.push([p + j(0.3), a + j(0.3), p + j(0.3), b + j(0.3)]);
    inner.push([a + j(0.3), p + j(0.3), b + j(0.3), p + j(0.3)]);
  }
  // the outer square: four separate strokes that cross at the corners, like a marker would
  const ov = c * 0.13;
  border.push([a - ov + j(0.6), a + j(0.4), b + ov + j(0.6), a + j(0.4)]);
  border.push([b + j(0.4), a - ov + j(0.6), b + j(0.4), b + ov + j(0.6)]);
  border.push([b + ov + j(0.6), b + j(0.4), a - ov + j(0.6), b + j(0.4)]);
  border.push([a + j(0.4), b + ov + j(0.6), a + j(0.4), a - ov + j(0.6)]);
  const trace = (list) => {
    const r2 = mulberry32(0x5EED);   // same bows for the bleed, core and density passes
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of list) wobblyLine(ctx, x0, y0, x1, y1, r2, 0.4);
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // ink bleeding into the fibres
  trace(inner); ctx.strokeStyle = rgba(MARKER, 0.09); ctx.lineWidth = 2.7; ctx.stroke();
  // the stroke itself
  trace(inner); ctx.strokeStyle = rgba(MARKER, 0.85); ctx.lineWidth = 1.5; ctx.stroke();
  // marker ink is never perfectly even: a few denser runs where the tip lingered
  ctx.save();
  const dashes = [];
  for (let k = 0; k < 16; k++) dashes.push(4 + rnd() * 26, 10 + rnd() * 40);
  ctx.setLineDash(dashes);
  trace(inner); ctx.strokeStyle = rgba(MARKER, 0.16); ctx.lineWidth = 1.2; ctx.stroke();
  ctx.restore();
  trace(border); ctx.strokeStyle = rgba(MARKER, 0.1); ctx.lineWidth = 3.8; ctx.stroke();
  trace(border); ctx.strokeStyle = rgba(MARKER, 0.88); ctx.lineWidth = 2.5; ctx.stroke();
  // 화점: dabbed marker dots, slightly lopsided
  for (const [x, y] of STAR_POINTS) {
    const cx = at(g, x) + j(0.25), cy = at(g, y) + j(0.25), r = c * 0.12;
    ctx.fillStyle = rgba(MARKER, 0.9);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba(MARKER, 0.45);
    ctx.beginPath(); ctx.arc(cx + j(r * 0.35), cy + j(r * 0.35), r * 0.9, 0, Math.PI * 2); ctx.fill();
  }
}

// Silver duct tape across one corner, running from one edge to the other so both torn ends
// are folded under the board and only the glossy, slightly frayed band shows.
function matTape(ctx, g, corner, rnd) {
  const S = g.size, c = g.cell;
  const sx = corner === 1 || corner === 2 ? -1 : 1;   // 0 TL, 1 TR, 2 BR, 3 BL
  const sy = corner >= 2 ? -1 : 1;
  const ox = sx > 0 ? 0 : S, oy = sy > 0 ? 0 : S;
  const t = c * 0.4;
  const L = c * 2.8, W = c * 0.56;
  const ang = Math.atan2(-sy, sx) + (rnd() - 0.5) * 0.18;
  ctx.save();
  ctx.translate(ox + sx * t, oy + sy * t);
  ctx.rotate(ang);
  const edge = (y0, sign) => {
    const pts = [];
    const n = 14;
    for (let k = 0; k <= n; k++) pts.push([-L / 2 + (L * k) / n, y0 + sign * rnd() * c * 0.025]);
    return pts;
  };
  const top = edge(-W / 2, 1), bot = edge(W / 2, -1).reverse();
  const shape = () => {
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1]);
    for (const [x, y] of top) ctx.lineTo(x, y);
    for (const [x, y] of bot) ctx.lineTo(x, y);
    ctx.closePath();
  };
  // the tape stands a hair off the cardboard: soft shadow below
  ctx.save();
  ctx.translate(0, Math.max(0.6, c * 0.035));
  shape(); ctx.fillStyle = 'rgba(52,32,12,.30)'; ctx.fill();
  ctx.restore();
  const gr = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
  gr.addColorStop(0, '#9DA1A8');
  gr.addColorStop(0.16, '#D9DCE1');
  gr.addColorStop(0.3, '#F4F6F8');
  gr.addColorStop(0.46, '#C3C7CC');
  gr.addColorStop(0.8, '#ABAFB5');
  gr.addColorStop(1, '#8C9097');
  ctx.globalAlpha = 0.93;
  shape(); ctx.fillStyle = gr; ctx.fill();
  ctx.save();
  shape(); ctx.clip();
  // woven scrim showing through: threads along the tape and a looser cross weave
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(0.35, 0.8 / g.dpr);
  ctx.strokeStyle = 'rgba(70,74,82,.09)';
  ctx.beginPath();
  for (let y = -W / 2; y < W / 2; y += 1.1) { ctx.moveTo(-L / 2, y); ctx.lineTo(L / 2, y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.045)';
  ctx.beginPath();
  for (let x = -L / 2; x < L / 2; x += 1.3) { ctx.moveTo(x, -W / 2); ctx.lineTo(x + 0.4, W / 2); }
  ctx.stroke();
  // the sheen of the PE film: one soft specular streak along the tape
  const sh = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
  sh.addColorStop(0.18, 'rgba(255,255,255,0)');
  sh.addColorStop(0.3, 'rgba(255,255,255,.45)');
  sh.addColorStop(0.42, 'rgba(255,255,255,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(-L / 2, -W / 2, L, W);
  // two creases where it was pressed down over the corner
  for (let k = 0; k < 2; k++) {
    const x = (rnd() - 0.5) * L * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, -W / 2); ctx.lineTo(x + (rnd() - 0.5) * W, W / 2);
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 1, -W / 2); ctx.lineTo(x + 1 + (rnd() - 0.5) * W, W / 2);
    ctx.strokeStyle = 'rgba(60,64,70,.14)'; ctx.lineWidth = 0.8; ctx.stroke();
  }
  ctx.restore();
  // crisp edges: a bright lip on top, a darker one below
  ctx.globalAlpha = 1;
  ctx.lineWidth = 0.7;
  ctx.beginPath(); top.forEach(([x, y], k) => (k ? ctx.lineTo(x, y + 0.4) : ctx.moveTo(x, y + 0.4)));
  ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.stroke();
  ctx.beginPath(); bot.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = 'rgba(70,74,80,.55)'; ctx.stroke();
  ctx.restore();
}

// Die-cut vinyl sticker: white border, ink outline, flat colour, a little highlight.
function sticker(ctx, x, y, rot, scale, pathFn, fill) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // shadow so it reads as stuck on top
  ctx.save(); ctx.translate(0.06, 0.1); pathFn(ctx);
  ctx.strokeStyle = 'rgba(40,24,8,.35)'; ctx.lineWidth = 0.34; ctx.stroke(); ctx.restore();
  pathFn(ctx);
  ctx.strokeStyle = '#FFF8EC'; ctx.lineWidth = 0.3; ctx.stroke();
  pathFn(ctx);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = '#2A1E2F'; ctx.lineWidth = 0.09; ctx.stroke();
  ctx.restore();
}

function starPath(ctx) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 0.42 : 1, a = -Math.PI / 2 + (k * Math.PI) / 5;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function boltPath(ctx) {
  ctx.beginPath();
  const pts = [[0.25, -1], [-0.55, 0.12], [-0.02, 0.12], [-0.3, 1], [0.58, -0.22], [0.04, -0.22], [0.38, -1]];
  pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function heartPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(0, 0.95);
  ctx.bezierCurveTo(-0.35, 0.62, -1.02, 0.2, -0.98, -0.32);
  ctx.bezierCurveTo(-0.92, -0.9, -0.22, -1.02, 0, -0.46);
  ctx.bezierCurveTo(0.22, -1.02, 0.92, -0.9, 0.98, -0.32);
  ctx.bezierCurveTo(1.02, 0.2, 0.35, 0.62, 0, 0.95);
  ctx.closePath();
}

// Stickers sit in the margin, straddling the cut edge as if slapped on in a hurry. None is a
// round red or a disc: anything stone-shaped or #FF3B30 would compete with the last-move dot.
function matStickers(ctx, g) {
  const c = g.cell, S = g.size;
  sticker(ctx, at(g, 4.5), c * 0.24, 0.28, c * 0.34, starPath, '#FFD23F');
  sticker(ctx, S - c * 0.25, at(g, 9.5), -0.35, c * 0.32, boltPath, '#B6FF4D');
  sticker(ctx, at(g, 10.5), S - c * 0.22, -0.22, c * 0.29, heartPath, '#FF8FC7');
}

function drawMat(ctx, g) {
  const S = g.size;
  const rnd = mulberry32(0xB0B1E);
  const gr = ctx.createRadialGradient(S * 0.46, S * 0.42, S * 0.05, S * 0.5, S * 0.5, S * 0.8);
  gr.addColorStop(0, '#D5AE77');
  gr.addColorStop(0.55, KRAFT);
  gr.addColorStop(1, '#B38A55');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, S, S);
  mottle(ctx, g, 0xFAB, 22, [120, 80, 36], [255, 236, 196], 0.09);
  devicePatternFill(ctx, g, noiseTile(192, 0xC0FFEE, [86, 54, 20], [255, 240, 210], 0.16));
  matFlutes(ctx, g);
  matFibers(ctx, g, rnd);
  matWear(ctx, g, rnd);
  matCypher(ctx, g, rnd);
  matStain(ctx, g, rnd);
  matEdge(ctx, g);
  matGrid(ctx, g, rnd);
  for (let k = 0; k < 4; k++) matTape(ctx, g, k, rnd);
  matStickers(ctx, g);
}

// ---- 네온 아케이드 (neon) --------------------------------------------------------------------------

function glowStroke(ctx, g, build, color, glow, blurCss, width) {
  ctx.save();
  // shadowBlur is in canvas pixels and ignores the transform, so scale it by hand. It runs
  // once per theme/size change; nothing per frame ever uses shadowBlur.
  ctx.shadowColor = glow;
  ctx.shadowBlur = blurCss * g.dpr;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  build();
  ctx.stroke();
  ctx.stroke();
  ctx.restore();
}

function drawNeon(ctx, g) {
  const S = g.size, c = g.cell;
  ctx.fillStyle = '#0E1030';
  ctx.fillRect(0, 0, S, S);
  let gr = ctx.createRadialGradient(S / 2, S * 0.45, 0, S / 2, S / 2, S * 0.72);
  gr.addColorStop(0, 'rgba(70,44,160,.42)');
  gr.addColorStop(0.6, 'rgba(30,20,90,.18)');
  gr.addColorStop(1, 'rgba(0,0,0,.35)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, S, S);
  // faint sub-grid between the lines: the arcade cabinet's CRT mask
  ctx.fillStyle = 'rgba(25,227,255,.05)';
  ctx.beginPath();
  for (let y = 0; y < LINES - 1; y++) for (let x = 0; x < LINES - 1; x++) {
    const px = at(g, x + 0.5), py = at(g, y + 0.5);
    ctx.moveTo(px + 0.7, py); ctx.arc(px, py, 0.7, 0, Math.PI * 2);
  }
  ctx.fill();
  const a = at(g, 0), b = at(g, LINES - 1);
  const inner = () => {
    ctx.beginPath();
    for (let i = 1; i < LINES - 1; i++) {
      const p = at(g, i);
      ctx.moveTo(p, a); ctx.lineTo(p, b);
      ctx.moveTo(a, p); ctx.lineTo(b, p);
    }
  };
  glowStroke(ctx, g, inner, 'rgba(25,227,255,.55)', 'rgba(25,227,255,.8)', 6, 1);
  crispGrid(ctx, g, 'rgba(120,240,255,.85)', 1 / g.dpr, 1 / g.dpr);
  // magenta frame on the outermost lines
  const frame = () => { ctx.beginPath(); ctx.rect(a, a, b - a, b - a); };
  glowStroke(ctx, g, frame, '#FF2BD6', 'rgba(255,43,214,.9)', 9, 2);
  ctx.strokeStyle = '#FFB3F1';
  ctx.lineWidth = Math.max(1 / g.dpr, 0.67);
  frame(); ctx.stroke();
  // outer cabinet trim
  ctx.strokeStyle = 'rgba(255,43,214,.35)';
  ctx.lineWidth = 1;
  ctx.beginPath(); roundRectPath(ctx, c * 0.18, c * 0.18, S - c * 0.36, S - c * 0.36, c * 0.3); ctx.stroke();
  // 화점: magenta diamonds
  ctx.save();
  ctx.shadowColor = 'rgba(255,43,214,.95)';
  ctx.shadowBlur = 7 * g.dpr;
  ctx.fillStyle = '#FF5BE0';
  for (const [x, y] of STAR_POINTS) {
    const px = at(g, x), py = at(g, y), r = c * 0.15;
    ctx.beginPath();
    ctx.moveTo(px, py - r); ctx.lineTo(px + r, py); ctx.lineTo(px, py + r); ctx.lineTo(px - r, py); ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // scanlines over the grid, under the stones (stones live on their own canvas above)
  const h = Math.max(3, Math.round(3 * g.dpr));
  const tile = makeCanvas(1, h);
  const t = tile.getContext('2d');
  t.fillStyle = 'rgba(255,255,255,.035)';
  t.fillRect(0, 0, 1, Math.max(1, Math.round(g.dpr)));
  devicePatternFill(ctx, g, tile);
  gr = ctx.createLinearGradient(0, 0, 0, S);
  gr.addColorStop(0, 'rgba(255,43,214,.06)');
  gr.addColorStop(0.5, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(25,227,255,.06)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, S, S);
}

// ---- 수련 도장 (dojo): tatami ------------------------------------------------------------------------

function drawDojo(ctx, g) {
  const S = g.size, c = g.cell;
  const rnd = mulberry32(0xD0D0);
  let gr = ctx.createLinearGradient(0, 0, S, S);
  gr.addColorStop(0, '#D4C788');
  gr.addColorStop(0.5, '#CDBF7E');
  gr.addColorStop(1, '#C2B271');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, S, S);
  // woven rush: one strand every ~2.4 px, each a slightly different shade
  for (let y = 0; y < S; y += 2.4) {
    const v = rnd();
    ctx.fillStyle = v < 0.55 ? `rgba(80,70,20,${(0.06 + rnd() * 0.08).toFixed(3)})` : `rgba(255,250,215,${(0.05 + rnd() * 0.07).toFixed(3)})`;
    ctx.fillRect(0, y, S, 1.1);
  }
  mottle(ctx, g, 0xDA7A, 18, [96, 84, 30], [255, 248, 210], 0.07);
  devicePatternFill(ctx, g, noiseTile(160, 0x7A7A, [70, 60, 20], [255, 250, 220], 0.14));
  // 縁 (heri): navy cloth bands, top and bottom, with a gold diamond weave
  const hb = c * 0.36;
  for (const y0 of [0, S - hb]) {
    ctx.fillStyle = '#1F2A44';
    ctx.fillRect(0, y0, S, hb);
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(0, y0 + hb * 0.15, S, hb * 0.1);
    ctx.strokeStyle = '#C9A227';
    ctx.lineWidth = Math.max(0.6, c * 0.025);
    ctx.beginPath();
    ctx.moveTo(0, y0 + hb * 0.12); ctx.lineTo(S, y0 + hb * 0.12);
    ctx.moveTo(0, y0 + hb * 0.88); ctx.lineTo(S, y0 + hb * 0.88);
    ctx.stroke();
    ctx.fillStyle = '#C9A227';
    const d = hb * 0.3, step = hb * 1.05;
    for (let x = step / 2; x < S; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, y0 + hb / 2 - d); ctx.lineTo(x + d, y0 + hb / 2); ctx.lineTo(x, y0 + hb / 2 + d); ctx.lineTo(x - d, y0 + hb / 2);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(0, y0 === 0 ? hb : y0 - 1, S, 1);
  }
  // lacquer rails left and right: black, with a red-lacquer inlay and a gold pinstripe. Mostly
  // black on purpose: an all-red rail would vanish under 1P's red turn glow.
  const rw = c * 0.24;
  for (const [x0, inner] of [[0, rw], [S - rw, 0]]) {
    gr = ctx.createLinearGradient(x0, 0, x0 + rw, 0);
    gr.addColorStop(0, '#0E0908'); gr.addColorStop(0.5, '#2A1C18'); gr.addColorStop(1, '#0E0908');
    ctx.fillStyle = gr;
    ctx.fillRect(x0, hb, rw, S - hb * 2);
    ctx.fillStyle = '#8E1B1B';
    ctx.fillRect(x0 + rw * 0.36, hb, rw * 0.28, S - hb * 2);
    ctx.fillStyle = 'rgba(255,200,180,.25)';
    ctx.fillRect(x0 + rw * 0.4, hb, Math.max(0.5, rw * 0.06), S - hb * 2);
    ctx.fillStyle = '#C9A227';
    ctx.fillRect(x0 + inner - (inner ? Math.max(0.6, c * 0.03) : 0), hb, Math.max(0.6, c * 0.03), S - hb * 2);
  }
  ctx.strokeStyle = '#120C08';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0.75, 0.75, S - 1.5, S - 1.5);
  // gold corner fittings
  const f = c * 0.62, th = c * 0.15;
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.translate(k === 1 || k === 2 ? S : 0, k >= 2 ? S : 0);
    ctx.rotate((k * Math.PI) / 2);
    gr = ctx.createLinearGradient(0, 0, f, f);
    gr.addColorStop(0, '#F3D774'); gr.addColorStop(0.5, '#C9A227'); gr.addColorStop(1, '#8A6A12');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(f, 0); ctx.lineTo(f, th); ctx.lineTo(th, th); ctx.lineTo(th, f); ctx.lineTo(0, f); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,24,0,.6)'; ctx.lineWidth = 0.7; ctx.stroke();
    ctx.fillStyle = '#5A4208';
    ctx.beginPath(); ctx.arc(th * 0.55, th * 0.55, th * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  crispGrid(ctx, g, 'rgba(26,26,26,.9)', 1.25, 2);
  // 화점: small red seals
  for (const [x, y] of STAR_POINTS) {
    const s = c * 0.24, px = at(g, x), py = at(g, y);
    ctx.fillStyle = '#B22222';
    ctx.fillRect(px - s / 2, py - s / 2, s, s);
    ctx.strokeStyle = 'rgba(255,225,205,.75)';
    ctx.lineWidth = Math.max(0.5, s * 0.1);
    ctx.strokeRect(px - s * 0.3, py - s * 0.3, s * 0.6, s * 0.6);
  }
}

// ---- 8비트 오락실 (pixel): the four greens of an early handheld LCD ------------------------------------

const LCD = { ink: '#0F380F', dark: '#306230', mid: '#8BAC0F', light: '#9BBC0F', white: '#E8F5C8' };

// Device px per art pixel. 12 art pixels per cell, as the research asks, but snapped to whole
// device pixels so every "pixel" is the same size (an up-scaled low-res canvas would give a mix
// of 5- and 6-px blocks at most board sizes).
export function pixelUnit(g) {
  return Math.max(1, Math.round(g.cellDev / 12));
}

function drawPixel(ctx, g) {
  const P = pixelUnit(g), D = g.dev;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = LCD.ink;
  ctx.fillRect(0, 0, D, D);
  ctx.fillStyle = LCD.dark;
  ctx.fillRect(P, P, D - 2 * P, D - 2 * P);
  ctx.fillStyle = LCD.mid;
  ctx.fillRect(2 * P, 2 * P, D - 4 * P, D - 4 * P);
  // 2x2 dither band just inside the frame, the cartridge-label look
  ctx.fillStyle = LCD.light;
  const inner = 3 * P;
  for (let y = 2 * P; y < D - 2 * P; y += P) {
    for (let x = 2 * P; x < D - 2 * P; x += P) {
      const edge = x < inner || y < inner || x >= D - inner || y >= D - inner;
      if (edge && ((x / P + y / P) & 1)) ctx.fillRect(x, y, P, P);
    }
  }
  ctx.restore();
  // lines: 1 art pixel inside, 2 for the border (2 inner looked like a fence at 24 pt cells)
  crispGrid(ctx, g, LCD.dark, P / g.dpr, (2 * P) / g.dpr);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = LCD.ink;
  for (const [x, y] of STAR_POINTS) {
    const cx = g.padDev + x * g.cellDev, cy = g.padDev + y * g.cellDev;
    ctx.fillRect(cx - P, cy - P, 2 * P, 2 * P);
  }
  ctx.restore();
}

// ---- 클래식 원목 (wood) ---------------------------------------------------------------------------

function drawWood(ctx, g) {
  const S = g.size, c = g.cell;
  const rnd = mulberry32(0x7EAC);
  let gr = ctx.createLinearGradient(0, 0, S, S);
  gr.addColorStop(0, '#E3B96A');
  gr.addColorStop(1, '#D9A955');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, S, S);
  // 18 grain lines (fixed seed), plus fainter fine grain between them
  const grain = (n, alpha, wMin, wMax) => {
    for (let k = 0; k < n; k++) {
      const y0 = rnd() * S, amp = 1 + rnd() * 4, wl = 40 + rnd() * 110, ph = rnd() * 6.28;
      const drift = (rnd() - 0.5) * S * 0.08;
      ctx.beginPath();
      for (let x = -4; x <= S + 4; x += 4) {
        const y = y0 + Math.sin(x / wl + ph) * amp + (x / S) * drift;
        if (x === -4) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(120,70,20,${alpha})`;
      ctx.lineWidth = wMin + rnd() * (wMax - wMin);
      ctx.stroke();
    }
  };
  grain(40, 0.05, 0.4, 1);
  grain(18, 0.12, 0.6, 1.6);
  devicePatternFill(ctx, g, noiseTile(160, 0x600D, [110, 64, 20], [255, 236, 190], 0.14));
  gr = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
  gr.addColorStop(0, 'rgba(255,240,200,.08)');
  gr.addColorStop(1, 'rgba(90,50,10,.14)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, S, S);
  // frame: 0.3 cell of darker wood with a bevel
  const f = c * 0.3;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, S, S);
  ctx.rect(f, f, S - 2 * f, S - 2 * f);   // even-odd: the inner square is a hole
  ctx.clip('evenodd');
  gr = ctx.createLinearGradient(0, 0, S, S);
  gr.addColorStop(0, '#9A6634'); gr.addColorStop(1, '#7A4C22');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, S, S);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,225,170,.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(1, 1, S - 2, S - 2);
  ctx.strokeStyle = 'rgba(60,32,8,.55)';
  ctx.strokeRect(f + 0.5, f + 0.5, S - 2 * f - 1, S - 2 * f - 1);
  crispGrid(ctx, g, '#3B2A14', 1, 1.5);
  ctx.fillStyle = '#3B2A14';
  for (const [x, y] of STAR_POINTS) {
    ctx.beginPath(); ctx.arc(at(g, x), at(g, y), c * 0.1, 0, Math.PI * 2); ctx.fill();
  }
}

// ---- stones (docs/research/ux.md §3.6) -------------------------------------------------------------

// Draws one stone centred on (x, y) with radius r, in whatever units ctx uses. board.js calls
// it once per theme/size/colour to build sprites; `unit` is the size of one art pixel for the
// pixel style (device px), ignored otherwise.
export function drawStone(ctx, x, y, r, color, style, unit = 1) {
  if (style && style.kind === 'pixel') { drawPixelStone(ctx, x, y, r, color, unit); return; }
  const s = style || {};
  const black = color === 1;
  const TAU = Math.PI * 2;
  const glow = black ? s.blackGlow : s.whiteGlow;
  if (glow) {
    const gg = ctx.createRadialGradient(x, y, r * 0.92, x, y, r * 1.2);
    gg.addColorStop(0, rgba(glow, glow[3]));
    gg.addColorStop(0.45, rgba(glow, glow[3] * 0.4));
    gg.addColorStop(1, rgba(glow, 0));
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(x, y, r * 1.2, 0, TAU); ctx.fill();
  }
  // contact shadow: a blurred disc offset down-right (gradient, not shadowBlur: same look in
  // WebKit and Chromium, and shadowBlur ignores the canvas transform)
  const sa = black ? s.shadow ?? 0.45 : s.shadowWhite ?? 0.35;
  if (sa > 0) {
    const sx = x + r * 0.06, sy = y + r * 0.12;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 1.08);
    sg.addColorStop(0, `rgba(0,0,0,${sa})`);
    sg.addColorStop(0.84, `rgba(0,0,0,${sa})`);
    sg.addColorStop(0.93, `rgba(0,0,0,${sa * 0.45})`);
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(sx, sy, r * 1.08, 0, TAU); ctx.fill();
  }
  let body;
  if (black) {
    body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
    body.addColorStop(0, '#7A7A80');
    body.addColorStop(0.18, '#3A3A40');
    body.addColorStop(0.65, '#141416');
    body.addColorStop(1, '#000000');
  } else {
    body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
    body.addColorStop(0, '#FFFFFF');
    body.addColorStop(0.55, '#F1F1EC');
    body.addColorStop(0.9, '#CFCFC6');
    body.addColorStop(1, '#A9A99E');
  }
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  if (black) {
    // soft glossy highlight, an ellipse tilted -35°
    ctx.save();
    ctx.translate(x - r * 0.32, y - r * 0.38);
    ctx.rotate((-35 * Math.PI) / 180);
    ctx.scale(1, 0.16 / 0.28);
    const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.28);
    hg.addColorStop(0, 'rgba(255,255,255,.36)');
    hg.addColorStop(0.6, 'rgba(255,255,255,.2)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.28, 0, TAU); ctx.fill();
    ctx.restore();
    // faint light bounced back onto the lower rim
    ctx.strokeStyle = 'rgba(255,255,255,.09)';
    ctx.lineWidth = r * 0.06;
    ctx.beginPath(); ctx.arc(x, y, r * 0.93, Math.PI * 0.12, Math.PI * 0.7); ctx.stroke();
    if (s.blackRim) {
      ctx.strokeStyle = s.blackRim;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = r * 0.08;
      ctx.beginPath(); ctx.arc(x, y, r * 0.96, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  } else {
    const hg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, 0, x - r * 0.3, y - r * 0.35, r * 0.16);
    hg.addColorStop(0, 'rgba(255,255,255,.9)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.16, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(0,0,0,${s.edgeWhite ?? 0.25})`;
    ctx.lineWidth = r * 0.04;
    ctx.beginPath(); ctx.arc(x, y, r * 0.98, 0, TAU); ctx.stroke();
  }
}

// Pixel stone: an odd-sized pixel circle, drawn in whole `unit` blocks.
function drawPixelStone(ctx, x, y, r, color, unit) {
  const u = Math.max(1, Math.round(unit));
  const D = 2 * Math.max(2, Math.floor(r / u)) + 1;
  const h = (D - 1) / 2;
  const R2 = (h + 0.35) * (h + 0.35);
  const inside = (i, j) => i >= 0 && j >= 0 && i < D && j < D && (i - h) ** 2 + (j - h) ** 2 <= R2;
  const x0 = Math.round(x - (D * u) / 2), y0 = Math.round(y - (D * u) / 2);
  const px = (i, j, c) => { ctx.fillStyle = c; ctx.fillRect(x0 + i * u, y0 + j * u, u, u); };
  for (let j = 0; j < D; j++) for (let i = 0; i < D; i++) if (inside(i, j)) px(i + 1, j + 1, LCD.dark);   // drop shadow
  for (let j = 0; j < D; j++) {
    for (let i = 0; i < D; i++) {
      if (!inside(i, j)) continue;
      const edge = !inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1);
      const d2 = (i - h) ** 2 + (j - h) ** 2;
      if (color === 1) {
        let c = LCD.ink;
        if (!edge && i + j < D - 2 && d2 > (h - 2.3) ** 2 && d2 <= (h - 1.1) ** 2) c = LCD.dark;
        px(i, j, c);
      } else {
        let c = LCD.white;
        if (edge) c = LCD.ink;
        else if (i + j > D + 1 && d2 > (h - 2.2) ** 2) c = LCD.light;
        px(i, j, c);
      }
    }
  }
  if (color === 1) {
    px(h - 2, h - 3, LCD.mid); px(h - 3, h - 2, LCD.mid);
  } else {
    px(h - 2, h - 2, '#FFFFFF');
  }
}

// ---- page backgrounds (CSS, applied by the UI to the battle screen) -----------------------------

const NOISE_SVG = (alpha) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .9 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='${alpha}'/%3E%3C/svg%3E")`;

// ---- the table ------------------------------------------------------------------------------------

// Field reference (board.js reads all of these; the UI reads name, accent and pageBg):
//   accent      the stage's UI colour (setup sheet chip, stage label)
//   pageBg      CSS `background` value for the battle screen
//   backdrop    flat colour behind the canvases and around the board in the loupe
//   frame       { radius (CSS px), shadow (CSS box-shadow) } for the board element
//   ring        impact / last-move ring colour
//   dust        mat only: two dust colours for the six specks kicked up by a stone
//   breathe     neon only: the board layer pulses 0.85↔1 opacity (CSS, off for reduced motion)
//   pixel       pixel only: blocky drop (flicker), blocky win line
//   stoneStyle  input for drawStone()
//   placeSound  variant name for audio.play('place', { theme })
// Every drawBoard goes through this so helpers can make off-screen canvases in the right document.
function painter(fn) {
  return (ctx, g) => {
    const prev = canvasDoc;
    canvasDoc = (ctx && ctx.canvas && ctx.canvas.ownerDocument) || null;
    try { fn(ctx, g); } finally { canvasDoc = prev; }
  };
}

export const THEMES = Object.freeze({
  mat: Object.freeze({
    id: 'mat', name: '배틀 장판', accent: '#FFD23F', placeSound: 'mat',
    pageBg: `${NOISE_SVG(0.06)}, radial-gradient(120% 80% at 50% 38%, #3A3A3E 0%, #2B2B2E 55%, #1E1E21 100%) #2B2B2E`,
    backdrop: KRAFT,
    frame: { radius: 5, shadow: '0 4px 0 rgba(20,12,4,.55), 0 14px 30px rgba(0,0,0,.5)' },
    ring: '#FFF6E4', dust: ['#EAD3A6', '#A97F4B'],
    stoneStyle: Object.freeze({ kind: 'gloss', shadow: 0.58, shadowWhite: 0.46, edgeWhite: 0.32 }),
    drawBoard: painter(drawMat),
  }),
  neon: Object.freeze({
    id: 'neon', name: '네온 아케이드', accent: '#FF2BD6', placeSound: 'neon',
    pageBg: 'radial-gradient(90% 70% at 50% 42%, #2A0B4A 0%, #12082E 55%, #07071A 100%) #07071A',
    backdrop: '#0E1030',
    frame: { radius: 10, shadow: '0 0 0 1px rgba(255,43,214,.45), 0 0 26px rgba(255,43,214,.28), 0 14px 30px rgba(0,0,0,.55)' },
    ring: '#19E3FF', breathe: true,
    stoneStyle: Object.freeze({
      kind: 'gloss', shadow: 0.35, shadowWhite: 0.3, blackRim: '#19E3FF',
      blackGlow: [25, 227, 255, 0.55], whiteGlow: [255, 138, 230, 0.6],
    }),
    drawBoard: painter(drawNeon),
  }),
  dojo: Object.freeze({
    id: 'dojo', name: '수련 도장', accent: '#C9A227', placeSound: 'dojo',
    pageBg: `${NOISE_SVG(0.05)}, linear-gradient(180deg, #2B2017 0%, #1E1610 100%) #241A12`,
    backdrop: '#CDBF7E',
    frame: { radius: 3, shadow: '0 4px 0 rgba(10,6,2,.6), 0 14px 30px rgba(0,0,0,.5)' },
    ring: '#B22222',
    stoneStyle: Object.freeze({ kind: 'gloss', shadow: 0.48, shadowWhite: 0.38, edgeWhite: 0.3 }),
    drawBoard: painter(drawDojo),
  }),
  pixel: Object.freeze({
    id: 'pixel', name: '8비트 오락실', accent: '#9BBC0F', placeSound: 'pixel',
    pageBg: 'radial-gradient(circle at 1px 1px, rgba(155,188,15,.10) 1px, transparent 1.5px) 0 0 / 6px 6px, #0F380F',
    backdrop: LCD.mid,
    frame: { radius: 0, shadow: '0 4px 0 #071C07, 0 14px 30px rgba(0,0,0,.45)' },
    ring: LCD.ink, pixel: true,
    stoneStyle: Object.freeze({ kind: 'pixel', unitsPerCell: 12 }),
    drawBoard: painter(drawPixel),
  }),
  wood: Object.freeze({
    id: 'wood', name: '클래식 원목', accent: '#E3B96A', placeSound: 'wood',
    pageBg: 'radial-gradient(110% 80% at 50% 40%, #4A3019 0%, #2E1D0F 60%, #1E1309 100%) #2E1D0F',
    backdrop: '#DDB05F',
    frame: { radius: 6, shadow: '0 4px 0 rgba(30,16,4,.6), 0 14px 30px rgba(0,0,0,.5)' },
    ring: '#FFF2D6',
    stoneStyle: Object.freeze({ kind: 'gloss', shadow: 0.45, shadowWhite: 0.35, edgeWhite: 0.28 }),
    drawBoard: painter(drawWood),
  }),
});

export function getTheme(id) {
  return THEMES[id] || THEMES[DEFAULT_THEME];
}
