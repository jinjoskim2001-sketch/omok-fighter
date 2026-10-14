// engine.js — the CPU opponent's search (SPEC §8.2, docs/research/ai.md). Pure: no DOM, no
// Worker API. worker.js wraps it; ai-client.js also runs it on the main thread as a fallback.
//
// What shapes this file:
// - Legality must match js/rules.js exactly: 3-3 is forbidden for both colours, including the
//   recursive fake-three check, and overlineWins decides whether six counts. The fast pattern
//   table below only knows the geometric definition. That definition is a strict superset of
//   rules' forbidden points: the table counts any line that is one stone away from two winning
//   points as a three, while rules also requires a straight four and a straightening point that
//   is not itself forbidden. So the table only *flags* a possible 3-3 (FL_MAYBE), and legal()
//   confirms every flagged point with rules.isForbidden on a mirror board. tests/ai.test.js
//   fuzzes this parity for both colours.
// - JavaScriptCore (iPhone) is fast on typed arrays and integer maths, and slow on BigInt,
//   strings, closures and sort comparators in hot loops. The search uses none of those.
// - Budget by time, never by depth. Lockdown or Low Power Mode can make JS about 10× slower; a
//   depth budget would freeze the game, a time budget just plays weaker. Time is checked every
//   256 nodes and every phase of the root has its own share of the budget.
// - Stateless requests. Every think() rebuilds the board from the move list, so undo and new
//   games need nothing special. Only the transposition table survives between calls (it is
//   keyed by position, so stale entries are still true; reset() or a level change clears it).
// - Whatever happens inside, think() returns a point that rules.judgeMove accepts, or -1 with
//   reason 'draw' when the side to move has no legal point at all.

import { N, EMPTY, BLACK, WHITE, DEFAULT_RULES, isForbidden, judgeMove } from '../rules.js';

const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? () => performance.now() : () => Date.now();

// ---- geometry: a padded 1-D board so window reads never need a bounds check ---------------
const PAD = 5;
const W = N + 2 * PAD;            // 25
const WW = W * W;                 // 625
const CELLS = N * N;              // 225
const WALL = 3;
const DIR = [1, W, W + 1, W - 1]; // —, |, \, /
const toPad = (i) => (((i / N) | 0) + PAD) * W + (i % N) + PAD;
const PUB = new Int16Array(WW).fill(-1);  // padded index -> public y*15+x (-1 = wall)
for (let i = 0; i < CELLS; i++) PUB[toPad(i)] = i;
const FIRST = toPad(0), LAST = toPad(CELLS - 1);
const CENTER = toPad(7 * N + 7);

// ---- pattern levels: what placing a stone HERE makes on one line --------------------------
const NONE = 0, B2 = 1, F2 = 2, B3 = 3, F3 = 4, B4 = 5, F4 = 6, F5 = 7;
// Per-point flags, per colour.
const FL_FIVE = 1;    // makes five
const FL_FOUR = 2;    // makes at least one four (one point left to five)
const FL_THREE = 4;   // makes at least one (table) open three
const FL_WIN3 = 8;    // makes an open four or two fours: wins next move unless answered by a five
const FL_MAYBE = 16;  // table sees two threes: forbidden unless rules' fake-three check clears it
// Static value per pattern level, used for move ordering and evaluation. 3-3 is worth nothing
// (it cannot be played), unlike freestyle engines that score it as a winning shape.
const VAL = new Int32Array([0, 2, 10, 12, 60, 80, 400, 10000]);
const VAL_WIN3 = 3000, VAL_43 = 1500;

const POW3 = [1, 3, 9, 27, 81, 243, 729, 2187, 6561, 19683];
const KEYS = 59049;

// Line window -> pattern level. Window digit i covers offsets -5..-1 (i = 0..4) and +1..+5
// (i = 5..9) around the point, which is always "own". Digit 0 empty, 1 own, 2 opponent/wall.
// Built by recursion with memoisation, so split threes, X.XXX.X and exact-five vs overline all
// fall out of the definitions instead of a hand-written shape list.
function buildTable(overlineWins) {
  const t = new Int8Array(KEYS).fill(-1);
  const digit = (k, i) => ((k / POW3[i]) | 0) % 3;
  const isFive = (k) => {
    let run = 1;
    for (let i = 4; i >= 0 && digit(k, i) === 1; i--) run++;
    for (let i = 5; i <= 9 && digit(k, i) === 1; i++) run++;
    return overlineWins ? run >= 5 : run === 5;
  };
  const level = (k) => {
    if (t[k] >= 0) return t[k];
    let r = NONE;
    if (isFive(k)) r = F5;
    else {
      let wins = 0;
      for (let i = 0; i < 10; i++) if (digit(k, i) === 0 && isFive(k + POW3[i])) wins++;
      if (wins >= 2) r = F4;
      else if (wins === 1) r = B4;
      else {
        for (let i = 0; i < 10; i++) {
          if (digit(k, i) !== 0) continue;
          const l = level(k + POW3[i]);
          const down = l === F4 ? F3 : l === B4 ? B3 : l === F3 ? F2 : l === B3 ? B2 : NONE;
          if (down > r) r = down;
        }
      }
    }
    return (t[k] = r);
  };
  for (let k = 0; k < KEYS; k++) level(k);
  return t;
}
const TABLES = [null, null];
const tableFor = (ow) => (TABLES[ow ? 1 : 0] ??= buildTable(ow));

// ---- seeded randomness -----------------------------------------------------------------------
// mulberry32: tiny, fast, good enough for move choice. Same seed -> same game (tests, ?seed=).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Zobrist keys as two Int32 halves (no BigInt), fixed seed so hashes are stable across runs.
const ZLO = new Int32Array(3 * WW), ZHI = new Int32Array(3 * WW);
{
  const r = mulberry32(0x0B0C);
  for (let i = 0; i < 3 * WW; i++) { ZLO[i] = (r() * 4294967296) | 0; ZHI[i] = (r() * 4294967296) | 0; }
}
const SIDE_LO = 0x5bd1e995 | 0, SIDE_HI = 0x27d4eb2d | 0;   // xor'ed in when white is to move

// Exact-legality cache (rules.isForbidden results), direct-mapped on position hash + point.
const LC_BITS = 12, LC_SIZE = 1 << LC_BITS, LC_MASK = LC_SIZE - 1;

// ---- incremental board -----------------------------------------------------------------------

class Board {
  constructor(rules) {
    this.rules = rules;
    this.T = tableFor(rules.overlineWins);
    this.cells = new Uint8Array(WW);
    this.grid = new Int8Array(CELLS);           // rules.js mirror (y*15+x), for exact checks
    this.pat = new Uint8Array(3 * WW * 4);      // [(c*WW+i)*4+d]
    this.flags = new Uint8Array(3 * WW);        // [c*WW+i]
    this.pval = new Int32Array(3 * WW);         // [c*WW+i]
    this.tot = new Int32Array(3);               // sum of pval per colour
    this.cnt5 = new Int32Array(3);              // FL_FIVE points per colour
    this.cntOpen4 = new Int32Array(3);          // FL_WIN3 points per colour (not FL_MAYBE)
    this.cntFour = new Int32Array(3);           // FL_FOUR points per colour (not FL_MAYBE)
    this.nb = new Uint8Array(WW);               // stones in the surrounding 5×5 square
    this.hist = new Int16Array(CELLS + 1);
    this.n = 0;
    this.hlo = 0;
    this.hhi = 0;
    this.lcLo = new Int32Array(LC_SIZE);
    this.lcHi = new Int32Array(LC_SIZE);
    this.lcKey = new Int32Array(LC_SIZE).fill(-1);
    this.lcVal = new Uint8Array(LC_SIZE);

    this.cells.fill(WALL);
    for (let i = 0; i < CELLS; i++) this.cells[toPad(i)] = EMPTY;
    for (let i = FIRST; i <= LAST; i++) {
      if (this.cells[i] === EMPTY) { this._recalc(i, BLACK); this._recalc(i, WHITE); }
    }
    // Empty-board snapshot: clear() copies it back instead of recomputing.
    this.empty = {
      pat: this.pat.slice(), flags: this.flags.slice(), pval: this.pval.slice(),
      tot: this.tot.slice(), cnt5: this.cnt5.slice(), cntOpen4: this.cntOpen4.slice(), cntFour: this.cntFour.slice(),
    };
  }

  clear() {
    const e = this.empty;
    for (let k = 0; k < this.n; k++) this.cells[this.hist[k]] = EMPTY;
    this.pat.set(e.pat); this.flags.set(e.flags); this.pval.set(e.pval);
    this.tot.set(e.tot); this.cnt5.set(e.cnt5); this.cntOpen4.set(e.cntOpen4); this.cntFour.set(e.cntFour);
    this.nb.fill(0);
    this.grid.fill(EMPTY);
    this.n = 0;
    this.hlo = 0;
    this.hhi = 0;
  }

  // Window key of point i along step s, as colour c sees it.
  _key(i, s, c) {
    const cl = this.cells;
    let k = 0, v;
    v = cl[i - 5 * s]; k += v === EMPTY ? 0 : v === c ? 1 : 2;
    v = cl[i - 4 * s]; k += v === EMPTY ? 0 : v === c ? 3 : 6;
    v = cl[i - 3 * s]; k += v === EMPTY ? 0 : v === c ? 9 : 18;
    v = cl[i - 2 * s]; k += v === EMPTY ? 0 : v === c ? 27 : 54;
    v = cl[i - s]; k += v === EMPTY ? 0 : v === c ? 81 : 162;
    v = cl[i + s]; k += v === EMPTY ? 0 : v === c ? 243 : 486;
    v = cl[i + 2 * s]; k += v === EMPTY ? 0 : v === c ? 729 : 1458;
    v = cl[i + 3 * s]; k += v === EMPTY ? 0 : v === c ? 2187 : 4374;
    v = cl[i + 4 * s]; k += v === EMPTY ? 0 : v === c ? 6561 : 13122;
    v = cl[i + 5 * s]; k += v === EMPTY ? 0 : v === c ? 19683 : 39366;
    return k;
  }

  // Counters follow the flags. A FL_MAYBE point is "probably forbidden": it adds no value and
  // does not count as a threat (cnt5 is unaffected — a five is never forbidden).
  _count(c, f, sign) {
    if (f & FL_FIVE) this.cnt5[c] += sign;
    if (f & FL_MAYBE) return;
    if (f & FL_WIN3) this.cntOpen4[c] += sign;
    if (f & FL_FOUR) this.cntFour[c] += sign;
  }

  _unflag(ci, c) {
    this._count(c, this.flags[ci], -1);
    this.tot[c] -= this.pval[ci];
    this.flags[ci] = 0;
    this.pval[ci] = 0;
  }

  // Flags and value of point ci from its 4 pattern levels.
  _setFlags(ci, c) {
    const pb = ci * 4, pat = this.pat;
    let fours = 0, threes = 0, five = false, open4 = false, v = 0;
    for (let d = 0; d < 4; d++) {
      const l = pat[pb + d];
      v += VAL[l];
      if (l === F5) five = true;
      else if (l === F4) { open4 = true; fours++; }
      else if (l === B4) fours++;
      else if (l === F3) threes++;
    }
    let f = 0;
    if (five) f = FL_FIVE;                       // five beats everything, 3-3 included
    else {
      if (fours) f |= FL_FOUR;
      if (open4 || fours >= 2) f |= FL_WIN3;
      if (threes) f |= FL_THREE;
      if (threes >= 2) { f |= FL_MAYBE; v = 0; }
      else if (open4 || fours >= 2) v += VAL_WIN3;
      else if (fours && threes) v += VAL_43;
    }
    this.flags[ci] = f;
    this.pval[ci] = v;
    this.tot[c] += v;
    this._count(c, f, 1);
  }

  _recalc(i, c) {
    const ci = c * WW + i, pb = ci * 4;
    this._unflag(ci, c);
    for (let d = 0; d < 4; d++) this.pat[pb + d] = this.T[this._key(i, DIR[d], c)];
    this._setFlags(ci, c);
  }

  _recalcDir(i, d, c) {
    const ci = c * WW + i;
    this._unflag(ci, c);
    this.pat[ci * 4 + d] = this.T[this._key(i, DIR[d], c)];
    this._setFlags(ci, c);
  }

  // A stone at i changes the window of every empty point within 5 along each line through i.
  _touch(i) {
    const cl = this.cells;
    for (let d = 0; d < 4; d++) {
      const s = DIR[d];
      for (let k = 1; k <= 5; k++) {
        let j = i + k * s;
        if (cl[j] === EMPTY) { this._recalcDir(j, d, BLACK); this._recalcDir(j, d, WHITE); }
        j = i - k * s;
        if (cl[j] === EMPTY) { this._recalcDir(j, d, BLACK); this._recalcDir(j, d, WHITE); }
      }
    }
  }

  put(i, c) {
    this._unflag(BLACK * WW + i, BLACK);
    this._unflag(WHITE * WW + i, WHITE);
    this.cells[i] = c;
    this.grid[PUB[i]] = c;
    this.hist[this.n++] = i;
    this.hlo ^= ZLO[c * WW + i];
    this.hhi ^= ZHI[c * WW + i];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.nb[i + dy * W + dx]++;
    this._touch(i);
  }

  undo() {
    const i = this.hist[--this.n], c = this.cells[i];
    this.cells[i] = EMPTY;
    this.grid[PUB[i]] = EMPTY;
    this.hlo ^= ZLO[c * WW + i];
    this.hhi ^= ZHI[c * WW + i];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.nb[i + dy * W + dx]--;
    this._recalc(i, BLACK);
    this._recalc(i, WHITE);
    this._touch(i);
  }

  // Exact: is empty point i forbidden for c by rules.js? Only called for FL_MAYBE points.
  forbidden(i, c) {
    const key = i * 4 + c;
    const slot = (this.hlo ^ Math.imul(key, 0x9E3779B1)) & LC_MASK;
    if (this.lcKey[slot] === key && this.lcLo[slot] === this.hlo && this.lcHi[slot] === this.hhi) return this.lcVal[slot] === 1;
    const p = PUB[i];
    const f = isForbidden(this.grid, p % N, (p / N) | 0, c, this.rules);
    this.lcKey[slot] = key; this.lcLo[slot] = this.hlo; this.lcHi[slot] = this.hhi; this.lcVal[slot] = f ? 1 : 0;
    return f;
  }

  // The legality the game uses: empty and not forbidden (same answer as !rules.isForbidden).
  legal(i, c) {
    if (this.cells[i] !== EMPTY) return false;
    if ((this.flags[c * WW + i] & FL_MAYBE) === 0) return true;
    return !this.forbidden(i, c);
  }

  // First point where c makes five, or -1.
  findFive(c) {
    const f = this.flags, b = c * WW, cl = this.cells;
    for (let i = FIRST; i <= LAST; i++) if (cl[i] === EMPTY && (f[b + i] & FL_FIVE)) return i;
    return -1;
  }

  // Second five point for c (after `first`), or -1.
  nextFive(c, first) {
    const f = this.flags, b = c * WW, cl = this.cells;
    for (let i = first + 1; i <= LAST; i++) if (cl[i] === EMPTY && (f[b + i] & FL_FIVE)) return i;
    return -1;
  }
}

// ---- search ----------------------------------------------------------------------------------

const WIN = 1000000, INF = 2000000, MATE_BOUND = WIN - 1000;
const MAXPLY = 64, MAXMV = CELLS;
const TT_BITS = 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;    // ≈ 4 MB in total
const EXACT = 1, LOWER = 2, UPPER = 3;
const VCF_BITS = 16, VCF_SIZE = 1 << VCF_BITS, VCF_MASK = VCF_SIZE - 1;
const TIME_MASK = 255;                     // check the clock every 256 nodes

// Difficulty. Measured with tools/selfplay.mjs (paired openings, colours swapped, Node 22 on a
// loaded 4-core box): hard beats normal 53–11 over 64 games, normal beats easy 24–0, hard beats
// easy 12–0; easy blocks a four ~90% and an open three ~50% of the time (tests/ai.test.js #18).
//   timeMs: budget; maxDepth: iterative-deepening cap; rootK/k1/k2/k3: candidate limits at the
//   root, ply < 2, ply < 4 and deeper (defending nodes are never cut); vcf / oppVcf: depth of our
//   own continuous-four search and of the check against the opponent's; seeFour / seeThree:
//   chance to answer a four / an open three (easy "misses" the rest); temp / topN: softmax over
//   the best root moves (0 = always the best); wideOpening: first stone anywhere in the central
//   3×3 instead of the centre point.
export const LEVELS = Object.freeze({
  easy: Object.freeze({ timeMs: 60, maxDepth: 2, rootK: 10, k1: 8, k2: 6, k3: 4, vcf: 0, oppVcf: 0, seeFour: 0.9, seeThree: 0.5, temp: 220, topN: 6, wideOpening: true }),
  normal: Object.freeze({ timeMs: 450, maxDepth: 6, rootK: 16, k1: 12, k2: 10, k3: 7, vcf: 8, oppVcf: 6, seeFour: 1, seeThree: 1, temp: 40, topN: 3, wideOpening: false }),
  hard: Object.freeze({ timeMs: 1300, maxDepth: 16, rootK: 24, k1: 16, k2: 12, k3: 8, vcf: 16, oppVcf: 12, seeFour: 1, seeThree: 1, temp: 0, topN: 1, wideOpening: false }),
});
const MIN_TIME_MS = 10, MAX_TIME_MS = 10000;

class Searcher {
  constructor(board) {
    this.b = board;
    this.ttLo = new Int32Array(TT_SIZE);
    this.ttHi = new Int32Array(TT_SIZE);
    this.ttScore = new Int32Array(TT_SIZE);
    this.ttDepth = new Int8Array(TT_SIZE);
    this.ttFlag = new Uint8Array(TT_SIZE);
    this.ttMove = new Int16Array(TT_SIZE).fill(-1);
    this.mv = new Int16Array(MAXPLY * MAXMV);
    this.sc = new Int32Array(MAXPLY * MAXMV);
    this.vcfLo = new Int32Array(VCF_SIZE);
    this.vcfHi = new Int32Array(VCF_SIZE);
    this.vcfD = new Int8Array(VCF_SIZE);
    this.vcfMove = -1;
    this.nodes = 0;
    this.deadline = 0;
    this.stop = false;
    this.cfg = LEVELS.hard;
  }

  clearTT() {
    this.ttLo.fill(0); this.ttHi.fill(0); this.ttScore.fill(0);
    this.ttDepth.fill(0); this.ttFlag.fill(0); this.ttMove.fill(-1);
  }

  timeUp() {
    if ((++this.nodes & TIME_MASK) === 0 && now() > this.deadline) this.stop = true;
    return this.stop;
  }

  hashLo(c) { return c === WHITE ? this.b.hlo ^ SIDE_LO : this.b.hlo; }
  hashHi(c) { return c === WHITE ? this.b.hhi ^ SIDE_HI : this.b.hhi; }

  // Candidate moves for c into mv[ply*MAXMV ..], best first. Returns the count.
  //   Opponent has a four: the single block (0 if the block is forbidden for us = lost).
  //   Opponent threatens an open four / 4-4: every point that answers it, never cut to top-K.
  //   Otherwise: legal points near stones, scored by own value ×2 + opponent value, top `limit`.
  gen(c, ply, limit) {
    const b = this.b, o = 3 - c, base = ply * MAXMV, cb = c * WW, ob = o * WW;
    const cells = b.cells, flags = b.flags, pval = b.pval, nb = b.nb, mv = this.mv, sc = this.sc;
    if (b.cnt5[o] > 0) {
      const i = b.findFive(o);
      if (b.legal(i, c)) { mv[base] = i; sc[base] = 0; return 1; }
      return 0;
    }
    const defend = b.cntOpen4[o] > 0;
    const cap = defend ? MAXMV : limit;
    let n = 0;
    for (let i = FIRST; i <= LAST; i++) {
      if (cells[i] !== EMPTY || nb[i] === 0) continue;
      const fc = flags[cb + i];
      if ((fc & FL_MAYBE) && b.forbidden(i, c)) continue;
      if (defend && !(fc & FL_FOUR) && !(flags[ob + i] & (FL_FOUR | FL_WIN3))) continue;
      const s = pval[cb + i] * 2 + pval[ob + i];
      // bounded insertion: keep the best `cap` in order
      if (n === cap && sc[base + n - 1] >= s) continue;
      let k = n < cap ? n++ : n - 1;
      while (k > 0 && sc[base + k - 1] < s) { mv[base + k] = mv[base + k - 1]; sc[base + k] = sc[base + k - 1]; k--; }
      mv[base + k] = i; sc[base + k] = s;
    }
    return n;
  }

  // Static evaluation from the side to move (c).
  evaluate(c, ply) {
    const b = this.b, o = 3 - c;
    if (b.cnt5[c] > 0) return WIN - ply - 1;                                   // we complete five
    if (b.cnt5[o] > 1) return -(WIN - ply - 2);                                // two fives to stop
    if (b.cnt5[o] === 0 && b.cntOpen4[c] > 0 && b.cntFour[o] === 0) return WIN - ply - 3;
    return b.tot[c] - ((b.tot[o] * 9) >> 3) + 50;                              // + tempo
  }

  // VCF: can attacker `a` (to move) win by continuous fours within `depth` of its own moves?
  // Sets this.vcfMove to the first move on success. Honours the deadline (false = unknown).
  vcf(a, depth, ply) {
    const b = this.b, d = 3 - a, ab = a * WW;
    if (b.cnt5[a] > 0) { this.vcfMove = b.findFive(a); return true; }
    if (depth <= 0 || ply >= MAXPLY - 1 || this.timeUp()) return false;
    const lo = this.hashLo(a), hi = this.hashHi(a), h = (lo ^ (hi >>> 16)) & VCF_MASK;
    if (this.vcfLo[h] === lo && this.vcfHi[h] === hi && this.vcfD[h] >= depth) return false;
    let forced = -1;
    if (b.cnt5[d] > 0) {                     // the defender has a four: block it with a four, or fail
      if (b.cnt5[d] > 1) return false;
      forced = b.findFive(d);
    }
    const base = ply * MAXMV, mv = this.mv, sc = this.sc, flags = b.flags;
    let n = 0;
    for (let i = FIRST; i <= LAST; i++) {
      if (b.cells[i] !== EMPTY) continue;
      const f = flags[ab + i];
      if (!(f & FL_FOUR) || (forced >= 0 && i !== forced)) continue;
      if ((f & FL_MAYBE) && b.forbidden(i, a)) continue;
      const s = (f & FL_WIN3) ? 2 : (f & FL_THREE) ? 1 : 0;
      let k = n++;
      while (k > 0 && sc[base + k - 1] < s) { mv[base + k] = mv[base + k - 1]; sc[base + k] = sc[base + k - 1]; k--; }
      mv[base + k] = i; sc[base + k] = s;
    }
    for (let k = 0; k < n; k++) {
      const m = mv[base + k];
      b.put(m, a);
      let win = false;
      if (b.cnt5[a] >= 2) win = true;                       // open four / double four
      else if (b.cnt5[d] === 0) {                           // the defender cannot win first
        const r = b.findFive(a);
        if (!b.legal(r, d)) win = true;                     // the only block is 3-3 for them
        else { b.put(r, d); win = this.vcf(a, depth - 1, ply + 1); b.undo(); }
      }
      b.undo();
      if (win) { this.vcfMove = m; return true; }
      if (this.stop) return false;                          // never record a timed-out failure
    }
    this.vcfLo[h] = lo; this.vcfHi[h] = hi; this.vcfD[h] = depth;
    return false;
  }

  // Fresh VCF probe with its own time slice (never past the overall deadline).
  // Returns true only for a proven win; false = no VCF found or ran out of time.
  // `shortest` deepens 1, 2, … so the first win found is the quickest: the CPU finishes
  // without detours (failed entries carry over, since they are keyed by remaining depth).
  vcfFresh(a, depth, ms, shortest = false) {
    const t = now();
    const saveDeadline = this.deadline, saveStop = this.stop;
    const until = Math.min(saveDeadline, t + ms);
    if (until <= t) return false;
    this.vcfD.fill(0);
    this.deadline = until;
    this.stop = false;
    let r = false;
    for (let d = shortest ? 1 : depth; d <= depth && !r && !this.stop; d++) r = this.vcf(a, d, 0);
    const timedOut = this.stop;
    this.deadline = saveDeadline;
    this.stop = saveStop;
    return timedOut ? false : r;
  }

  // Negamax alpha-beta (fail-soft) with a transposition table; mate scores are stored
  // relative to the node so they stay correct at any ply.
  ab(c, depth, ply, alpha, beta) {
    const b = this.b, o = 3 - c, cfg = this.cfg;
    if (b.cnt5[c] > 0) return WIN - ply - 1;
    if (this.timeUp()) return 0;                            // discarded by the caller
    if (depth <= 0 || ply >= MAXPLY - 2) return this.evaluate(c, ply);
    const lo = this.hashLo(c), hi = this.hashHi(c), slot = lo & TT_MASK;
    let ttMove = -1;
    if (this.ttLo[slot] === lo && this.ttHi[slot] === hi) {
      ttMove = this.ttMove[slot];
      if (this.ttDepth[slot] >= depth) {
        let s = this.ttScore[slot];
        const f = this.ttFlag[slot];
        if (s > MATE_BOUND) s -= ply; else if (s < -MATE_BOUND) s += ply;
        if (f === EXACT || (f === LOWER && s >= beta) || (f === UPPER && s <= alpha)) return s;
      }
    }
    const limit = ply < 2 ? cfg.k1 : ply < 4 ? cfg.k2 : cfg.k3;
    const n = this.gen(c, ply, limit);
    if (n === 0) {
      if (b.cnt5[o] > 0) return -(WIN - ply - 2);            // their four, our block is forbidden
      if (b.cntOpen4[o] > 0) return -(WIN - ply - 4);        // nothing stops their open four
      return 0;                                              // no move near the stones: call it even
    }
    const base = ply * MAXMV, mv = this.mv;
    if (ttMove >= 0) {
      for (let k = 1; k < n; k++) if (mv[base + k] === ttMove) { mv[base + k] = mv[base]; mv[base] = ttMove; break; }
    }
    const a0 = alpha;
    let best = -INF, bestMove = mv[base];
    for (let k = 0; k < n; k++) {
      const m = mv[base + k];
      b.put(m, c);
      const ext = (b.cnt5[c] > 0 && depth <= 2) ? 1 : 0;   // we made a four: the reply is forced
      const s = -this.ab(o, depth - 1 + ext, ply + 1, -beta, -alpha);
      b.undo();
      if (this.stop) return best > -INF ? best : 0;
      if (s > best) { best = s; bestMove = m; }
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    let st = best;
    if (st > MATE_BOUND) st += ply; else if (st < -MATE_BOUND) st -= ply;
    this.ttLo[slot] = lo; this.ttHi[slot] = hi; this.ttScore[slot] = st;
    this.ttDepth[slot] = depth; this.ttMove[slot] = bestMove;
    this.ttFlag[slot] = best <= a0 ? UPPER : best >= beta ? LOWER : EXACT;
    return best;
  }

  // Static score of playing m (for answers that skip the search).
  scoreAfter(m, c) {
    const b = this.b;
    b.put(m, c);
    const s = -this.evaluate(3 - c, 1);
    b.undo();
    return s;
  }

  // Best legal point by a quick heuristic, preferring points near stones. `own` scores only
  // c's own potential (easy's "didn't see it" move); otherwise attack + defence.
  bestLegal(c, skip = -1, own = false) {
    const b = this.b, cb = c * WW, ob = (3 - c) * WW;
    let best = -1, bs = -1;
    for (let i = FIRST; i <= LAST; i++) {
      if (i === skip || !b.legal(i, c)) continue;
      // near stones: by value; far away (nearly empty board): closest to the centre
      const s = b.nb[i] > 0
        ? (1 << 28) + (own ? b.pval[cb + i] : b.pval[cb + i] * 2 + b.pval[ob + i])
        : 100 - distance(i, CENTER);
      if (s > bs) { bs = s; best = i; }
    }
    return best;
  }

  // Root: returns { move (padded or -1), reason, score, depth }.
  root(c, rng, timeMs, t0) {
    const b = this.b, o = 3 - c, cfg = this.cfg;
    const done = (move, reason, score = 0, depth = 0) => ({ move, reason, score, depth });

    // 0. no legal point at all: the round is a draw (the game layer decides that too)
    if (this.bestLegal(c) < 0) return done(-1, 'draw');

    // 1. opening moves (search from move 3 on)
    if (b.n === 0) {
      const m = cfg.wideOpening ? toPad((6 + ((rng() * 3) | 0)) * N + 6 + ((rng() * 3) | 0)) : CENTER;
      return done(m, 'book');
    }
    if (b.n === 1) {
      const f = b.hist[0], cand = [];
      for (const d of [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1]) if (b.legal(f + d, c)) cand.push(f + d);
      if (cand.length) return done(cand[(rng() * cand.length) | 0], 'book');
    }

    // 2. tactical shortcuts
    if (b.cnt5[c] > 0) return done(b.findFive(c), 'win', WIN - 1);
    if (b.cnt5[o] > 0) {
      const i = b.findFive(o), j = b.nextFive(o, i);
      const blockI = b.legal(i, c), blockJ = j >= 0 && b.legal(j, c);
      if (j >= 0) {                                          // two fives (open four): lost
        const m = blockI ? i : blockJ ? j : this.bestLegal(c);
        return done(m, 'lost', -(WIN - 2));
      }
      if (!blockI) return done(this.bestLegal(c), 'lost', -(WIN - 2));   // the block is 3-3 for us
      if (rng() < cfg.seeFour) return done(i, 'block', this.scoreAfter(i, c));
      const q = this.bestLegal(c, i, true);                  // easy only: "didn't see it"
      return q >= 0 ? done(q, 'blunder', this.scoreAfter(q, c)) : done(i, 'block', this.scoreAfter(i, c));
    }
    if (cfg.vcf && this.vcfFresh(c, cfg.vcf, timeMs * 0.2, true)) return done(this.vcfMove, 'vcf', WIN - 3);

    // 3. root candidates
    let n = this.gen(c, 0, cfg.rootK);
    if (n === 0) {
      const q = this.bestLegal(c);
      return done(q, b.cnt5[o] > 0 || b.cntOpen4[o] > 0 ? 'lost' : 'forced', this.scoreAfter(q, c));
    }
    let moves = Array.from(this.mv.subarray(0, n));
    if (cfg.seeThree < 1 && b.cntOpen4[o] > 0 && rng() > cfg.seeThree) {   // easy misses the three
      const q = this.bestLegal(c, -1, true);
      if (q >= 0) return done(q, 'blunder', this.scoreAfter(q, c));
    }
    // 4. the opponent has a VCF: keep only moves after which it fails (if any do). The refutation
    //    may lie outside the top-K (a block on their four line, or a four of ours that gains
    //    tempo), so those points join the candidates first, after the ordered ones.
    if (cfg.oppVcf && this.vcfFresh(o, cfg.oppVcf, timeMs * 0.1)) {
      const seen = new Set(moves);
      for (let i = FIRST; i <= LAST; i++) {
        if (seen.has(i) || b.cells[i] !== EMPTY) continue;
        if (((b.flags[o * WW + i] & FL_FOUR) || (b.flags[c * WW + i] & FL_FOUR)) && b.legal(i, c)) moves.push(i);
      }
      const keep = [];
      const filterEnd = t0 + timeMs * 0.45;
      for (let k = 0; k < moves.length; k++) {
        const m = moves[k];
        if (now() > filterEnd) { keep.push(m); continue; }   // unchecked: keep it, search decides
        b.put(m, c);
        const still = this.vcfFresh(o, cfg.oppVcf, timeMs * 0.05);
        b.undo();
        if (!still) keep.push(m);
      }
      if (keep.length) moves = keep;                         // else lost anyway: search them all
    }
    if (moves.length === 1) return done(moves[0], 'forced', this.scoreAfter(moves[0], c));

    // 5. iterative deepening; the previous best is searched first at every depth
    let bestMove = moves[0], bestScore = -INF, depthDone = 0, rootScores = null;
    const window = cfg.temp ? cfg.temp * 3 : 0;              // keep near-best scores exact for softmax
    for (let depth = 1; depth <= this.maxDepth; depth++) {
      let alpha = -INF, curBest = -1, curScore = -INF;
      const scores = [];
      for (let k = 0; k < moves.length; k++) {
        const m = moves[k];
        b.put(m, c);
        const s = -this.ab(o, depth - 1, 1, -INF, -(alpha - window));
        b.undo();
        if (this.stop) break;
        scores.push(m, s);
        if (s > curScore) { curScore = s; curBest = m; }
        if (s > alpha) alpha = s;
      }
      if (this.stop) {
        // A cut-off iteration only counts if the previous best was re-searched and beaten.
        if (scores.length > 2 && curBest !== moves[0] && curScore > scores[1]) { bestMove = curBest; bestScore = curScore; }
        break;
      }
      bestMove = curBest; bestScore = curScore; depthDone = depth; rootScores = scores;
      moves = [curBest, ...moves.filter((m) => m !== curBest)];
      if (Math.abs(bestScore) > MATE_BOUND) break;
      if (now() - t0 > timeMs * 0.45) break;                 // the next depth would not finish
    }

    // 6. human-like choice among near-best moves (never one proven to lose)
    if (cfg.temp && rootScores && Math.abs(bestScore) < MATE_BOUND) {
      const pool = [];
      for (let k = 0; k < rootScores.length; k += 2) {
        const s = rootScores[k + 1];
        if (s > -MATE_BOUND && s >= bestScore - window) pool.push([rootScores[k], s]);
      }
      pool.sort((x, y) => y[1] - x[1]);
      pool.length = Math.min(pool.length, cfg.topN);
      let z = 0;
      const w = pool.map(([, s]) => (z += Math.exp((s - bestScore) / cfg.temp)));
      const r = rng() * z;
      const pick = pool[w.findIndex((x) => x >= r)] ?? pool[0];
      if (pick) return done(pick[0], pick[0] === bestMove ? 'search' : 'search~', pick[1], depthDone);
    }
    return done(bestMove, 'search', bestScore === -INF ? 0 : bestScore, depthDone);
  }
}

function distance(a, b) {
  return Math.max(Math.abs((a % W) - (b % W)), Math.abs(((a / W) | 0) - ((b / W) | 0)));
}

// ---- public API ------------------------------------------------------------------------------

function checkMoves(moves) {
  if (!Array.isArray(moves) || moves.length > CELLS) throw new TypeError('moves must be an array of ≤ 225 points');
  const seen = new Uint8Array(CELLS);
  for (let k = 0; k < moves.length; k++) {
    const i = moves[k];
    if (!Number.isInteger(i) || i < 0 || i >= CELLS || seen[i]) throw new TypeError(`bad move ${k}: ${i}`);
    seen[i] = 1;
  }
  return moves;
}

const clampNum = (x, lo, hi, dflt) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt);

// createEngine({ overlineWins }) → { think(req), reset() }
//   req = { moves:number[] (y*15+x, black first), level:'easy'|'normal'|'hard', seed?:uint32,
//           timeMs?:number, maxDepth?:number (tests/bench only) }
//   → { move (y*15+x, or -1), reason, score, depth, nodes, ms }
//   reason: 'book'|'win'|'block'|'vcf'|'forced'|'search'|'search~'|'blunder'|'lost'|'draw'
//   ('fallback' only if a contract check had to step in — never seen in testing).
//   score is from the CPU's side: > 0 good for it, ±~1e6 = forced win/loss found.
export function createEngine({ overlineWins = false } = {}) {
  const rules = Object.freeze({ ...DEFAULT_RULES, overlineWins: overlineWins === true });
  const board = new Board(rules);
  const s = new Searcher(board);
  let lastLevel = null;

  function think(req = {}) {
    const t0 = now();
    const level = Object.prototype.hasOwnProperty.call(LEVELS, req.level) ? req.level : 'normal';
    const cfg = LEVELS[level];
    const moves = checkMoves(req.moves);
    const timeMs = clampNum(req.timeMs, MIN_TIME_MS, MAX_TIME_MS, cfg.timeMs);
    const seed = Number.isFinite(req.seed) ? req.seed >>> 0 : (0x9E3779B9 ^ moves.length) >>> 0;
    const rng = mulberry32(seed);
    if (level !== lastLevel) { s.clearTT(); lastLevel = level; }   // TT scores depend on the level's limits

    board.clear();
    for (let k = 0; k < moves.length; k++) board.put(toPad(moves[k]), k % 2 === 0 ? BLACK : WHITE);
    const c = moves.length % 2 === 0 ? BLACK : WHITE;
    s.cfg = cfg;
    s.maxDepth = clampNum(req.maxDepth, 1, 30, cfg.maxDepth) | 0;
    s.nodes = 0;
    s.stop = false;
    s.deadline = t0 + timeMs;

    const r = s.root(c, rng, timeMs, t0);
    let move = r.move >= 0 ? PUB[r.move] : -1;
    let reason = r.reason;
    // Contract: a point rules.judgeMove accepts, or -1 only when there truly is none.
    if (move < 0 || !judgeMove(board.grid, move % N, (move / N) | 0, c, rules).ok) {
      move = -1;
      for (let i = 0; i < CELLS; i++) {
        if (board.grid[i] === EMPTY && judgeMove(board.grid, i % N, (i / N) | 0, c, rules).ok) { move = i; break; }
      }
      reason = move < 0 ? 'draw' : 'fallback';
    }
    return { move, reason, score: r.score | 0, depth: r.depth, nodes: s.nodes, ms: Math.round(now() - t0) };
  }

  function reset() {
    s.clearTT();
    lastLevel = null;
  }

  return { think, reset };
}

// Three fixed middle-game positions for the ?bench debug page: how deep does hard get here?
const BENCH = [
  { name: 'opening', moves: [112, 111, 98, 127, 95, 99, 84, 126, 96, 141] },
  { name: 'middle', moves: [112, 111, 98, 127, 95, 99, 84, 126, 96, 141, 94, 97, 113, 128, 70, 56, 125, 114] },
  { name: 'crowded', moves: [112, 111, 98, 127, 95, 99, 84, 126, 96, 141, 94, 97, 113, 128, 70, 56, 125, 114, 92, 93, 156, 159, 129, 86, 100, 143, 175, 71] },
];

// bench() → [{ name, move, reason, depth, nodes, ms, knps }] — hard level, fresh tables per position.
export function bench({ overlineWins = false, timeMs = LEVELS.hard.timeMs, level = 'hard' } = {}) {
  const eng = createEngine({ overlineWins });
  return BENCH.map(({ name, moves }) => {
    eng.reset();
    const r = eng.think({ moves, level, seed: 1, timeMs });
    return { name, move: r.move, reason: r.reason, depth: r.depth, nodes: r.nodes, ms: r.ms, knps: Math.round(r.nodes / Math.max(1, r.ms)) };
  });
}

// Building blocks for tests and tools (not part of the game API).
export const internals = Object.freeze({
  buildTable, tableFor, Board, Searcher, mulberry32, toPad, PUB, PAD, W, WW,
  NONE, B2, F2, B3, F3, B4, F4, F5, FL_FIVE, FL_FOUR, FL_THREE, FL_WIN3, FL_MAYBE, WIN, MATE_BOUND,
});
