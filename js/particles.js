// js/particles.js - one lazily created full-screen canvas for victory bursts.
// Time-based (survives 30 fps Low Power Mode and 120 Hz), sprite-cached (no per-frame paths,
// no shadowBlur), pooled, and it stops its rAF loop and frees memory when idle.
const MAX = 180;          // hard cap on live particles
const DPR_CAP = 2;        // iPhone DPR is 3; 2 is visually identical for soft particles, ~2.25x fewer pixels
const SPR = 32;           // sprite cell, CSS px
const IDLE_RELEASE_MS = 3000;   // canvas given back this long after the last particle died

let cv = null, ctx = null, raf = 0, last = 0, w = 0, h = 0, dpr = 1, idleTimer = 0;
const live = [];
const sprites = new Map();
const reduced = () => document.documentElement.dataset.motion === 'reduce';

function ensure() {
  if (cv) return true;
  cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:60';
  ctx = cv.getContext('2d');
  if (!ctx) { cv = null; return false; }
  document.body.append(cv);
  resize();
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onHidden);
  return true;
}
function resize() {
  if (!cv) return;
  dpr = Math.min(globalThis.devicePixelRatio || 1, DPR_CAP);
  w = innerWidth; h = innerHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);   // also clears
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
}
function onHidden() { if (document.hidden) clear(); }

// ---- sprite cache: each (kind,color) is drawn once into a small canvas ----
function sprite(kind, color) {
  const key = kind + color;
  let s = sprites.get(key);
  if (s) return s;
  s = document.createElement('canvas');
  s.width = s.height = SPR * DPR_CAP;
  const c = s.getContext('2d');
  c.scale(DPR_CAP, DPR_CAP); c.translate(SPR / 2, SPR / 2);
  c.fillStyle = color; c.strokeStyle = color;
  const r = SPR / 2 - 1;
  switch (kind) {
    case 'glow': {                       // soft dot: fire embers, ghost wisps, dust
      const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(-r, -r, r * 2, r * 2); break;
    }
    case 'star':                         // 4-point sparkle
      c.beginPath();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, k = i % 2 ? r * .28 : r; c.lineTo(Math.cos(a) * k, Math.sin(a) * k); }
      c.closePath(); c.fill(); break;
    case 'confetti': c.fillRect(-r * .55, -r * .3, r * 1.1, r * .6); break;
    case 'bolt':
      c.lineWidth = 4; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(-r * .2, -r); c.lineTo(r * .35, -r * .15); c.lineTo(-r * .1, 0); c.lineTo(r * .3, r); c.stroke(); break;
    case 'heart':
      c.beginPath(); c.moveTo(0, r * .7);
      c.bezierCurveTo(-r, 0, -r * .6, -r * .9, 0, -r * .35);
      c.bezierCurveTo(r * .6, -r * .9, r, 0, 0, r * .7); c.fill(); break;
    case 'drop': c.beginPath(); c.ellipse(0, 0, r * .45, r * .6, 0, 0, Math.PI * 2); c.fill(); break;
    default: c.beginPath(); c.arc(0, 0, r * .5, 0, Math.PI * 2); c.fill();
  }
  sprites.set(key, s);
  return s;
}

// Named burst presets used by character cues ({fx:'sparkle', at:'head'}). Spread into burst():
//   burst({ x, y, ...FX.sparkle }). Angles in degrees, y-down (270 = up).
export const FX = {
  sparkle:  { kind: 'star', colors: ['#FFD84D', '#FFFFFF'], n: 24, speed: [120, 260], gravity: 300, life: [0.6, 1.1], size: [10, 18] },
  firework: { kind: 'glow', colors: ['#FFB020', '#FF5A36', '#FFE97A'], n: 40, speed: [140, 300], gravity: 160, drag: 1.8, life: [0.7, 1.2], size: [12, 22], blend: 'lighter' },
  smoke:    { kind: 'glow', colors: ['#D9D3E2', '#B9B0C6'], n: 10, speed: [20, 70], angle: [200, 340], gravity: -60, life: [0.6, 1], size: [26, 40], shrink: false },
  petals:   { kind: 'drop', colors: ['#FFB7CF', '#FFD6E4'], n: 18, speed: [60, 140], angle: [150, 210], gravity: 40, drag: 0.6, life: [1.2, 1.8], size: [8, 12], spin: [-3, 3] },
  bolts:    { kind: 'bolt', colors: ['#3CE0FF', '#FFFFFF'], n: 16, speed: [160, 280], gravity: 0, life: [0.25, 0.5], size: [18, 28], blend: 'lighter' },
  confetti: { kind: 'confetti', colors: ['#FF4FA3', '#B6FF4D', '#3CE0FF', '#FFD84D'], n: 60, speed: [220, 380], angle: [220, 320], gravity: 520, drag: 1.2, life: [1, 1.6], size: [8, 12], spin: [-10, 10], shrink: false },
  hearts:   { kind: 'heart', colors: ['#FF4FA3', '#FF8FB0'], n: 14, speed: [60, 160], angle: [230, 310], gravity: -60, life: [0.8, 1.2], size: [12, 18] },
  wisps:    { kind: 'glow', colors: ['#9EE8FF', '#CDBFF7'], n: 16, speed: [60, 120], gravity: -90, life: [0.8, 1.3], size: [14, 22], blend: 'lighter' },
  jelly:    { kind: 'drop', colors: ['#FFD45E', '#9C4A1A'], n: 16, speed: [120, 240], angle: [200, 340], gravity: 600, life: [0.5, 0.9], size: [7, 12] },
  dust:     { kind: 'glow', colors: ['#CBBFA8'], n: 8, speed: [40, 90], angle: [180, 360], gravity: -20, life: [0.4, 0.6], size: [16, 24], shrink: false },
  sweat:    { kind: 'drop', colors: ['#9FE3FF'], n: 6, speed: [80, 140], angle: [210, 330], gravity: 400, life: [0.4, 0.6], size: [6, 9] },
};

const rnd = ([a, b]) => a + Math.random() * (b - a);

// x,y in CSS px (client coords). Presets: FX above.
export function burst({
  x, y, n = 24, kind = 'star', colors = ['#FFD84D', '#FFFFFF'],
  speed = [120, 260], angle = [0, 360], gravity = 320, drag = 1.4,
  life = [0.6, 1.1], size = [10, 18], spin = [-6, 6], shrink = true, blend = 'source-over',
}) {
  if (reduced() || !ensure()) return;
  clearTimeout(idleTimer);
  idleTimer = 0;
  for (let i = 0; i < n && live.length < MAX; i++) {
    const a = rnd(angle) * Math.PI / 180, v = rnd(speed);
    live.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: gravity, drag,
      t: 0, life: rnd(life), size: rnd(size), rot: Math.random() * 6.283, vr: rnd(spin),
      img: sprite(kind, colors[i % colors.length]), shrink, blend,
    });
  }
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
}

function tick(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);   // clamp: a dropped frame must not teleport particles
  last = now;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, cv.width, cv.height);
  for (let i = live.length - 1; i >= 0; i--) {
    const p = live[i];
    p.t += dt;
    if (p.t >= p.life) { live[i] = live[live.length - 1]; live.pop(); continue; }
    const f = 1 - p.drag * dt;
    p.vx *= f; p.vy = p.vy * f + p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    const k = p.t / p.life;
    const s = p.size * (p.shrink ? 1 - 0.6 * k : 1);
    const cos = Math.cos(p.rot) * dpr, sin = Math.sin(p.rot) * dpr;
    ctx.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
    ctx.globalCompositeOperation = p.blend;      // 'lighter' for fire/lightning only
    ctx.setTransform(cos, sin, -sin, cos, p.x * dpr, p.y * dpr);
    ctx.drawImage(p.img, -s / 2, -s / 2, s, s);
  }
  if (live.length) raf = requestAnimationFrame(tick);
  else { raf = 0; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); releaseLater(); }
}

// The canvas is full-screen (≈5 MB of backing store at DPR 2) and a composited layer above
// everything, so it only exists while there is something to draw: once idle for a few seconds
// it goes away by itself, and the next burst() makes a new one (ensure()).
function releaseLater() {
  clearTimeout(idleTimer);
  idleTimer = cv ? setTimeout(() => { idleTimer = 0; if (!live.length) release(); }, IDLE_RELEASE_MS) : 0;
}

export function clear() {
  live.length = 0;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); }
  releaseLater();
}

// Free the canvas now (screen destroy, result overlay closed): gives the backing store back to
// iOS. Safe to call any time; a later burst() recreates it.
export function release() {
  live.length = 0;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  clearTimeout(idleTimer);
  idleTimer = 0;
  if (!cv) return;
  removeEventListener('resize', resize);
  document.removeEventListener('visibilitychange', onHidden);
  cv.width = cv.height = 0;
  cv.remove();
  cv = ctx = null;
}

// viewBox (0..120) anchor on a .stage -> client px. Use the untransformed .stage box,
// never the rotating SVG's own rect.
export function anchor(stage, vx, vy) {
  const r = stage.getBoundingClientRect();
  return { x: r.left + (vx / 120) * r.width, y: r.top + (vy / 120) * r.height };
}
