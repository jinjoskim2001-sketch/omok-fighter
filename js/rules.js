// rules.js — 오목 파이터 rule engine. Pure functions, no DOM.
// Board: Int8Array(N*N), index = y*N + x, 0 empty / 1 black / 2 white.
//
// Definitions (RIF renju wording, generalised to either colour):
//   five         : a contiguous run of exactly 5 (or >=5 when overlineWins) through the move.
//   four         : a line where ONE more stone makes a five.
//   straight four: an unbroken run of exactly 4 whose BOTH end points make a five (열린 4).
//   three        : a line where ONE more stone (at q) makes a straight four that contains the
//                  move. With fakeThreeCheck, q itself must not be a forbidden point (거짓 삼).
//   double three : a move (not making a five) that creates >= 2 threes in different lines.
// Each of the 4 lines through the move is classified once: five > four > three, so a line
// is never counted as both a four and a three, and two threes on one line count once.
//
// Functions temporarily write stones into the board they are given and always restore
// them before returning. Pass a copy if another piece of code reads the same array
// concurrently (e.g. a Worker sharing memory) — normal single-thread use is fine.

export const N = 15;
export const EMPTY = 0, BLACK = 1, WHITE = 2;
export const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export const DEFAULT_RULES = Object.freeze({
  overlineWins: false,   // 장목(6목 이상) 승리 인정? 국룰(일반룰) = false: 놓을 수는 있지만 승리 아님
  doubleThree: 'both',   // 'both' | 'black' | 'off'  — 3-3 금지 대상
  doubleFour: 'off',     // 'off' | 'black' | 'both'  — 4-4 금지 대상 (국룰 = 허용)
  fakeThreeCheck: true,  // 렌주식 거짓 금수(가짜 3) 재귀 판정
  maxDepth: 3,           // 재귀 깊이 제한 (깊이 초과 시 "진짜 3"으로 간주 = 보수적으로 금지)
});

const inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
const applies = (who, c) => who === 'both' || (who === 'black' && c === BLACK);

// Length of the contiguous run of colour c through (x,y) along (dx,dy), counting (x,y) as c
// whatever is actually stored there.
function runLen(b, x, y, dx, dy, c) {
  let n = 1, i = x + dx, j = y + dy;
  while (inb(i, j) && b[j * N + i] === c) { n++; i += dx; j += dy; }
  i = x - dx; j = y - dy;
  while (inb(i, j) && b[j * N + i] === c) { n++; i -= dx; j -= dy; }
  return n;
}
const isWinLen = (n, overlineWins) => (overlineWins ? n >= 5 : n === 5);
const fiveInDir = (b, x, y, c, dx, dy, ow) => isWinLen(runLen(b, x, y, dx, dy, c), ow);

// Placing c at (x,y) wins? (x,y) is treated as c; call it on an empty point before placing,
// or on the just-placed stone after placing — both work.
export function isFive(b, x, y, c, overlineWins = false) {
  for (const [dx, dy] of DIRS) if (fiveInDir(b, x, y, c, dx, dy, overlineWins)) return true;
  return false;
}

// Cells of the winning run through (x,y) (for highlight/animation), or null.
export function winningLine(b, x, y, c, overlineWins = false) {
  for (const [dx, dy] of DIRS) {
    if (!fiveInDir(b, x, y, c, dx, dy, overlineWins)) continue;
    let i = x, j = y;
    while (inb(i - dx, j - dy) && b[(j - dy) * N + (i - dx)] === c) { i -= dx; j -= dy; }
    const cells = [];
    do { cells.push([i, j]); i += dx; j += dy; } while (inb(i, j) && (b[j * N + i] === c || (i === x && j === y)));
    return cells;
  }
  return null;
}

// First empty cell reached from (x,y) walking in (sx,sy) through stones of colour c.
// Returns its index, or -1 if the walk hits the edge or an opponent stone first.
function nextEmpty(b, x, y, sx, sy, c) {
  let i = x + sx, j = y + sy;
  while (inb(i, j)) {
    const v = b[j * N + i];
    if (v === c) { i += sx; j += sy; continue; }
    return v === EMPTY ? j * N + i : -1;
  }
  return -1;
}

// With c already on (x,y): how many fours does this line hold through (x,y)?
// 0, 1 (a four or a straight four) or 2 (two fours on one line, e.g. X.XXX.X).
function foursInDir(b, x, y, c, dx, dy, ow) {
  let wins = 0;
  for (const s of [1, -1]) {
    const e = nextEmpty(b, x, y, s * dx, s * dy, c);
    if (e >= 0 && fiveInDir(b, e % N, (e / N) | 0, c, dx, dy, ow)) wins++;
  }
  if (wins === 2 && runLen(b, x, y, dx, dy, c) === 4) return 1;   // straight four = one four
  return wins;
}

// With c on (x,y): is the run through (x,y) an unbroken 4 whose both ends make a five?
function isStraightFour(b, x, y, c, dx, dy, ow) {
  if (runLen(b, x, y, dx, dy, c) !== 4) return false;
  for (const s of [1, -1]) {
    const e = nextEmpty(b, x, y, s * dx, s * dy, c);   // the cell just past the run's end
    if (e < 0 || !fiveInDir(b, e % N, (e / N) | 0, c, dx, dy, ow)) return false;
  }
  return true;
}

// With c on (x,y) and this line holding no four: is it a three through (x,y)?
// The straightening point q must be the first empty cell on one side (a straight four that
// contains both the move and q is contiguous, so nothing but c can lie between them).
function threeInDir(b, x, y, c, dx, dy, rules, depth) {
  for (const s of [1, -1]) {
    const q = nextEmpty(b, x, y, s * dx, s * dy, c);
    if (q < 0) continue;
    const qx = q % N, qy = (q / N) | 0;
    b[q] = c;
    const straight = isStraightFour(b, qx, qy, c, dx, dy, rules.overlineWins);
    b[q] = EMPTY;
    if (!straight) continue;
    // 거짓 삼: q is a point c may not play (checked with the move still on the board).
    if (rules.fakeThreeCheck && depth < rules.maxDepth && forbiddenAt(b, qx, qy, c, rules, depth + 1)) continue;
    return true;
  }
  return false;
}

// Cheap, conservative pre-filter: a three needs >= 2 own stones near p on its line and a four
// >= 3 (counted within distance 4, stopping at opponent stones). Optional — the full check
// is already ~1 µs/point on Node 22 — but it keeps AI move generation cheap.
function mayBeForbidden(b, x, y, c, need33, need44) {
  let lines2 = 0, lines3 = 0;
  for (const [dx, dy] of DIRS) {
    let n = 0;
    for (const s of [1, -1]) {
      for (let k = 1; k <= 4; k++) {
        const i = x + s * k * dx, j = y + s * k * dy;
        if (!inb(i, j)) break;
        const v = b[j * N + i];
        if (v === c) n++; else if (v !== EMPTY) break;
      }
    }
    if (n >= 2) lines2++;
    if (n >= 3) lines3++;
  }
  return (need33 && lines2 >= 2) || (need44 && lines3 >= 1);   // 4-4 may sit on one line (X.XXX.X)
}

// Classify every line through an EMPTY point (x,y) for colour c.
// Returns { five, fours, threes } — fours counts 2 for a double four on one line.
export function analyzeMove(b, x, y, c, rules = DEFAULT_RULES, depth = 0) {
  const ow = rules.overlineWins;
  if (isFive(b, x, y, c, ow)) return { five: true, fours: 0, threes: 0 };
  const idx = y * N + x;
  b[idx] = c;
  let fours = 0, threes = 0;
  for (const [dx, dy] of DIRS) {
    const f = foursInDir(b, x, y, c, dx, dy, ow);
    if (f) { fours += f; continue; }
    if (threeInDir(b, x, y, c, dx, dy, rules, depth)) threes++;
  }
  b[idx] = EMPTY;
  return { five: false, fours, threes };
}

function forbiddenAt(b, x, y, c, rules, depth) {
  const t33 = applies(rules.doubleThree, c), t44 = applies(rules.doubleFour, c);
  if (!t33 && !t44) return false;
  if (!mayBeForbidden(b, x, y, c, t33, t44)) return false;
  const { five, fours, threes } = analyzeMove(b, x, y, c, rules, depth);
  if (five) return false;                                   // 5목 완성은 금수보다 우선
  return (t33 && threes >= 2) || (t44 && fours >= 2);
}

// Public: is an EMPTY point (x,y) forbidden for colour c? (occupied -> false; check that first)
export function isForbidden(b, x, y, c, rules = DEFAULT_RULES) {
  if (b[y * N + x] !== EMPTY) return false;
  return forbiddenAt(b, x, y, c, rules, 0);
}

export function isDoubleThree(b, x, y, c, rules = DEFAULT_RULES) {
  if (b[y * N + x] !== EMPTY) return false;
  const r = analyzeMove(b, x, y, c, rules, 0);
  return !r.five && r.threes >= 2;
}

// One call for the UI: what happens if c plays (x,y)?
//   { ok:false, reason:'occupied'|'33'|'44' }
//   { ok:true, win:boolean, line:[[x,y],...]|null, overline:boolean }  (overline: 6목+ made but
//   it does not win under the current rules — show a toast "장목은 승리가 아니에요")
export function judgeMove(b, x, y, c, rules = DEFAULT_RULES) {
  if (!inb(x, y) || b[y * N + x] !== EMPTY) return { ok: false, reason: 'occupied' };
  if (isFive(b, x, y, c, rules.overlineWins)) {
    return { ok: true, win: true, line: winningLine(b, x, y, c, rules.overlineWins), overline: false };
  }
  const t33 = applies(rules.doubleThree, c), t44 = applies(rules.doubleFour, c);
  if ((t33 || t44) && mayBeForbidden(b, x, y, c, t33, t44)) {
    const { threes, fours } = analyzeMove(b, x, y, c, rules, 0);
    if (t33 && threes >= 2) return { ok: false, reason: '33' };
    if (t44 && fours >= 2) return { ok: false, reason: '44' };
  }
  const overline = !rules.overlineWins && DIRS.some(([dx, dy]) => runLen(b, x, y, dx, dy, c) >= 6);
  return { ok: true, win: false, line: null, overline };
}
