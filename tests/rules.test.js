// Rule-engine tests. Run: node --test tests/
// Snippet notation: X = stones of the colour to move, O = opponent, * = candidate move, . = empty.
// `at: [x0, y0]` = board position of the snippet's top-left cell (default [3,3], i.e. away from
// every edge). Edge/corner cases put the snippet against the board edge with at:[0,…] etc.
// Every case that runs under doubleThree:'both' is ALSO run with colours swapped (white to move)
// and must give the same verdict — the rule is colour-symmetric.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  N, EMPTY, BLACK, WHITE, DEFAULT_RULES, isFive, isForbidden, isDoubleThree, judgeMove, analyzeMove, winningLine,
} from '../js/rules.js';

export function parse(rows, at = [3, 3], mover = BLACK) {
  const b = new Int8Array(N * N);
  const opp = mover === BLACK ? WHITE : BLACK;
  let p = null;
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    const x = at[0] + c, y = at[1] + r;
    if (ch === '.' ) return;
    if (x >= N || y >= N) throw new Error(`snippet out of board at ${x},${y}`);
    if (ch === 'X') b[y * N + x] = mover;
    else if (ch === 'O') b[y * N + x] = opp;
    else if (ch === '*') p = [x, y];
    else throw new Error(`bad char ${ch}`);
  }));
  if (!p) throw new Error('no * in snippet');
  return { b, p };
}

// expect: 'forbidden' | 'allowed' | 'win'
export const CASES = [
  { id: 'C01', name: 'solid open three x2 (H+V) = 3-3', expect: 'forbidden', rows: [
    '.........',
    '.........',
    '....X....',
    '....X....',
    '..XX*....',
    '.........',
    '.........'] },
  { id: 'C02', name: 'split three (X.XX) + solid three', expect: 'forbidden', rows: [
    '.........',
    '.........',
    '....X....',
    '....X....',
    '.X.X*....',
    '.........',
    '.........'] },
  { id: 'C03', name: 'move fills middle of two split threes (H: XX.X, diag: X.XX)', expect: 'forbidden', rows: [
    '.........',
    '.........',
    '.X.......',
    '.........',
    '..X*.X...',
    '....X....',
    '.........',
    '.........'] },
  { id: 'C04', name: 'diagonal + anti-diagonal open threes', expect: 'forbidden', rows: [
    '.........',
    '.........',
    '..X...X..',
    '...X.X...',
    '....*....',
    '.........',
    '.........',
    '.........'] },
  { id: 'C05', name: 'V three blocked directly by O (OXX*) -> only one three', expect: 'allowed', rows: [
    '.........',
    '....O....',
    '....X....',
    '....X....',
    '..XX*....',
    '.........',
    '.........'] },
  { id: 'C06', name: 'V "O.XXX.O" looks open in a 5-window but is NOT a three', expect: 'allowed', rows: [
    '....O....',
    '.........',
    '....X....',
    '....X....',
    '..XX*....',
    '.........',
    '....O....',
    '.........'] },
  { id: 'C07', name: 'V "O.XXX.." (O at distance 2 on one side only) IS a three', expect: 'forbidden', rows: [
    '....O....',
    '.........',
    '....X....',
    '....X....',
    '..XX*....',
    '.........',
    '.........',
    '.........'] },
  { id: 'C08', name: 'H three flush against left edge |XX* is not a three', at: [0, 3], expect: 'allowed', rows: [
    '.........',
    '.........',
    '..X......',
    '..X......',
    'XX*......',
    '.........',
    '.........'] },
  { id: 'C09', name: 'H three one cell from left edge |.XX*.. IS a three', at: [0, 3], expect: 'forbidden', rows: [
    '.........',
    '.........',
    '...X.....',
    '...X.....',
    '.XX*.....',
    '.........',
    '.........'] },
  { id: 'C10', name: 'edge split |X.X* is not a three', at: [0, 3], expect: 'allowed', rows: [
    '.........',
    '.........',
    '...X.....',
    '...X.....',
    'X.X*.....',
    '.........',
    '.........'] },
  { id: 'C11', name: 'corner diagonal (0,0)(1,1)* not a three; H three only', at: [0, 0], expect: 'allowed', rows: [
    'X........',
    '.X.......',
    '..*XX....',
    '.........',
    '.........'] },
  { id: 'C12', name: 'X..XX*..X: both straight-fours would be overlines -> not a three (6목 무효)', expect: 'allowed', rows: [
    '.........',
    '.........',
    '.....X...',
    '.....X...',
    'X..XX*..X',
    '.........',
    '.........'] },
  { id: 'C13', name: 'same as C12 with overlineWins=true -> it IS a three', rules: { overlineWins: true }, expect: 'forbidden', rows: [
    '.........',
    '.........',
    '.....X...',
    '.....X...',
    'X..XX*..X',
    '.........',
    '.........'] },
  { id: 'C14', name: 'X..XX*... (flanked on one side only) still a three', expect: 'forbidden', rows: [
    '.........',
    '.........',
    '.....X...',
    '.....X...',
    'X..XX*...',
    '.........',
    '.........'] },
  { id: 'C15', name: '4-3 (closed four + open three) allowed', expect: 'allowed', rows: [
    '.........',
    '.........',
    '....X....',
    '....X....',
    'OXXX*....',
    '.........',
    '.........'] },
  { id: 'C16', name: '4-4 in two lines allowed (국룰)', expect: 'allowed', rows: [
    '.........',
    '....X....',
    '....X....',
    '....X....',
    '.XXX*....',
    '.........',
    '.........'] },
  { id: 'C16b', name: 'C16 with doubleFour:"both" (option) -> 44', rules: { doubleFour: 'both' }, expect: 'forbidden', rows: [
    '.........',
    '....X....',
    '....X....',
    '....X....',
    '.XXX*....',
    '.........',
    '.........'] },
  { id: 'C17', name: '4-4 on ONE line X.X*X.X allowed (국룰)', expect: 'allowed', rows: [
    '.........',
    '.X.X*X.X.',
    '.........'] },
  { id: 'C17b', name: 'C17 with doubleFour:"both" -> 44 (one-line double four counts 2)', rules: { doubleFour: 'both' }, expect: 'forbidden', rows: [
    '.........',
    '.X.X*X.X.',
    '.........'] },
  { id: 'C18', name: '4-3-3 (four + two open threes) forbidden: contains 3-3', expect: 'forbidden', rows: [
    '.........',
    '.........',
    '..X.X....',
    '...XX....',
    'OXXX*....',
    '.........',
    '.........'] },
  { id: 'C19', name: 'five + 3-3 at once -> five wins', expect: 'win', rows: [
    '.........',
    '.........',
    '..X.X....',
    '...XX....',
    'XXXX*....',
    '.........',
    '.........'] },
  { id: 'C20', name: 'overline (6목) + 3-3, overline does not win -> 3-3 forbidden', expect: 'forbidden', rows: [
    '.........',
    '.........',
    '..X.X....',
    '...XX....',
    '.XXX*XX..',
    '.........',
    '.........'] },
  { id: 'C20b', name: 'C20 with overlineWins=true -> win', rules: { overlineWins: true }, expect: 'win', rows: [
    '.........',
    '.........',
    '..X.X....',
    '...XX....',
    '.XXX*XX..',
    '.........',
    '.........'] },
  { id: 'C21', name: 'two threes on ONE line (.XX.*.XX., overlineWins) count once', rules: { overlineWins: true }, expect: 'allowed', rows: [
    '.........',
    '.XX.*.XX.',
    '.........'] },
  { id: 'C22', name: 'fake three: H three only straightens at q, q is 4-3-3 (forbidden) -> one real three', at: [0, 0], expect: 'allowed', rows: [
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '......XX.X.....',
    '......XXX......',
    '..O.XX*........',
    '...............',
    '...............'] },
  { id: 'C23', name: 'C22 with fakeThreeCheck=false -> counted as 3-3', at: [0, 0], rules: { fakeThreeCheck: false }, expect: 'forbidden', rows: [
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '......XX.X.....',
    '......XXX......',
    '..O.XX*........',
    '...............',
    '...............'] },
  { id: 'C24', name: 'C22 without the O: H three has a second, legal straightening point -> real 3-3', at: [0, 0], expect: 'forbidden', rows: [
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '......XX.X.....',
    '......XXX......',
    '....XX*........',
    '...............',
    '...............'] },
  { id: 'C25', name: 'split three with O touching: .X.X*O not a three', expect: 'allowed', rows: [
    '.........',
    '.........',
    '....X....',
    '....X....',
    '.X.X*O...',
    '.........',
    '.........'] },
  { id: 'C26', name: 'split three with O on the far side: OX.X*. not a three', expect: 'allowed', rows: [
    '.........',
    '.........',
    '....X....',
    '....X....',
    'OX.X*....',
    '.........',
    '.........'] },
  { id: 'C27', name: 'two-gap shape X..X* is not a three', expect: 'allowed', rows: [
    '.........',
    '.........',
    '.....X...',
    '.....X...',
    '.X..X*...',
    '.........',
    '.........'] },
  { id: 'C28', name: 'bottom-right: diag + H threes touching edge with one inner margin -> 3-3', at: [6, 6], expect: 'forbidden', rows: [
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.....X...',
    '......X..',
    '.....XX*.',
    '.........'] },
  { id: 'C29', name: 'diag ending exactly in the corner + V along the edge: nothing is a three', at: [6, 6], expect: 'allowed', rows: [
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '......X.X',
    '.......XX',
    '........*'] },
  { id: 'C30', name: 'doubleThree:"black" (렌주식 옵션): white may play C01 shape', rules: { doubleThree: 'black' }, mover: WHITE, noSwap: true, expect: 'allowed', rows: [
    '.........',
    '.........',
    '....X....',
    '....X....',
    '..XX*....',
    '.........',
    '.........'] },
  { id: 'C31', name: "opponent's 3-3 point is free for me", expect: 'allowed', rows: [
    '.........',
    '.........',
    '....O....',
    '....O....',
    '..OO*....',
    '.........',
    '.........'] },
  { id: 'C32', name: 'single open three is fine', expect: 'allowed', rows: [
    '.........',
    '.........',
    '.........',
    '.........',
    '..XX*....',
    '.........',
    '.........'] },
  { id: 'C33', name: 'unrelated three already on the same line (.XXX..*) does not count', expect: 'allowed', rows: [
    '.........',
    '.........',
    '......X..',
    '......X..',
    '.XXX..*..',
    '.........',
    '.........'] },
  { id: 'C34', name: '.XXX.* makes a (broken) four, not a three -> 4-3 allowed', expect: 'allowed', rows: [
    '.........',
    '.........',
    '.....X...',
    '.....X...',
    '.XXX.*...',
    '.........',
    '.........'] },
  { id: 'C35', name: 'top edge: V three with one empty row above edge IS a three -> 3-3', at: [3, 0], expect: 'forbidden', rows: [
    '.........',
    '....X....',
    '....X....',
    '..XX*....',
    '.........',
    '.........',
    '.........'] },
  { id: 'C36', name: 'top edge: V three flush with edge is not a three', at: [3, 0], expect: 'allowed', rows: [
    '....X....',
    '....X....',
    '..XX*....',
    '.........',
    '.........',
    '.........'] },
  { id: 'C37', name: '4-4-3 allowed (only one three; 4-4 legal)', expect: 'allowed', rows: [
    '.........',
    '....X....',
    '..X.X....',
    '...XX....',
    'OXXX*....',
    '.........',
    '.........',
    '.........'] },
  { id: 'C38', name: 'exact five in H while V would be 6 -> win', expect: 'win', rows: [
    '.........',
    '....X....',
    '....X....',
    '....X....',
    'XXXX*....',
    '....X....',
    '....X....',
    '.........'] },
  { id: 'C39', name: 'plain overline (no 3-3) is a legal move but not a win', expect: 'allowed', overline: true, rows: [
    '.........',
    'XXX*XX...',
    '.........'] },
  { id: 'C41', name: 'X.XX*. is a four (X.XXX), not a three -> 4-3 allowed (naive 5-window matchers call it 3-3)', expect: 'allowed', rows: [
    '.........',
    '.........',
    '....X....',
    '....X....',
    'X.XX*....',
    '.........',
    '.........'] },
  { id: 'C40', name: 'anti-diagonal split three + H split three', expect: 'forbidden', rows: [
    '.........',
    '.........',
    '......X..',
    '.........',
    '.XX.*....',
    '...X.....',
    '.........',
    '.........'] },
];

function verdict(b, p, mover, rules) {
  const [x, y] = p;
  const before = b.slice();
  const forb = isForbidden(b, x, y, mover, rules);
  const j = judgeMove(b, x, y, mover, rules);
  const five = isFive(b, x, y, mover, rules.overlineWins);
  assert.deepEqual(b, before, 'board must be restored');
  if (five) {
    assert.equal(forb, false, 'a five is never forbidden');
    assert.equal(j.ok && j.win, true);
    return { v: 'win', j };
  }
  assert.equal(j.ok, !forb, 'judgeMove agrees with isForbidden');
  return { v: forb ? 'forbidden' : 'allowed', j };
}

if (!process.env.NO_RUN) for (const c of CASES) {
  const rules = { ...DEFAULT_RULES, ...(c.rules || {}) };
  const mover = c.mover || BLACK;
  test(`${c.id} ${c.name}`, () => {
    const { b, p } = parse(c.rows, c.at, mover);
    const { v, j } = verdict(b, p, mover, rules);
    assert.equal(v, c.expect);
    if (c.overline) assert.equal(j.overline, true);
    if (!c.noSwap && rules.doubleThree === 'both') {
      const other = mover === BLACK ? WHITE : BLACK;
      const s = parse(c.rows, c.at, other);
      assert.equal(verdict(s.b, s.p, other, rules).v, c.expect, 'colour-swapped verdict differs');
    }
  });
}

test('winningLine returns the 5 cells (exact five)', () => {
  const { b, p } = parse(['XX*XX'], [5, 7]);
  const line = winningLine(b, p[0], p[1], BLACK, false);
  assert.deepEqual(line, [[5, 7], [6, 7], [7, 7], [8, 7], [9, 7]]);
});

test('analyzeMove counts per line (C18 = 1 four, 2 threes)', () => {
  const c = CASES.find((k) => k.id === 'C18');
  const { b, p } = parse(c.rows, c.at);
  assert.deepEqual(analyzeMove(b, p[0], p[1], BLACK, DEFAULT_RULES), { five: false, fours: 1, threes: 2 });
  assert.equal(isDoubleThree(b, p[0], p[1], BLACK, DEFAULT_RULES), true);
});
