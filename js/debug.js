// js/debug.js — test hooks (SPEC §8.8). Loaded by js/main.js only when the URL asks for it.
//
//   ?play=1                 skip the install gate (local runs, tests)
//   ?gate=install|escape    force a gate screen
//   ?shot=<state>           render a fixed state: fixed seed, fixed positions, nothing saved,
//                           CSS animations frozen at &t=<seconds> (default per shot). When the
//                           page is ready <html data-shot="ready">.
//       states: title menu setup2p setupCpu select vs coin battle armed forbidden ko roundResult
//               matchResult(&char=<id>&mode=cpu&winner=2) pause undoAsk settings records draw
//               timeover landscape
//       extra:  &theme=<id> (battle shots), &seed=<n>, &motion=reduce, &speed=fast|min
//   ?bench                  AI benchmark (js/ai/engine.js bench()) printed on screen + console
//   window.__omok = { app, router, VERSION, M } for manual poking.

import * as M from './match.js';
import { THEME_IDS } from './themes.js';
import { CHARACTER_IDS } from './characters.js';
import { openSetup } from './ui/setup.js';
import { seeded as seededRng } from './ui/dom.js';

export const SHOTS = [
  'title', 'menu', 'setup2p', 'setupCpu', 'select', 'vs', 'coin', 'battle', 'armed', 'forbidden', 'ko',
  'roundResult', 'matchResult', 'pause', 'undoAsk', 'settings', 'records', 'draw', 'timeover', 'landscape',
];
// default freeze time (seconds after the shot started) per state
const T_DEFAULT = { title: 1.4, vs: 1.2, matchResult: 2.6, ko: 0.6, roundResult: 0.8, coin: 1.0, select: 0.4 };

export const seeded = seededRng;

const xy = (x, y) => y * 15 + x;
// A calm mid-game position (12 stones, black to move, nobody close to five).
const MIDGAME = [[7, 7], [8, 7], [7, 8], [6, 6], [8, 9], [9, 8], [6, 8], [7, 9], [5, 7], [9, 6], [8, 8], [6, 9]].map(([x, y]) => xy(x, y));
// Black to move; (3,7) makes five on row 7 (4..7 already black, 8 is white).
const KO_LINE = [[7, 7], [8, 8], [6, 7], [8, 7], [5, 7], [8, 6], [6, 8], [9, 9], [4, 7], [7, 6]].map(([x, y]) => xy(x, y));
const KO_MOVE = xy(3, 7);
// Black to move; (7,7) is a double three (row 7: 5,6,7 and column 7: 5,6,7).
const FORBID = [[5, 7], [10, 10], [6, 7], [11, 11], [7, 5], [2, 12], [7, 6], [12, 2]].map(([x, y]) => xy(x, y));
const FORBID_MOVE = xy(7, 7);
// Rounds for a finished match: black wins in 9 / white wins in 10.
const BLACK_WINS = [[3, 7], [3, 9], [4, 7], [4, 9], [5, 7], [11, 3], [6, 7], [10, 10], [7, 7]].map(([x, y]) => xy(x, y));
const WHITE_WINS = [[3, 3], [7, 7], [3, 5], [8, 7], [12, 3], [9, 7], [3, 11], [10, 7], [12, 12], [11, 7]].map(([x, y]) => xy(x, y));

export function readShot(params) {
  const name = params.get('shot');
  if (!name || !SHOTS.includes(name)) return null;
  const t = parseFloat(params.get('t'));
  const seed = parseInt(params.get('seed'), 10);
  const prefs = { sound: false, haptics: true, fxSpeed: 'normal', seenArmHint: 3 };
  const sp = params.get('speed');
  if (sp === 'fast' || sp === 'min') prefs.fxSpeed = sp;
  if (params.get('motion') === 'reduce') prefs.motion = 'reduce';
  if (params.get('forbid') === '1') prefs.showForbidden = true;
  const ch = params.get('char');
  const theme = params.get('theme');
  return {
    name,
    t: Number.isFinite(t) && t >= 0 ? t : (T_DEFAULT[name] ?? 0.6),
    seed: Number.isFinite(seed) ? seed : 7,
    prefs,
    char: CHARACTER_IDS.includes(ch) ? ch : null,
    theme: THEME_IDS.includes(theme) ? theme : 'mat',
    mode: params.get('mode') === 'cpu' ? 'cpu' : '2p',
    winner: params.get('winner') === '2' ? 2 : 1,
    timer: [10, 20, 30].includes(parseInt(params.get('timer'), 10)) ? parseInt(params.get('timer'), 10) : null,
  };
}

export function readGate(params) {
  const g = params.get('gate');
  return g === 'install' || g === 'escape' ? g : null;
}

let ctx = null;
export function install(c) {
  ctx = c;
  globalThis.__omok = { ...c, M, shots: SHOTS };
}

// ---- fixtures ------------------------------------------------------------------------------------
function playAll(state, moves) {
  for (const i of moves) {
    const r = M.play(state, i);
    if (!r.ok) console.error('[debug] fixture move rejected', i, r);
  }
  return state;
}
function mkMatch(shot, extra = {}) {
  const p1 = shot.char || 'bigom';
  const p2 = shot.mode === 'cpu' ? (p1 === 'nyangja' ? 'bulttong' : 'nyangja') : (p1 === 'nyangja' ? 'bigom' : 'nyangja');
  return M.createMatch({
    mode: shot.mode, bestOf: 3, p1, p2, cpuLevel: 'normal', cpuPlayer: shot.mode === 'cpu' ? 2 : undefined,
    round1Black: 1, firstRule: 'loser', overlineWins: false, timer: shot.timer ?? 20, undoLimit: shot.mode === 'cpu' ? 3 : 1,
    ...extra,
  });
}
function finishedMatch(shot) {
  const S = mkMatch(shot, { timer: 0 });
  // R1: 2P wins (white), R2: 1P wins as black (loser takes black), R3: 1P wins as white → 2:1, 역전승
  playAll(S, WHITE_WINS); M.nextRound(S);
  playAll(S, BLACK_WINS); M.nextRound(S);
  playAll(S, WHITE_WINS);
  if (shot.winner === 2) {
    // mirror: 1P won R1, 2P took R2 and R3
    const T = mkMatch(shot, { timer: 0, round1Black: 2 });
    playAll(T, WHITE_WINS); M.nextRound(T);
    playAll(T, BLACK_WINS); M.nextRound(T);
    playAll(T, WHITE_WINS);
    return T;
  }
  return S;
}
const STATS = {
  matches: 27, rounds: 61,
  byChar: {
    bigom: { played: 14, won: 9 }, nyangja: { played: 9, won: 4 }, bulttong: { played: 7, won: 5 }, jaepjaep: { played: 6, won: 2 },
    ppibik: { played: 5, won: 3 }, kkakkung: { played: 4, won: 1 }, beonjjeok: { played: 6, won: 3 }, taenggeul: { played: 3, won: 1 },
  },
  cpu: { easy: { w: 6, l: 1 }, normal: { w: 4, l: 6 }, hard: { w: 1, l: 5 } },
  cpuStreak: 2, cpuBestStreak: 5, fastestKO: 11, longestRound: 87,
  recent: [
    { at: Date.UTC(2026, 9, 11, 12), mode: '2p', p1: 'bigom', p2: 'nyangja', score: [2, 1], winner: 1 },
    { at: Date.UTC(2026, 9, 10, 12), mode: 'cpu', p1: 'bulttong', p2: 'ppibik', score: [0, 2], winner: 2, level: 'hard' },
    { at: Date.UTC(2026, 9, 9, 12), mode: 'cpu', p1: 'bigom', p2: 'kkakkung', score: [2, 0], winner: 1, level: 'easy' },
    { at: Date.UTC(2026, 9, 7, 12), mode: '2p', p1: 'jaepjaep', p2: 'jaepjaep', score: [1, 2], winner: 2 },
    { at: Date.UTC(2026, 9, 5, 12), mode: '2p', p1: 'taenggeul', p2: 'beonjjeok', score: [3, 1], winner: 1 },
  ],
};

// ---- freezing ------------------------------------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function freezeAt(t0, t) {
  // Every animation of the shot started at ≈ t0 (performance clock). Seek each one to what it
  // would show t seconds after the shot started, let that frame render, then hold it there.
  // (WebKit shows a stale compositor frame when a paused animation is seeked, so seek first,
  // pause after.) A finished animation's currentTime is stuck at its end, so measure from
  // startTime on the document timeline when there is one (an excerpt's moved start survives).
  const shift = t * 1000 - (performance.now() - t0);
  const tl = document.timeline ? document.timeline.currentTime : null;
  const list = document.getAnimations();
  for (const a of list) {
    try {
      const virt = a.startTime != null && tl != null ? (tl - a.startTime) * (a.playbackRate || 1) : (a.currentTime || 0);
      a.currentTime = Math.max(0, virt + shift);
    } catch { /* finished / removed */ }
  }
  for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(() => r()));
  for (const a of document.getAnimations()) { try { a.pause(); } catch { /* gone */ } }
}

// ---- shots ----------------------------------------------------------------------------------------
export async function runShot(shot) {
  const { app, router } = ctx;
  app.loadStats = () => JSON.parse(JSON.stringify(STATS));
  app.setup.chars = { p1: 'bigom', p2: 'nyangja', cpuMe: 'bigom' };
  const t0 = performance.now();
  const battle = (match, opts = {}) => router.go('battle', { match, theme: shot.theme, intro: false, ...opts }, { transition: 'none' });
  let settle = 700;
  switch (shot.name) {
    case 'title': router.go('title', {}, { transition: 'none' }); break;
    case 'menu': router.go('menu', {}, { transition: 'none' }); break;
    case 'setup2p': router.go('menu', {}, { transition: 'none' }); openSetup('2p'); break;
    case 'setupCpu': router.go('menu', {}, { transition: 'none' }); openSetup('cpu'); break;
    case 'select': {
      const s = router.go('select', { mode: shot.mode }, { transition: 'none' });
      s.debugState({ p1: shot.char || 'bigom', p2: 'kkakkung' });
      break;
    }
    case 'vs': router.go('vs', { match: mkMatch(shot), theme: shot.theme }, { transition: 'none' }); break;
    case 'coin': {
      const b = battle(mkMatch(shot, { round1Black: shot.winner === 2 ? 2 : 1 }));
      b.shot('coin');
      break;
    }
    case 'battle': battle(playAll(mkMatch(shot), MIDGAME)); break;
    case 'armed': { const b = battle(playAll(mkMatch(shot), MIDGAME)); await wait(80); b.shot('armed', { idx: xy(9, 7) }); break; }
    case 'forbidden': { const b = battle(playAll(mkMatch(shot), FORBID)); await wait(80); b.shot('forbidden', { idx: FORBID_MOVE }); settle = 0; break; }
    case 'ko': { const b = battle(playAll(mkMatch(shot), KO_LINE)); await wait(60); b.shot('ko', { idx: KO_MOVE }); break; }
    case 'roundResult': { const b = battle(playAll(mkMatch(shot), KO_LINE)); await wait(60); b.shot('roundResult', { idx: KO_MOVE }); break; }
    case 'matchResult': router.go('result', { match: finishedMatch(shot), theme: shot.theme }, { transition: 'none' }); break;
    case 'pause': { const b = battle(playAll(mkMatch(shot), MIDGAME)); await wait(40); b.shot('pause'); break; }
    case 'undoAsk': { const b = battle(playAll(mkMatch(shot), MIDGAME.slice(0, 11))); await wait(40); b.shot('undoAsk'); break; }
    case 'settings': router.go('settings', {}, { transition: 'none' }); break;
    case 'records': router.go('records', {}, { transition: 'none' }); break;
    case 'draw': { const b = battle(playAll(mkMatch(shot), MIDGAME)); await wait(40); b.shot('draw'); break; }
    case 'timeover': { const b = battle(playAll(mkMatch(shot), MIDGAME)); await wait(40); b.shot('timeover'); break; }
    case 'landscape': {
      battle(playAll(mkMatch(shot), MIDGAME));
      document.documentElement.dataset.forceRotate = '1';
      break;
    }
    default: break;
  }
  await wait(settle);
  await freezeAt(t0, shot.t);
  for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(() => r()));
  await wait(40);
  document.documentElement.dataset.shot = 'ready';
}

// ---- AI bench --------------------------------------------------------------------------------------
export async function bench() {
  const pre = document.createElement('pre');
  pre.id = 'bench';
  pre.style.cssText = 'position:fixed;inset:auto 8px 8px 8px;z-index:200;max-height:60vh;overflow:auto;margin:0;padding:10px;border:3px solid #2A1E2F;border-radius:12px;background:#FFF4DE;color:#2A1E2F;font:12px/1.4 ui-monospace,Menlo,monospace;white-space:pre-wrap';
  pre.textContent = 'AI bench…';
  document.body.append(pre);
  const lines = [];
  try {
    const eng = await import('./ai/engine.js');
    if (typeof eng.bench === 'function') {
      const rows = await eng.bench();
      for (const r of rows) lines.push(`${r.name.padEnd(14)} move ${String(r.move).padStart(3)} ${String(r.reason).padEnd(8)} d${r.depth} ${r.nodes}n ${r.ms}ms ${r.knps}knps`);
    }
  } catch (err) { lines.push('engine bench failed: ' + err.message); }
  try {
    const { createAiClient } = await import('./ai-client.js');
    const ai = createAiClient({});
    for (const level of ['easy', 'normal', 'hard']) {
      const t = performance.now();
      const r = await ai.think({ moves: MIDGAME, level, seed: 1 });
      lines.push(`client ${level.padEnd(7)} move ${r.move} ${r.reason} d${r.depth} ${r.nodes}n ${r.ms}ms (wall ${Math.round(performance.now() - t)}ms, ${r.via})`);
    }
    ai.dispose();
  } catch (err) { lines.push('client bench failed: ' + err.message); }
  pre.textContent = lines.join('\n');
  console.log('[bench]\n' + lines.join('\n'));
  document.documentElement.dataset.bench = 'done';
}
