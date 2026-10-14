// Match state machine tests (js/match.js, SPEC §2 and §8.1). Run: node --test tests/match.test.js
// Positions are built through play() only, so every board here was reached by legal moves.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { N, BLACK, WHITE, EMPTY, judgeMove } from '../js/rules.js';
import {
  FORMATS, createMatch, rulesOf, needOf, colorOf, playerOf, toMove, boardOf, canPlace, play, undo, undoLeft,
  resignRound, forfeitMatch, timeoutRound, nextRound, rematch, matchPoint, isFinalRound, legalMoves,
  summary, serialize, deserialize,
} from '../js/match.js';

const at = (x, y) => y * N + x;

// The winner's stones go on row 7 (x = 3..7), the loser's on row 0 at x = 0,2,4,6,8: spaced
// X.X.X.X.X never forms a three or a five, so the loser never blocks or wins by accident.
const WIN_CELLS = [3, 4, 5, 6, 7].map((x) => at(x, 7));
const LOSE_CELLS = [0, 2, 4, 6, 8].map((x) => at(x, 0));

function winRound(s, winner) {
  let wi = 0, li = 0, r = null;
  while (s.status === 'playing') {
    r = play(s, toMove(s) === winner ? WIN_CELLS[wi++] : LOSE_CELLS[li++]);
    assert.ok(r.ok, `setup move failed: ${r.reason}`);
  }
  assert.equal(r.how, 'five');
  return r;
}

// Plays rounds with the given winners (1|2|0 = resign-free draw is not cheap, so 0 = skip),
// calling nextRound between them.
function playRounds(s, winners) {
  for (const w of winners) {
    if (s.status === 'roundOver') nextRound(s);
    winRound(s, w);
  }
  return s;
}

// A full-board fill with no five and no three for either colour at any point: colour =
// ((x + 2y) >> 1) & 1 gives every 4-cell window on every line exactly two stones of each
// colour. 113 cells are black (colour 0), 112 white — exactly a full game's split.
function fullBoardOrder() {
  const blacks = [], whites = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) (((x + 2 * y) >> 1) & 1 ? whites : blacks).push(at(x, y));
  const order = [];
  for (let k = 0; k < blacks.length; k++) { order.push(blacks[k]); if (k < whites.length) order.push(whites[k]); }
  return order;
}

// Black stones that leave (7,7) as a double three for black (two open threes, H and V).
// White plays spaced stones on column 0. Black to move afterwards.
function threeThreeSetup(s) {
  const B = [at(7, 5), at(7, 6), at(5, 7), at(6, 7)];
  const W = [at(0, 0), at(0, 2), at(0, 4), at(0, 6)];
  for (let k = 0; k < 4; k++) { assert.ok(play(s, B[k]).ok); assert.ok(play(s, W[k]).ok); }
}

const base = (extra = {}) => createMatch({ mode: '2p', bestOf: 3, p1: 'bigom', p2: 'nyangja', round1Black: 1, firstRule: 'loser', overlineWins: false, timer: 0, undoLimit: 1, ...extra });
const cpu = (extra = {}) => createMatch({ mode: 'cpu', bestOf: 3, p1: 'bigom', p2: 'ppibik', cpuLevel: 'hard', round1Black: 1, firstRule: 'loser', overlineWins: false, timer: 0, undoLimit: 3, ...extra });

describe('construction', () => {
  test('FORMATS: need = (bestOf+1)/2, labels, frozen', () => {
    for (const bo of [1, 3, 5, 7]) assert.equal(FORMATS[bo].need, (bo + 1) / 2);
    assert.equal(FORMATS[3].label, '3판 2선승');
    assert.ok(Object.isFrozen(FORMATS) && Object.isFrozen(FORMATS[5]));
  });

  test('createMatch: SPEC state shape', () => {
    const s = base();
    assert.deepEqual(s, {
      v: 1,
      cfg: { mode: '2p', bestOf: 3, p1: 'bigom', p2: 'nyangja', cpuLevel: null, cpuPlayer: null, round1Black: 1, firstRule: 'loser', overlineWins: false, timer: 0, undoLimit: 1 },
      round: 1, score: [0, 0], rounds: [], black: 1, moves: [], status: 'playing', undoUsed: { 1: 0, 2: 0 },
      winner: null, forfeit: null, lastLine: null,
    });
  });

  test('createMatch: invalid values fall back to defaults; CPU always sits in slot 2', () => {
    const s = createMatch({ mode: 'x', bestOf: 4, p1: 'Bad Id', p2: 7, round1Black: 3, firstRule: '?', overlineWins: 'yes', timer: 15, undoLimit: -2 });
    assert.deepEqual(s.cfg, { mode: '2p', bestOf: 3, p1: 'bigom', p2: 'nyangja', cpuLevel: null, cpuPlayer: null, round1Black: 1, firstRule: 'loser', overlineWins: false, timer: 0, undoLimit: 1 });
    const c = createMatch({ mode: 'cpu', cpuLevel: 'insane', cpuPlayer: 1 });
    assert.equal(c.cfg.cpuLevel, 'normal');
    assert.equal(c.cfg.cpuPlayer, 2);
    assert.equal(c.cfg.undoLimit, 3);
    assert.deepEqual(createMatch().cfg, createMatch(null).cfg);
    assert.equal(createMatch({ undoLimit: -1 }).cfg.undoLimit, -1);
    assert.equal(createMatch({ undoLimit: 0 }).cfg.undoLimit, 0);
  });

  test('createMatch: independent objects', () => {
    const a = base(), b = base();
    play(a, at(7, 7));
    assert.equal(b.moves.length, 0);
    assert.notEqual(a.cfg, b.cfg);
  });

  test('rulesOf carries overlineWins and the frozen defaults', () => {
    assert.equal(rulesOf(base()).overlineWins, false);
    const r = rulesOf(base({ overlineWins: true }));
    assert.equal(r.overlineWins, true);
    assert.equal(r.doubleThree, 'both');
    assert.equal(r.fakeThreeCheck, true);
    assert.equal(needOf(createMatch({ bestOf: 7 })), 4);
  });
});

describe('turns and colours', () => {
  test('round 1 black comes from cfg; colours alternate from black', () => {
    for (const rb of [1, 2]) {
      const s = base({ round1Black: rb });
      assert.equal(s.black, rb);
      assert.equal(colorOf(s, rb), BLACK);
      assert.equal(colorOf(s, 3 - rb), WHITE);
      assert.equal(playerOf(s, BLACK), rb);
      assert.equal(playerOf(s, WHITE), 3 - rb);
      assert.equal(toMove(s), rb);
      play(s, at(7, 7));
      assert.equal(toMove(s), 3 - rb);
    }
  });

  test('boardOf replays moves (black first)', () => {
    const s = base();
    play(s, at(7, 7)); play(s, at(8, 8)); play(s, at(1, 2));
    const b = boardOf(s);
    assert.equal(b.length, 225);
    assert.equal(b[at(7, 7)], BLACK);
    assert.equal(b[at(8, 8)], WHITE);
    assert.equal(b[at(1, 2)], BLACK);
    assert.equal(b.reduce((n, v) => n + (v !== EMPTY), 0), 3);
  });
});

describe('play and canPlace', () => {
  test('occupied and out-of-range points are refused without changing state', () => {
    const s = base();
    play(s, at(7, 7));
    for (const idx of [at(7, 7), -1, 225, 3.5, '7', null, undefined, NaN]) {
      assert.deepEqual(play(s, idx), { ok: false, reason: 'occupied' });
      assert.equal(canPlace(s, idx).reason, 'occupied');
    }
    assert.equal(s.moves.length, 1);
  });

  test('3-3 is refused for black and for white (rules.judgeMove)', () => {
    const s = base();
    threeThreeSetup(s);
    assert.deepEqual(canPlace(s, at(7, 7)), { ok: false, reason: '33' });
    assert.deepEqual(play(s, at(7, 7)), { ok: false, reason: '33' });
    assert.equal(s.moves.length, 8);

    // Same shape for white: black opens elsewhere first so white has the 3-3 point.
    const w = base();
    assert.ok(play(w, at(14, 14)).ok);
    const W = [at(7, 5), at(7, 6), at(5, 7), at(6, 7)], B = [at(14, 12), at(14, 10), at(14, 8), at(14, 6)];
    for (let k = 0; k < 4; k++) { assert.ok(play(w, W[k]).ok); assert.ok(play(w, B[k]).ok); }
    assert.equal(colorOf(w, toMove(w)), WHITE);
    assert.equal(play(w, at(7, 7)).reason, '33');
  });

  test('a legal move returns the non-ending result shape', () => {
    const s = base();
    assert.deepEqual(play(s, at(7, 7)), {
      ok: true, win: false, line: null, overline: false, draw: false, roundOver: false, matchOver: false, winner: null, how: null,
    });
    assert.deepEqual(canPlace(s, at(8, 8)), { ok: true, win: false, line: null, overline: false });
  });

  test('five ends the round: score, record, line', () => {
    const s = base();
    const r = winRound(s, 1);
    assert.equal(r.win, true);
    assert.equal(r.roundOver, true);
    assert.equal(r.matchOver, false);
    assert.equal(r.winner, 1);
    assert.equal(r.line.length, 5);
    assert.deepEqual(r.line, [[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]]);
    assert.deepEqual(s.lastLine, r.line);
    assert.equal(s.status, 'roundOver');
    assert.deepEqual(s.score, [1, 0]);
    assert.deepEqual(s.rounds, [{ winner: 1, how: 'five', moves: 9, black: 1 }]);
    assert.deepEqual(play(s, at(10, 10)), { ok: false, reason: 'over' });
    assert.deepEqual(canPlace(s, at(10, 10)), { ok: false, reason: 'over' });
    assert.equal(s.moves.length, 9, 'board stays for the round-result screen');
  });

  test('white can win too (round records the winner, not the colour)', () => {
    const s = base();
    const r = winRound(s, 2);
    assert.equal(r.winner, 2);
    assert.deepEqual(s.rounds[0], { winner: 2, how: 'five', moves: 10, black: 1 });
  });

  test('overline: legal, flagged, not a win — unless overlineWins', () => {
    for (const ow of [false, true]) {
      const s = base({ overlineWins: ow });
      const B = [at(2, 7), at(3, 7), at(4, 7), at(5, 7), at(7, 7)];
      const W = [at(0, 0), at(0, 2), at(0, 4), at(0, 6), at(0, 8)];
      for (let k = 0; k < 5; k++) { assert.ok(play(s, B[k]).ok); assert.ok(play(s, W[k]).ok); }
      const r = play(s, at(6, 7));          // 2..7 = six in a row
      assert.equal(r.ok, true);
      assert.equal(r.win, ow);
      assert.equal(r.overline, !ow);
      assert.equal(r.roundOver, ow);
      if (ow) assert.equal(r.line.length, 6);
    }
  });

  test('draw on a full board: no pip, record winner 0, board kept', () => {
    const s = base();
    const order = fullBoardOrder();
    let r;
    for (let k = 0; k < order.length; k++) {
      r = play(s, order[k]);
      assert.equal(r.ok, true, `move ${k}`);
      if (k < order.length - 1) assert.equal(r.roundOver, false, `move ${k} ended the round`);
    }
    assert.equal(r.draw, true);
    assert.equal(r.winner, 0);
    assert.equal(r.how, 'draw');
    assert.equal(s.status, 'roundOver');
    assert.deepEqual(s.score, [0, 0]);
    assert.deepEqual(s.rounds, [{ winner: 0, how: 'draw', moves: 225, black: 1 }]);
    assert.deepEqual(legalMoves(s), []);
  });

  test('legalMoves excludes occupied and forbidden points', () => {
    const s = base();
    assert.equal(legalMoves(s).length, 225);
    threeThreeSetup(s);
    const lm = legalMoves(s);
    assert.equal(lm.length, 225 - 8 - 1);
    assert.ok(!lm.includes(at(7, 7)));
  });
});

describe('formats and next-round colours', () => {
  for (const bestOf of [1, 3, 5, 7]) {
    test(`bestOf ${bestOf}: match ends at ${(bestOf + 1) / 2} wins`, () => {
      const s = base({ bestOf });
      const need = (bestOf + 1) / 2;
      for (let k = 0; k < need; k++) {
        if (k) { assert.equal(s.status, 'roundOver'); nextRound(s); }
        const r = winRound(s, 2);
        assert.equal(r.matchOver, k === need - 1);
      }
      assert.equal(s.status, 'matchOver');
      assert.equal(s.winner, 2);
      assert.deepEqual(s.score, [0, need]);
      assert.equal(s.round, need);
      assert.equal(nextRound(s), s, 'nextRound is a no-op after the match');
      assert.equal(s.status, 'matchOver');
    });
  }

  test("firstRule 'loser': the round's loser takes black", () => {
    const s = base({ bestOf: 7, firstRule: 'loser', round1Black: 1 });
    winRound(s, 1); nextRound(s);
    assert.equal(s.black, 2);
    assert.equal(s.round, 2);
    winRound(s, 1); nextRound(s);
    assert.equal(s.black, 2, 'P2 lost again, stays black');
    winRound(s, 2); nextRound(s);
    assert.equal(s.black, 1);
    assert.deepEqual(s.rounds.map((r) => r.black), [1, 2, 2]);
  });

  test("firstRule 'alternate': colours swap every round whoever wins", () => {
    const s = base({ bestOf: 7, firstRule: 'alternate', round1Black: 2 });
    winRound(s, 1); nextRound(s);
    assert.equal(s.black, 1);
    winRound(s, 2); nextRound(s);
    assert.equal(s.black, 2);
    winRound(s, 2); nextRound(s);
    assert.equal(s.black, 1);
  });

  for (const firstRule of ['loser', 'alternate']) {
    test(`draw swaps colours (${firstRule}), round number still advances`, () => {
      const s = base({ firstRule, round1Black: 1 });
      for (const i of fullBoardOrder()) play(s, i);
      assert.equal(s.status, 'roundOver');
      nextRound(s);
      assert.equal(s.round, 2);
      assert.equal(s.black, 2);
      assert.deepEqual(s.moves, []);
      assert.deepEqual(s.score, [0, 0]);
    });
  }

  test('nextRound resets the undo allowance and the last line', () => {
    const s = base({ undoLimit: 1 });
    play(s, at(9, 9));
    assert.ok(undo(s, 1).ok);
    assert.equal(undoLeft(s, 1), 0);
    winRound(s, 1);
    assert.ok(s.lastLine);
    nextRound(s);
    assert.equal(undoLeft(s, 1), 1);
    assert.equal(s.lastLine, null);
    assert.equal(nextRound(s), s, 'no-op while playing');
    assert.equal(s.round, 2);
  });

  test('rematch: same cfg, previous match loser takes black in round 1', () => {
    for (const winner of [1, 2]) {
      const s = base({ bestOf: 1, round1Black: winner });
      winRound(s, winner);
      const r = rematch(s);
      assert.equal(r.status, 'playing');
      assert.equal(r.round, 1);
      assert.equal(r.black, 3 - winner);
      assert.equal(r.cfg.round1Black, 3 - winner);
      assert.deepEqual({ ...r.cfg, round1Black: 0 }, { ...s.cfg, round1Black: 0 });
      assert.deepEqual(r.score, [0, 0]);
      assert.notEqual(r.cfg, s.cfg);
    }
  });
});

describe('match point', () => {
  test('bestOf 3: one win away; both = final round', () => {
    const s = base();
    assert.equal(matchPoint(s, 1), false);
    winRound(s, 1);
    assert.equal(matchPoint(s, 1), true, 'visible on the round result screen too');
    assert.equal(matchPoint(s, 2), false);
    assert.equal(isFinalRound(s), false);
    nextRound(s);
    winRound(s, 2);
    nextRound(s);
    assert.equal(isFinalRound(s), true);
    winRound(s, 1);
    assert.equal(s.status, 'matchOver');
    assert.equal(matchPoint(s, 2), false, 'nothing is on match point after the match');
    assert.equal(isFinalRound(s), false);
  });

  test('bestOf 1 has no match point / final round', () => {
    const s = base({ bestOf: 1 });
    assert.equal(matchPoint(s, 1), false);
    assert.equal(isFinalRound(s), false);
  });

  test('bestOf 7: match point at 3 wins', () => {
    const s = playRounds(base({ bestOf: 7 }), [1, 1, 1]);
    assert.equal(matchPoint(s, 1), true);
    assert.equal(matchPoint(s, 2), false);
    assert.equal(matchPoint(s, 3), false);
  });
});

describe('undo — 2P', () => {
  test("only the player's own last stone, before the opponent replies", () => {
    const s = base({ undoLimit: 3 });
    assert.deepEqual(undo(s, 1), { ok: false, removed: [], reason: 'none' });
    play(s, at(7, 7));                                     // 1P black
    assert.equal(undo(s, 2).reason, 'none', '2P has no stone yet');
    play(s, at(8, 8));                                     // 2P white replied
    assert.equal(undo(s, 1).reason, 'notYours');
    assert.deepEqual(undo(s, 2), { ok: true, removed: [at(8, 8)] });
    assert.deepEqual(s.moves, [at(7, 7)]);
    assert.equal(toMove(s), 2);
    assert.deepEqual(undo(s, 1), { ok: true, removed: [at(7, 7)] });
    assert.deepEqual(s.moves, []);
    assert.deepEqual(s.undoUsed, { 1: 1, 2: 1 });
  });

  test('second player as black: none until they moved', () => {
    const s = base({ round1Black: 2 });
    play(s, at(7, 7));                                     // 2P black
    assert.equal(undo(s, 1).reason, 'none');
    assert.ok(undo(s, 2).ok);
  });

  test('per-round limit (1 by default), 0 = off, -1 = unlimited', () => {
    const s = base({ undoLimit: 1 });
    assert.equal(undoLeft(s, 1), 1);
    play(s, at(7, 7));
    assert.ok(undo(s, 1).ok);
    play(s, at(7, 7));
    assert.deepEqual(undo(s, 1), { ok: false, removed: [], reason: 'limit' });
    assert.equal(undoLeft(s, 1), 0);
    assert.equal(undoLeft(s, 2), 1, 'limits are per player');

    const off = base({ undoLimit: 0 });
    play(off, at(7, 7));
    assert.equal(undo(off, 1).reason, 'limit');

    const inf = base({ undoLimit: -1 });
    assert.equal(undoLeft(inf, 1), Infinity);
    for (let k = 0; k < 20; k++) { play(inf, at(7, 7)); assert.ok(undo(inf, 1).ok); }
    assert.equal(undoLeft(inf, 1), Infinity);
  });

  test('no undo once the round is over (K.O., resign, timeout)', () => {
    const s = base({ undoLimit: -1 });
    winRound(s, 1);
    assert.equal(undo(s, 1).reason, 'over');
    assert.equal(s.moves.length, 9);
    nextRound(s);
    play(s, at(7, 7));
    resignRound(s, 1);
    assert.equal(undo(s, 2).reason, 'over');
  });

  test('bad player ids are refused', () => {
    const s = base();
    play(s, at(7, 7));
    assert.equal(undo(s, 3).ok, false);
    assert.equal(undo(s, '1').ok, false);
    assert.equal(undoLeft(s, 0), 0);
  });
});

describe('undo — CPU', () => {
  test('human black: removes human stone + CPU reply, or just the human stone', () => {
    const s = cpu({ round1Black: 1 });
    play(s, at(7, 7));                                     // human
    play(s, at(8, 8));                                     // CPU
    assert.deepEqual(undo(s, 1), { ok: true, removed: [at(8, 8), at(7, 7)] });
    assert.deepEqual(s.moves, []);
    play(s, at(7, 7));                                     // human; CPU still thinking
    assert.deepEqual(undo(s, 1), { ok: true, removed: [at(7, 7)] });
    assert.equal(s.undoUsed[1], 2);
    assert.equal(undoLeft(s, 1), 1);
  });

  test('human white: the CPU opening stone alone cannot be undone', () => {
    const s = cpu({ round1Black: 2 });
    play(s, at(7, 7));                                     // CPU black
    assert.equal(undo(s, 1).reason, 'none');
    play(s, at(8, 8));                                     // human
    assert.deepEqual(undo(s, 1), { ok: true, removed: [at(8, 8)] });
    play(s, at(8, 8)); play(s, at(6, 6));                  // human, CPU
    assert.deepEqual(undo(s, 1), { ok: true, removed: [at(6, 6), at(8, 8)] });
    assert.deepEqual(s.moves, [at(7, 7)]);
    assert.equal(toMove(s), 1, "human's turn again");
  });

  test('the CPU never undoes; limit 3 by default', () => {
    const s = cpu();
    play(s, at(7, 7)); play(s, at(8, 8));
    assert.equal(undo(s, 2).reason, 'notYours');
    assert.equal(undoLeft(s, 2), 0);
    for (let k = 0; k < 3; k++) { assert.ok(undo(s, 1).ok); play(s, at(7, 7)); play(s, at(8, 8)); }
    assert.equal(undo(s, 1).reason, 'limit');
  });
});

describe('resign, timeout, forfeit', () => {
  test('resignRound gives the round to the opponent', () => {
    const s = base();
    play(s, at(7, 7));
    const r = resignRound(s, 1);
    assert.deepEqual(r, { ok: true, win: false, line: null, overline: false, draw: false, roundOver: true, matchOver: false, winner: 2, how: 'resign' });
    assert.deepEqual(s.rounds[0], { winner: 2, how: 'resign', moves: 1, black: 1 });
    assert.deepEqual(s.score, [0, 1]);
    assert.equal(resignRound(s, 1).reason, 'over');
    nextRound(s);
    assert.equal(s.black, 1, 'the resigning loser takes black');
    assert.equal(resignRound(s, 5).ok, false);
  });

  test('resign can end the match', () => {
    const s = base({ bestOf: 1 });
    const r = resignRound(s, 2);
    assert.equal(r.matchOver, true);
    assert.equal(s.winner, 1);
    assert.equal(s.forfeit, null);
  });

  test('timeoutRound: only the player to move', () => {
    const s = base();
    assert.deepEqual(timeoutRound(s, 2), { ok: false, reason: 'turn' });
    const r = timeoutRound(s, 1);
    assert.equal(r.how, 'timeout');
    assert.equal(r.winner, 2);
    assert.deepEqual(s.rounds[0], { winner: 2, how: 'timeout', moves: 0, black: 1 });
    assert.equal(timeoutRound(s, 2).reason, 'over');
  });

  test('forfeitMatch mid-round: match lost, unfinished round not recorded', () => {
    const s = playRounds(base({ bestOf: 5 }), [1]);
    nextRound(s);
    play(s, at(7, 7));
    const r = forfeitMatch(s, 1);
    assert.deepEqual(r, { ok: true, win: false, line: null, overline: false, draw: false, roundOver: true, matchOver: true, winner: 2, how: 'forfeit' });
    assert.equal(s.status, 'matchOver');
    assert.equal(s.winner, 2);
    assert.equal(s.forfeit, 1);
    assert.deepEqual(s.score, [1, 0]);
    assert.equal(s.rounds.length, 1);
    assert.equal(forfeitMatch(s, 2).reason, 'over');
    assert.equal(play(s, at(1, 1)).reason, 'over');
    const sum = summary(s);
    assert.equal(sum.winner, 2);
    assert.equal(sum.forfeit, 1);
    assert.equal(sum.perfect, false);
    assert.equal(sum.comeback, false);
  });

  test('forfeitMatch between rounds is allowed', () => {
    const s = playRounds(base(), [2]);
    assert.equal(forfeitMatch(s, 2).winner, 1);
    assert.equal(s.status, 'matchOver');
  });
});

describe('summary', () => {
  test('fields, fastestKO (2P: any five), longestRound, perfect', () => {
    const s = base({ bestOf: 3 });
    play(s, at(12, 12)); resignRound(s, 2);               // R1: 1P by resign, 1 stone
    nextRound(s);                                         // 2P black
    winRound(s, 1);                                       // R2: 1P five as white: 10 stones
    const sum = summary(s);
    assert.deepEqual(sum, {
      mode: '2p', bestOf: 3, p1: 'bigom', p2: 'nyangja', score: [2, 0], winner: 1, forfeit: null,
      rounds: [{ winner: 1, how: 'resign', moves: 1, black: 1 }, { winner: 1, how: 'five', moves: 10, black: 2 }],
      fastestKO: 10, longestRound: 10, perfect: true, comeback: false,
    });
    sum.rounds[0].moves = 99;
    assert.equal(s.rounds[0].moves, 1, 'summary rounds are copies');
  });

  test('fastestKO in CPU mode counts only rounds the human won', () => {
    const s = cpu({ bestOf: 3 });
    winRound(s, 2);                                       // CPU five, 10 stones
    nextRound(s);
    winRound(s, 1);                                       // human five
    const k = s.rounds[1].moves;
    nextRound(s);
    winRound(s, 1);
    const sum = summary(s);
    assert.equal(sum.level, 'hard');
    assert.equal(sum.fastestKO, Math.min(k, s.rounds[2].moves));
    assert.equal(sum.perfect, false);
    const lost = cpu({ bestOf: 1 });
    winRound(lost, 2);
    assert.equal(summary(lost).fastestKO, null);
  });

  test('perfect needs bestOf >= 3; draws do not spoil it', () => {
    assert.equal(summary(playRounds(base({ bestOf: 1 }), [1])).perfect, false);
    const s = base({ bestOf: 3 });
    for (const i of fullBoardOrder()) play(s, i);       // R1 draw
    nextRound(s);
    playRounds(s, [2, 2]);
    assert.equal(summary(s).perfect, true);
    assert.equal(summary(playRounds(base({ bestOf: 5 }), [1, 2, 1, 1])).perfect, false);
  });

  test('comeback (역전승): trailing by 2, or the opponent was on match point', () => {
    const cases = [
      [3, [2, 1, 1], true],          // 0:1 → 2:1  (opponent on match point)
      [3, [1, 2, 1], false],         // never trailed
      [5, [2, 2, 1, 1, 1], true],    // 0:2 → 3:2
      [5, [2, 1, 1, 1], false],      // 0:1 → 3:1  (opponent never on match point)
      [5, [1, 2, 2, 1, 1], true],    // 1:2 → 3:2  (opponent on match point)
      [7, [2, 2, 1, 1, 1, 1], true], // 0:2 → 4:2  (deficit 2)
      [7, [2, 1, 2, 1, 1, 1], false],
    ];
    for (const [bestOf, winners, expect] of cases) {
      const s = playRounds(base({ bestOf }), winners);
      assert.equal(s.status, 'matchOver', winners.join());
      assert.equal(summary(s).comeback, expect, `${bestOf}: ${winners.join()}`);
    }
  });

  test('unfinished match: winner null, no badges', () => {
    const sum = summary(playRounds(base(), [1]));
    assert.equal(sum.winner, null);
    assert.equal(sum.perfect, false);
    assert.equal(sum.comeback, false);
  });
});

describe('serialize / deserialize', () => {
  const roundTrip = (s) => {
    const json = serialize(s);
    const back = deserialize(json);
    assert.ok(back, `restore failed for status ${s.status}`);
    assert.deepEqual(back, s);
    assert.equal(serialize(back), json);
    assert.deepEqual(deserialize(JSON.parse(json)), s, 'accepts an already-parsed object');
    return back;
  };

  test('round trip in every status', () => {
    const s = base({ bestOf: 5, undoLimit: 3 });
    roundTrip(s);
    play(s, at(7, 7)); play(s, at(8, 8)); undo(s, 2); play(s, at(8, 6));
    roundTrip(s);
    winRound(nextRound(resignRound(s, 1) && s), 2);       // R1 resign, R2 five
    roundTrip(s);                                         // roundOver after five (lastLine recomputed)
    nextRound(s);
    for (const i of fullBoardOrder()) play(s, i);        // R3 draw
    roundTrip(s);
    nextRound(s);
    play(s, at(7, 7));
    timeoutRound(s, 2);                                   // R4 timeout
    roundTrip(s);
    nextRound(s);
    winRound(s, 2);                                       // 2P: 3 wins
    assert.equal(s.status, 'matchOver');
    roundTrip(s);
  });

  test('round trip: CPU match, forfeits, overline rules', () => {
    const c = cpu({ cpuLevel: 'easy', overlineWins: true, round1Black: 2 });
    play(c, at(7, 7)); play(c, at(6, 6));
    roundTrip(c);
    forfeitMatch(c, 1);
    roundTrip(c);
    const f = playRounds(base(), [1]);
    forfeitMatch(f, 1);                                   // forfeited between rounds
    roundTrip(f);
  });

  test('a restored state keeps working', () => {
    const s = base();
    play(s, at(7, 7));
    const back = deserialize(serialize(s));
    assert.ok(undo(back, 1).ok);
    winRound(back, 2);
    assert.deepEqual(back.score, [0, 1]);
  });

  test('extra fields are dropped on save and ignored on load', () => {
    const s = base();
    s.uiScratch = { big: 'x' };
    assert.ok(!serialize(s).includes('uiScratch'));
    const raw = JSON.parse(serialize(base()));
    raw.junk = 1; raw.cfg.extra = 2;
    const back = deserialize(raw);
    assert.ok(back);
    assert.ok(!('junk' in back) && !('extra' in back.cfg));
  });

  test('bad or old data → null, never throws', () => {
    const good = () => JSON.parse(serialize(playRounds(base({ bestOf: 5 }), [1])));
    const bad = [
      undefined, null, '', 'null', '[]', '{', '42', 'true', 7, [], {},
      JSON.stringify({ ...good(), v: 2 }),
      JSON.stringify({ ...good(), v: '1' }),
    ];
    const mutations = [
      (s) => { delete s.cfg; },
      (s) => { s.cfg.mode = 'online'; },
      (s) => { s.cfg.bestOf = 4; },
      (s) => { s.cfg.p1 = '<img>'; },
      (s) => { s.cfg.cpuLevel = 'hard'; },                   // 2P match with a CPU level
      (s) => { s.cfg.undoLimit = 1000; },
      (s) => { s.cfg.timer = 15; },
      (s) => { s.cfg.overlineWins = 0; },
      (s) => { s.score = [2, 0]; },                           // disagrees with rounds
      (s) => { s.score = [1]; },
      (s) => { s.round = 0; },
      (s) => { s.round = 3; },                                // rounds/round mismatch
      (s) => { s.status = 'paused'; },
      (s) => { s.status = 'playing'; },                       // roundOver board kept but marked playing
      (s) => { s.black = 2; },                                // wrong colour for this round
      (s) => { s.rounds[0].black = 2; },                      // round 1 black ≠ cfg.round1Black
      (s) => { s.rounds[0].how = 'ko'; },
      (s) => { s.rounds[0].winner = 0; },                     // draw that is not 'draw'
      (s) => { s.rounds[0].moves = 4; },                      // five with too few stones
      (s) => { s.rounds[0].moves = 10; },                     // five's colour ≠ winner's colour
      (s) => { s.moves = s.moves.slice(0, -1); },             // board does not end in five
      (s) => { s.moves[0] = s.moves[1]; },                    // duplicate stone
      (s) => { s.moves[0] = 225; },
      (s) => { s.moves[0] = '112'; },
      (s) => { s.moves = 'abc'; },
      (s) => { s.undoUsed = { 1: 5, 2: 0 }; },                // over the 2P limit (1)
      (s) => { s.undoUsed = [0, 0]; },
      (s) => { s.winner = 1; },
      (s) => { s.forfeit = 2; },
      (s) => { s.forfeit = 3; },
    ];
    for (const b of bad) assert.equal(deserialize(b), null, String(b));
    mutations.forEach((m, k) => {
      const s = good();
      m(s);
      assert.equal(deserialize(JSON.stringify(s)), null, `mutation ${k}: ${m}`);
      assert.equal(deserialize(s), null, `mutation ${k} (object)`);
    });
    // A getter that throws is still just "bad data".
    const evil = good();
    Object.defineProperty(evil, 'rounds', { get() { throw new Error('boom'); }, enumerable: true });
    assert.equal(deserialize(evil), null);
  });

  test('history with an illegal 3-3 or a stone after five is rejected', () => {
    const s = base();
    threeThreeSetup(s);
    const raw = JSON.parse(serialize(s));
    raw.moves.push(at(7, 7));                              // black's 3-3
    assert.equal(deserialize(raw), null);

    const w = base();
    winRound(w, 1);
    const r2 = JSON.parse(serialize(w));
    r2.status = 'playing'; r2.rounds = []; r2.score = [0, 0];
    assert.equal(deserialize(r2), null, 'five on the board but round still playing');
  });

  test('a 2P save cannot claim the CPU used undos; 2P cannot hide a match already won', () => {
    const c = JSON.parse(serialize(cpu()));
    c.undoUsed = { 1: 0, 2: 1 };
    assert.equal(deserialize(c), null);
    const s = playRounds(base({ bestOf: 3 }), [1, 1]);
    const raw = JSON.parse(serialize(s));
    raw.status = 'roundOver'; raw.winner = null;
    assert.equal(deserialize(raw), null);
  });

  test('fuzz: random corruption of real saves never throws; survivors re-serialize identically', () => {
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    const states = [];
    const a = base({ bestOf: 5, undoLimit: -1 });
    states.push(serialize(a));
    play(a, at(7, 7)); play(a, at(8, 8));
    states.push(serialize(a));
    winRound(nextRound(resignRound(a, 2) && a), 1);
    states.push(serialize(a));
    const c = cpu(); play(c, at(7, 7)); play(c, at(6, 7)); forfeitMatch(c, 1);
    states.push(serialize(c));
    const junk = [null, 0, -1, 1, 2, 3, 9, 225, 'x', '', true, false, [], {}, 1.5, 1e9];
    let kept = 0;
    for (let t = 0; t < 3000; t++) {
      const src = states[(rnd() * states.length) | 0];
      let json;
      if (rnd() < 0.3) {
        // byte-level damage (half-written file)
        const cut = (rnd() * src.length) | 0;
        json = rnd() < 0.5 ? src.slice(0, cut) : src.slice(0, cut) + String.fromCharCode(32 + ((rnd() * 90) | 0)) + src.slice(cut + 1);
      } else {
        const o = JSON.parse(src);
        const paths = [];
        (function walk(v, p) { if (v && typeof v === 'object') for (const k of Object.keys(v)) { paths.push([...p, k]); walk(v[k], [...p, k]); } })(o, []);
        const p = paths[(rnd() * paths.length) | 0];
        let parent = o;
        for (const k of p.slice(0, -1)) parent = parent[k];
        const last = p[p.length - 1];
        if (rnd() < 0.2) delete parent[last]; else parent[last] = junk[(rnd() * junk.length) | 0];
        json = JSON.stringify(o);
      }
      let back;
      assert.doesNotThrow(() => { back = deserialize(json); });
      if (back) { kept++; assert.equal(serialize(deserialize(serialize(back))), serialize(back)); }
    }
    assert.ok(kept < 3000);
  });
});

describe('legality contract with rules.js', () => {
  test('every accepted move passed rules.judgeMove for the colour to move', () => {
    // Random legal-looking play: play() must agree with judgeMove on every attempt.
    let seed = 99;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let g = 0; g < 20; g++) {
      const s = base({ bestOf: 1 });
      for (let t = 0; t < 400 && s.status === 'playing'; t++) {
        const idx = (rnd() * 225) | 0;
        const b = boardOf(s);
        const j = judgeMove(b, idx % N, (idx / N) | 0, colorOf(s, toMove(s)), rulesOf(s));
        const before = s.moves.length;
        const r = play(s, idx);
        assert.equal(r.ok, j.ok);
        if (!j.ok) { assert.equal(r.reason, j.reason); assert.equal(s.moves.length, before); }
        else assert.equal(r.win, j.win);
      }
    }
  });
});
