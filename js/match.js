// match.js — one match: rounds, score, colours, undo, resign, save/restore (SPEC §2, §8.1).
//
// Constraints that shape this file:
// - Pure: no DOM, no clock, no randomness. The coin toss / "random colour" is decided by the UI
//   and arrives as cfg.round1Black, so the same state + inputs always give the same result.
// - The UI saves after every move (iOS kills background PWAs), so the state is plain JSON data.
//   Functions take it as the first argument; the mutating ones change it in place and return a
//   small result object, the rest only read.
// - The board is NOT stored. It is replayed from `moves` (≤ 225 stones, a few µs), so undo, the
//   save file and the AI request can never disagree about the position.
// - Legality is js/rules.js `judgeMove`, for both players, every time — the same check the AI's
//   answer must pass.
// - deserialize() is the only door for data from storage. A save may be old, half-written or
//   hand-edited: it rebuilds a fresh state from fully validated fields (replaying every move)
//   and returns null for anything it does not understand. It never throws.
//
// Players are 1 (1P) and 2 (2P / the CPU). Colours are rules.BLACK (1) and rules.WHITE (2).
// `state.black` says which PLAYER holds black in the current round.

import { N, EMPTY, BLACK, WHITE, DEFAULT_RULES, judgeMove, isForbidden, winningLine } from './rules.js';

export const FORMATS = Object.freeze({
  1: Object.freeze({ need: 1, label: '단판 승부' }),
  3: Object.freeze({ need: 2, label: '3판 2선승' }),
  5: Object.freeze({ need: 3, label: '5판 3선승' }),
  7: Object.freeze({ need: 4, label: '7판 4선승' }),
});

const CELLS = N * N;
const MODES = ['2p', 'cpu'];
const LEVELS = ['easy', 'normal', 'hard'];
const BEST_OF = [1, 3, 5, 7];
const TIMERS = [0, 10, 20, 30];
const HOWS = ['five', 'timeout', 'resign', 'draw'];
const STATUSES = ['playing', 'roundOver', 'matchOver'];
const CHAR_ID = /^[a-z][a-z0-9_-]{0,31}$/;
// The UI offers undo limits -1 (unlimited), 0, 1 and 3. Anything up to this is accepted so a
// later build can add choices without invalidating saves; beyond it a save is junk.
const UNDO_MAX = 99;
// Draws score nothing, so a match can run past bestOf rounds — but not forever.
const ROUND_MAX = 99;
// Fewest stones on a board where someone has just made five: five of the winner's, four replies.
const MIN_FIVE_MOVES = 9;

const STD_RULES = Object.freeze({ ...DEFAULT_RULES, overlineWins: false });
const OW_RULES = Object.freeze({ ...DEFAULT_RULES, overlineWins: true });

// ---- small helpers ------------------------------------------------------------------

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const isIdx = (i) => isInt(i, 0, CELLS - 1);
const isPlayer = (p) => p === 1 || p === 2;
const isCharId = (s) => typeof s === 'string' && CHAR_ID.test(s);
const isUndoLimit = (n) => isInt(n, -1, UNDO_MAX);
const other = (p) => 3 - p;
const needFor = (bestOf) => FORMATS[bestOf].need;

// Who made move number k (0-based) of the current round. Black moves first.
const moverAt = (state, k) => (k % 2 === 0 ? state.black : other(state.black));

// Black for the round after `last` (a completed-round record). A draw always swaps colours —
// nobody lost, and the side that had the first-move advantage gives it up.
function nextBlack(cfg, last) {
  if (last.winner === 0) return other(last.black);
  if (cfg.firstRule === 'loser') return other(last.winner);
  return other(last.black);
}

// Does colour c have any legal point on board b? (Stops at the first one: almost every empty
// point passes rules' cheap pre-filter, so this is ~1 µs unless the board is nearly full.)
function hasLegalMove(b, c, rules) {
  for (let i = 0; i < CELLS; i++) {
    if (b[i] === EMPTY && !isForbidden(b, i % N, (i / N) | 0, c, rules)) return true;
  }
  return false;
}

// ---- construction ---------------------------------------------------------------------

function normalizeCfg(raw) {
  const r = isObj(raw) ? raw : {};
  const mode = MODES.includes(r.mode) ? r.mode : '2p';
  return {
    mode,
    bestOf: BEST_OF.includes(r.bestOf) ? r.bestOf : 3,
    p1: isCharId(r.p1) ? r.p1 : 'bigom',
    p2: isCharId(r.p2) ? r.p2 : 'nyangja',
    // Fixed shape in both modes (null when unused) keeps saves and validation simple.
    cpuLevel: mode === 'cpu' ? (LEVELS.includes(r.cpuLevel) ? r.cpuLevel : 'normal') : null,
    cpuPlayer: mode === 'cpu' ? 2 : null,               // the CPU always sits in the 2P slot
    round1Black: r.round1Black === 2 ? 2 : 1,
    firstRule: r.firstRule === 'alternate' ? 'alternate' : 'loser',
    overlineWins: r.overlineWins === true,
    timer: TIMERS.includes(r.timer) ? r.timer : 0,
    undoLimit: isUndoLimit(r.undoLimit) ? r.undoLimit : (mode === 'cpu' ? 3 : 1),
  };
}

function freshState(cfg) {
  return {
    v: 1, cfg, round: 1, score: [0, 0], rounds: [], black: cfg.round1Black, moves: [],
    status: 'playing', undoUsed: { 1: 0, 2: 0 }, winner: null, forfeit: null, lastLine: null,
  };
}

// cfg = { mode, bestOf, p1, p2, cpuLevel?, round1Black, firstRule, overlineWins, timer, undoLimit }.
// Unknown or invalid values fall back to the SPEC defaults instead of throwing.
export function createMatch(cfg) {
  return freshState(normalizeCfg(cfg));
}

// ---- reading ----------------------------------------------------------------------------

export function rulesOf(state) {
  return state.cfg.overlineWins ? OW_RULES : STD_RULES;
}

export function needOf(state) {
  return needFor(state.cfg.bestOf);
}

export function colorOf(state, player) {
  return player === state.black ? BLACK : WHITE;
}

// Which player owns stones of colour c this round (handy for drawing HUD stone icons).
export function playerOf(state, color) {
  return color === BLACK ? state.black : other(state.black);
}

export function toMove(state) {
  return moverAt(state, state.moves.length);
}

export function boardOf(state) {
  const b = new Int8Array(CELLS);
  const m = state.moves;
  for (let k = 0; k < m.length; k++) b[m[k]] = k % 2 === 0 ? BLACK : WHITE;
  return b;
}

// Can the player to move put a stone on idx? {ok:true, win, line, overline} or
// {ok:false, reason:'occupied'|'33'|'44'|'over'} ('over' = the round is not being played).
export function canPlace(state, idx) {
  if (state.status !== 'playing') return { ok: false, reason: 'over' };
  if (!isIdx(idx)) return { ok: false, reason: 'occupied' };
  const color = colorOf(state, toMove(state));
  return judgeMove(boardOf(state), idx % N, (idx / N) | 0, color, rulesOf(state));
}

// Every point the player to move may play (occupied and forbidden points excluded).
export function legalMoves(state) {
  const b = boardOf(state);
  const c = colorOf(state, toMove(state));
  const rules = rulesOf(state);
  const out = [];
  for (let i = 0; i < CELLS; i++) {
    if (b[i] === EMPTY && !isForbidden(b, i % N, (i / N) | 0, c, rules)) out.push(i);
  }
  return out;
}

// How many undos `player` has left this round (Infinity = unlimited). The CPU has none.
export function undoLeft(state, player) {
  if (!isPlayer(player)) return 0;
  if (state.cfg.mode === 'cpu' && player !== 1) return 0;
  const lim = state.cfg.undoLimit;
  if (lim < 0) return Infinity;
  return Math.max(0, lim - (state.undoUsed[player] | 0));
}

// One more round won takes the match. Single-game matches have no "match point" (every game is
// the decider), and after the match ends nobody is on match point any more.
export function matchPoint(state, player) {
  if (!isPlayer(player) || state.cfg.bestOf === 1 || state.status === 'matchOver') return false;
  return state.score[player - 1] === needOf(state) - 1;
}

// Both players on match point: the next round decides the match ("FINAL ROUND").
export function isFinalRound(state) {
  return matchPoint(state, 1) && matchPoint(state, 2);
}

// ---- results ----------------------------------------------------------------------------
// Every mutating call returns the same shape so the UI can handle them with one function:
//   { ok:false, reason }                                        nothing changed
//   { ok:true, win, line, overline, draw, roundOver, matchOver, winner, how }
// winner: the round's winner (1|2, 0 = draw) when roundOver, null while the round goes on.
// how: 'five'|'timeout'|'resign'|'draw'|'forfeit' when the round/match ended, else null.

function finishRound(state, winner, how, line = null, overline = false) {
  state.rounds.push({ winner, how, moves: state.moves.length, black: state.black });
  if (winner) state.score[winner - 1]++;
  if (winner && state.score[winner - 1] >= needOf(state)) {
    state.status = 'matchOver';
    state.winner = winner;
  } else {
    state.status = 'roundOver';
  }
  return {
    ok: true, win: how === 'five', line, overline, draw: winner === 0,
    roundOver: true, matchOver: state.status === 'matchOver', winner, how,
  };
}

// The player to move puts a stone on idx. Ends the round on five, or as a draw when the board
// is full or the next player has no legal point left (every empty point is 3-3 for them).
export function play(state, idx) {
  if (state.status !== 'playing') return { ok: false, reason: 'over' };
  if (!isIdx(idx)) return { ok: false, reason: 'occupied' };
  const b = boardOf(state);
  const player = toMove(state);
  const color = colorOf(state, player);
  const rules = rulesOf(state);
  const j = judgeMove(b, idx % N, (idx / N) | 0, color, rules);
  if (!j.ok) return { ok: false, reason: j.reason };

  state.moves.push(idx);
  state.lastLine = null;
  b[idx] = color;
  if (j.win) {
    state.lastLine = j.line;
    return finishRound(state, player, 'five', j.line, false);
  }
  const next = color === BLACK ? WHITE : BLACK;
  if (state.moves.length >= CELLS || !hasLegalMove(b, next, rules)) {
    return finishRound(state, 0, 'draw', null, j.overline);
  }
  return {
    ok: true, win: false, line: null, overline: j.overline, draw: false,
    roundOver: false, matchOver: false, winner: null, how: null,
  };
}

// "이번 판 기권": `player` gives this round to the opponent.
export function resignRound(state, player) {
  if (!isPlayer(player)) return { ok: false, reason: 'player' };
  if (state.status !== 'playing') return { ok: false, reason: 'over' };
  return finishRound(state, other(player), 'resign');
}

// The move timer ran out for `player` with no stone armed: TIME OVER loses the round.
// Only the player whose turn it is can run out of time.
export function timeoutRound(state, player) {
  if (!isPlayer(player)) return { ok: false, reason: 'player' };
  if (state.status !== 'playing') return { ok: false, reason: 'over' };
  if (player !== toMove(state)) return { ok: false, reason: 'turn' };
  return finishRound(state, other(player), 'timeout');
}

// "매치 포기": `player` concedes the whole match. Allowed mid-round or between rounds. The
// unfinished round is not recorded and the score stays as it was (it shows what was played);
// state.forfeit marks how the match ended.
export function forfeitMatch(state, player) {
  if (!isPlayer(player)) return { ok: false, reason: 'player' };
  if (state.status === 'matchOver') return { ok: false, reason: 'over' };
  state.status = 'matchOver';
  state.winner = other(player);
  state.forfeit = player;
  return {
    ok: true, win: false, line: null, overline: false, draw: false,
    roundOver: true, matchOver: true, winner: state.winner, how: 'forfeit',
  };
}

// Take back moves for `player`. → { ok:true, removed:[idx, …] } (most recent first) or
// { ok:false, removed:[], reason:'over'|'limit'|'none'|'notYours' }.
//   2P : only the player's own last stone, and only while the opponent has not replied
//        (the UI asks the opponent for permission first).
//   CPU: player 1 only. Removes the human's last stone and the CPU's reply, or just the human's
//        stone when the CPU has not answered yet (the UI cancels the AI first).
// One call uses one undo of the per-round allowance. Never after the round has ended.
export function undo(state, player) {
  const fail = (reason) => ({ ok: false, removed: [], reason });
  if (!isPlayer(player)) return fail('notYours');
  if (state.status !== 'playing') return fail('over');
  const cpu = state.cfg.mode === 'cpu';
  if (cpu && player !== 1) return fail('notYours');
  if (undoLeft(state, player) < 1) return fail('limit');

  const n = state.moves.length;
  let count;
  if (cpu) {
    if (n === 0) return fail('none');
    if (moverAt(state, n - 1) === 1) count = 1;          // the CPU has not replied yet
    else if (n >= 2) count = 2;                           // human stone + CPU reply
    else return fail('none');                             // only the CPU's first stone is down
  } else {
    if (n === 0 || (n === 1 && moverAt(state, 0) !== player)) return fail('none');
    if (moverAt(state, n - 1) !== player) return fail('notYours');
    count = 1;
  }
  const removed = [];
  for (let k = 0; k < count; k++) removed.push(state.moves.pop());
  state.undoUsed[player] = (state.undoUsed[player] | 0) + 1;
  state.lastLine = null;
  return { ok: true, removed };
}

// roundOver → playing: next round number, colours by cfg.firstRule ('loser': the loser of the
// round takes black; 'alternate': colours swap; a draw always swaps), empty board, fresh undo
// allowance. Does nothing in any other status. Returns the (same, mutated) state.
export function nextRound(state) {
  if (state.status !== 'roundOver') return state;
  state.black = nextBlack(state.cfg, state.rounds[state.rounds.length - 1]);
  state.round++;
  state.moves = [];
  state.status = 'playing';
  state.undoUsed = { 1: 0, 2: 0 };
  state.lastLine = null;
  return state;
}

// "한 판 더!": a new match with the same settings; the loser of this match takes black in
// round 1 (no coin toss). If the match has no winner (not finished) round 1 keeps its colours.
export function rematch(state) {
  const round1Black = isPlayer(state.winner) ? other(state.winner) : state.cfg.round1Black;
  return freshState({ ...state.cfg, round1Black });
}

// ---- summary ----------------------------------------------------------------------------
// For the match result screen and storage.recordMatch:
//   fastestKO   fewest stones on the board (both colours) in a round won by five — in CPU mode
//               only rounds the human (1P) won count; null if there is none.
//   longestRound most stones in any recorded round (0 if none).
//   perfect     bestOf ≥ 3, the match was won on the board (not by forfeit) and the loser won
//               no round. Draws do not spoil it.
//   comeback    "역전승": won on the board after trailing, where at some point either the deficit
//               was ≥ 2 rounds or the opponent stood on match point while leading (so the
//               default 3판 2선승 can produce it: 0:1 → 2:1).

export function summary(state) {
  const { cfg } = state;
  const need = needOf(state);
  const winner = isPlayer(state.winner) ? state.winner : null;
  const onBoard = winner !== null && state.forfeit === null;

  let fastestKO = null, longestRound = 0, comeback = false;
  const run = [0, 0];
  for (const r of state.rounds) {
    if (r.moves > longestRound) longestRound = r.moves;
    if (r.how === 'five' && (cfg.mode !== 'cpu' || r.winner === 1)) {
      if (fastestKO === null || r.moves < fastestKO) fastestKO = r.moves;
    }
    if (r.winner) run[r.winner - 1]++;
    if (onBoard) {
      const mine = run[winner - 1], theirs = run[other(winner) - 1];
      if (theirs - mine >= 2 || (theirs > mine && theirs === need - 1)) comeback = true;
    }
  }
  const loserWins = winner ? state.score[other(winner) - 1] : 0;
  const out = {
    mode: cfg.mode, bestOf: cfg.bestOf, p1: cfg.p1, p2: cfg.p2,
    score: [state.score[0], state.score[1]], winner, forfeit: state.forfeit,
    rounds: state.rounds.map((r) => ({ ...r })),
    fastestKO, longestRound,
    perfect: onBoard && cfg.bestOf >= 3 && loserWins === 0,
    comeback: onBoard && comeback,
  };
  if (cfg.mode === 'cpu') out.level = cfg.cpuLevel;
  return out;
}

// ---- save / restore ---------------------------------------------------------------------

export function serialize(state) {
  // Only the known fields: anything the UI may have hung on the object stays out of the save.
  const { v, cfg, round, score, rounds, black, moves, status, undoUsed, winner, forfeit, lastLine } = state;
  return JSON.stringify({ v, cfg, round, score, rounds, black, moves, status, undoUsed, winner, forfeit, lastLine });
}

// JSON string (or an already-parsed object) → state, or null when it is not a valid v1 match.
export function deserialize(json) {
  try {
    const raw = typeof json === 'string' ? JSON.parse(json) : json;
    return restore(raw);
  } catch {
    return null;
  }
}

function restoreCfg(c) {
  if (!isObj(c)) return null;
  if (!MODES.includes(c.mode) || !BEST_OF.includes(c.bestOf)) return null;
  if (!isCharId(c.p1) || !isCharId(c.p2)) return null;
  const cpu = c.mode === 'cpu';
  if (cpu ? (!LEVELS.includes(c.cpuLevel) || c.cpuPlayer !== 2) : (c.cpuLevel !== null || c.cpuPlayer !== null)) return null;
  if (!isPlayer(c.round1Black)) return null;
  if (c.firstRule !== 'loser' && c.firstRule !== 'alternate') return null;
  if (typeof c.overlineWins !== 'boolean' || !TIMERS.includes(c.timer) || !isUndoLimit(c.undoLimit)) return null;
  return {
    mode: c.mode, bestOf: c.bestOf, p1: c.p1, p2: c.p2, cpuLevel: c.cpuLevel, cpuPlayer: c.cpuPlayer,
    round1Black: c.round1Black, firstRule: c.firstRule, overlineWins: c.overlineWins,
    timer: c.timer, undoLimit: c.undoLimit,
  };
}

// Replays a round's moves. Every stone must be legal for its colour and nothing but the last
// stone may make five. → { board, lastWins } or null.
function replay(moves, rules) {
  if (!Array.isArray(moves) || moves.length > CELLS) return null;
  const b = new Int8Array(CELLS);
  let lastWins = false;
  for (let k = 0; k < moves.length; k++) {
    const i = moves[k];
    if (!isIdx(i) || lastWins) return null;              // a stone after a five is impossible
    const c = k % 2 === 0 ? BLACK : WHITE;
    const j = judgeMove(b, i % N, (i / N) | 0, c, rules);
    if (!j.ok) return null;
    b[i] = c;
    lastWins = j.win;
  }
  return { board: b, lastWins };
}

// The board after a round ended `how` must look like it: five on the last stone, a draw only on
// a board where the next player cannot move, and no five for a resignation or a timeout.
function boardMatches(rep, moves, how, rules) {
  if (how === 'five') return rep.lastWins;
  if (rep.lastWins) return false;
  if (how === 'draw') {
    const next = moves.length % 2 === 0 ? BLACK : WHITE;
    return moves.length >= CELLS || !hasLegalMove(rep.board, next, rules);
  }
  return true;
}

function restore(s) {
  if (!isObj(s) || s.v !== 1) return null;
  const cfg = restoreCfg(s.cfg);
  if (!cfg) return null;
  const need = needFor(cfg.bestOf);
  const rules = cfg.overlineWins ? OW_RULES : STD_RULES;
  if (!STATUSES.includes(s.status) || !isInt(s.round, 1, ROUND_MAX)) return null;
  if (!Array.isArray(s.rounds) || s.rounds.length > s.round) return null;

  // Completed rounds: colours must follow the rules from cfg.round1Black, and nobody may have
  // reached `need` before the last recorded round.
  const rounds = [];
  const score = [0, 0];
  let black = cfg.round1Black;
  for (let k = 0; k < s.rounds.length; k++) {
    const r = s.rounds[k];
    if (!isObj(r) || !isInt(r.winner, 0, 2) || !HOWS.includes(r.how) || !isInt(r.moves, 0, CELLS)) return null;
    if (r.black !== black) return null;
    if ((r.winner === 0) !== (r.how === 'draw')) return null;
    if (r.how === 'five') {
      if (r.moves < MIN_FIVE_MOVES) return null;
      if ((r.moves % 2 === 1) !== (r.winner === r.black)) return null;   // five is the winner's colour
    }
    if (score[0] >= need || score[1] >= need) return null;               // match was already over
    if (r.winner) score[r.winner - 1]++;
    rounds.push({ winner: r.winner, how: r.how, moves: r.moves, black: r.black });
    black = nextBlack(cfg, r);
  }
  if (!Array.isArray(s.score) || s.score.length !== 2 || s.score[0] !== score[0] || s.score[1] !== score[1]) return null;
  const reached = score[0] >= need ? 1 : score[1] >= need ? 2 : 0;
  const last = rounds[rounds.length - 1];

  // Where the current board belongs: a round in progress (played/forfeited mid-round) or the
  // round that just ended (kept on screen until nextRound).
  const forfeit = s.forfeit === null ? null : isPlayer(s.forfeit) ? s.forfeit : undefined;
  if (forfeit === undefined) return null;
  let midRound;
  if (s.status === 'playing') {
    if (forfeit !== null || s.winner !== null || reached) return null;
    midRound = true;
  } else if (s.status === 'roundOver') {
    if (forfeit !== null || s.winner !== null || reached || !last) return null;
    midRound = false;
  } else if (forfeit === null) {
    if (!reached || s.winner !== reached || !last) return null;
    midRound = false;
  } else {
    if (reached || s.winner !== other(forfeit)) return null;
    midRound = rounds.length === s.round - 1;
  }
  if (rounds.length !== (midRound ? s.round - 1 : s.round)) return null;
  if (s.black !== (midRound ? black : last.black)) return null;

  const rep = replay(s.moves, rules);
  if (!rep) return null;
  const moves = s.moves.slice();
  if (midRound) {
    if (rep.lastWins) return null;
    // A live round always leaves the player to move a legal point; otherwise play() would have
    // ended it as a draw.
    if (s.status === 'playing') {
      const next = moves.length % 2 === 0 ? BLACK : WHITE;
      if (moves.length >= CELLS || !hasLegalMove(rep.board, next, rules)) return null;
    }
  } else {
    if (moves.length !== last.moves || !boardMatches(rep, moves, last.how, rules)) return null;
  }

  const u = s.undoUsed;
  if (!isObj(u)) return null;
  const cap = cfg.undoLimit < 0 ? UNDO_MAX : cfg.undoLimit;
  if (!isInt(u[1], 0, cap) || !isInt(u[2], 0, cfg.mode === 'cpu' ? 0 : cap)) return null;

  // lastLine is derived data: recompute it instead of trusting the file.
  let lastLine = null;
  if (!midRound && last.how === 'five' && moves.length) {
    const i = moves[moves.length - 1];
    lastLine = winningLine(rep.board, i % N, (i / N) | 0, rep.board[i], rules.overlineWins);
  }
  return {
    v: 1, cfg, round: s.round, score, rounds, black: s.black, moves, status: s.status,
    undoUsed: { 1: u[1], 2: u[2] }, winner: s.winner, forfeit, lastLine,
  };
}
