#!/usr/bin/env node
// Phone-size screenshot of the app (or any page in this repository) with Playwright.
// Replaces 품알's tools/shot.sh: no Chrome path, no 500 px window minimum, no iframe crop.
//
// usage: node tools/shot.mjs "<path and query>" out.png [width height] [options]
//   "<path and query>"   "?play=1&shot=battle", "/", "tools/demo-gate.html?mode=escape&app=kakaotalk"
//   width height         CSS px of the viewport (default 393 852); the PNG is 3× that
//   --standalone         pretend to be the installed home-screen app (navigator.standalone,
//                        no Safari/ token in the user agent → data-display="standalone")
//   --ua <name>          safari26 | safari27 (default) | kakao | insta | chrome-ios | android
//   --webkit             WebKit instead of Chromium (needs PLAYWRIGHT_BROWSERS_PATH pointing at
//                        a WebKit build; Chromium comes with the machine)
//   --wait <ms>          time after load before the picture (default 1500)
//   --full               the whole scrollable page instead of the viewport
//   --dpr <n>            device pixel ratio (default 3)
//   --offline            serve the page, then cut the network (offline checks with ?sw=1)
//
// It serves the repository itself on a random free port (no cache headers, like tools/serve.py),
// prints every console error, page error and failed request, and exits with code 1 if the
// screenshot could not be taken. Examples:
//   node tools/shot.mjs "/" /tmp/gate27.png 375 667 --ua safari27        (the real install gate)
//   node tools/shot.mjs "?play=1&shot=battle" /tmp/b.png --standalone
//   node tools/shot.mjs "tools/demo-gate.html?mode=escape&app=kakaotalk" /tmp/k.png --ua kakao

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const UAS = {
  safari26: `${IOS} Version/26.4 Mobile/15E148 Safari/604.1`,
  safari27: `${IOS} Version/27.0 Mobile/15E148 Safari/604.1`,
  kakao: `${IOS} Mobile/15E148 Safari/604.1 KAKAOTALK/25.8.2 (INAPP)`,
  insta: `${IOS} Mobile/22H20 Instagram 398.0.0.28.84 (iPhone17,1; iOS 18_7; ko_KR; ko; scale=3.00; 1206x2622; 791234567) NW/3`,
  'chrome-ios': `${IOS} CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1`,
  android: 'Mozilla/5.0 (Linux; Android 16; SM-S938N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  // The installed app: the same WebKit, but no "Safari/" token and no Version/.
  standalone: `${IOS} Mobile/15E148`,
};

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
};

function parseArgs(argv) {
  const opts = { target: '/', out: 'shot.png', w: 393, h: 852, standalone: false, webkit: false, wait: 1500, ua: null, full: false, dpr: 3, offline: false };
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--standalone') opts.standalone = true;
    else if (a === '--webkit') opts.webkit = true;
    else if (a === '--full') opts.full = true;
    else if (a === '--offline') opts.offline = true;
    else if (a === '--wait') opts.wait = Number(argv[++i]);
    else if (a === '--ua') opts.ua = argv[++i];
    else if (a === '--dpr') opts.dpr = Number(argv[++i]);
    else if (a === '-h' || a === '--help') opts.help = true;
    else pos.push(a);
  }
  if (pos[0] !== undefined) opts.target = pos[0];
  if (pos[1] !== undefined) opts.out = pos[1];
  if (pos[2] !== undefined) opts.w = Number(pos[2]);
  if (pos[3] !== undefined) opts.h = Number(pos[3]);
  if (opts.ua && !UAS[opts.ua]) throw new Error(`unknown --ua ${opts.ua} (${Object.keys(UAS).join(', ')})`);
  if (![opts.w, opts.h, opts.wait, opts.dpr].every((n) => Number.isFinite(n) && n >= 0)) throw new Error('bad number');
  return opts;
}

// A static server for the repository, so module scripts, the worker and the font load the way
// they do on GitHub Pages (same origin, relative URLs, the folder as the root).
function serve() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, path.normalize(rel));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Cache-Control': 'no-store' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 24).join('\n'));
    return;
  }
  const require = createRequire('/opt/node22/lib/node_modules/');
  const pw = require('playwright');
  const server = await serve();
  const { port } = server.address();
  const target = opts.target.startsWith('/') ? opts.target : `/${opts.target}`;
  const url = `http://127.0.0.1:${port}${target}`;
  const ua = UAS[opts.ua || (opts.standalone ? 'standalone' : 'safari27')];

  const engine = opts.webkit ? pw.webkit : pw.chromium;
  let browser;
  try {
    browser = await engine.launch();
  } catch (err) {
    server.close();
    if (opts.webkit) console.error('WebKit did not start. Set PLAYWRIGHT_BROWSERS_PATH to the folder that holds a webkit-* build.');
    throw err;
  }
  let errors = 0;
  try {
    const contextOpts = {
      viewport: { width: opts.w, height: opts.h },
      deviceScaleFactor: opts.dpr,
      hasTouch: true,
      isMobile: true,
      userAgent: ua,
      locale: 'ko-KR',
    };
    let context;
    try {
      context = await browser.newContext(contextOpts);
    } catch {
      // Some engine builds refuse isMobile; the layout only needs the viewport and touch.
      delete contextOpts.isMobile;
      context = await browser.newContext(contextOpts);
    }
    if (opts.standalone) {
      await context.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
      });
    }
    const page = await context.newPage();
    page.on('console', (m) => {
      // Harness pages report measurements as "[audit] …" lines.
      if (m.type() === 'log' && m.text().startsWith('[audit]')) console.log(m.text());
      if (m.type() === 'error' || m.type() === 'warning') {
        if (m.type() === 'error') errors += 1;
        console.log(`console.${m.type()}: ${m.text()}`);
      }
    });
    page.on('pageerror', (e) => { errors += 1; console.log(`pageerror: ${e.message}`); });
    page.on('requestfailed', (r) => console.log(`requestfailed: ${r.url()} ${r.failure() ? r.failure().errorText : ''}`));
    page.on('response', (r) => { if (r.status() >= 400) console.log(`http ${r.status()}: ${r.url()}`); });

    await page.goto(url, { waitUntil: 'load' });
    if (opts.offline) {
      // The worker has to install (precache everything) and claim the page first.
      const ready = await page.evaluate(() => (navigator.serviceWorker
        ? Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 20000))])
        : false));
      console.log(ready ? 'service worker ready, going offline' : 'no service worker (localhost needs ?sw=1)');
      await page.waitForFunction(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller), null, { timeout: 5000 }).catch(() => {});
      await context.setOffline(true);
      await page.reload({ waitUntil: 'load' }).catch((e) => console.log(`offline reload: ${e.message}`));
    }
    // ?shot= pages (js/debug.js) say when their fixed state is drawn.
    if (/[?&]shot=/.test(target)) {
      await page.waitForFunction(() => document.documentElement.dataset.shot === 'ready', null, { timeout: 10000 })
        .catch(() => console.log('note: the page never set <html data-shot="ready">'));
    }
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    await page.waitForTimeout(opts.wait);
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    await page.screenshot({ path: opts.out, fullPage: opts.full });
    const size = await page.evaluate(() => ({
      w: innerWidth, h: innerHeight,
      overflowX: document.documentElement.scrollWidth > innerWidth,
      display: document.documentElement.getAttribute('data-display') || 'tab',
    }));
    console.log(`saved ${opts.out}  (${opts.webkit ? 'webkit' : 'chromium'} ${await browser.version()}, ${size.w}x${size.h} @${opts.dpr}x, ${size.display}${size.overflowX ? ', HORIZONTAL OVERFLOW' : ''}, console errors: ${errors})`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(`FAILED: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
