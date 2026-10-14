// js/main.js — 돌주먹 boot and wiring (SPEC §8.8).
//
// Boot: loadPrefs → html[data-motion] → audio.init → detectEnv → registerSW → gateMode → gate or 타이틀.
// Constraints that shape this file (the same ones as the owner's 품알):
// - iOS suspends a hidden home-screen app and may never run it again, so the match is saved
//   synchronously after every move (js/ui/battle.js) and again on hidden / pagehide.
// - registerSW() is called before the app's own lifecycle listeners, so an update reload on a
//   return to the foreground wins over every "visible" handler; canReload() below decides when a
//   reload costs nothing (SPEC §8.8: 'now' only on 타이틀/메뉴 with no running match; 'show' never
//   during battle animations, overlays or sheets).
// - ?shot= (js/debug.js) never reads or writes the player's data.

import { audio } from './audio.js';
import * as store from './storage.js';
import * as install from './install.js';
import { setHapticsEnabled } from './haptics.js';
import { serialize, deserialize } from './match.js';
import { CHARACTER_IDS } from './characters.js';
import { app } from './ui/ctx.js';
import * as router from './ui/router.js';
import { isSheetOpen } from './ui/sheet.js';
import { createTitle } from './ui/title.js';
import { createMenu } from './ui/menu.js';
import { createSelect } from './ui/select.js';
import { createVs } from './ui/vs.js';
import { createBattle } from './ui/battle.js';
import { createResult } from './ui/results.js';
import { createSettings } from './ui/settings.js';
import { createRecords } from './ui/records.js';

export const VERSION = 'omok-v1';     // keep equal to VERSION in sw.js (a test checks it)

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

let env = null;
const landscapeMq = window.matchMedia ? window.matchMedia('(orientation: landscape) and (max-height: 500px)') : null;
const reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

// ---- prefs ------------------------------------------------------------------------------------
function applyMotion() {
  const m = app.prefs.motion;
  const reduce = m === 'reduce' || (m !== 'full' && !!(reduceMq && reduceMq.matches));
  document.documentElement.dataset.motion = reduce ? 'reduce' : 'full';
}
function applyPrefs() {
  const p = app.prefs;
  applyMotion();
  try {
    audio.setEnabled(p.sound !== false);
    if (typeof audio.setVolume === 'function') audio.setVolume(typeof p.volume === 'number' ? p.volume : 0.8);
    if (typeof audio.setIgnoreSilent === 'function') audio.setIgnoreSilent(p.ignoreSilent === true);
  } catch (err) { console.warn('[omok] audio prefs', err); }
  try { setHapticsEnabled(p.haptics !== false); } catch { /* optional */ }
}

// A fighter id from storage that this build does not have (renamed, removed, hand-edited) → the
// default for that slot, so no screen ever looks up a character that is not there.
const knownChar = (id, fallback) => (CHARACTER_IDS.includes(id) ? id : fallback);

function normalizeSetup(raw) {
  const d = JSON.parse(JSON.stringify(store.DEFAULT_SETUP));
  const s = raw && typeof raw === 'object' ? raw : {};
  for (const k of ['2p', 'cpu', 'chars']) d[k] = { ...d[k], ...(s[k] && typeof s[k] === 'object' ? s[k] : {}) };
  const def = store.DEFAULT_SETUP.chars || {};
  for (const k of Object.keys(def)) d.chars[k] = knownChar(d.chars[k], def[k]);
  return d;
}

// ---- match persistence ------------------------------------------------------------------------
// The save holds the match (js/match.js serialize) plus what the UI adds: the stage, and the move
// clock while one is running — { p, left (ms), moves, round } — so 이어하기 does not refill it.
function cleanClock(c) {
  if (!c || typeof c !== 'object') return null;
  const { p, left, moves, round } = c;
  if ((p !== 1 && p !== 2) || !Number.isFinite(left) || left < 0) return null;
  if (!Number.isInteger(moves) || moves < 0 || !Number.isInteger(round) || round < 1) return null;
  return { p, left: Math.round(left), moves, round };
}
function packSave(state, theme, clock) {
  const out = { v: 1, theme, match: JSON.parse(serialize(state)) };
  const c = cleanClock(clock);
  if (c) out.clock = c;
  return JSON.stringify(out);
}
function unpackSave(raw) {
  let obj = raw;
  if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { return null; } }
  if (!obj || typeof obj !== 'object') return null;
  const match = deserialize(obj.match !== undefined ? obj.match : obj);
  if (!match || match.status === 'matchOver') return null;
  match.cfg.p1 = knownChar(match.cfg.p1, 'bigom');
  match.cfg.p2 = knownChar(match.cfg.p2, 'nyangja');
  return { match, theme: typeof obj.theme === 'string' ? obj.theme : 'mat', clock: cleanClock(obj.clock) };
}

let saveWarned = false;
Object.assign(app, {
  version: VERSION,
  params,
  setPrefs(patch) {
    if (patch && typeof patch === 'object') Object.assign(app.prefs, patch);
    if (app.persist) store.savePrefs(app.prefs);
    applyPrefs();
    return app.prefs;
  },
  saveSetup() { if (app.persist) store.saveSetup(app.setup); },
  saveMatch(state, theme, clock = null) {
    if (!app.persist || !state) return;
    let ok = true;
    try { ok = store.saveMatch(packSave(state, theme, clock)) !== false; } catch { ok = false; }
    if (!ok && !saveWarned) {
      saveWarned = true;
      import('./ui/toast.js').then((m) => m.toast('이 브라우저에서는 저장이 안 돼요')).catch(() => {});
    }
  },
  loadMatch() {
    if (!app.persist) return null;
    try { return unpackSave(store.loadSave()); } catch { return null; }
  },
  hasMatch() { return !!app.loadMatch(); },
  clearMatch() { if (app.persist) { try { store.clearSave(); } catch { /* fine */ } } },
  recordMatch(sum) { if (app.persist) { try { store.recordMatch(sum); } catch (err) { console.warn('[omok] stats', err); } } },
  loadStats() { try { return store.loadStats() || {}; } catch { return {}; } },
  resetStats() { if (app.persist) { try { store.resetStats(); } catch { /* fine */ } } },
  go: (name, p, opts) => router.go(name, p, opts),
  current: () => router.currentScreen(),
  canInstall() {
    if (app.frozen) return true;
    if (!env || env.standalone) return false;
    if (env.ios) return true;
    try { return typeof install.canPromptInstall === 'function' && install.canPromptInstall(); } catch { return false; }
  },
  openInstallGuide() {
    const root = $('gateRoot');
    if (!root || root.childElementCount > 0) return;
    if (env && !env.ios && typeof install.canPromptInstall === 'function' && install.canPromptInstall()) {
      install.promptInstall().catch(() => {});
      return;
    }
    install.mountGate(root, env && env.inApp ? 'escape' : 'install', env, { auto: false, inGame: true, onPlayHere() {} });
  },
  share() { return install.shareApp(); },
  isLandscape: () => !!(landscapeMq && landscapeMq.matches),
});

// ---- lifecycle ---------------------------------------------------------------------------------
const gateUp = () => { const g = $('gateRoot'); return !!g && g.childElementCount > 0; };

// May the page reload into a new version right now? (js/install.js asks)
function canReload(when) {
  if (gateUp() || isSheetOpen()) return false;
  const name = router.screenName();
  const scr = router.currentScreen();
  if (!scr) return false;
  if (when === 'now') return (name === 'title' || name === 'menu') && !app.hasMatch();
  if (typeof scr.quiet === 'function') return scr.quiet(when) === true;
  return false;
}

function wireLifecycle() {
  const onHide = () => router.call('onHide');
  const onShow = () => {
    // An update that arrived while away: reload into it first (covers pageshow from bfcache).
    try { if (install.applyPendingUpdate()) return; } catch { /* fine */ }
    router.call('onShow');
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? onHide() : onShow()));
  window.addEventListener('pagehide', onHide);
  window.addEventListener('pageshow', (e) => { if (e.persisted && !document.hidden) onShow(); });

  if (landscapeMq) {
    const onRot = () => router.call('onLandscape', landscapeMq.matches);
    if (landscapeMq.addEventListener) landscapeMq.addEventListener('change', onRot);
    else if (landscapeMq.addListener) landscapeMq.addListener(onRot);
  }
  if (reduceMq) {
    const onRm = () => { if (app.prefs.motion === 'auto' || !app.prefs.motion) applyMotion(); };
    if (reduceMq.addEventListener) reduceMq.addEventListener('change', onRm);
    else if (reduceMq.addListener) reduceMq.addListener(onRm);
  }

  // iOS can leave a fixed page scrolled after a focus or the keyboard; the app never scrolls.
  const unscroll = () => {
    const b = document.body;
    if (b.scrollTop || b.scrollLeft) { b.scrollTop = 0; b.scrollLeft = 0; }
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  };
  window.addEventListener('scroll', unscroll, { passive: true });
  document.addEventListener('focusout', () => setTimeout(unscroll, 60));
  // Safari ignores user-scalable=no in a tab: no pinch, no long-press menu.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
  document.addEventListener('touchstart', () => {}, { passive: true });   // :active styles on iOS
}

function mountRotateOverlay() {
  if ($('rotate')) return;
  const r = document.createElement('div');
  r.id = 'rotate';
  r.setAttribute('role', 'alert');
  r.innerHTML = '<div class="rot__phone" aria-hidden="true"></div><div class="rot__text">세로로 돌려 주세요</div><div class="rot__sub">돌주먹은 세로 화면 전용이에요</div>';
  document.body.append(r);
}

// ---- boot --------------------------------------------------------------------------------------
function registerScreens() {
  router.register('title', createTitle);
  router.register('menu', createMenu);
  router.register('select', createSelect);
  router.register('vs', createVs);
  router.register('battle', createBattle);
  router.register('result', createResult);
  router.register('settings', createSettings);
  router.register('records', createRecords);
}

async function startApp(debug, shot) {
  registerScreens();
  mountRotateOverlay();
  if (env.standalone && navigator.storage && typeof navigator.storage.persist === 'function') {
    navigator.storage.persist().catch(() => {});
  }
  if (debug) debug.install({ app, router, VERSION });
  if (shot) { await debug.runShot(shot); return; }
  router.go('title', {}, { transition: 'none' });
  if (debug && params.has('bench')) debug.bench();
}

async function boot() {
  const wantsDebug = ['play', 'shot', 'gate', 'bench'].some((k) => params.has(k));
  const debug = wantsDebug ? await import('./debug.js').catch((err) => { console.warn('[omok] debug.js', err); return null; }) : null;
  const shot = debug ? debug.readShot(params) : null;
  const forcedGate = debug ? debug.readGate(params) : null;

  app.persist = !shot;
  app.frozen = !!shot;
  const defaults = { ...store.DEFAULT_PREFS };
  app.prefs = app.persist ? { ...defaults, ...(store.loadPrefs() || {}) } : { ...defaults, ...(shot.prefs || {}) };
  if (shot && shot.seed != null) app.rng = debug.seeded(shot.seed);
  app.setup = normalizeSetup(app.persist ? store.loadSetup() : null);
  applyPrefs();
  try { audio.init(app.prefs); } catch (err) { console.warn('[omok] audio.init', err); }

  env = install.detectEnv();
  app.env = env;
  // Before the app's own listeners: an update reload on a return to visible must win.
  install.registerSW({ beforeReload: () => router.call('onHide'), canReload });
  wireLifecycle();

  const forcePlay = params.get('play') === '1' || !!shot;
  const mode = forcedGate || install.gateMode(env, { forcePlay, trial: app.prefs.trial === true });
  if (mode === 'game') { await startApp(debug, shot); return; }
  // No save is created behind the gate. A forced gate shows what its usual audience sees.
  const gateEnv = !forcedGate ? env
    : forcedGate === 'escape' ? { ...env, ios: true, inApp: env.inApp || 'kakaotalk' }
      : { ...env, ios: true, safari: true, inApp: null };
  install.mountGate($('gateRoot'), mode, gateEnv, {
    auto: !forcedGate,
    onPlayHere() {
      app.setPrefs({ trial: true });
      startApp(debug, null).catch(bootFailed);
    },
  });
}

function bootFailed(err) {
  console.error('[omok] boot failed:', err);
  const root = $('app');
  if (!root) return;
  const msg = params.has('play') ? String((err && err.message) || err) : '문제가 생겼어요. 앱을 다시 열어 주세요';
  root.innerHTML = `<div class="scr" style="align-items:center;justify-content:center;text-align:center;gap:12px"><p class="disp" style="font-size:28px">앗!</p><p></p></div>`;
  root.querySelector('p:last-child').textContent = msg;
}

boot().catch(bootFailed);
