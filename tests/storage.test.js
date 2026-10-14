// js/storage.js: prefs, setup, the match save and the 전적 (SPEC §8.7) against a fake
// localStorage — including one that throws, one that is full, and data an older build (or a
// hand edit) left behind.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEYS, DEFAULT_PREFS, DEFAULT_SETUP, RECENT_MAX,
  loadPrefs, savePrefs, loadSetup, saveSetup, loadSave, saveMatch, clearSave, isSave,
  loadStats, recordMatch, resetStats,
} from '../js/storage.js';

function fakeStorage({ throwOnRead = false, throwOnWrite = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem(k) { if (throwOnRead) throw new Error('SecurityError'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (throwOnWrite) throw new Error('QuotaExceededError'); map.set(k, String(v)); },
    removeItem(k) { if (throwOnWrite) throw new Error('SecurityError'); map.delete(k); },
  };
}

function withStorage(storage, run) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    return run(storage);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else delete globalThis.localStorage;
  }
}

const fresh = (run) => withStorage(fakeStorage(), run);

// A minimal js/match.js serialize() result and the UI's wrapper around it (js/main.js packSave).
const MATCH = {
  v: 1,
  cfg: { mode: '2p', bestOf: 3, p1: 'bigom', p2: 'nyangja', cpuLevel: null, cpuPlayer: null, round1Black: 1,
    firstRule: 'loser', overlineWins: false, timer: 0, undoLimit: 1 },
  round: 1, score: [0, 0], rounds: [], black: 1, moves: [112, 113, 97], status: 'playing',
  undoUsed: { 1: 0, 2: 0 }, winner: null, forfeit: null, lastLine: null,
};
const SAVE = { v: 1, theme: 'mat', match: MATCH };

function summary(over = {}) {
  return {
    mode: '2p', bestOf: 3, p1: 'bigom', p2: 'nyangja', score: [2, 1], winner: 1, forfeit: null,
    rounds: [
      { winner: 1, how: 'five', moves: 31, black: 1 },
      { winner: 2, how: 'five', moves: 44, black: 1 },
      { winner: 1, how: 'five', moves: 27, black: 2 },
    ],
    fastestKO: 27, longestRound: 44, perfect: false, comeback: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// keys and defaults
// ---------------------------------------------------------------------------

test('every key is prefixed omok. (the origin is shared with /pumal/)', () => {
  assert.deepEqual({ ...KEYS }, { prefs: 'omok.prefs.v1', setup: 'omok.setup.v1', save: 'omok.save.v1', stats: 'omok.stats.v1' });
  assert.ok(Object.isFrozen(KEYS));
});

test('defaults are the ones SPEC §8.7 lists, and cannot be changed by accident', () => {
  assert.deepEqual({ ...DEFAULT_PREFS }, {
    sound: true, volume: 0.8, ignoreSilent: false, haptics: true, fxSpeed: 'normal', shake: true,
    motion: 'auto', input: 'double', showForbidden: false, overlineWins: false, firstRule: 'loser', trial: false, seenArmHint: 0,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_SETUP)), {
    '2p': { bestOf: 3, timer: 0, undo: 1, stage: 'mat' },
    cpu: { bestOf: 3, timer: 0, undo: 3, stage: 'mat', level: 'normal', myColor: 'black' },
    chars: { p1: 'bigom', p2: 'nyangja', cpuMe: 'bigom' },
  });
  assert.ok(Object.isFrozen(DEFAULT_PREFS));
  assert.ok(Object.isFrozen(DEFAULT_SETUP) && Object.isFrozen(DEFAULT_SETUP.cpu));
  assert.equal(RECENT_MAX, 20);
});

// ---------------------------------------------------------------------------
// prefs
// ---------------------------------------------------------------------------

test('prefs: nothing stored → the defaults, as a fresh object', () => fresh(() => {
  const a = loadPrefs();
  assert.deepEqual(a, { ...DEFAULT_PREFS });
  a.sound = false;
  assert.equal(loadPrefs().sound, true, 'the caller cannot change the defaults through the result');
}));

test('prefs: a round trip keeps every value, written synchronously', () => fresh((s) => {
  const p = { ...DEFAULT_PREFS, sound: false, volume: 0.5, fxSpeed: 'fast', motion: 'reduce', input: 'single', trial: true, seenArmHint: 2 };
  assert.equal(savePrefs(p), true);
  assert.ok(s.map.has('omok.prefs.v1'), 'stored before savePrefs returned');
  assert.deepEqual(loadPrefs(), p);
}));

test('prefs: known keys keep their type and their allowed values; unknown keys pass through', () => fresh((s) => {
  s.setItem('omok.prefs.v1', JSON.stringify({
    sound: 'yes', volume: 7, haptics: false, fxSpeed: 'turbo', motion: 'full', input: 2, firstRule: 'alternate',
    seenArmHint: -1, showForbidden: true, futureThing: { a: 1 },
  }).replace(/^\{/, '{"__proto__":{"polluted":true},'));
  const p = loadPrefs();
  assert.equal(p.sound, true, 'wrong type → default');
  assert.equal(p.volume, 1, 'clamped to 0..1');
  assert.equal(p.haptics, false);
  assert.equal(p.fxSpeed, 'normal', 'unknown choice → default');
  assert.equal(p.motion, 'full');
  assert.equal(p.input, 'double');
  assert.equal(p.firstRule, 'alternate');
  assert.equal(p.seenArmHint, 0);
  assert.equal(p.showForbidden, true);
  assert.deepEqual(p.futureThing, { a: 1 }, 'a later build\'s key survives a downgrade');
  assert.equal({}.polluted, undefined);
  assert.equal(p.polluted, undefined);
}));

test('prefs: broken JSON or a non-object falls back to the defaults', () => {
  for (const raw of ['{nope', '"text"', '[1,2]', 'null', '42']) {
    fresh((s) => {
      s.setItem('omok.prefs.v1', raw);
      assert.deepEqual(loadPrefs(), { ...DEFAULT_PREFS }, raw);
    });
  }
});

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

test('setup: round trip, deep defaults, and stale values replaced one by one', () => fresh((s) => {
  assert.deepEqual(loadSetup(), JSON.parse(JSON.stringify(DEFAULT_SETUP)));
  const mine = loadSetup();
  mine.cpu.level = 'hard';
  mine.cpu.myColor = 'random';
  mine['2p'].bestOf = 5;
  mine['2p'].undo = -1;
  mine.chars.p1 = 'jaepjaep';
  assert.equal(saveSetup(mine), true);
  assert.deepEqual(loadSetup(), mine);

  s.setItem('omok.setup.v1', JSON.stringify({
    '2p': { bestOf: 4, timer: 20, undo: -5, stage: 'neon' },
    cpu: { level: 'insane', myColor: 'white', stage: '<script>' },
    chars: { p1: 'kkakkung', p2: 42 },
    extra: { x: 1 },
  }));
  const st = loadSetup();
  assert.deepEqual(st['2p'], { bestOf: 3, timer: 20, undo: 1, stage: 'neon' });
  assert.deepEqual(st.cpu, { bestOf: 3, timer: 0, undo: 3, stage: 'mat', level: 'normal', myColor: 'white' });
  assert.deepEqual(st.chars, { p1: 'kkakkung', p2: 'nyangja', cpuMe: 'bigom' });
  assert.equal('extra' in st, false);
}));

test('setup: saving a partial object still stores a complete one', () => fresh((s) => {
  assert.equal(saveSetup({ cpu: { level: 'easy' } }), true);
  const stored = JSON.parse(s.getItem('omok.setup.v1'));
  assert.equal(stored.cpu.level, 'easy');
  assert.equal(stored.cpu.bestOf, 3);
  assert.deepEqual(stored['2p'], { ...DEFAULT_SETUP['2p'] });
  assert.equal(saveSetup(null), false);
}));

// ---------------------------------------------------------------------------
// the match in progress
// ---------------------------------------------------------------------------

test('match save: string or object in, the object back; clearSave removes it', () => fresh((s) => {
  assert.equal(loadSave(), null);
  assert.equal(saveMatch(JSON.stringify(SAVE)), true);
  assert.equal(s.getItem('omok.save.v1'), JSON.stringify(SAVE), 'the string is stored as given');
  assert.deepEqual(loadSave(), SAVE);
  assert.equal(saveMatch({ ...SAVE, theme: 'neon' }), true);
  assert.equal(loadSave().theme, 'neon');
  assert.equal(clearSave(), true);
  assert.equal(loadSave(), null);
}));

test('match save: a bare serialized match is accepted too', () => fresh(() => {
  assert.equal(isSave(MATCH), true);
  assert.equal(saveMatch(JSON.stringify(MATCH)), true);
  assert.deepEqual(loadSave(), MATCH);
}));

test('match save: something that is not a save never replaces a good one', () => fresh((s) => {
  saveMatch(SAVE);
  const bad = [
    null, undefined, 42, 'not json', '{"v":1}', { v: 2, match: MATCH }, { v: 1, match: { ...MATCH, moves: 'x' } },
    { v: 1, match: { ...MATCH, moves: [1, 999] } }, { v: 1, match: { ...MATCH, cfg: null } }, { v: 1, match: null },
  ];
  for (const b of bad) assert.equal(saveMatch(b), false, JSON.stringify(b));
  assert.deepEqual(loadSave(), SAVE);
  s.setItem('omok.save.v1', '{"v":1,"match":{"v":1}}');
  assert.equal(loadSave(), null, 'a damaged stored save reads as no save');
}));

// ---------------------------------------------------------------------------
// 전적
// ---------------------------------------------------------------------------

test('stats: empty → zeros, complete and well-formed', () => fresh(() => {
  assert.deepEqual(loadStats(), {
    matches: 0, rounds: 0, byChar: {},
    cpu: { easy: { w: 0, l: 0 }, normal: { w: 0, l: 0 }, hard: { w: 0, l: 0 } },
    cpuStreak: 0, cpuBestStreak: 0, fastestKO: null, longestRound: 0, recent: [],
  });
}));

test('stats: a 2P match counts both fighters, rounds, fastest K.O., longest round and the recent list', () => fresh(() => {
  const st = recordMatch(summary(), 1000);
  assert.equal(st.matches, 1);
  assert.equal(st.rounds, 3);
  assert.deepEqual(st.byChar, { bigom: { played: 1, won: 1 }, nyangja: { played: 1, won: 0 } });
  assert.equal(st.fastestKO, 27);
  assert.equal(st.longestRound, 44);
  assert.deepEqual(st.recent, [{ at: 1000, mode: '2p', p1: 'bigom', p2: 'nyangja', score: [2, 1], winner: 1 }]);
  assert.deepEqual(loadStats(), st, 'stored');
  assert.deepEqual(st.cpu.normal, { w: 0, l: 0 }, '2P does not touch the CPU record');

  const st2 = recordMatch(summary({ score: [0, 2], winner: 2, fastestKO: 33, longestRound: 50, rounds: [{}, {}] }), 2000);
  assert.equal(st2.matches, 2);
  assert.equal(st2.rounds, 5);
  assert.equal(st2.fastestKO, 27, 'the shortest stays');
  assert.equal(st2.longestRound, 50);
  assert.deepEqual(st2.byChar.nyangja, { played: 2, won: 1 });
  assert.equal(st2.recent[0].at, 2000, 'newest first');
}));

test('stats: a mirror match counts the fighter twice and the win once', () => fresh(() => {
  const st = recordMatch(summary({ p1: 'ppibik', p2: 'ppibik' }));
  assert.deepEqual(st.byChar.ppibik, { played: 2, won: 1 });
}));

test('stats: against the CPU only my fighter counts; wins, losses and the streak per level', () => fresh(() => {
  const cpu = (winner, level = 'hard') => summary({ mode: 'cpu', level, p1: 'bigom', p2: 'taenggeul', winner, score: winner === 1 ? [2, 0] : [0, 2] });
  recordMatch(cpu(1));
  recordMatch(cpu(1));
  let st = recordMatch(cpu(1, 'easy'));
  assert.equal(st.cpuStreak, 3);
  assert.equal(st.cpuBestStreak, 3);
  assert.deepEqual(st.cpu.hard, { w: 2, l: 0 });
  assert.deepEqual(st.cpu.easy, { w: 1, l: 0 });
  assert.equal(st.byChar.taenggeul, undefined, 'the CPU\'s fighter is not mine');
  assert.deepEqual(st.byChar.bigom, { played: 3, won: 3 });
  st = recordMatch(cpu(2));
  assert.equal(st.cpuStreak, 0);
  assert.equal(st.cpuBestStreak, 3, 'the best streak stays');
  assert.deepEqual(st.cpu.hard, { w: 2, l: 1 });
  assert.equal(st.recent[0].level, 'hard');
  assert.deepEqual(st.recent[0].score, [0, 2]);
}));

test('stats: the recent list keeps the last 20', () => fresh(() => {
  for (let i = 0; i < 25; i += 1) recordMatch(summary(), i);
  const st = loadStats();
  assert.equal(st.matches, 25);
  assert.equal(st.recent.length, 20);
  assert.equal(st.recent[0].at, 24);
  assert.equal(st.recent[19].at, 5);
}));

test('stats: a summary that is not a match is refused and writes nothing', () => fresh((s) => {
  for (const bad of [null, {}, { mode: 'x', p1: 'a', p2: 'b' }, { mode: '2p', p1: 1, p2: 'b' }]) {
    assert.equal(recordMatch(bad), null);
  }
  assert.equal(s.map.has('omok.stats.v1'), false);
}));

test('stats: damaged stored values are repaired field by field', () => fresh((s) => {
  s.setItem('omok.stats.v1', JSON.stringify({
    matches: -3, rounds: 'many', byChar: { bigom: { played: 2, won: 5 }, 'bad id!': { played: 1 }, nyangja: 'x' },
    cpu: { normal: { w: 4, l: 1.5 }, insane: { w: 9 } }, cpuStreak: 4, cpuBestStreak: 2, fastestKO: 0, longestRound: 61,
    recent: [{ at: 5, mode: 'cpu', p1: 'bigom', p2: 'ppibik', score: [1, 'x'], winner: 7, level: 'hard' }, { at: 'x' }, null],
  }));
  const st = loadStats();
  assert.equal(st.matches, 0);
  assert.equal(st.rounds, 0);
  assert.deepEqual(st.byChar, { bigom: { played: 2, won: 2 } });
  assert.deepEqual(st.cpu.normal, { w: 4, l: 0 });
  assert.equal('insane' in st.cpu, false);
  assert.equal(st.cpuBestStreak, 4, 'never below the current streak');
  assert.equal(st.fastestKO, null);
  assert.equal(st.longestRound, 61);
  assert.deepEqual(st.recent, [{ at: 5, mode: 'cpu', p1: 'bigom', p2: 'ppibik', score: [1, 0], winner: null, level: 'hard' }]);
}));

test('stats: reset clears the 전적 and nothing else', () => fresh((s) => {
  savePrefs({ ...DEFAULT_PREFS, sound: false });
  saveMatch(SAVE);
  recordMatch(summary());
  assert.equal(resetStats(), true);
  assert.equal(s.map.has('omok.stats.v1'), false);
  assert.equal(loadStats().matches, 0);
  assert.equal(loadPrefs().sound, false);
  assert.deepEqual(loadSave(), SAVE);
}));

// ---------------------------------------------------------------------------
// storage that fails
// ---------------------------------------------------------------------------

test('no localStorage at all (node, sandboxed frame): loads give defaults, writes report false', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  if (saved) delete globalThis.localStorage;
  try {
    assert.deepEqual(loadPrefs(), { ...DEFAULT_PREFS });
    assert.equal(savePrefs(DEFAULT_PREFS), false);
    assert.equal(saveMatch(SAVE), false);
    assert.equal(loadSave(), null);
    assert.equal(loadStats().matches, 0);
    assert.equal(recordMatch(summary()).matches, 1, 'the caller still gets the new numbers');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
  }
});

test('a localStorage getter that throws (Safari with storage blocked) is survived', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
  try {
    assert.deepEqual(loadPrefs(), { ...DEFAULT_PREFS });
    assert.equal(saveMatch(SAVE), false);
    assert.equal(clearSave(), false);
    assert.equal(resetStats(), false);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else delete globalThis.localStorage;
  }
});

test('reads and writes that throw (private mode, quota) never escape', () => {
  withStorage(fakeStorage({ throwOnRead: true }), () => {
    assert.deepEqual(loadPrefs(), { ...DEFAULT_PREFS });
    assert.equal(loadSave(), null);
    assert.deepEqual(loadSetup(), JSON.parse(JSON.stringify(DEFAULT_SETUP)));
  });
  withStorage(fakeStorage({ throwOnWrite: true }), () => {
    assert.equal(savePrefs(DEFAULT_PREFS), false);
    assert.equal(saveSetup(loadSetup()), false);
    assert.equal(saveMatch(SAVE), false, 'the UI shows "저장이 안 돼요" once');
    assert.equal(clearSave(), false);
    assert.ok(recordMatch(summary()));
  });
});

test('a value that cannot be serialised is refused, not thrown', () => fresh(() => {
  const cyclic = { ...DEFAULT_PREFS };
  cyclic.self = cyclic;
  assert.equal(savePrefs(cyclic), false);
}));
