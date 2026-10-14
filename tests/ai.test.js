// CPU opponent tests (js/ai/engine.js, js/ai/worker.js, js/ai-client.js) — docs/research/ai.md §11.
// Run: node --test tests/ai.test.js
//
// Notation: positions are drawn with 'X' = the side the AI plays, 'O' = the opponent. Every
// tactical case runs in all 8 rotations/mirrors AND with the colours swapped (16 variants), so a
// bug that only shows on one diagonal or for white cannot hide. Seeds are fixed.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { N, EMPTY, BLACK, WHITE, DEFAULT_RULES, isForbidden, judgeMove } from '../js/rules.js';
import { createEngine, bench, LEVELS, internals } from '../js/ai/engine.js';
import { createAiClient } from '../js/ai-client.js';

const { Board, Searcher, tableFor, toPad, mulberry32, WW, F3, B3, F4, B4, F5, FL_MAYBE, FL_FIVE } = internals;
const RULES = { ...DEFAULT_RULES };
const RULES_OW = { ...DEFAULT_RULES, overlineWins: true };
const at = (x, y) => y * N + x;
const xy = (i) => [i % N, (i / N) | 0];

// ---- position helpers ------------------------------------------------------------------------

// 8 symmetries of the 15×15 board.
const SYMS = [
  (x, y) => [x, y], (x, y) => [14 - y, x], (x, y) => [14 - x, 14 - y], (x, y) => [y, 14 - x],
  (x, y) => [14 - x, y], (x, y) => [x, 14 - y], (x, y) => [y, x], (x, y) => [14 - y, 14 - x],
];
const symIdx = (k, i) => { const [x, y] = SYMS[k](i % N, (i / N) | 0); return at(x, y); };

// Rows → { mine:[idx], theirs:[idx] } ('X' mine, 'O' theirs, anything else empty).
function parse(rows, ox = 0, oy = 0) {
  const mine = [], theirs = [];
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === 'X') mine.push(at(x + ox, y + oy));
    else if (ch === 'O') theirs.push(at(x + ox, y + oy));
  }));
  return { mine, theirs };
}

// Stone sets → a move list (black first) with `aiColor` to move. Missing stones are padded with
// spaced fillers on the bottom row (black) / right column (white): X.X.X never forms a threat.
const FILL = { [BLACK]: [0, 2, 4, 6, 8, 10].map((x) => at(x, 14)), [WHITE]: [0, 2, 4, 6, 8, 10].map((y) => at(14, y)) };
function toMoves(blacks, whites, toMove) {
  const b = blacks.slice(), w = whites.slice();
  const wantB = toMove === BLACK ? Math.max(b.length, w.length) : Math.max(b.length, w.length + 1);
  const wantW = toMove === BLACK ? wantB : wantB - 1;
  let fb = 0, fw = 0;
  while (b.length < wantB) b.push(FILL[BLACK][fb++]);
  while (w.length < wantW) w.push(FILL[WHITE][fw++]);
  const moves = [];
  for (let k = 0; k < b.length; k++) { moves.push(b[k]); if (k < w.length) moves.push(w[k]); }
  assert.equal(new Set(moves).size, moves.length, 'overlapping stones');
  return moves;
}

// All 16 variants of a case: { moves, aiColor, map(idx) } — map transforms expected points.
function variants(rows) {
  const { mine, theirs } = parse(rows);
  const out = [];
  for (let k = 0; k < 8; k++) {
    for (const aiColor of [BLACK, WHITE]) {
      const m = mine.map((i) => symIdx(k, i)), t = theirs.map((i) => symIdx(k, i));
      const moves = aiColor === BLACK ? toMoves(m, t, BLACK) : toMoves(t, m, WHITE);
      out.push({ moves, aiColor, sym: k, map: (i) => symIdx(k, i) });
    }
  }
  return out;
}

function gridOf(moves) {
  const b = new Int8Array(N * N);
  moves.forEach((m, k) => { b[m] = k % 2 === 0 ? BLACK : WHITE; });
  return b;
}
const colorToMove = (moves) => (moves.length % 2 === 0 ? BLACK : WHITE);
const judge = (moves, i, rules = RULES) => judgeMove(gridOf(moves), i % N, (i / N) | 0, colorToMove(moves), rules);

function boardFrom(moves, rules = RULES) {
  const b = new Board(rules);
  moves.forEach((m, k) => b.put(toPad(m), k % 2 === 0 ? BLACK : WHITE));
  return b;
}

// Random legal game prefix (both sides play random legal points near the centre).
function randomGame(r, plies, rules = RULES) {
  const g = new Int8Array(N * N), moves = [];
  for (let p = 0; p < plies; p++) {
    const c = moves.length % 2 === 0 ? BLACK : WHITE;
    let placed = false;
    for (let tries = 0; tries < 60 && !placed; tries++) {
      const x = Math.min(14, Math.max(0, 7 + Math.round((r() - 0.5) * 12)));
      const y = Math.min(14, Math.max(0, 7 + Math.round((r() - 0.5) * 12)));
      const i = at(x, y);
      const j = judgeMove(g, x, y, c, rules);
      if (!j.ok || j.win) continue;
      g[i] = c; moves.push(i); placed = true;
    }
    if (!placed) break;
  }
  return moves;
}

const engines = {};
const eng = (level) => (engines[level] ??= createEngine());

// ---- 1-5: pattern table, 3-3, parity, incremental board ---------------------------------------

describe('pattern table', () => {
  // Window around '*' (the point, treated as own): 5 cells each side, padded with empty.
  const lvl = (line, ow = false) => {
    const k = line.indexOf('*');
    const L = ('.....' + line.slice(0, k)).slice(-5), R = (line.slice(k + 1) + '.....').slice(0, 5);
    const d = (ch) => (ch === '.' ? 0 : ch === 'X' ? 1 : 2);
    let key = 0;
    for (let i = 0; i < 5; i++) key += d(L[i]) * 3 ** i;
    for (let i = 0; i < 5; i++) key += d(R[i]) * 3 ** (5 + i);
    return tableFor(ow)[key];
  };

  test('1. classification', () => {
    assert.equal(lvl('.XXX*.'), F4, '.XXXX. open four');
    assert.equal(lvl('OXXX*.'), B4, 'OXXXX. four');
    assert.equal(lvl('XXX*X'), F5, 'XXX.X gap makes five');
    assert.equal(lvl('..XX*..'), F3, '..XXX.. open three');
    assert.equal(lvl('.X*.X.'), F3, '.XX.X. split three');
    assert.equal(lvl('OXX*..'), B3, 'OXXX.. is not an open three');
    assert.equal(lvl('O.XX*.O'), B3, 'O.XXX.O cannot become a straight four');
  });

  test('2. overline: XXXX.X gap is five only with overlineWins', () => {
    assert.notEqual(lvl('XXXX*X', false), F5);
    assert.equal(lvl('XXXX*X', true), F5);
    assert.equal(lvl('.XXXX*.', false), F5, 'exact five next to empty');
    assert.notEqual(lvl('XXXXX*', false), F5);
  });
});

describe('3-3 detection and parity with rules.js', () => {
  const cases = [
    { name: 'cross 3-3', forbidden: true, rows: ['.......', '...X...', '...X...', '.XX*...', '.......'] },
    { name: 'split 3-3', forbidden: true, rows: ['.......', '...X...', '...X...', '.......', '.XX*...', '.......'] },
    { name: '4-3 is legal', forbidden: false, rows: ['.......', '....X..', '....X..', '.XXX*..', '.......'] },
    { name: '4-4 is legal', forbidden: false, rows: ['.......', '....X..', '....X..', '....X..', '.XXX*..', '.......'] },
    { name: '3-3 that makes five is legal', forbidden: false, rows: ['........', '..X.X...', '...XX...', 'XXXX*...', '........'] },
    { name: '3-3 with one three blocked is legal', forbidden: false, rows: ['...O...', '...X...', '...X...', '.XX*...', '.......'] },
  ];
  for (const c of cases) {
    test(`3. ${c.name} (both colours, all symmetries)`, () => {
      const { mine, theirs } = parse(c.rows.map((r) => r.replace('*', '.')), 4, 4);
      const star = c.rows.findIndex((r) => r.includes('*'));
      const p0 = at(c.rows[star].indexOf('*') + 4, star + 4);
      for (let k = 0; k < 8; k++) {
        for (const col of [BLACK, WHITE]) {
          const b = new Board(RULES);
          const g = new Int8Array(N * N);
          for (const i of mine) { const s = symIdx(k, i); b.put(toPad(s), col); g[s] = col; }
          for (const i of theirs) { const s = symIdx(k, i); b.put(toPad(s), 3 - col); g[s] = 3 - col; }
          const p = symIdx(k, p0);
          assert.equal(isForbidden(g, p % N, (p / N) | 0, col, RULES), c.forbidden, 'rules.js agrees with the case');
          assert.equal(b.legal(toPad(p), col), !c.forbidden, `sym ${k} colour ${col}`);
        }
      }
    });
  }

  test('4. parity fuzz: engine legal() === !rules.isForbidden, both colours, both overline settings', () => {
    for (const rules of [RULES, RULES_OW]) {
      const r = mulberry32(rules.overlineWins ? 4242 : 2424);
      const b = new Board(rules);
      let checks = 0, forbidden = 0;
      for (let t = 0; t < 300; t++) {
        b.clear();
        const g = new Int8Array(N * N);
        const density = 0.08 + r() * 0.4;
        for (let i = 0; i < N * N; i++) {
          const x = i % N, y = (i / N) | 0, dist = Math.hypot(x - 7, y - 7);
          if (r() < density * (dist < 5 ? 1.6 : 0.5)) { const c = r() < 0.55 ? BLACK : WHITE; g[i] = c; b.put(toPad(i), c); }
        }
        for (let i = 0; i < N * N; i++) {
          if (g[i] !== EMPTY) { assert.equal(b.legal(toPad(i), BLACK), false); continue; }
          for (const c of [BLACK, WHITE]) {
            const f = isForbidden(g, i % N, (i / N) | 0, c, rules);
            checks++; if (f) forbidden++;
            if (f) assert.ok(b.flags[c * WW + toPad(i)] & FL_MAYBE, 'table flags are a superset of rules');
            if (b.legal(toPad(i), c) === f) assert.fail(`parity broken at ${xy(i)} colour ${c} (ow=${rules.overlineWins}, board ${t})`);
          }
        }
      }
      assert.ok(forbidden > 300, `fuzz must exercise forbidden points (got ${forbidden} of ${checks})`);
    }
  });

  test('5. incremental board equals a full recompute after 2000 random put/undo steps', () => {
    const r = mulberry32(5);
    const b = new Board(RULES);
    const stones = [];
    const fields = ['flags', 'pval', 'tot', 'cnt5', 'cntOpen4', 'cntFour', 'nb'];
    for (let step = 0; step < 2000; step++) {
      if (stones.length && (r() < 0.4 || stones.length > 150)) { b.undo(); stones.pop(); }
      else {
        let i;
        do { i = (r() * N * N) | 0; } while (stones.some((s) => s[0] === i));
        const c = r() < 0.5 ? BLACK : WHITE;
        b.put(toPad(i), c); stones.push([i, c]);
      }
      if (step % 50 !== 49) continue;
      const fresh = new Board(RULES);
      for (const [i, c] of stones) fresh.put(toPad(i), c);
      for (const f of fields) assert.deepEqual(b[f], fresh[f], `${f} after step ${step}`);
      for (let i = 0; i < WW; i++) {
        if (b.cells[i] !== EMPTY) continue;                    // occupied/wall patterns are unused
        for (const c of [BLACK, WHITE]) {
          for (let d = 0; d < 4; d++) {
            const k = (c * WW + i) * 4 + d;
            if (b.pat[k] !== fresh.pat[k]) assert.fail(`pattern of ${i} dir ${d} colour ${c} after step ${step}`);
          }
        }
      }
      assert.equal(b.hlo, fresh.hlo);
      assert.equal(b.hhi, fresh.hhi);
      assert.deepEqual(b.grid, fresh.grid);
    }
  });
});

// ---- 6-14: tactics (16 variants each) -------------------------------------------------------

describe('tactics', () => {
  const LV = ['easy', 'normal', 'hard'];

  test('6. win in one: plays a five point (either end)', () => {
    const rows = ['..........', '..........', '..XXXX....', '..OOO.....', '..........'];
    const ends = [at(1, 2), at(6, 2)];
    for (const v of variants(rows)) {
      for (const level of LV) {
        const r = eng(level).think({ moves: v.moves, level, seed: 1 });
        assert.equal(r.reason, 'win', `${level} sym ${v.sym}`);
        assert.ok(ends.map(v.map).includes(r.move));
        assert.ok(judge(v.moves, r.move).win);
      }
    }
  });

  test('7. prefers its own five over blocking', () => {
    const rows = ['..........', '..XXXX....', '..........', '...OOOO...', '..........'];
    for (const v of variants(rows)) {
      for (const level of LV) {
        const r = eng(level).think({ moves: v.moves, level, seed: 2 });
        assert.equal(r.reason, 'win');
        assert.ok(judge(v.moves, r.move).win);
      }
    }
  });

  test('8. blocks a four, including a split four OO.OO', () => {
    const cases = [
      { rows: ['..........', '.XOOOO....', '...X......', '....X.....'], block: at(6, 1) },
      { rows: ['..........', '..OO.OO...', '...X......', '..X.......'], block: at(4, 1) },
    ];
    for (const c of cases) {
      for (const v of variants(c.rows)) {
        for (const level of ['normal', 'hard']) {
          const r = eng(level).think({ moves: v.moves, level, seed: 3 });
          assert.equal(r.reason, 'block', `${level} sym ${v.sym} colour ${v.aiColor}`);
          assert.equal(r.move, v.map(c.block));
        }
      }
    }
  });

  test('9. opponent has an open four: a legal move, reason lost, no exception', () => {
    const rows = ['..........', '..........', '..OOOO....', '..X.X.....', '...X......'];
    for (const v of variants(rows)) {
      for (const level of LV) {
        const r = eng(level).think({ moves: v.moves, level, seed: 4 });
        assert.equal(r.reason, 'lost');
        assert.ok(judge(v.moves, r.move).ok);
        assert.ok([at(1, 2), at(6, 2)].map(v.map).includes(r.move), 'still blocks one end');
      }
    }
  });

  test('10. our only block is 3-3 for us: a LEGAL move with reason lost', () => {
    // O four on row 9 (4..7); the five point (8,9) makes two open threes for X (column 8 and
    // the diagonal), so X cannot block.
    const rows = [
      '...........', '...........', '...........', '...........', '...........', '...........', '...........',
      '........X..',
      '........X..',
      '...XOOOO...',
      '.........X.',
      '..........X',
    ];
    for (const v of variants(rows)) {
      const block = v.map(at(8, 9));
      const g = gridOf(v.moves);
      assert.ok(isForbidden(g, block % N, (block / N) | 0, v.aiColor, RULES), 'precondition: the block is forbidden');
      for (const level of LV) {
        const r = eng(level).think({ moves: v.moves, level, seed: 5 });
        assert.equal(r.reason, 'lost');
        assert.notEqual(r.move, block);
        assert.ok(judge(v.moves, r.move).ok, `${level} returned an illegal move`);
      }
    }
  });

  test('11. blocks an open three (normal, hard)', () => {
    const rows = ['...........', '...........', '....OOO....', '...........', '..X....X...', '.....X.....'];
    for (const v of variants(rows)) {
      for (const level of ['normal', 'hard']) {
        const r = eng(level).think({ moves: v.moves, level, seed: 6, timeMs: 250 });
        assert.ok(judge(v.moves, r.move).ok);
        const after = boardFrom([...v.moves, r.move]);
        const opp = 3 - v.aiColor;
        const madeFour = after.cnt5[v.aiColor] > 0;
        assert.ok(after.cntOpen4[opp] === 0 || madeFour, `${level} sym ${v.sym} colour ${v.aiColor}: open three left at ${xy(r.move)} (${r.reason})`);
      }
    }
  });

  // Positions found in self-play where the side to move has a VCF of exactly this many fours
  // (none shorter) and the opponent has no four.
  const VCF = {
    3: [[112, 111, 128, 96, 126, 129, 98, 84, 142, 114, 144, 99, 69, 113, 143, 141, 127, 97, 124, 125],
      [112, 113, 96, 128, 98, 99, 127, 82, 126, 84, 142, 172]],
    5: [[112, 111, 98, 126, 96, 95, 80, 128, 97, 82, 78, 79, 127, 64, 63, 109, 94, 123, 81, 137, 151, 65, 142, 157, 66, 108, 99, 100, 62, 107, 110, 46, 93, 139, 36, 51, 38, 52, 48, 33, 155]],
    7: [[112, 96, 113, 111, 126, 140, 127, 97, 141, 99, 98, 83, 125, 128, 109, 93]],
  };
  // Plays the attack out against a defender who always blocks the five point (if legal).
  // The attacker must make five within `fours` of its own moves.
  function playOut(engine, level, moves, fours) {
    const ms = moves.slice();
    const atk = colorToMove(ms);
    for (let k = 0; k < fours; k++) {
      const r = engine.think({ moves: ms, level, seed: 7 });
      const j = judge(ms, r.move);
      assert.ok(j.ok);
      ms.push(r.move);
      if (j.win) return true;
      const b = boardFrom(ms);
      const five = b.findFive(atk);
      assert.ok(five >= 0, `attacker move ${k} (${r.reason}) was not a four`);
      const block = internals.PUB[five];
      if (!judge(ms, block).ok) return true;               // the defender may not block: wins next
      ms.push(block);
    }
    return judge(ms, internals.PUB[boardFrom(ms).findFive(atk)]).win;
  }

  for (const d of [3, 5, 7]) {
    test(`12. finds a VCF of ${d} fours (hard, normal) fast and it really wins`, () => {
      for (const base of VCF[d]) {
        for (let k = 0; k < 8; k++) {
          const moves = base.map((i) => symIdx(k, i));
          for (const level of ['hard', 'normal']) {
            const e = createEngine();
            const r = e.think({ moves, level, seed: 8 });
            assert.equal(r.reason, 'vcf', `${level} sym ${k}`);
            assert.ok(r.ms < 100, `VCF took ${r.ms} ms`);
            assert.ok(playOut(e, level, moves, d), `${level} sym ${k}: the VCF did not win`);
          }
        }
      }
    });
  }

  test('13. exploit: the only block is 3-3 for the opponent → play the four (vcf)', () => {
    const rows = [
      '...........', '...........', '...........', '...........', '...........', '...........', '...........',
      '........O..',
      '........O..',
      '...OXXX....',
      '.........O.',
      '..........O',
    ];
    for (const v of variants(rows)) {
      for (const level of ['normal', 'hard']) {
        const r = eng(level).think({ moves: v.moves, level, seed: 9 });
        assert.equal(r.reason, 'vcf', `${level} sym ${v.sym} colour ${v.aiColor}`);
        assert.equal(r.move, v.map(at(7, 9)));
      }
    }
  });

  test('14. defends against the opponent VCF (hard)', () => {
    const rows = [
      '.............', '.............', '.............',
      '....O.O.O....',
      '...........X.',
      '...O.........',
      '...O........X',
      '...O..X......',
      '.X...........',
      '..........X..',
    ];
    const probe = (moves, who, depth) => {
      const b = boardFrom(moves), s = new Searcher(b);
      s.deadline = performance.now() + 1e9;
      return s.vcfFresh(who, depth, 1e9);
    };
    for (const v of variants(rows).filter((_, k) => k % 3 === 0)) {    // 6 of 16: each takes ~1 s
      const opp = 3 - v.aiColor;
      assert.ok(probe(v.moves, opp, 14), 'precondition: the opponent has a VCF');
      assert.ok(!probe(v.moves, v.aiColor, 14), 'precondition: the AI has none');
      const r = createEngine().think({ moves: v.moves, level: 'hard', seed: 10 });
      assert.ok(judge(v.moves, r.move).ok);
      assert.ok(!probe([...v.moves, r.move], opp, 12), `sym ${v.sym}: VCF still there after ${xy(r.move)} (${r.reason})`);
    }
  });
});

// ---- 15-20: contract, timing, determinism, levels, draws, self-play -------------------------

describe('contract', () => {
  test('15. never forbidden or occupied: 200 random positions × 3 levels', () => {
    const r = mulberry32(15);
    for (let t = 0; t < 200; t++) {
      const moves = randomGame(r, (r() * 90) | 0, t % 4 === 0 ? RULES_OW : RULES);
      const rules = t % 4 === 0 ? RULES_OW : RULES;
      for (const level of ['easy', 'normal', 'hard']) {
        const e = rules.overlineWins ? (engines['ow-' + level] ??= createEngine({ overlineWins: true })) : eng(level);
        const res = e.think({ moves, level, seed: t, timeMs: level === 'easy' ? undefined : 20 });
        assert.ok(Number.isInteger(res.move) && res.move >= 0, `no move: ${JSON.stringify(res)}`);
        const j = judge(moves, res.move, rules);
        assert.ok(j.ok, `${level} position ${t}: ${xy(res.move)} is ${j.reason}`);
        assert.notEqual(res.reason, 'fallback');
      }
    }
  });

  test('16. time budgets: hard ≤ timeMs + 150 ms, easy < 100 ms', () => {
    const r = mulberry32(16);
    for (let t = 0; t < 3; t++) {
      const moves = randomGame(r, 20 + t * 15);
      for (const [level, limit] of [['hard', LEVELS.hard.timeMs + 150], ['normal', LEVELS.normal.timeMs + 150], ['easy', 100]]) {
        const e = createEngine();
        const t0 = performance.now();
        const res = e.think({ moves, level, seed: t });
        const wall = performance.now() - t0;
        assert.ok(wall <= limit, `${level} took ${wall.toFixed(0)} ms (limit ${limit})`);
        assert.ok(res.ms <= limit);
      }
    }
    const e = createEngine();
    const t0 = performance.now();
    e.think({ moves: randomGame(r, 30), level: 'hard', timeMs: 200 });
    assert.ok(performance.now() - t0 <= 350, 'custom budget honoured');
  });

  test('17. determinism: same moves + same seed → same move', () => {
    const r = mulberry32(17);
    for (let t = 0; t < 6; t++) {
      const moves = randomGame(r, 6 + t * 5);
      for (const level of ['easy', 'normal', 'hard']) {
        const req = { moves, level, seed: 1234 + t, timeMs: 10000, maxDepth: level === 'hard' ? 4 : undefined };
        const a = createEngine().think(req);
        const e = createEngine();
        e.think({ moves: randomGame(r, 10), level, seed: 1 });   // unrelated search first…
        e.reset();                                                // …then a new game
        const b = e.think(req);
        assert.equal(a.move, b.move, `${level} position ${t}`);
        assert.equal(a.reason, b.reason);
      }
    }
    // and the seed matters where the level is meant to vary
    const opening = [at(7, 7)];
    const replies = new Set();
    for (let s = 0; s < 20; s++) replies.add(createEngine().think({ moves: opening, level: 'hard', seed: s }).move);
    assert.ok(replies.size >= 3, 'the second move varies with the seed');
  });

  test('18. easy blunder rates over 400 seeds: blocks fours 0.80–0.97, stops open threes 0.35–0.65', () => {
    const four = variants(['..........', '.XOOOO....', '...X......', '....X.....']);
    const three = variants(['...........', '....OOO....', '...........', '...X..X....', '.....X.....']);
    const e = createEngine();
    for (const k of [0, 1]) {                                  // identity, AI black / AI white
      const f = four[k], t = three[k];
      let blocked = 0, stopped = 0;
      const R = 400;
      for (let s = 0; s < R; s++) {
        const r4 = e.think({ moves: f.moves, level: 'easy', seed: s * 7919 + 1 });
        assert.ok(judge(f.moves, r4.move).ok);
        if (r4.move === f.map(at(6, 1))) { blocked++; assert.equal(r4.reason, 'block'); }
        else assert.equal(r4.reason, 'blunder');
        const r3 = e.think({ moves: t.moves, level: 'easy', seed: s * 104729 + 3 });
        if (boardFrom([...t.moves, r3.move]).cntOpen4[3 - t.aiColor] === 0) stopped++;
      }
      const rate4 = blocked / R, rate3 = stopped / R;
      assert.ok(rate4 >= 0.8 && rate4 <= 0.97, `block-four rate ${rate4} (AI colour ${f.aiColor})`);
      assert.ok(rate3 >= 0.35 && rate3 <= 0.65, `stop-open-three rate ${rate3} (AI colour ${t.aiColor})`);
    }
  });

  test('19. full board → move -1, reason draw; one empty point → that point', () => {
    const blacks = [], whites = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) (((x + 2 * y) >> 1) & 1 ? whites : blacks).push(at(x, y));
    const full = [];
    for (let k = 0; k < blacks.length; k++) { full.push(blacks[k]); if (k < whites.length) full.push(whites[k]); }
    const e = createEngine();
    for (const level of ['easy', 'normal', 'hard']) {
      const r = e.think({ moves: full, level });
      assert.equal(r.move, -1);
      assert.equal(r.reason, 'draw');
      const last = full.slice(0, -1);
      assert.equal(e.think({ moves: last, level }).move, full[full.length - 1]);
    }
  });

  test('20. self-play smoke: hard vs normal completes with only legal moves', () => {
    const eh = createEngine(), en = createEngine();
    const moves = [];
    let result = 'none';
    for (let p = 0; p < 225; p++) {
      const black = p % 2 === 0;
      const r = (black ? eh : en).think({ moves, level: black ? 'hard' : 'normal', seed: p, timeMs: black ? 150 : 60 });
      if (r.move < 0) { result = 'draw'; break; }
      const j = judge(moves, r.move);
      assert.ok(j.ok, `illegal ${xy(r.move)} at ply ${p}`);
      moves.push(r.move);
      if (j.win) { result = black ? 'hard' : 'normal'; break; }
    }
    assert.notEqual(result, 'none');
  });

  test('bad requests throw a TypeError (the worker turns it into an error reply)', () => {
    const e = createEngine();
    for (const moves of [undefined, 'x', [1, 1], [225], [-1], [1.5], new Array(226).fill(0)]) {
      assert.throws(() => e.think({ moves, level: 'easy' }), TypeError);
    }
    assert.equal(e.think({ moves: [], level: 'nonsense' }).reason, 'book', 'unknown level → normal');
  });

  test('bench() reports depth and speed for three fixed positions', () => {
    const res = bench({ timeMs: 150 });
    assert.equal(res.length, 3);
    for (const r of res) {
      assert.ok(r.depth >= 1 && r.nodes > 0 && r.knps >= 0, JSON.stringify(r));
      assert.ok(r.ms <= 300);
    }
  });
});

// ---- 21: worker protocol --------------------------------------------------------------------

describe('worker', () => {
  test('21. protocol through self.onmessage: init → ready, think → move with the same id, errors keep the id', async () => {
    const sent = [];
    globalThis.self = { postMessage: (m) => sent.push(m) };
    try {
      await import('../js/ai/worker.js?protocol');
      assert.equal(typeof self.onmessage, 'function');
      self.onmessage({ data: { t: 'init', rules: { overlineWins: false } } });
      assert.deepEqual(sent.shift(), { t: 'ready' });
      self.onmessage({ data: { t: 'think', id: 41, moves: [at(7, 7)], level: 'normal', seed: 1 } });
      const m = sent.shift();
      assert.equal(m.t, 'move');
      assert.equal(m.id, 41);
      assert.ok(judge([at(7, 7)], m.move).ok);
      for (const k of ['reason', 'score', 'depth', 'nodes', 'ms']) assert.ok(k in m, k);
      self.onmessage({ data: { t: 'reset' } });
      assert.equal(sent.length, 0, 'reset has no reply');
      self.onmessage({ data: { t: 'think', id: 42, moves: [3, 3], level: 'easy' } });
      assert.deepEqual(Object.keys(sent[0]).sort(), ['id', 'message', 't']);
      assert.equal(sent.shift().id, 42);
      self.onmessage({ data: { t: 'bogus', id: 43 } });
      assert.equal(sent.shift().t, 'error');
      self.onmessage({ data: null });
      assert.equal(sent.shift().t, 'error');
    } finally {
      delete globalThis.self;
    }
  });
});

// ---- ai-client: worker path, fallback, cancel, visibility (with a mock Worker) --------------

describe('ai-client', () => {
  // A stand-in for the browser's module Worker: runs worker.js's handler asynchronously, the way
  // messages cross threads. `MockWorker.mode` simulates failures.
  class MockWorker {
    static mode = 'ok';           // 'ok' | 'throw' | 'error' | 'hang' | 'illegal'
    static made = [];
    constructor(url, opts) {
      if (MockWorker.mode === 'throw') throw new Error('module workers unsupported');
      assert.equal(opts.type, 'module');
      assert.ok(String(url).endsWith('/js/ai/worker.js'));
      this.mode = MockWorker.mode;
      this.terminated = false;
      this.handle = import(String(url)).then((m) => m.handle);
      MockWorker.made.push(this);
    }
    postMessage(m) {
      const msg = structuredClone(m);
      setTimeout(async () => {
        if (this.terminated) return;
        if (this.mode === 'error') { this.onerror?.({ preventDefault() {} }); return; }
        if (this.mode === 'hang' && msg.t === 'think') return;
        const handle = await this.handle;
        handle(msg, (reply) => {
          if (this.mode === 'illegal' && reply.t === 'move') reply.move = msg.moves.length ? msg.moves[0] : reply.move;
          setTimeout(() => { if (!this.terminated) this.onmessage?.({ data: structuredClone(reply) }); }, 1);
        });
      }, 1);
    }
    terminate() { this.terminated = true; }
  }
  const OPEN = [at(7, 7), at(8, 8), at(7, 8)];
  const isAbort = (e) => e && e.name === 'AbortError';
  const savedWorker = globalThis.Worker;
  after(() => { globalThis.Worker = savedWorker; delete globalThis.document; });

  test('no Worker at all → main-thread fallback with a legal move', async () => {
    delete globalThis.Worker;
    const c = createAiClient();
    const r = await c.think({ moves: OPEN, level: 'hard', seed: 1 });
    assert.equal(r.via, 'main');
    assert.ok(judge(OPEN, r.move).ok);
    assert.ok(r.ms <= 500 + 150, 'fallback budget is capped');
    c.dispose();
  });

  test('worker path: legal move, ids, warm(), reset()', async () => {
    globalThis.Worker = MockWorker; MockWorker.mode = 'ok'; MockWorker.made = [];
    const c = createAiClient({ overlineWins: true });
    assert.equal(await c.warm(), true);
    const r = await c.think({ moves: OPEN, level: 'normal', seed: 2 });
    assert.equal(r.via, 'worker');
    assert.ok(judge(OPEN, r.move, RULES_OW).ok);
    c.reset();
    const r2 = await c.think({ moves: [...OPEN, r.move], level: 'easy', seed: 3 });
    assert.ok(judge([...OPEN, r.move], r2.move, RULES_OW).ok);
    assert.equal(MockWorker.made.length, 1, 'one worker serves many requests');
    c.dispose();
    assert.ok(MockWorker.made[0].terminated);
  });

  test('a newer request cancels the older one; cancel() aborts and terminates a busy worker', async () => {
    globalThis.Worker = MockWorker; MockWorker.mode = 'ok'; MockWorker.made = [];
    const c = createAiClient();
    await c.warm();
    const first = c.think({ moves: OPEN, level: 'hard', seed: 4 });
    const second = c.think({ moves: OPEN, level: 'easy', seed: 5 });
    await assert.rejects(first, isAbort);
    const r = await second;
    assert.ok(judge(OPEN, r.move).ok);
    const third = c.think({ moves: OPEN, level: 'hard', seed: 6 });
    await new Promise((res) => setTimeout(res, 5));
    c.cancel();
    await assert.rejects(third, (e) => isAbort(e) && e.message === 'cancelled');
    assert.ok(MockWorker.made.some((w) => w.terminated), 'busy worker terminated');
    const r4 = await c.think({ moves: OPEN, level: 'easy', seed: 7 });
    assert.equal(r4.via, 'worker', 'respawned');
    c.dispose();
  });

  test('Worker constructor throws → fallback', async () => {
    globalThis.Worker = MockWorker; MockWorker.mode = 'throw';
    const c = createAiClient();
    assert.equal(await c.warm(), false);
    const r = await c.think({ moves: OPEN, level: 'easy', seed: 8 });
    assert.equal(r.via, 'main');
    c.dispose();
  });

  test('Worker fails to load (error event) → fallback, and stays on the main thread', async () => {
    globalThis.Worker = MockWorker; MockWorker.mode = 'error'; MockWorker.made = [];
    const c = createAiClient();
    const r = await c.think({ moves: OPEN, level: 'easy', seed: 9 });
    assert.equal(r.via, 'main');
    MockWorker.mode = 'ok';
    const r2 = await c.think({ moves: OPEN, level: 'easy', seed: 9 });
    assert.equal(r2.via, 'main');
    assert.equal(MockWorker.made.length, 1);
    c.dispose();
  });

  test('an illegal answer from the worker is never passed on', async () => {
    globalThis.Worker = MockWorker; MockWorker.mode = 'illegal';
    const c = createAiClient();
    const r = await c.think({ moves: OPEN, level: 'easy', seed: 10 });
    assert.equal(r.via, 'main');
    assert.ok(judge(OPEN, r.move).ok);
    assert.ok(r.error);
    c.dispose();
  });

  test('a hung worker is replaced by the fallback after timeMs + grace', async () => {
    globalThis.Worker = MockWorker; MockWorker.mode = 'hang';
    const c = createAiClient();
    const t0 = Date.now();
    const r = await c.think({ moves: OPEN, level: 'easy', seed: 11, timeMs: 20 });
    assert.equal(r.via, 'main');
    assert.ok(judge(OPEN, r.move).ok);
    assert.ok(Date.now() - t0 < 5000);
    c.dispose();
  });

  test('app hidden → the search is cancelled (AbortError "hidden")', async () => {
    globalThis.Worker = MockWorker; MockWorker.mode = 'ok';
    const listeners = {};
    globalThis.document = {
      visibilityState: 'visible',
      addEventListener: (t, f) => { listeners[t] = f; },
      removeEventListener: (t, f) => { if (listeners[t] === f) delete listeners[t]; },
    };
    const c = createAiClient();
    await c.warm();
    const p = c.think({ moves: OPEN, level: 'hard', seed: 12 });
    await new Promise((res) => setTimeout(res, 5));
    document.visibilityState = 'hidden';
    listeners.visibilitychange();
    await assert.rejects(p, (e) => isAbort(e) && e.message === 'hidden');
    await assert.rejects(c.think({ moves: OPEN, level: 'easy' }), (e) => isAbort(e) && e.message === 'hidden', 'no search starts while hidden');
    document.visibilityState = 'visible';
    const r = await c.think({ moves: OPEN, level: 'easy', seed: 13 });
    assert.ok(judge(OPEN, r.move).ok);
    c.dispose();
    assert.equal(listeners.visibilitychange, undefined, 'dispose removes the listener');
  });

  test('update pending (a new version owns the cache): a live Worker keeps serving, no new one is spawned', async () => {
    // Review finding 26: a Worker spawned after the update would run the NEXT version's worker.js
    // and engine.js inside this page. The page's own engine (a static import) plays instead.
    globalThis.Worker = MockWorker; MockWorker.mode = 'ok'; MockWorker.made = [];
    let pending = false;
    const c = createAiClient({ updatePending: () => pending });
    assert.equal(await c.warm(), true);
    pending = true;
    const r = await c.think({ moves: OPEN, level: 'easy', seed: 21 });
    assert.equal(r.via, 'worker', 'the live Worker (this version) is reused');
    const p = c.think({ moves: OPEN, level: 'hard', seed: 22 });
    await new Promise((res) => setTimeout(res, 5));
    c.cancel();                                         // mid-search: the busy Worker has to go…
    await assert.rejects(p, isAbort);
    assert.ok(MockWorker.made[0].terminated);
    const r2 = await c.think({ moves: OPEN, level: 'hard', seed: 23 });
    assert.equal(r2.via, 'main', '…and is not replaced while the update is pending');
    assert.ok(judge(OPEN, r2.move).ok);
    assert.ok(r2.ms <= 500 + 150, 'fallback budget');
    assert.equal(await c.warm(), false, 'warm() does not spawn either');
    assert.equal(MockWorker.made.length, 1, 'no second Worker');
    c.dispose();
    const c2 = createAiClient({ updatePending: () => pending });   // the next battle in the same page
    const r3 = await c2.think({ moves: OPEN, level: 'easy', seed: 24 });
    assert.equal(r3.via, 'main');
    assert.equal(MockWorker.made.length, 1);
    c2.dispose();
    pending = false;                                    // after the reload: Workers again
    const c3 = createAiClient({ updatePending: () => pending });
    assert.equal((await c3.think({ moves: OPEN, level: 'easy', seed: 25 })).via, 'worker');
    c3.dispose();
    // Nothing loaded lazily on the main thread: the fallback engine is the page's own version.
    const src = fs.readFileSync(new URL('../js/ai-client.js', import.meta.url), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/\bimport\(/.test(src), 'no dynamic import() in ai-client.js');
    assert.match(src, /^import \{ createEngine \} from '\.\/ai\/engine\.js';$/m);
  });

  test('dispose() rejects the request in flight; bad moves reject with TypeError; full board → draw', async () => {
    globalThis.Worker = MockWorker; MockWorker.mode = 'ok';
    const c = createAiClient();
    const p = c.think({ moves: OPEN, level: 'hard', seed: 14 });
    c.dispose();
    await assert.rejects(p, (e) => isAbort(e) && e.message === 'disposed');
    await assert.rejects(c.think({ moves: [1, 1], level: 'easy' }), TypeError);
    const blacks = [], whites = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) (((x + 2 * y) >> 1) & 1 ? whites : blacks).push(at(x, y));
    const full = [];
    for (let k = 0; k < blacks.length; k++) { full.push(blacks[k]); if (k < whites.length) full.push(whites[k]); }
    const r = await c.think({ moves: full, level: 'easy' });
    assert.equal(r.move, -1);
    assert.equal(r.reason, 'draw');
    c.dispose();
  });
});
