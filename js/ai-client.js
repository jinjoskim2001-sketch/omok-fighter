// ai-client.js — main-thread side of the CPU opponent (SPEC §8.2, docs/research/ai.md §8).
//
// What shapes this file:
// - The search runs in a module Worker (Safari/iOS 15+) so the board, timers and animations
//   stay smooth while the CPU thinks. If the Worker cannot start (old Safari, blocked script,
//   crash, hang) the same engine runs on the main thread with the budget capped at 500 ms, and
//   the client stays on that path from then on.
// - A search cannot be interrupted from outside. Cancelling (undo, quit, new request, app
//   hidden) therefore terminates a busy Worker; the next request spawns a fresh one (module is
//   cached, the pattern table takes ~25 ms). Replies carry the request id and stale ones are
//   dropped, so a late answer can never land on the wrong position.
// - iOS suspends workers in the background; a search resumed after its deadline would play a
//   shallow move. So `visibilitychange → hidden` cancels the search, and the UI asks again when
//   the app is visible (SPEC §8.8 lifecycle).
// - The game must never receive an illegal point. Every answer, whichever path produced it, is
//   checked with rules.judgeMove before it is resolved; a bad one is recomputed.
// - Version skew after an update (sw.js activates a new version mid-session; the page reloads
//   only at a quiet moment, js/install.js). From then on every fetch is served from the NEW
//   cache, so code this page loads lazily would be the next version's, running inside this
//   one. Hence: the main-thread engine is a static import (always this page's own version),
//   and while install.isUpdatePending() no fresh Worker is spawned: a live one keeps serving,
//   otherwise the in-memory engine plays (fallback budget) until the reload. (pumal guards its
//   only lazy module the same way, js/main.js.)
//
// createAiClient({ overlineWins, updatePending? }) → {   (updatePending: tests only; defaults to install.isUpdatePending)
//   think({ moves, level, seed?, timeMs? }) → Promise<{ move, reason, score, depth, nodes, ms, via }>
//       moves: the round's move list (y*15+x, black first) — the CPU plays the side to move.
//       move: always passes rules.judgeMove; -1 with reason 'draw' only when the CPU has no
//       legal point. reason: see engine.js ('fallback' + `error` = last-resort move after an
//       engine failure). ms: search time; time the reveal delay with your own clock.
//       via: 'worker' | 'main'. Rejects with err.name === 'AbortError' when cancelled
//       (err.message 'cancelled' | 'hidden' | 'disposed'), or a TypeError for a bad move list.
//       A newer think() cancels the older one.
//   cancel()   drop the request in flight (its promise rejects with AbortError). On the
//              main-thread fallback a search that already started runs to its end (≤ 500 ms).
//   dispose()  cancel + stop the Worker and free its memory (~4 MB). The client can be used
//              again afterwards; it respawns on the next think().
//   reset()    new game: clear the engine's transposition table (optional — requests are stateless)
//   warm()     start the Worker ahead of the first request → Promise<boolean> (true = Worker ready)
// }

import { N, EMPTY, BLACK, WHITE, DEFAULT_RULES, judgeMove } from './rules.js';
import { createEngine } from './ai/engine.js';
import { isUpdatePending } from './install.js';

const CELLS = N * N;
const LEVEL_MS = { easy: 60, normal: 450, hard: 1300 };
const READY_TIMEOUT_MS = 6000;   // module fetch + table build; a real failure fires onerror at once
const HANG_GRACE_MS = 3000;      // no reply by timeMs + this → treat the Worker as hung
const FALLBACK_CAP_MS = 500;     // main-thread search blocks input, so keep it short
const PAINT_GAP_MS = 30;         // let the "생각 중…" frame paint before blocking the main thread

function abortError(message) {
  const e = new Error(message);
  e.name = 'AbortError';
  return e;
}

function checkMoves(moves) {
  if (!Array.isArray(moves) || moves.length > CELLS) throw new TypeError('moves must be an array of ≤ 225 points');
  const seen = new Uint8Array(CELLS);
  for (let k = 0; k < moves.length; k++) {
    const i = moves[k];
    if (!Number.isInteger(i) || i < 0 || i >= CELLS || seen[i]) throw new TypeError(`bad move ${k}: ${i}`);
    seen[i] = 1;
  }
  return moves.slice();
}

function boardFrom(moves) {
  const b = new Int8Array(CELLS);
  for (let k = 0; k < moves.length; k++) b[moves[k]] = k % 2 === 0 ? BLACK : WHITE;
  return b;
}

// Is `res.move` an acceptable answer for the side to move?
function verify(res, moves, rules) {
  if (!res || typeof res !== 'object' || !Number.isInteger(res.move)) return false;
  const b = boardFrom(moves);
  const c = moves.length % 2 === 0 ? BLACK : WHITE;
  if (res.move === -1) {
    for (let i = 0; i < CELLS; i++) if (b[i] === EMPTY && judgeMove(b, i % N, (i / N) | 0, c, rules).ok) return false;
    return true;
  }
  if (res.move < 0 || res.move >= CELLS) return false;
  return judgeMove(b, res.move % N, (res.move / N) | 0, c, rules).ok;
}

// Last resort when even the engine module cannot load (offline and not cached): win if we can,
// block a five if we can, else play next to the last stone. Always legal by rules.judgeMove.
function emergencyMove(moves, rules) {
  const t0 = Date.now();
  const b = boardFrom(moves);
  const c = moves.length % 2 === 0 ? BLACK : WHITE, o = 3 - c;
  const last = moves.length ? moves[moves.length - 1] : 7 * N + 7;
  const lx = last % N, ly = (last / N) | 0;
  let block = -1, best = -1, bestD = Infinity;
  for (let i = 0; i < CELLS; i++) {
    if (b[i] !== EMPTY) continue;
    const x = i % N, y = (i / N) | 0;
    const j = judgeMove(b, x, y, c, rules);
    if (!j.ok) continue;
    if (j.win) return { move: i, reason: 'win', score: 0, depth: 0, nodes: 0, ms: Date.now() - t0, via: 'main' };
    if (block < 0 && judgeMove(b, x, y, o, rules).win) block = i;
    const d = Math.max(Math.abs(x - lx), Math.abs(y - ly)) * 32 + Math.abs(x - 7) + Math.abs(y - 7);
    if (d < bestD) { bestD = d; best = i; }
  }
  const move = block >= 0 ? block : best;
  return { move, reason: move < 0 ? 'draw' : 'fallback', score: 0, depth: 0, nodes: 0, ms: Date.now() - t0, via: 'main' };
}

export function createAiClient({ overlineWins = false, updatePending = isUpdatePending } = {}) {
  const rules = Object.freeze({ ...DEFAULT_RULES, overlineWins: overlineWins === true });
  // A new version has taken over the cache: a Worker spawned now would load ITS worker.js and
  // engine.js into this page. Keep a live Worker, never start one.
  const skewed = () => { try { return updatePending() === true; } catch { return false; } };
  let worker = null;        // the Worker (spawning or ready), or null
  let ready = null;         // Promise<boolean> for `worker`
  let stopSpawn = null;     // settles a spawn still waiting for 'ready'
  let broken = false;       // the Worker path failed: main thread from now on
  let local = null;         // the main-thread engine (built on first use: ~25 ms, ~4 MB)
  let seq = 0;              // id of the newest request
  let current = null;       // the request in flight (any path)
  let busy = null;          // the request the Worker is searching right now
  let listening = false;

  function finish(job, result, error) {
    if (job.done) return;
    job.done = true;
    clearTimeout(job.timer);
    if (current === job) current = null;
    if (busy === job) busy = null;
    if (error) job.reject(error); else job.resolve(result);
  }

  function killWorker() {
    const w = worker;
    worker = null;
    ready = null;
    if (stopSpawn) { const s = stopSpawn; stopSpawn = null; s(false); }
    if (w) { w.onmessage = null; w.onerror = null; w.onmessageerror = null; try { w.terminate(); } catch { /* already gone */ } }
  }

  // The Worker failed (load error, crash, hang): switch to the main thread for good and finish
  // whatever it was working on there.
  function markBroken() {
    broken = true;
    const job = busy;
    busy = null;
    killWorker();
    if (job && !job.done) fallback(job);
  }

  function spawn() {
    return new Promise((resolve) => {
      let w;
      try {
        if (typeof Worker !== 'function') throw new Error('Worker unavailable');
        w = new Worker(new URL('./ai/worker.js', import.meta.url), { type: 'module' });
      } catch {
        broken = true;
        resolve(false);
        return;
      }
      worker = w;
      let settled = false;
      const settle = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (stopSpawn === settle) stopSpawn = null;
        resolve(ok);
      };
      stopSpawn = settle;
      const timer = setTimeout(() => { if (worker === w) markBroken(); settle(false); }, READY_TIMEOUT_MS);
      w.onerror = (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (worker === w) markBroken();
        settle(false);
      };
      w.onmessageerror = w.onerror;
      w.onmessage = (e) => {
        if (worker !== w) return;
        const m = e.data;
        if (!m || typeof m !== 'object') return;
        if (m.t === 'ready') settle(true);
        else onReply(m);
      };
      try {
        w.postMessage({ t: 'init', rules: { overlineWins: rules.overlineWins } });
      } catch {
        markBroken();
        settle(false);
      }
    });
  }

  function onReply(m) {
    const job = busy;
    if (!job || m.id !== job.id) return;              // stale: a cancelled or replaced request
    busy = null;
    clearTimeout(job.timer);
    if (m.t === 'move') {
      const res = { move: m.move, reason: m.reason, score: m.score, depth: m.depth, nodes: m.nodes, ms: m.ms, via: 'worker' };
      if (verify(res, job.moves, rules)) finish(job, res);
      else fallback(job, 'worker answer failed the legality check');   // never hand the game an illegal point
    } else if (m.t === 'error') {
      fallback(job, m.message || 'worker error');      // the CPU must still move
    }
  }

  function toWorker(job) {
    busy = job;
    job.timer = setTimeout(() => { if (busy === job && !job.done) markBroken(); }, job.timeMs + HANG_GRACE_MS);
    try {
      worker.postMessage({ t: 'think', id: job.id, moves: job.moves, level: job.level, seed: job.seed, timeMs: job.timeMs });
    } catch {
      markBroken();
    }
  }

  // Main-thread search. `why` (debug only) says why the Worker answer was not used; it is passed
  // along as result.error. Ends in emergencyMove if the engine cannot load or fails, so the CPU
  // always moves.
  async function runLocal(job, why) {
    let eng = null, error = why;
    await new Promise((r) => setTimeout(r, PAINT_GAP_MS));
    if (job.done) return;
    try {
      eng = local ??= createEngine({ overlineWins: rules.overlineWins });
    } catch (e) {
      local = null;                                    // try again next time
      error = String(e?.message ?? e);
    }
    let res = null;
    if (eng) {
      try {
        res = { ...eng.think({ moves: job.moves, level: job.level, seed: job.seed, timeMs: Math.min(job.timeMs, FALLBACK_CAP_MS) }), via: 'main' };
      } catch (e) {
        error = String(e?.message ?? e);
      }
    }
    if (!res || !verify(res, job.moves, rules)) res = emergencyMove(job.moves, rules);
    if (error) res.error = error;
    finish(job, res);
  }

  function fallback(job, why) {
    runLocal(job, why).catch((e) => finish(job, null, e));
  }

  async function run(job) {
    try {
      if (!broken && (worker || !skewed())) {
        const ok = await (ready ??= spawn());
        if (job.done) return;
        if (ok && worker && !broken) { toWorker(job); return; }
      }
      await runLocal(job);
    } catch (e) {
      finish(job, null, e);
    }
  }

  function abortCurrent(message) {
    const job = current;
    if (!job) return;
    if (busy === job) { busy = null; killWorker(); }   // mid-search: only terminate() stops it
    finish(job, null, abortError(message));
  }

  const onVisibility = () => { if (document.visibilityState === 'hidden') abortCurrent('hidden'); };
  function listen() {
    if (listening || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    document.addEventListener('visibilitychange', onVisibility);
    listening = true;
  }

  function think(req = {}) {
    listen();
    abortCurrent('cancelled');                         // a newer request replaces the old one
    const id = ++seq;
    return new Promise((resolve, reject) => {
      let moves;
      try { moves = checkMoves(req && req.moves); } catch (e) { reject(e); return; }
      // Asked while hidden: iOS would freeze the search mid-way. Ask again when visible.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { reject(abortError('hidden')); return; }
      const level = Object.prototype.hasOwnProperty.call(LEVEL_MS, req.level) ? req.level : 'normal';
      const timeMs = Number.isFinite(req.timeMs) ? Math.min(10000, Math.max(10, req.timeMs)) : LEVEL_MS[level];
      const seed = Number.isFinite(req.seed) ? req.seed >>> 0 : ((Date.now() ^ Math.imul(moves.length + 1, 2654435761)) >>> 0);
      const job = { id, moves, level, seed, timeMs, resolve, reject, done: false, timer: 0 };
      current = job;
      run(job);
    });
  }

  function cancel() {
    abortCurrent('cancelled');
  }

  function dispose() {
    abortCurrent('disposed');
    killWorker();
    local = null;
    if (listening) {
      document.removeEventListener('visibilitychange', onVisibility);
      listening = false;
    }
  }

  function reset() {
    if (worker) { try { worker.postMessage({ t: 'reset' }); } catch { /* a respawned Worker starts clean */ } }
    if (local) { try { local.reset(); } catch { /* rebuilt on the next failure */ } }
  }

  function warm() {
    if (broken || (!worker && skewed())) return Promise.resolve(false);
    return (ready ??= spawn());
  }

  return { think, cancel, dispose, reset, warm };
}
