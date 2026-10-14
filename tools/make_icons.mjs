#!/usr/bin/env node
// Generates every picture in icons/ from the vector art below (SPEC §10).
//
// usage: node tools/make_icons.mjs                 write icons/*.png
//        node tools/make_icons.mjs --preview a.png  also write a contact sheet (sizes, iOS mask,
//                                                   maskable safe zone, link preview) to look at
//
// The art: on the app background (#17121F) a glossy black stone and a glossy white stone clash;
// a yellow comic impact star bursts where they meet, and the black stone throws the punch in a
// small red boxing glove (돌 + 주먹). Everything is cut out like a sticker (paper rim, ink
// outline, ink drop shadow, SPEC §9) so the black stone still separates from the dark
// background at 60 px on a home screen.
//
// Pipeline: SVG/HTML → Chromium (Playwright) at 4× → Pillow (python3) downsampled with Lanczos
// and saved opaque (RGB, or a 256-colour palette for the big Android icons), square corners
// (iOS and Android apply their own masks). Every icon
// is exactly its nominal size. The link preview uses Black Han Sans from tools/src-fonts.
// iOS reads the home-screen icon once, at install: re-run this before the first share only, and
// bump ?v= on og:image in index.html whenever og-800x400.png changes.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'icons');
const FONT = path.join(ROOT, 'tools/src-fonts/BlackHanSans-Regular.ttf');
const SS = 4; // supersampling

const C = {
  bg: '#17121F', bg2: '#221A2E', bg3: '#2E2440', ink: '#2A1E2F', paper: '#FFF4DE',
  gold: '#FFD23F', goldDeep: '#F2A900', red: '#FF4757', redDeep: '#C42537', lime: '#B6FF4D',
};

// ---- geometry (1024 × 1024 art space) -----------------------------------------------------------

const B = { x: 346, y: 670, r: 240 };   // black stone (bottom left), throws the punch
const W = { x: 718, y: 320, r: 190 };   // white stone (top right), takes it
const GLOVE_SCALE = 0.92;
const DIR = (() => { const dx = W.x - B.x, dy = W.y - B.y, l = Math.hypot(dx, dy); return { x: dx / l, y: dy / l }; })();
const ANG = (Math.atan2(DIR.y, DIR.x) * 180) / Math.PI;
// The glove sits on the black stone's shoulder and its fist lands on the white stone's edge.
const GLOVE = { x: B.x + DIR.x * 128, y: B.y + DIR.y * 128 };
const HIT = { x: W.x - DIR.x * (W.r - 4), y: W.y - DIR.y * (W.r - 4) };

const f = (n) => Math.round(n * 10) / 10;

function starPoints(cx, cy, outer, inner, rot = -8) {
  const pts = [];
  const n = outer.length;
  for (let i = 0; i < n * 2; i += 1) {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const r = i % 2 === 0 ? outer[i / 2] : inner;
    pts.push(`${f(cx + Math.cos(a) * r)},${f(cy + Math.sin(a) * r)}`);
  }
  return pts.join(' ');
}

// Hand-tuned spike lengths: a comic burst is irregular, not a regular polygon.
const STAR_OUT = [318, 252, 300, 236, 334, 262, 292, 244, 326, 250, 306, 238, 316, 258];
const STAR = starPoints(HIT.x, HIT.y, STAR_OUT, 168, -4);
const STAR_CORE = starPoints(HIT.x, HIT.y, STAR_OUT.map((r) => r * 0.55), 96, 6);

// The glove in its own frame: origin at the cuff, punching along +x.
const MITT = 'M8 -78 C56 -110 128 -118 176 -106 C238 -92 262 -36 258 10 C254 70 210 104 150 104 C98 104 48 96 8 78 Z';
const CUFF = 'M-66 -70 H20 A16 16 0 0 1 36 -54 V54 A16 16 0 0 1 20 70 H-66 A16 16 0 0 1 -82 54 V-54 A16 16 0 0 1 -66 -70 Z';
const THUMB = 'M40 54 C62 30 120 26 156 44 C184 58 180 92 150 102 C110 112 60 104 40 88 Z';

function gloveShapes(fill) {
  // Silhouette pieces only (used for the sticker rim and the drop shadow).
  return `<g transform="translate(${f(GLOVE.x)} ${f(GLOVE.y)}) rotate(${f(ANG)}) scale(${GLOVE_SCALE})">` +
    `<path d="${MITT}" ${fill}/><path d="${CUFF}" ${fill}/><path d="${THUMB}" ${fill}/></g>`;
}

function glove() {
  return `<g transform="translate(${f(GLOVE.x)} ${f(GLOVE.y)}) rotate(${f(ANG)}) scale(${GLOVE_SCALE})" stroke="${C.ink}" stroke-width="17" stroke-linejoin="round" stroke-linecap="round">` +
    `<path d="${MITT}" fill="url(#gRed)"/>` +
    // knuckle crease between the fingers and the back of the hand
    `<path d="M168 -100 C190 -46 192 22 172 92" fill="none" stroke-width="11" opacity=".55"/>` +
    `<path d="${THUMB}" fill="url(#gRedThumb)"/>` +
    `<path d="M70 66 C96 56 128 58 150 70" fill="none" stroke-width="9" opacity=".5"/>` +
    `<path d="${CUFF}" fill="${C.paper}"/>` +
    `<path d="M-24 -66 V66" fill="none" stroke="${C.red}" stroke-width="22" stroke-linecap="butt"/>` +
    // gloss on the mitt
    `<path d="M120 -86 C170 -94 214 -78 230 -40" fill="none" stroke="#fff" stroke-width="20" opacity=".6"/>` +
    `<circle cx="238" cy="-14" r="9" fill="#fff" stroke="none" opacity=".8"/>` +
    `</g>`;
}

function stone(s, black) {
  const hx = s.x - s.r * 0.36, hy = s.y - s.r * 0.42;
  return `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="url(#${black ? 'gBlack' : 'gWhite'})" stroke="${C.ink}" stroke-width="16"/>` +
    (black
      ? `<ellipse cx="${f(hx)}" cy="${f(hy)}" rx="${f(s.r * 0.34)}" ry="${f(s.r * 0.17)}" transform="rotate(-38 ${f(hx)} ${f(hy)})" fill="#fff" opacity=".42"/>` +
        `<circle cx="${f(s.x - s.r * 0.5)}" cy="${f(s.y - s.r * 0.18)}" r="${f(s.r * 0.055)}" fill="#fff" opacity=".55"/>` +
        // rim light on the side away from the light: keeps the round shape readable on dark
        `<path d="M${f(s.x + s.r * 0.9)} ${f(s.y + s.r * 0.12)} A${s.r * 0.9} ${s.r * 0.9} 0 0 1 ${f(s.x + s.r * 0.12)} ${f(s.y + s.r * 0.9)}" fill="none" stroke="#9AA0B8" stroke-width="${f(s.r * 0.07)}" stroke-linecap="round" opacity=".55"/>`
      : `<ellipse cx="${f(hx)}" cy="${f(hy)}" rx="${f(s.r * 0.3)}" ry="${f(s.r * 0.15)}" transform="rotate(-38 ${f(hx)} ${f(hy)})" fill="#fff" opacity=".95"/>` +
        `<path d="M${f(s.x + s.r * 0.86)} ${f(s.y + s.r * 0.2)} A${s.r * 0.88} ${s.r * 0.88} 0 0 1 ${f(s.x + s.r * 0.2)} ${f(s.y + s.r * 0.86)}" fill="none" stroke="#8E8A7E" stroke-width="${f(s.r * 0.06)}" stroke-linecap="round" opacity=".45"/>`);
}

const DEFS = `<defs>
  <radialGradient id="gBlack" cx="38%" cy="32%" r="72%">
    <stop offset="0" stop-color="#7C7C88"/><stop offset=".22" stop-color="#3A3A44"/>
    <stop offset=".62" stop-color="#141418"/><stop offset="1" stop-color="#000"/></radialGradient>
  <radialGradient id="gWhite" cx="36%" cy="30%" r="78%">
    <stop offset="0" stop-color="#FFFFFF"/><stop offset=".5" stop-color="#F3F1EA"/>
    <stop offset=".86" stop-color="#D2CFC4"/><stop offset="1" stop-color="#ABA89C"/></radialGradient>
  <linearGradient id="gRed" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FF6A76"/><stop offset=".45" stop-color="${C.red}"/><stop offset="1" stop-color="${C.redDeep}"/></linearGradient>
  <linearGradient id="gRedThumb" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.red}"/><stop offset="1" stop-color="${C.redDeep}"/></linearGradient>
  <radialGradient id="gGlow" cx="50%" cy="46%" r="62%">
    <stop offset="0" stop-color="#46336A"/><stop offset=".55" stop-color="#2A1F3D"/><stop offset="1" stop-color="${C.bg}"/></radialGradient>
  <radialGradient id="gStar" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#FFE680"/><stop offset=".7" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.goldDeep}"/></radialGradient>
  <pattern id="pDots" width="28" height="28" patternUnits="userSpaceOnUse">
    <circle cx="14" cy="14" r="3.4" fill="${C.paper}" opacity=".07"/></pattern>
</defs>`;

// Speed rays from the impact point, drawn into the background.
function rays(cx, cy, n = 18, len = 1500) {
  let d = '';
  for (let i = 0; i < n; i += 1) {
    const a0 = ((i / n) * 360 + 3) * (Math.PI / 180);
    const a1 = a0 + (9 * Math.PI) / 180;
    d += `M${f(cx)} ${f(cy)}L${f(cx + Math.cos(a0) * len)} ${f(cy + Math.sin(a0) * len)}L${f(cx + Math.cos(a1) * len)} ${f(cy + Math.sin(a1) * len)}Z`;
  }
  return `<path d="${d}" fill="${C.gold}" opacity=".075"/>`;
}

// Motion lines behind the black stone: the punch travels toward the top right.
function speedLines() {
  const back = { x: -DIR.x, y: -DIR.y };
  const side = { x: -DIR.y, y: DIR.x };
  const lines = [[-150, 250, 150], [-20, 300, 190], [125, 250, 140]];
  return lines.map(([off, start, len]) => {
    const x0 = B.x + back.x * start + side.x * off, y0 = B.y + back.y * start + side.y * off;
    const x1 = x0 + back.x * len, y1 = y0 + back.y * len;
    return `<path d="M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}" stroke="${C.paper}" stroke-width="22" stroke-linecap="round" opacity=".22"/>`;
  }).join('');
}

// The cluster: star behind, the two stones, the glove on top. Drawn three times for the
// sticker look: ink drop shadow, paper rim, then the art itself.
function silhouette(fill) {
  return `<polygon points="${STAR}" ${fill} stroke-linejoin="round"/>` +
    `<circle cx="${W.x}" cy="${W.y}" r="${W.r}" ${fill}/>` +
    `<circle cx="${B.x}" cy="${B.y}" r="${B.r}" ${fill}/>` +
    gloveShapes(fill);
}

function cluster({ rim = 34, shadow = 30 } = {}) {
  const sh = `fill="#07050B" stroke="#07050B" stroke-width="${rim * 2}" stroke-linejoin="round"`;
  const pr = `fill="${C.paper}" stroke="${C.paper}" stroke-width="${rim * 2}" stroke-linejoin="round"`;
  return `<g opacity=".72" transform="translate(0 ${shadow})">${silhouette(sh)}</g>` +
    `<g>${silhouette(pr)}</g>` +
    `<polygon points="${STAR}" fill="url(#gStar)" stroke="${C.ink}" stroke-width="16" stroke-linejoin="round"/>` +
    `<polygon points="${STAR_CORE}" fill="#FFF8D6" opacity=".9"/>` +
    stone(W, false) +
    stone(B, true) +
    glove();
}

/** The full square icon. `scale` shrinks the art about the centre (maskable safe zone). */
// `dots` adds the app's halftone. Off for the icons: invisible at home-screen size, and it does
// not compress (it doubles the bytes of every icon the service worker caches).
export function iconSvg({ scale = 0.93, lines = true, rays: withRays = true, dots = false } = {}) {
  // The art's bounding box is centred on (507, 511); 0.93 leaves ~10 % to the edges, so the
  // rounded corners of the iOS mask never touch the black stone.
  const t = ` transform="translate(512 512) scale(${scale}) translate(-507 -511)"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${DEFS}` +
    `<rect width="1024" height="1024" fill="${C.bg}"/>` +
    `<rect width="1024" height="1024" fill="url(#gGlow)"/>` +
    `<g${t}>` +
    (withRays ? rays(HIT.x, HIT.y) : '') +
    (dots ? `<rect x="-600" y="-600" width="2224" height="2224" fill="url(#pDots)"/>` : '') +
    (lines ? speedLines() : '') +
    cluster() +
    `</g></svg>`;
}

// Link preview, 800 × 400. Everything that matters stays inside the centre 400 × 400 square, so a
// square crop (some chat apps) still shows the art and the name.
function ogHtml() {
  const font = fs.readFileSync(FONT).toString('base64');
  // A few stones on the board's intersections on both sides (40 px grid, centred on the image).
  const stones = [
    [1, 1, 'w'], [2, 2, 'b'], [3, 2, 'w'], [2, 4, 'b'], [3, 3, 'b'], [1, 6, 'b'], [4, 5, 'w'], [2, 8, 'w'],
    [18, 1, 'b'], [17, 2, 'w'], [16, 4, 'b'], [18, 4, 'w'], [17, 5, 'b'], [16, 7, 'w'], [18, 8, 'b'], [15, 2, 'w'],
  ].map(([gx, gy, c]) => `<i class="st st--${c}" style="left:${gx * 40 - 17}px;top:${gy * 40 - 17}px"></i>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'BHS'; src: url(data:font/ttf;base64,${font}) format('truetype'); }
  html, body { margin: 0; width: 800px; height: 400px; overflow: hidden; background: ${C.bg}; }
  .og { position: relative; width: 800px; height: 400px; overflow: hidden;
    background: radial-gradient(56% 92% at 50% 40%, #44306A 0%, #2A1F3D 46%, ${C.bg} 100%); }
  .burst { position: absolute; left: 50%; top: 38%; width: 1400px; height: 1400px; margin: -700px 0 0 -700px; border-radius: 50%;
    background: repeating-conic-gradient(from 2deg, rgba(255,244,222,.045) 0deg 8deg, transparent 8deg 20deg); }
  .board { position: absolute; inset: 0;
    background:
      linear-gradient(90deg, rgba(255,244,222,.1) 2px, transparent 2px) -1px 0 / 40px 40px,
      linear-gradient(rgba(255,244,222,.1) 2px, transparent 2px) 0 -1px / 40px 40px;
    -webkit-mask-image: linear-gradient(90deg, #000 0, #000 150px, transparent 250px, transparent 550px, #000 650px, #000 100%);
            mask-image: linear-gradient(90deg, #000 0, #000 150px, transparent 250px, transparent 550px, #000 650px, #000 100%); }
  .st { position: absolute; width: 34px; height: 34px; border-radius: 50%; border: 4px solid ${C.ink}; box-sizing: border-box;
    box-shadow: 0 4px 0 rgba(0,0,0,.5); }
  .st--b { background: radial-gradient(circle at 36% 30%, #7C7C88, #3A3A44 22%, #141418 62%, #000); box-shadow: 0 0 0 2px rgba(255,244,222,.5), 0 4px 0 rgba(0,0,0,.5); }
  .st--w { background: radial-gradient(circle at 36% 30%, #fff, #F3F1EA 50%, #D2CFC4 86%, #ABA89C); }
  .st::after { content: ''; position: absolute; left: 16%; top: 14%; width: 36%; height: 20%; border-radius: 50%; background: #fff; opacity: .45; transform: rotate(-38deg); }
  .st--w::after { opacity: .95; }
  .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(23,18,31,.55), transparent 22%, transparent 78%, rgba(23,18,31,.55)); }
  .art { position: absolute; left: 238px; top: -6px; width: 324px; height: 324px; }
  .art svg { width: 100%; height: 100%; display: block; overflow: visible; }
  .word { position: absolute; left: 0; right: 0; top: 246px; text-align: center;
    font: 104px/1 'BHS'; color: ${C.gold}; letter-spacing: 0;
    -webkit-text-stroke: 15px ${C.ink}; paint-order: stroke fill;
    text-shadow: 0 5px 0 ${C.ink}, 1px 9px 0 ${C.ink};
    transform: rotate(-4deg); }
  .tape { position: absolute; left: 50%; top: 350px; transform: translateX(-50%) rotate(2deg);
    padding: 6px 16px 7px; background: ${C.red}; color: #fff; border: 3px solid ${C.ink}; box-shadow: 0 4px 0 ${C.ink};
    font: 22px/1 'BHS'; letter-spacing: .16em; white-space: nowrap; }
</style></head><body><div class="og">
  <div class="burst"></div><div class="board"></div>${stones}<div class="shade"></div>
  <div class="art">${artOnly()}</div>
  <div class="word">돌주먹</div>
  <div class="tape">OMOK FIGHTER</div>
</div></body></html>`;
}

// The cluster alone on a transparent ground (for the link preview).
function artOnly() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="80 60 880 880">${DEFS}${speedLines()}${cluster()}</svg>`;
}

// ---- rendering ------------------------------------------------------------------------------------

function pageHtml(svg, size) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:${C.bg}}
    svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`;
}

async function shoot(browser, html, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: SS });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  return buf;
}

// Pillow does the downsampling (Lanczos beats the browser's own scaling for small icons) and
// writes plain RGB: no alpha channel at all, so no platform can show a transparent edge.
// `palette` stores 256 colours instead (still opaque, no transparency entry): the two 512 px
// Android icons shrink from ~170 KB to ~70 KB each with no visible change, and every byte of
// them is fetched into the offline cache on install.
function finish(raw, out, w, h, palette = false) {
  const tmp = path.join(os.tmpdir(), `omok-icon-${process.pid}-${w}x${h}.png`);
  fs.writeFileSync(tmp, raw);
  execFileSync('python3', ['-c', `
import sys
from PIL import Image
src, dst, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = Image.open(src).convert('RGB').resize((w, h), Image.LANCZOS)
if sys.argv[5] == '1':
    im = im.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
im.save(dst, optimize=True)
`, tmp, out, String(w), String(h), palette ? '1' : '0']);
  fs.unlinkSync(tmp);
}

const TARGETS = [
  { file: 'apple-touch-icon-180.png', size: 180, svg: () => iconSvg() },
  { file: 'icon-192.png', size: 192, svg: () => iconSvg(), palette: true },
  { file: 'icon-512.png', size: 512, svg: () => iconSvg(), palette: true },
  // Android masks this to a circle or squircle: the art stays inside the central 60 %.
  { file: 'icon-maskable-512.png', size: 512, svg: () => iconSvg({ scale: 0.72 }), palette: true },
  // 32 px: no rays or motion lines, they only add noise at this size.
  { file: 'favicon-32.png', size: 32, svg: () => iconSvg({ lines: false, rays: false }) },
];

async function preview(browser, file) {
  const img = (name) => `data:image/png;base64,${fs.readFileSync(path.join(OUT, name)).toString('base64')}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:24px;background:#d9d6cf;font:13px system-ui;color:#333;width:1180px}
    .row{display:flex;gap:28px;align-items:flex-end;margin-bottom:26px;flex-wrap:wrap}
    figure{margin:0;text-align:center} img{display:block;image-rendering:auto}
    .ios{border-radius:22.5%;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.25)}
    .dark{background:#000;padding:18px;border-radius:12px}
    .safe{position:relative} .safe::after{content:'';position:absolute;inset:10%;border-radius:50%;box-shadow:0 0 0 2px #0f0 inset}
    .circle{border-radius:50%;overflow:hidden}
  </style></head><body>
  <div class="row">
    <figure><img class="ios" src="${img('icon-512.png')}" width="256"><figcaption>512 (iOS mask)</figcaption></figure>
    <figure><img class="ios" src="${img('apple-touch-icon-180.png')}" width="180"><figcaption>180</figcaption></figure>
    <figure><img class="ios" src="${img('apple-touch-icon-180.png')}" width="60"><figcaption>60</figcaption></figure>
    <figure><img class="ios" src="${img('apple-touch-icon-180.png')}" width="40"><figcaption>40</figcaption></figure>
    <figure><img src="${img('favicon-32.png')}" width="32"><figcaption>32</figcaption></figure>
    <figure><img src="${img('favicon-32.png')}" width="16"><figcaption>16</figcaption></figure>
  </div>
  <div class="row">
    <div class="dark row" style="margin:0">
      <img class="ios" src="${img('apple-touch-icon-180.png')}" width="60"><img class="ios" src="${img('apple-touch-icon-180.png')}" width="60">
    </div>
    <figure class="safe"><img src="${img('icon-maskable-512.png')}" width="256"><figcaption>maskable (green = safe circle)</figcaption></figure>
    <figure><img class="circle" src="${img('icon-maskable-512.png')}" width="128"><figcaption>maskable circle</figcaption></figure>
  </div>
  <div class="row">
    <figure><img src="${img('og-800x400.png')}" width="800"><figcaption>og-800x400</figcaption></figure>
    <figure><img src="${img('og-800x400.png')}" width="300" style="object-fit:cover;width:300px;height:300px"><figcaption>square crop</figcaption></figure>
  </div></body></html>`;
  const page = await browser.newPage({ viewport: { width: 1228, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
}

async function main() {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--preview');
  const previewFile = pi >= 0 ? path.resolve(args[pi + 1] || 'icons-preview.png') : null;

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const t of TARGETS) {
      const raw = await shoot(browser, pageHtml(t.svg(), t.size), t.size, t.size);
      finish(raw, path.join(OUT, t.file), t.size, t.size, t.palette);
      console.log(`wrote icons/${t.file}`);
    }
    const og = await shoot(browser, ogHtml(), 800, 400);
    finish(og, path.join(OUT, 'og-800x400.png'), 800, 400);
    console.log('wrote icons/og-800x400.png');
    if (previewFile) {
      await preview(browser, previewFile);
      console.log(`preview ${previewFile}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
