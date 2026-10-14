// Prototype: shared rules + pattern table + incremental board (no DOM). ES module.
export const N = 15, PAD = 5, W = N + 2 * PAD, WW = W * W;
export const EMPTY = 0, BLACK = 1, WHITE = 2, WALL = 3;
export const DIRS = [1, W, W + 1, W - 1];
// per-direction pattern levels (what placing a stone HERE makes on that line)
export const NONE = 0, B2 = 1, F2 = 2, B3 = 3, F3 = 4, B4 = 5, F4 = 6, F5 = 7;
// point flags (per color)
export const FL_FIVE = 1, FL_OPEN4 = 2, FL_FOUR = 4, FL_THREE = 8, FL_FORBID = 16, FL_WIN3 = 32; // WIN3: open4 or 4-4
const POW3 = [1, 3, 9, 27, 81, 243, 729, 2187, 6561, 19683];
const KEYS = 59049;

export const idxOf = (x, y) => (y + PAD) * W + (x + PAD);
export const xyOf = (i) => [(i % W) - PAD, ((i / W) | 0) - PAD];

// window digit i: offsets -5..-1 -> 0..4, +1..+5 -> 5..9 ; digit 0 empty, 1 own, 2 blocked
export function buildTable(overlineWins = false) {
  const t = new Int8Array(KEYS).fill(-1);
  const d = (k, i) => ((k / POW3[i]) | 0) % 3;
  const isFive = (k) => {
    let run = 1;
    for (let i = 4; i >= 0 && d(k, i) === 1; i--) run++;
    for (let i = 5; i <= 9 && d(k, i) === 1; i++) run++;
    return overlineWins ? run >= 5 : run === 5;
  };
  const level = (k) => {
    if (t[k] >= 0) return t[k];
    let r = NONE;
    if (isFive(k)) r = F5;
    else {
      let wins = 0;
      for (let i = 0; i < 10; i++) if (d(k, i) === 0 && isFive(k + POW3[i])) wins++;
      if (wins >= 2) r = F4; else if (wins === 1) r = B4;
      else {
        for (let i = 0; i < 10; i++) {
          if (d(k, i) !== 0) continue;
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

// Zobrist: two 32-bit halves, seeded (no BigInt)
function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) | 0; }; }
const zr = mulberry32(0x0B0C);
export const ZLO = new Int32Array(3 * WW), ZHI = new Int32Array(3 * WW);
for (let i = 0; i < 3 * WW; i++) { ZLO[i] = zr(); ZHI[i] = zr(); }

// ordering/eval value per direction level (attacker's view), tune by self-play
export const VAL = new Int32Array([0, 2, 10, 12, 60, 80, 400, 10000]);

export class Board {
  constructor(table) {
    this.T = table;
    this.cells = new Uint8Array(WW).fill(WALL);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) this.cells[idxOf(x, y)] = EMPTY;
    this.pat = new Uint8Array(3 * WW * 4);    // [(c*WW+i)*4+d]
    this.flags = new Uint8Array(3 * WW);      // [c*WW+i]
    this.pval = new Int32Array(3 * WW);       // [c*WW+i]
    this.tot = new Int32Array(3);
    this.cnt5 = new Int32Array(3); this.cntOpen4 = new Int32Array(3); this.cntFour = new Int32Array(3);
    this.nb = new Uint8Array(WW);             // stones within 2 (5x5)
    this.hlo = 0; this.hhi = 0;
    this.hist = new Int16Array(N * N + 1); this.n = 0;
    for (let i = 0; i < WW; i++) if (this.cells[i] === EMPTY) { this._recalc(i, BLACK); this._recalc(i, WHITE); }
  }
  _key(i, s, c) {
    const cl = this.cells; let k = 0, v;
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
  _unflag(ci, c) { const f = this.flags[ci]; if (f & FL_FIVE) this.cnt5[c]--; if (f & FL_WIN3) this.cntOpen4[c]--; if (f & FL_FOUR) this.cntFour[c]--; this.tot[c] -= this.pval[ci]; this.flags[ci] = 0; this.pval[ci] = 0; }
  // recompute all 4 dirs of empty point i for color c
  _recalc(i, c) {
    const ci = c * WW + i, pb = ci * 4;
    this._unflag(ci, c);
    let fours = 0, threes = 0, five = false, open4 = false, v = 0;
    for (let d = 0; d < 4; d++) {
      const l = this.T[this._key(i, DIRS[d], c)];
      this.pat[pb + d] = l; v += VAL[l];
      if (l === F5) five = true; else if (l === F4) { open4 = true; fours++; } else if (l === B4) fours++; else if (l === F3) threes++;
    }
    this._setFlags(ci, c, five, open4, fours, threes, v);
  }
  // update a single direction d of point i for color c (cheaper incremental path)
  _recalcDir(i, d, c) {
    const ci = c * WW + i, pb = ci * 4;
    this.pat[pb + d] = this.T[this._key(i, DIRS[d], c)];
    this._unflag(ci, c);
    let fours = 0, threes = 0, five = false, open4 = false, v = 0;
    for (let e = 0; e < 4; e++) {
      const l = this.pat[pb + e]; v += VAL[l];
      if (l === F5) five = true; else if (l === F4) { open4 = true; fours++; } else if (l === B4) fours++; else if (l === F3) threes++;
    }
    this._setFlags(ci, c, five, open4, fours, threes, v);
  }
  _setFlags(ci, c, five, open4, fours, threes, v) {
    let f = 0;
    if (five) f = FL_FIVE;
    else if (threes >= 2) { f = FL_FORBID; v = 0; }              // 3-3 forbidden for BOTH colors (5 overrides)
    else {
      if (fours) f |= FL_FOUR;
      if (open4 || fours >= 2) { f |= FL_WIN3; v += 3000; }
      else if (fours && threes) v += 1500;                      // 4-3
      if (threes) f |= FL_THREE;
    }
    this.flags[ci] = f; this.pval[ci] = v; this.tot[c] += v;
    if (f & FL_FIVE) this.cnt5[c]++; if (f & FL_WIN3) this.cntOpen4[c]++; if (f & FL_FOUR) this.cntFour[c]++;
  }
  legal(i, c) { return this.cells[i] === EMPTY && !(this.flags[c * WW + i] & FL_FORBID); }
  isWinMove(i, c) { return (this.flags[c * WW + i] & FL_FIVE) !== 0; }
  _touch(i) {
    const cl = this.cells;
    for (let d = 0; d < 4; d++) {
      const s = DIRS[d];
      for (let k = -5; k <= 5; k++) {
        if (k === 0) continue;
        const j = i + k * s;
        if (cl[j] === EMPTY) { this._recalcDir(j, d, BLACK); this._recalcDir(j, d, WHITE); }
      }
    }
  }
  put(i, c) {
    this._unflag(BLACK * WW + i, BLACK); this._unflag(WHITE * WW + i, WHITE);
    this.cells[i] = c; this.hist[this.n++] = i;
    this.hlo ^= ZLO[c * WW + i]; this.hhi ^= ZHI[c * WW + i];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.nb[i + dy * W + dx]++;
    this._touch(i);
  }
  undo() {
    const i = this.hist[--this.n], c = this.cells[i];
    this.cells[i] = EMPTY;
    this.hlo ^= ZLO[c * WW + i]; this.hhi ^= ZHI[c * WW + i];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.nb[i + dy * W + dx]--;
    this._recalc(i, BLACK); this._recalc(i, WHITE);
    this._touch(i);
  }
  // after the move at i by c: did c make five?
  findFlag(c, flag) { const b = c * WW; for (let i = 0; i < WW; i++) if (this.cells[i] === EMPTY && (this.flags[b + i] & flag)) return i; return -1; }
}

export function fromAscii(table, rows) { // rows: 'X' black, 'O' white, '.' empty ; returns board
  const b = new Board(table);
  rows.forEach((r, y) => [...r.replace(/\s/g, '')].forEach((ch, x) => { if (ch === 'X') b.put(idxOf(x, y), BLACK); else if (ch === 'O') b.put(idxOf(x, y), WHITE); }));
  return b;
}
