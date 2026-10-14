// js/particles.js - one lazily created full-screen canvas for victory bursts.
// Time-based (survives 30 fps Low Power Mode and 120 Hz), sprite-cached (no per-frame paths,
// no shadowBlur), pooled, and it stops its rAF loop and frees memory when idle.
const MAX = 180;          // hard cap on live particles
const DPR_CAP = 2;        // iPhone DPR is 3; 2 is visually identical for soft particles, ~2.25x fewer pixels
const SPR = 32;           // sprite cell, CSS px

let cv = null, ctx = null, raf = 0, last = 0, w = 0, h = 0, dpr = 1;
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
      c.lineWidth = 3; c.lineJoin = 'round';
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

const rnd = ([a, b]) => a + Math.random() * (b - a);

// x,y in CSS px (client coords). Presets live in the character table (see fxPresets).
export function burst({
  x, y, n = 24, kind = 'star', colors = ['#FFD84D', '#FFFFFF'],
  speed = [120, 260], angle = [0, 360], gravity = 320, drag = 1.4,
  life = [0.6, 1.1], size = [10, 18], spin = [-6, 6], shrink = true, blend = 'source-over',
}) {
  if (reduced() || !ensure()) return;
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
  else { raf = 0; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); }
}

export function clear() {
  live.length = 0;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); }
}

// call when the result overlay closes: gives the backing store back to iOS
export function release() {
  clear();
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
