// Cross-check js/rules.js against an independent brute-force definition on random boards.
import { N, EMPTY, BLACK, WHITE, DIRS, DEFAULT_RULES, isForbidden, analyzeMove } from '../js/rules.js';

const inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;

function line(x, y, dx, dy) {          // whole board line through (x,y): [{x,y}], index of (x,y)
  let i = x, j = y;
  while (inb(i - dx, j - dy)) { i -= dx; j -= dy; }
  const cells = [];
  let k = -1;
  while (inb(i, j)) { if (i === x && j === y) k = cells.length; cells.push(j * N + i); i += dx; j += dy; }
  return { cells, k };
}
function runAt(b, cells, idx, c) {      // [lo, hi] of contiguous c-run containing idx (idx assumed c)
  let lo = idx, hi = idx;
  while (lo - 1 >= 0 && b[cells[lo - 1]] === c) lo--;
  while (hi + 1 < cells.length && b[cells[hi + 1]] === c) hi++;
  return [lo, hi];
}
const winLen = (n, ow) => (ow ? n >= 5 : n === 5);

function bfForbidden(b, p, c, rules, depth) {
  const t33 = rules.doubleThree === 'both' || (rules.doubleThree === 'black' && c === BLACK);
  const t44 = rules.doubleFour === 'both' || (rules.doubleFour === 'black' && c === BLACK);
  if (!t33 && !t44) return false;
  const x = p % N, y = (p / N) | 0;
  b[p] = c;
  // five?
  for (const [dx, dy] of DIRS) {
    const { cells, k } = line(x, y, dx, dy);
    const [lo, hi] = runAt(b, cells, k, c);
    if (winLen(hi - lo + 1, rules.overlineWins)) { b[p] = EMPTY; return false; }
  }
  let threes = 0, fours = 0;
  for (const [dx, dy] of DIRS) {
    const { cells, k } = line(x, y, dx, dy);
    // fours: distinct empty points e on the line whose five contains p
    let winPts = [];
    for (let e = 0; e < cells.length; e++) {
      if (b[cells[e]] !== EMPTY) continue;
      b[cells[e]] = c;
      const [lo, hi] = runAt(b, cells, e, c);
      if (winLen(hi - lo + 1, rules.overlineWins) && lo <= k && k <= hi) winPts.push(e);
      b[cells[e]] = EMPTY;
    }
    if (winPts.length) {
      // a straight four (both wins at the ends of one 4-run containing p) is ONE four
      const [lo, hi] = runAt(b, cells, k, c);
      const straight = winPts.length === 2 && hi - lo + 1 === 4 && winPts[0] === lo - 1 && winPts[1] === hi + 1;
      fours += straight ? 1 : winPts.length;
      continue;
    }
    // three: some empty q makes a straight four containing p and q, and q is not forbidden
    let isThree = false;
    for (let q = 0; q < cells.length && !isThree; q++) {
      if (b[cells[q]] !== EMPTY) continue;
      b[cells[q]] = c;
      const [lo, hi] = runAt(b, cells, q, c);
      let ok = hi - lo + 1 === 4 && lo <= k && k <= hi;
      if (ok) {
        for (const e of [lo - 1, hi + 1]) {
          if (e < 0 || e >= cells.length || b[cells[e]] !== EMPTY) { ok = false; break; }
          b[cells[e]] = c;
          const [l2, h2] = runAt(b, cells, e, c);
          b[cells[e]] = EMPTY;
          if (!winLen(h2 - l2 + 1, rules.overlineWins)) { ok = false; break; }
        }
      }
      b[cells[q]] = EMPTY;
      if (ok && rules.fakeThreeCheck && depth < rules.maxDepth && bfForbidden(b, cells[q], c, rules, depth + 1)) ok = false;
      if (ok) isThree = true;
    }
    if (isThree) threes++;
  }
  b[p] = EMPTY;
  return (t33 && threes >= 2) || (t44 && fours >= 2);
}

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const variants = [
  { name: 'default', rules: DEFAULT_RULES },
  { name: 'overlineWins', rules: { ...DEFAULT_RULES, overlineWins: true } },
  { name: 'noFake', rules: { ...DEFAULT_RULES, fakeThreeCheck: false } },
  { name: '44both', rules: { ...DEFAULT_RULES, doubleFour: 'both' } },
  { name: 'renjuish', rules: { ...DEFAULT_RULES, doubleThree: 'black', doubleFour: 'black' } },
];
const r = rng(12345);
let checks = 0, forb = 0, mism = 0;
const BOARDS = +process.argv[2] || 400;
for (let t = 0; t < BOARDS; t++) {
  const b = new Int8Array(N * N);
  const density = 0.08 + r() * 0.35;
  // clustered random stones (more realistic than uniform): random walk around the centre
  for (let i = 0; i < N * N; i++) {
    const x = i % N, y = (i / N) | 0;
    const dist = Math.hypot(x - 7, y - 7);
    if (r() < density * (dist < 5 ? 1.6 : 0.5)) b[i] = r() < 0.55 ? BLACK : WHITE;
  }
  for (const v of variants) {
    for (let p = 0; p < N * N; p++) {
      if (b[p] !== EMPTY) continue;
      for (const c of [BLACK, WHITE]) {
        const a = isForbidden(b, p % N, (p / N) | 0, c, v.rules);
        const e = bfForbidden(b, p, c, v.rules, 0);
        checks++; if (e) forb++;
        if (a !== e) {
          mism++;
          if (mism <= 5) {
            console.log('MISMATCH', v.name, 'colour', c, 'at', p % N, (p / N) | 0, 'fast', a, 'bf', e);
            let s = ''; for (let y = 0; y < N; y++) { for (let x = 0; x < N; x++) s += (y * N + x === p) ? '*' : '.XO'[b[y * N + x]]; s += '\n'; } console.log(s);
          }
        }
      }
    }
  }
}
console.log({ boards: BOARDS, checks, forbiddenFound: forb, mismatches: mism });

// Timing: all empty points, both colours, on mid-game-like boards.
const t0 = performance.now();
let n = 0;
for (let t = 0; t < 200; t++) {
  const b = new Int8Array(N * N);
  for (let i = 0; i < 60; i++) { const p = (r() * 9 + 3 | 0) * N + (r() * 9 + 3 | 0); b[p] = i % 2 ? WHITE : BLACK; }
  for (let p = 0; p < N * N; p++) if (!b[p]) { isForbidden(b, p % N, (p / N) | 0, BLACK); isForbidden(b, p % N, (p / N) | 0, WHITE); n += 2; }
}
const dt = performance.now() - t0;
console.log(`timing: ${n} isForbidden calls in ${dt.toFixed(1)} ms = ${(dt * 1000 / n).toFixed(2)} µs/call`);
