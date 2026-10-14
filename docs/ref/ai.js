// Prototype search: threat shortcuts + VCF + negamax alpha-beta / ID / TT + difficulty policy.
import { N, W, WW, EMPTY, BLACK, WHITE, FL_FIVE, FL_FOUR, FL_WIN3, FL_THREE, FL_FORBID, idxOf } from './board.js';

export const WIN = 1000000, INF = 2000000, MATE_BOUND = WIN - 1000;
const MAXPLY = 64, MAXMV = 225;
const TT_BITS = 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
const EXACT = 1, LOWER = 2, UPPER = 3;
const SIDE_LO = 0x5bd1e995 | 0, SIDE_HI = 0x27d4eb2d | 0; // xor'ed in when white to move

export const LEVELS = {
  easy:   { timeMs: 60,   maxDepth: 2,  rootK: 10, k1: 8,  k2: 6, k3: 4, vcf: 0,  oppVcf: 0,  seeFour: 0.9, seeThree: 0.5, temp: 220, topN: 6 },
  normal: { timeMs: 450,  maxDepth: 6,  rootK: 16, k1: 12, k2: 10, k3: 7, vcf: 8,  oppVcf: 6,  seeFour: 1,   seeThree: 1,   temp: 40,  topN: 3 },
  hard:   { timeMs: 1300, maxDepth: 16, rootK: 24, k1: 16, k2: 12, k3: 8, vcf: 16, oppVcf: 12, seeFour: 1,   seeThree: 1,   temp: 0,   topN: 1 },
};

export class Searcher {
  constructor(board) {
    this.b = board;
    this.ttLo = new Int32Array(TT_SIZE); this.ttHi = new Int32Array(TT_SIZE);
    this.ttScore = new Int32Array(TT_SIZE); this.ttDepth = new Int8Array(TT_SIZE);
    this.ttFlag = new Uint8Array(TT_SIZE); this.ttMove = new Int16Array(TT_SIZE).fill(-1);
    this.mv = new Int16Array(MAXPLY * MAXMV); this.sc = new Int32Array(MAXPLY * MAXMV);
    this.vcfLo = new Int32Array(1 << 16); this.vcfHi = new Int32Array(1 << 16); this.vcfD = new Int8Array(1 << 16);
    this.nodes = 0; this.deadline = 0; this.stop = false; this.cfg = LEVELS.hard;
  }
  timeUp() { if ((++this.nodes & 1023) === 0 && performance.now() > this.deadline) this.stop = true; return this.stop; }
  hashLo(c) { return c === WHITE ? this.b.hlo ^ SIDE_LO : this.b.hlo; }
  hashHi(c) { return c === WHITE ? this.b.hhi ^ SIDE_HI : this.b.hhi; }

  // ---- move generation into this.mv[ply*MAXMV ..]; returns count
  gen(c, ply, limit) {
    const b = this.b, o = 3 - c, base = ply * MAXMV, cb = c * WW, ob = o * WW;
    let n = 0;
    if (b.cnt5[o] > 0) {                                  // opponent four -> single forced block
      const i = b.findFlag(o, FL_FIVE);
      if (b.legal(i, c)) { this.mv[base] = i; this.sc[base] = 0; return 1; }
      return 0;                                           // block is forbidden for us -> lost
    }
    const defend = b.cntOpen4[o] > 0;                     // opponent threatens open-four / 4-4
    for (let i = 0; i < WW; i++) {
      if (b.cells[i] !== EMPTY || b.nb[i] === 0) continue;
      const fc = b.flags[cb + i];
      if (fc & FL_FORBID) continue;
      const fo = b.flags[ob + i];
      if (defend && !(fc & FL_FOUR) && !(fo & (FL_FOUR | FL_WIN3))) continue;
      const s = (fo & FL_FORBID) ? b.pval[cb + i] * 2 : b.pval[cb + i] * 2 + b.pval[ob + i];
      this.mv[base + n] = i; this.sc[base + n] = s; n++;
    }
    for (let a = 1; a < n; a++) {                         // insertion sort desc
      const m = this.mv[base + a], s = this.sc[base + a]; let k = a - 1;
      while (k >= 0 && this.sc[base + k] < s) { this.mv[base + k + 1] = this.mv[base + k]; this.sc[base + k + 1] = this.sc[base + k]; k--; }
      this.mv[base + k + 1] = m; this.sc[base + k + 1] = s;
    }
    return defend ? n : Math.min(n, limit);               // never prune defensive sets
  }

  evaluate(c, ply) {
    const b = this.b, o = 3 - c;
    if (b.cnt5[c] > 0) return WIN - ply - 1;
    if (b.cnt5[o] > 1) return -(WIN - ply - 2);
    if (b.cnt5[o] === 0 && b.cntOpen4[c] > 0 && b.cntFour[o] === 0) return WIN - ply - 3;
    return b.tot[c] - ((b.tot[o] * 9) >> 3) + 50;
  }

  // ---- VCF: can `a` (to move) win by continuous fours within `depth` attacker moves?
  vcf(a, depth, ply) {
    const b = this.b, d = 3 - a, ab = a * WW;
    if (b.cnt5[a] > 0) { this.vcfMove = b.findFlag(a, FL_FIVE); return true; }
    if (depth <= 0 || this.timeUp()) return false;
    const lo = this.hashLo(a), hi = this.hashHi(a), h = (lo ^ (hi >>> 16)) & 0xFFFF;
    if (this.vcfLo[h] === lo && this.vcfHi[h] === hi && this.vcfD[h] >= depth) return false; // failed before with >= depth
    let forced = -1;
    if (b.cnt5[d] > 0) { if (b.cnt5[d] > 1) return false; forced = b.findFlag(d, FL_FIVE); }
    const base = ply * MAXMV; let n = 0;
    for (let i = 0; i < WW; i++) {
      if (b.cells[i] !== EMPTY) continue;
      const f = b.flags[ab + i];
      if (!(f & FL_FOUR) || (f & FL_FORBID)) continue;
      if (forced >= 0 && i !== forced) continue;
      this.mv[base + n] = i; this.sc[base + n] = (f & FL_WIN3) ? 2 : (f & FL_THREE) ? 1 : 0; n++;
    }
    for (let a2 = 1; a2 < n; a2++) { const m = this.mv[base + a2], s = this.sc[base + a2]; let k = a2 - 1; while (k >= 0 && this.sc[base + k] < s) { this.mv[base + k + 1] = this.mv[base + k]; this.sc[base + k + 1] = this.sc[base + k]; k--; } this.mv[base + k + 1] = m; this.sc[base + k + 1] = s; }
    for (let k = 0; k < n; k++) {
      const m = this.mv[base + k];
      b.put(m, a);
      let win = false;
      if (b.cnt5[a] >= 2) win = true;                   // open four / double four
      else if (b.cnt5[d] === 0) {                        // defender cannot win first
        const r = b.findFlag(a, FL_FIVE);
        if (!b.legal(r, d)) win = true;                  // only block is 3-3 for defender -> unstoppable
        else { b.put(r, d); win = this.vcf(a, depth - 1, ply + 1); b.undo(); }
      }
      b.undo();
      if (win) { this.vcfMove = m; return true; }
      if (this.stop) return false;
    }
    this.vcfLo[h] = lo; this.vcfHi[h] = hi; this.vcfD[h] = depth;
    return false;
  }
  vcfFresh(a, depth, ms) { this.vcfD.fill(0); const sv = this.deadline, st = this.stop; this.deadline = Math.min(sv, performance.now() + ms); this.stop = false; const r = this.vcf(a, depth, 0); const timedOut = this.stop; this.deadline = sv; this.stop = st; return timedOut ? false : r; }

  // ---- negamax alpha-beta (fail-soft), TT with mate-distance normalisation
  ab(c, depth, ply, alpha, beta) {
    const b = this.b, o = 3 - c, cfg = this.cfg;
    if (b.cnt5[c] > 0) return WIN - ply - 1;
    if (this.timeUp()) return 0;
    if (depth <= 0) return this.evaluate(c, ply);
    const lo = this.hashLo(c), hi = this.hashHi(c), slot = lo & TT_MASK;
    let ttMove = -1;
    if (this.ttLo[slot] === lo && this.ttHi[slot] === hi) {
      ttMove = this.ttMove[slot];
      if (this.ttDepth[slot] >= depth) {
        let s = this.ttScore[slot]; const f = this.ttFlag[slot];
        if (s > MATE_BOUND) s -= ply; else if (s < -MATE_BOUND) s += ply;
        if (f === EXACT || (f === LOWER && s >= beta) || (f === UPPER && s <= alpha)) return s;
      }
    }
    const limit = ply < 2 ? cfg.k1 : ply < 4 ? cfg.k2 : cfg.k3;
    const n = this.gen(c, ply, limit);
    if (n === 0) return -(WIN - ply - 2);
    const base = ply * MAXMV;
    if (ttMove >= 0) for (let k = 1; k < n; k++) if (this.mv[base + k] === ttMove) { this.mv[base + k] = this.mv[base]; this.mv[base] = ttMove; break; }
    const a0 = alpha; let best = -INF, bestMove = this.mv[base];
    for (let k = 0; k < n; k++) {
      const m = this.mv[base + k];
      b.put(m, c);
      const ext = (b.cnt5[c] > 0 && depth <= 2) ? 1 : 0;   // we made a four: reply is forced, don't lose depth
      const s = -this.ab(o, depth - 1 + ext, ply + 1, -beta, -alpha);
      b.undo();
      if (this.stop) return best > -INF ? best : 0;
      if (s > best) { best = s; bestMove = m; }
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    let st = best; if (st > MATE_BOUND) st += ply; else if (st < -MATE_BOUND) st -= ply;
    this.ttLo[slot] = lo; this.ttHi[slot] = hi; this.ttScore[slot] = st; this.ttDepth[slot] = depth; this.ttMove[slot] = bestMove;
    this.ttFlag[slot] = best <= a0 ? UPPER : best >= beta ? LOWER : EXACT;
    return best;
  }

  bestLegalByPval(c, skip = -1) { const b = this.b; let best = -1, bs = -1; for (let j = 0; j < WW; j++) if (j !== skip && b.legal(j, c) && (b.nb[j] || b.n === 0) && b.pval[c * WW + j] > bs) { bs = b.pval[c * WW + j]; best = j; } return best; }

  // ---- root: returns { move, reason, score, depth, nodes, ms }
  think(c, level = 'hard', rng = Math.random, override = {}) {
    const cfg = this.cfg = { ...LEVELS[level], ...override };
    const b = this.b, o = 3 - c, t0 = performance.now();
    this.deadline = t0 + cfg.timeMs; this.stop = false; this.nodes = 0;
    const out = (move, reason, extra = {}) => ({ move, reason, ms: Math.round(performance.now() - t0), nodes: this.nodes, ...extra });
    // 1. opening policy
    if (b.n === 0) return out(level === 'easy' ? idxOf(6 + ((rng() * 3) | 0), 6 + ((rng() * 3) | 0)) : idxOf(7, 7), 'book');
    if (b.n === 1) { // adjacent reply toward centre
      const f = b.hist[0], cand = [];
      for (const d of [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1]) if (b.legal(f + d, c)) cand.push(f + d);
      return out(cand[(rng() * cand.length) | 0], 'book');
    }
    // 2. tactical shortcuts (easy may "not see" threats)
    if (b.cnt5[c] > 0) return out(b.findFlag(c, FL_FIVE), 'win');
    if (b.cnt5[o] > 0) {
      const i = b.findFlag(o, FL_FIVE);
      if (!b.legal(i, c)) return out(this.bestLegalByPval(c), 'lost');      // never return an illegal move
      if (rng() < cfg.seeFour) return out(i, 'block');
      const q = this.bestLegalByPval(c, i); return out(q, 'blunder');   // easy only: "didn't see it"
    }
    if (cfg.vcf && this.vcfFresh(c, cfg.vcf, cfg.timeMs * 0.2)) return out(this.vcfMove, 'vcf');
    // 3. root candidates (+ opponent-VCF refutation filter)
    let n = this.gen(c, 0, cfg.rootK);
    let moves = Array.from(this.mv.subarray(0, n));
    if (cfg.seeThree < 1 && b.cntOpen4[o] > 0 && rng() > cfg.seeThree) { // easy "misses" the open three
      const q = this.bestLegalByPval(c); if (q >= 0) return out(q, 'blunder');
    }
    if (cfg.oppVcf && this.vcfFresh(o, cfg.oppVcf, cfg.timeMs * 0.1)) {
      const keep = [];
      for (const m of moves) { b.put(m, c); const still = this.vcfFresh(o, cfg.oppVcf, cfg.timeMs * 0.05); b.undo(); if (!still) keep.push(m); }
      if (keep.length) moves = keep;                                     // else: lost anyway, search all
    }
    if (moves.length === 0) { const q = this.bestLegalByPval(c); return out(q, q < 0 ? 'draw' : 'lost'); }
    if (moves.length === 1) return out(moves[0], 'forced');
    // 4. iterative deepening
    let bestMove = moves[0], bestScore = -INF, depthDone = 0, rootScores = null;
    for (let depth = 1; depth <= cfg.maxDepth; depth++) {
      let alpha = -INF, curBest = -1, curScore = -INF; const scores = [];
      const window = cfg.temp ? cfg.temp * 3 : 0;          // keep near-best scores exact for softmax
      for (const m of moves) {
        b.put(m, c);
        const s = -this.ab(o, depth - 1, 1, -INF, -(alpha - window));
        b.undo();
        if (this.stop) break;
        scores.push([m, s]);
        if (s > curScore) { curScore = s; curBest = m; }
        if (s > alpha) alpha = s;
      }
      if (this.stop) { if (scores.length > 1 && curBest !== moves[0] && curScore > scores[0][1]) bestMove = curBest; break; }
      bestMove = curBest; bestScore = curScore; depthDone = depth; rootScores = scores;
      moves = [curBest, ...moves.filter((m) => m !== curBest)];  // PV first next iteration
      if (Math.abs(bestScore) > MATE_BOUND) break;
      if (performance.now() - t0 > cfg.timeMs * 0.45) break;      // next depth would not finish
    }
    // 5. human-like choice among near-best, never a proven-losing move
    if (cfg.temp && rootScores && Math.abs(bestScore) < MATE_BOUND) {
      const pool = rootScores.filter(([, s]) => s > -MATE_BOUND && s >= bestScore - cfg.temp * 3).sort((x, y) => y[1] - x[1]).slice(0, cfg.topN);
      let z = 0; const w = pool.map(([, s]) => (z += Math.exp((s - bestScore) / cfg.temp)));
      const r = rng() * z; const pick = pool[w.findIndex((x) => x >= r)];
      if (pick) return out(pick[0], pick[0] === bestMove ? 'search' : 'search~', { score: pick[1], depth: depthDone });
    }
    return out(bestMove, 'search', { score: bestScore, depth: depthDone });
  }
}
