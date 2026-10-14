// Prefs, last match setup, the match in progress and the 전적 for 돌주먹 (SPEC §8.7).
//
// Constraints that shape this file (the same ones as the owner's 품알):
// - Saving must be synchronous: iOS gives no time for async work on `pagehide`, and a hidden
//   home-screen app can be killed without another event.
// - Every localStorage access can throw (private mode, storage disabled, quota), so each one
//   sits in try/catch and failure degrades to "nothing stored" instead of an exception.
// - The origin (jinjoskim2001-sketch.github.io) also hosts /pumal/, and in a Safari tab both
//   apps share one localStorage. Every key here starts with `omok.`.
// - Whatever comes back from storage may be stale (an older version of this app), half
//   written, or edited by hand. Loads never trust it: known keys keep their type and their
//   allowed values, everything else falls back to the defaults.

export const KEYS = Object.freeze({
  prefs: 'omok.prefs.v1',
  setup: 'omok.setup.v1',
  save: 'omok.save.v1',
  stats: 'omok.stats.v1',
});

export const DEFAULT_PREFS = Object.freeze({
  sound: true, volume: 0.8, ignoreSilent: false, haptics: true, fxSpeed: 'normal', shake: true,
  motion: 'auto', input: 'double', showForbidden: false, overlineWins: false, firstRule: 'loser',
  trial: false, seenArmHint: 0,
});

export const DEFAULT_SETUP = Object.freeze({
  '2p': Object.freeze({ bestOf: 3, timer: 0, undo: 1, stage: 'mat' }),
  cpu: Object.freeze({ bestOf: 3, timer: 0, undo: 3, stage: 'mat', level: 'normal', myColor: 'black' }),
  chars: Object.freeze({ p1: 'bigom', p2: 'nyangja', cpuMe: 'bigom' }),
});

// How many finished matches the 전적 screen lists (ux.md §2.9).
export const RECENT_MAX = 20;

const LEVELS = ['easy', 'normal', 'hard'];
const SAVE_VERSION = 1;

// Values a known pref may take besides "same type as the default". A stored value outside
// the list (an older build, a typo) falls back to the default instead of reaching the UI.
const PREF_CHOICES = {
  fxSpeed: ['normal', 'fast', 'min'],
  motion: ['auto', 'reduce', 'full'],
  input: ['double', 'single'],
  firstRule: ['loser', 'alternate'],
};

// The same for the match setup sheet (SPEC §2). Stage and character ids are only checked for
// shape here: their lists belong to js/themes.js and js/characters.js, and the screens that
// use them already fall back when an id is unknown.
const SETUP_CHOICES = {
  bestOf: [1, 3, 5, 7],
  timer: [0, 10, 20, 30],
  level: LEVELS,
  myColor: ['black', 'white', 'random'],
};
const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const count = (x) => (Number.isInteger(x) && x >= 0 ? x : 0);
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- raw access ---------------------------------------------------------------------------

function store() {
  // Reading the global can itself throw (Safari with storage blocked, sandboxed frames).
  try {
    const s = globalThis.localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

function read(key) {
  try {
    const s = store();
    return s ? s.getItem(key) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function remove(key) {
  try {
    const s = store();
    if (!s) return false;
    s.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function readJson(key) {
  const raw = read(key);
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    return false;
  }
  return typeof json === 'string' ? write(key, json) : false;
}

// ---- prefs --------------------------------------------------------------------------------

function cleanPref(key, value) {
  const def = DEFAULT_PREFS[key];
  if (typeof value !== typeof def) return def;
  if (typeof def === 'number' && !Number.isFinite(value)) return def;
  if (own(PREF_CHOICES, key) && !PREF_CHOICES[key].includes(value)) return def;
  if (key === 'volume') return Math.min(1, Math.max(0, value));
  if (key === 'seenArmHint') return Number.isInteger(value) && value >= 0 ? value : def;
  return value;
}

/** Stored prefs merged into DEFAULT_PREFS. Known keys keep their type; unknown keys pass through. */
export function loadPrefs() {
  const prefs = { ...DEFAULT_PREFS };
  const obj = readJson(KEYS.prefs);
  if (isObj(obj)) {
    for (const key of Object.keys(obj)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      // Keys a later build adds are kept, so a downgrade does not lose them.
      prefs[key] = own(DEFAULT_PREFS, key) ? cleanPref(key, obj[key]) : obj[key];
    }
  }
  return prefs;
}

/** Writes the whole prefs object at once. Returns false when nothing was stored. */
export function savePrefs(prefs) {
  return writeJson(KEYS.prefs, { ...DEFAULT_PREFS, ...(isObj(prefs) ? prefs : {}) });
}

// ---- match setup (the sheet remembers its last values) ------------------------------------

function cleanSetupValue(key, value, def) {
  if (typeof value !== typeof def) return def;
  if (own(SETUP_CHOICES, key)) return SETUP_CHOICES[key].includes(value) ? value : def;
  if (key === 'undo') return Number.isInteger(value) && value >= -1 ? value : def;
  if (typeof def === 'string') return ID_RE.test(value) ? value : def;
  return value;
}

/** DEFAULT_SETUP with every stored value that is still valid. Always a fresh, complete object. */
export function loadSetup() {
  const setup = clone(DEFAULT_SETUP);
  const obj = readJson(KEYS.setup);
  if (!isObj(obj)) return setup;
  for (const group of Object.keys(setup)) {
    const stored = obj[group];
    if (!isObj(stored)) continue;
    for (const key of Object.keys(setup[group])) {
      if (own(stored, key)) setup[group][key] = cleanSetupValue(key, stored[key], setup[group][key]);
    }
  }
  return setup;
}

export function saveSetup(setup) {
  if (!isObj(setup)) return false;
  const out = clone(DEFAULT_SETUP);
  for (const group of Object.keys(out)) {
    if (isObj(setup[group])) out[group] = { ...out[group], ...setup[group] };
  }
  return writeJson(KEYS.setup, out);
}

// ---- the match in progress -----------------------------------------------------------------
//
// Written after every move (SPEC §2) and on hidden / pagehide. The UI stores
// { v:1, theme, match: <js/match.js serialize()> }; a bare serialized match is accepted too.
// Deep validation is js/match.js deserialize()'s job; this only refuses what is not a match
// save at all, so a broken value can never replace a good one.

function isMatchLike(m) {
  return isObj(m) && m.v === SAVE_VERSION && isObj(m.cfg) && Array.isArray(m.moves) &&
    m.moves.every((i) => Number.isInteger(i) && i >= 0 && i < 225);
}

export function isSave(x) {
  return isObj(x) && x.v === SAVE_VERSION && (isMatchLike(x.match) || (!own(x, 'match') && isMatchLike(x)));
}

/** The stored match save as an object, or null when there is none (or it is not a save). */
export function loadSave() {
  const obj = readJson(KEYS.save);
  return isSave(obj) ? obj : null;
}

/**
 * Stores the match in progress. Accepts the JSON string or the object.
 * Returns false when nothing was written: not a save, or storage unavailable / full.
 */
export function saveMatch(save) {
  let obj = save;
  if (typeof save === 'string') {
    try {
      obj = JSON.parse(save);
    } catch {
      return false;
    }
  }
  if (!isSave(obj)) return false;
  return typeof save === 'string' ? write(KEYS.save, save) : writeJson(KEYS.save, obj);
}

export function clearSave() {
  return remove(KEYS.save);
}

// ---- 전적 -----------------------------------------------------------------------------------

function emptyStats() {
  return {
    matches: 0,
    rounds: 0,
    byChar: {},
    cpu: { easy: { w: 0, l: 0 }, normal: { w: 0, l: 0 }, hard: { w: 0, l: 0 } },
    cpuStreak: 0,
    cpuBestStreak: 0,
    fastestKO: null,
    longestRound: 0,
    recent: [],
  };
}

function cleanRecent(r) {
  if (!isObj(r) || !Number.isFinite(r.at)) return null;
  if (r.mode !== '2p' && r.mode !== 'cpu') return null;
  if (typeof r.p1 !== 'string' || typeof r.p2 !== 'string') return null;
  const score = Array.isArray(r.score) && r.score.length === 2 ? r.score.map(count) : [0, 0];
  const out = { at: r.at, mode: r.mode, p1: r.p1, p2: r.p2, score, winner: r.winner === 1 || r.winner === 2 ? r.winner : null };
  if (r.mode === 'cpu' && LEVELS.includes(r.level)) out.level = r.level;
  return out;
}

function cleanStats(obj) {
  const st = emptyStats();
  if (!isObj(obj)) return st;
  st.matches = count(obj.matches);
  st.rounds = count(obj.rounds);
  if (isObj(obj.byChar)) {
    for (const id of Object.keys(obj.byChar)) {
      const r = obj.byChar[id];
      if (!ID_RE.test(id) || !isObj(r)) continue;
      const played = count(r.played);
      st.byChar[id] = { played, won: Math.min(count(r.won), played) };
    }
  }
  if (isObj(obj.cpu)) {
    for (const lv of LEVELS) {
      const r = obj.cpu[lv];
      if (isObj(r)) st.cpu[lv] = { w: count(r.w), l: count(r.l) };
    }
  }
  st.cpuStreak = count(obj.cpuStreak);
  st.cpuBestStreak = Math.max(count(obj.cpuBestStreak), st.cpuStreak);
  st.fastestKO = Number.isInteger(obj.fastestKO) && obj.fastestKO > 0 ? obj.fastestKO : null;
  st.longestRound = count(obj.longestRound);
  if (Array.isArray(obj.recent)) st.recent = obj.recent.map(cleanRecent).filter(Boolean).slice(0, RECENT_MAX);
  return st;
}

/** The 전적, always complete and well-formed (zeros when nothing is stored). */
export function loadStats() {
  return cleanStats(readJson(KEYS.stats));
}

/**
 * Adds one finished match (js/match.js summary()) to the 전적 and stores it.
 * - Fighter use counts the sides people played: both in 2P (a mirror match counts twice,
 *   one win), only 1P against the CPU (the CPU always sits in the 2P slot, SPEC §8.1).
 * - CPU wins/losses and the streak only count a match with a winner.
 * - summary.fastestKO already leaves out the CPU's own K.O.s.
 * `at` exists for tests; the app calls recordMatch(summary).
 * Returns the new stats, or null when the summary is not a match (nothing is written).
 */
export function recordMatch(summary, at = Date.now()) {
  if (!isObj(summary) || (summary.mode !== '2p' && summary.mode !== 'cpu')) return null;
  if (typeof summary.p1 !== 'string' || typeof summary.p2 !== 'string') return null;
  const st = loadStats();
  const winner = summary.winner === 1 || summary.winner === 2 ? summary.winner : null;
  const cpu = summary.mode === 'cpu';

  st.matches += 1;
  st.rounds += Array.isArray(summary.rounds) ? summary.rounds.length : 0;

  const sides = cpu ? [[summary.p1, 1]] : [[summary.p1, 1], [summary.p2, 2]];
  for (const [id, side] of sides) {
    if (!ID_RE.test(id)) continue;
    const r = st.byChar[id] || (st.byChar[id] = { played: 0, won: 0 });
    r.played += 1;
    if (winner === side) r.won += 1;
  }

  if (cpu && LEVELS.includes(summary.level) && winner) {
    if (winner === 1) {
      st.cpu[summary.level].w += 1;
      st.cpuStreak += 1;
      st.cpuBestStreak = Math.max(st.cpuBestStreak, st.cpuStreak);
    } else {
      st.cpu[summary.level].l += 1;
      st.cpuStreak = 0;
    }
  }

  if (Number.isInteger(summary.fastestKO) && summary.fastestKO > 0) {
    st.fastestKO = st.fastestKO === null ? summary.fastestKO : Math.min(st.fastestKO, summary.fastestKO);
  }
  if (Number.isInteger(summary.longestRound) && summary.longestRound > st.longestRound) {
    st.longestRound = summary.longestRound;
  }

  const entry = cleanRecent({
    at: Number.isFinite(at) ? at : Date.now(),
    mode: summary.mode, p1: summary.p1, p2: summary.p2,
    score: Array.isArray(summary.score) ? summary.score : [0, 0],
    winner, level: summary.level,
  });
  if (entry) st.recent = [entry, ...st.recent].slice(0, RECENT_MAX);

  writeJson(KEYS.stats, st);
  return st;
}

/** 기록 지우기. Returns true when the stored 전적 is gone. */
export function resetStats() {
  return remove(KEYS.stats);
}
