#!/usr/bin/env node
// Self-play strength check for the CPU levels (dev only, not precached).
//
//   node tools/selfplay.mjs [A] [B] [pairs] [--jobs N] [--seed S] [--open K] [--msA T] [--msB T] [--max-ply P]
//   e.g. node tools/selfplay.mjs hard normal 12 --jobs 4
//
// Each pair is one random opening (K stones near the centre, default 2) played twice with the
// colours swapped, so the first-move advantage cancels out. Every move is checked with
// rules.judgeMove by this harness (not by the engine), and the game ends on five, on a draw
// (no legal point for the side to move) or at --max-ply. Each side has its own engine.
// With --jobs > 1 pairs run in worker threads; keep jobs ≤ free cores or the time budgets
// (and so the strength) get distorted.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { N, EMPTY, BLACK, WHITE, DEFAULT_RULES, judgeMove } from '../js/rules.js';
import { createEngine } from '../js/ai/engine.js';

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let k = 0; k < argv.length; k++) {
    if (argv[k].startsWith('--')) opt[argv[k].slice(2)] = argv[++k];
    else pos.push(argv[k]);
  }
  return {
    a: pos[0] || 'hard', b: pos[1] || 'normal', pairs: +(pos[2] || 6),
    jobs: +(opt.jobs || 1), seed: +(opt.seed || 7), open: +(opt.open ?? 2),
    msA: opt.msA ? +opt.msA : undefined, msB: opt.msB ? +opt.msB : undefined,
    maxPly: +(opt['max-ply'] || 225), overline: opt.overline === '1',
  };
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// K distinct stones in the central 5×5, alternating colours, legal and non-winning.
function opening(r, k, rules) {
  const b = new Int8Array(N * N), moves = [];
  while (moves.length < k) {
    const i = (5 + ((r() * 5) | 0)) * N + 5 + ((r() * 5) | 0);
    const c = moves.length % 2 === 0 ? BLACK : WHITE;
    if (b[i] !== EMPTY) continue;
    const j = judgeMove(b, i % N, (i / N) | 0, c, rules);
    if (!j.ok || j.win) continue;
    b[i] = c; moves.push(i);
  }
  return moves;
}

function playGame({ open, aColor, a, b, msA, msB, maxPly, rules, seed }) {
  const engA = createEngine(rules), engB = createEngine(rules);
  const board = new Int8Array(N * N), moves = [];
  open.forEach((i, k) => { board[i] = k % 2 === 0 ? BLACK : WHITE; moves.push(i); });
  const stats = { A: { n: 0, ms: 0, max: 0, depth: 0, reasons: {} }, B: { n: 0, ms: 0, max: 0, depth: 0, reasons: {} } };
  let winner = 0, how = 'maxply';
  while (moves.length < maxPly) {
    const c = moves.length % 2 === 0 ? BLACK : WHITE;
    const isA = c === aColor;
    const side = isA ? 'A' : 'B';
    const r = (isA ? engA : engB).think({ moves, level: isA ? a : b, seed: (seed + moves.length * 7919) >>> 0, timeMs: isA ? msA : msB });
    const st = stats[side];
    st.n++; st.ms += r.ms; st.max = Math.max(st.max, r.ms); st.depth += r.depth;
    st.reasons[r.reason] = (st.reasons[r.reason] || 0) + 1;
    if (r.move < 0) { how = 'draw'; break; }
    const j = judgeMove(board, r.move % N, (r.move / N) | 0, c, rules);
    if (!j.ok) { winner = isA ? 'B' : 'A'; how = `illegal(${side}:${j.reason})`; break; }
    board[r.move] = c; moves.push(r.move);
    if (j.win) { winner = side; how = 'five'; break; }
  }
  return { winner, how, plies: moves.length, stats };
}

function runPairs(cfg, pairIds) {
  const rules = { ...DEFAULT_RULES, overlineWins: cfg.overline };
  const out = [];
  for (const p of pairIds) {
    const r = rng(cfg.seed * 1000003 + p);
    const open = opening(r, cfg.open, rules);
    for (const aColor of [BLACK, WHITE]) {
      const g = playGame({ open, aColor, a: cfg.a, b: cfg.b, msA: cfg.msA, msB: cfg.msB, maxPly: cfg.maxPly, rules, seed: (cfg.seed * 31 + p * 2 + aColor) >>> 0 });
      out.push({ pair: p, aColor, ...g });
    }
  }
  return out;
}

if (!isMainThread) {
  parentPort.postMessage(runPairs(workerData.cfg, workerData.pairs));
} else {
  const cfg = parseArgs(process.argv.slice(2));
  const ids = Array.from({ length: cfg.pairs }, (_, k) => k);
  const jobs = Math.max(1, Math.min(cfg.jobs, cfg.pairs));
  const t0 = Date.now();
  let games;
  if (jobs === 1) games = runPairs(cfg, ids);
  else {
    const chunks = Array.from({ length: jobs }, (_, j) => ids.filter((p) => p % jobs === j));
    const parts = await Promise.all(chunks.map((pairs) => new Promise((res, rej) => {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { cfg, pairs } });
      w.once('message', res); w.once('error', rej);
    })));
    games = parts.flat().sort((x, y) => x.pair - y.pair || x.aColor - y.aColor);
  }
  let aWins = 0, bWins = 0, draws = 0, aBlack = 0, aWhite = 0, illegal = 0;
  const agg = { A: { n: 0, ms: 0, max: 0, depth: 0, reasons: {} }, B: { n: 0, ms: 0, max: 0, depth: 0, reasons: {} } };
  for (const g of games) {
    const col = g.aColor === BLACK ? 'B' : 'W';
    console.log(`pair ${String(g.pair).padStart(2)} A=${col}  ${g.winner ? g.winner + ' wins' : 'draw  '}  ${g.how.padEnd(6)} ${g.plies} plies`);
    if (g.winner === 'A') { aWins++; if (g.aColor === BLACK) aBlack++; else aWhite++; }
    else if (g.winner === 'B') bWins++;
    else draws++;
    if (g.how.startsWith('illegal')) illegal++;
    for (const s of ['A', 'B']) {
      const a = agg[s], b = g.stats[s];
      a.n += b.n; a.ms += b.ms; a.max = Math.max(a.max, b.max); a.depth += b.depth;
      for (const [k, v] of Object.entries(b.reasons)) a.reasons[k] = (a.reasons[k] || 0) + v;
    }
  }
  const fmt = (s, lvl) => `${lvl.padEnd(6)} avg ${(agg[s].ms / Math.max(1, agg[s].n)).toFixed(0)} ms, max ${agg[s].max} ms, avg depth ${(agg[s].depth / Math.max(1, agg[s].n)).toFixed(1)}, reasons ${JSON.stringify(agg[s].reasons)}`;
  console.log(`\nA=${cfg.a} vs B=${cfg.b}: A ${aWins} - ${bWins} B, draws ${draws} of ${games.length} games  (A as black ${aBlack}/${games.length / 2}, as white ${aWhite}/${games.length / 2})  illegal ${illegal}  ${((Date.now() - t0) / 1000).toFixed(0)} s, jobs ${jobs}`);
  console.log('A ' + fmt('A', cfg.a));
  console.log('B ' + fmt('B', cfg.b));
}
