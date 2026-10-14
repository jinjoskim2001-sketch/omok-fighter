// Service worker for 돌주먹. Bump VERSION on every deploy (and the matching constant in
// js/main.js): a byte-different file is what makes the browser install the new worker.
// This file must never be renamed or removed — Safari unregisters a worker whose script 404s.
const VERSION = 'omok-v1';

// Every cache this app owns starts with this. The origin is shared with the owner's other
// project sites (/pumal/), so cleanup must never touch foreign caches.
const PREFIX = 'omok-';

// Everything the app needs to run offline: the module graph index.html reaches (static and
// dynamic imports, the AI worker), every stylesheet, the font and the icons. Relative to this
// file, so it works under https://<user>.github.io/<repo>/ and on localhost alike.
// tests/integration.test.js rebuilds this set from the sources and fails (printing the list
// to paste here) when a file is added, renamed or removed.
const SHELL = './';
const PRECACHE = [
  'manifest.webmanifest',

  'css/app.css',
  'css/battle.css',
  'css/fighters.css',
  'css/chars/bulttong.css',
  'css/chars/nyangja.css',
  'css/chars/bigom.css',
  'css/chars/beonjjeok.css',
  'css/chars/jaepjaep.css',
  'css/chars/ppibik.css',
  'css/chars/kkakkung.css',
  'css/chars/taenggeul.css',
  'css/gate.css',
  'fonts/bhs.woff2',

  'js/main.js',
  'js/rules.js',
  'js/match.js',
  'js/ai-client.js',
  'js/ai/engine.js',
  'js/ai/worker.js',
  'js/board.js',
  'js/themes.js',
  'js/audio.js',
  'js/haptics.js',
  'js/install.js',
  'js/storage.js',
  'js/wake.js',
  'js/characters.js',
  'js/chars/bulttong.js',
  'js/chars/nyangja.js',
  'js/chars/bigom.js',
  'js/chars/beonjjeok.js',
  'js/chars/jaepjaep.js',
  'js/chars/ppibik.js',
  'js/chars/kkakkung.js',
  'js/chars/taenggeul.js',
  'js/fighter.js',
  'js/particles.js',
  'js/debug.js',
  'js/ui/battle.js',
  'js/ui/ctx.js',
  'js/ui/dom.js',
  'js/ui/flow.js',
  'js/ui/hud.js',
  'js/ui/menu.js',
  'js/ui/records.js',
  'js/ui/results.js',
  'js/ui/router.js',
  'js/ui/select.js',
  'js/ui/settings.js',
  'js/ui/setup.js',
  'js/ui/sheet.js',
  'js/ui/title.js',
  'js/ui/toast.js',
  'js/ui/vs.js',
  'js/ui/widgets.js',

  'icons/apple-touch-icon-180.png',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

// Files the page can boot without. Everything else in PRECACHE is required: the app is one
// static module graph, so a single missing script or stylesheet means a dead screen. The
// font is optional too: font-display:swap falls back to the system font.
const isOptional = (path) =>
  path.startsWith('icons/') || path.startsWith('fonts/') || path === 'manifest.webmanifest' || path === 'js/debug.js';

const SCOPE = new URL('./', self.location.href);

// cache:'reload' skips the HTTP cache; GitHub Pages serves everything with max-age=600 and
// a stale file frozen into a fresh precache would survive until the next deploy.
function fetchFresh(path) {
  return fetch(new Request(new URL(path, SCOPE).href, { cache: 'reload' }));
}

// A non-OK answer (404, 5xx) for a required file fails the install: the previous worker and
// its complete cache stay in charge, and the next update check (launch / return to visible)
// tries again. Activating instead would delete that complete cache and leave a page that
// cannot boot. Only the optional files above may be skipped.
// A network failure is retried once and then fails the install, for any file.
async function precacheOne(cache, path, required) {
  let response;
  try {
    response = await fetchFresh(path);
  } catch {
    response = await fetchFresh(path);
  }
  if (!response.ok) {
    if (required) throw new Error(`precache: ${path} answered ${response.status}`);
    return false;
  }
  await cache.put(new URL(path, SCOPE).href, response);
  return true;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await precacheOne(cache, SHELL, true);
      await Promise.all(PRECACHE.map((path) => precacheOne(cache, path, !isOptional(path))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(PREFIX) && name !== VERSION)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

async function fromShell(request) {
  const cache = await caches.open(VERSION);
  // ignoreSearch: ?play=1, ?shot=…, ?openExternalBrowser=1, ?v=… and a module retried as
  // ?r=N all map to the same file.
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const response = await fetch(request);
    // Heal a precache that skipped an optional file (or a file added later) the first time it is used.
    // (A redirected response cannot be replayed for a navigation, so those are left alone.)
    if (response.ok && response.type === 'basic' && !response.redirected) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    if (request.mode === 'navigate') {
      const shell = await cache.match(SCOPE.href);
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Same origin, inside our folder only; everything else goes straight to the network.
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  event.respondWith(fromShell(request));
});
