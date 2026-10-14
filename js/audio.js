// Sound for 돌주먹 (SPEC §8.4, docs/research/ux.md §4, docs/research/characters.md §7).
//
// Web Audio synthesis only: no sound files, no <audio> element, no speechSynthesis. A media
// element anywhere in the app would switch iOS to the media-playback session, which ignores the
// silent switch and pauses the owner's music; the "ambient" session keeps the game as polite as
// a native one (unless the player opts into "무음 모드에서도 소리").
//
// The file has two halves:
//
//   1. Synthesis: createGraph / scheduleSfx / scheduleJingle. Plain functions over any
//      BaseAudioContext, so the very same code renders into an OfflineAudioContext. That is how
//      tools/demo-audio.html and tests/audio.test.js measure every sound (loudness, clipping,
//      length, spectrum): nobody can listen in CI.
//   2. The iOS lifecycle, ported from pumal's js/audio.js almost line for line: unlock on
//      touchend/click/keydown, the frozen-clock watchdog, the suspend/resume ladder, rebuilding
//      inside a real tap, closing old contexts, the REPLAY_MS replay and silence when hidden.
//
// Everything is progressive enhancement: with no AudioContext, no document, or a context iOS
// refuses to start, every call is a silent no-op and the game still reads from the screen alone.
//
// Public API (SPEC §8.4): audio.{ init(prefs), unlock(), play(name, opts?), jingle(spec, {delay})
// → {stop()}, stopAll(), setEnabled(on), isEnabled(), setVolume(0..1), setIgnoreSilent(on) },
// SFX_NAMES, CHAR_SFX. For tests, tools and the character lint: parseJingle, jingleLength, noteHz,
// patchFor, hasSound, PATCHES, DRUMS, WAVES, PLACE_THEMES, createGraph, scheduleSfx, scheduleJingle.

const g = globalThis;

// ---------------------------------------------------------------------------------------
// Names (the contract other modules and the character files are linted against)
// ---------------------------------------------------------------------------------------

/** UI sounds (ux.md §4.2). */
export const SFX_NAMES = [
  'place', 'arm', 'cursor', 'occupied', 'deny', 'menu', 'ok', 'cancel', 'pick1', 'pick2',
  'vs', 'round', 'fight', 'ko', 'roundWin', 'matchWin', 'lose', 'tick', 'tickHi', 'timeover',
  'undo', 'coin', 'draw', 'toast',
];

/** Character cue sounds: the only names a character's `cues[].sfx` / `turnSfx` may use. */
export const CHAR_SFX = [
  'WHOOSH', 'SWISH', 'SCRATCH', 'POP', 'TING', 'BOING', 'PUNCH', 'CLUNK', 'ZAP', 'BELL',
  'BLIP', 'SNIFF', 'COUGH', 'GIGGLE', 'HUP', 'WHIRR', 'SPLAT', 'CRACKLE',
];

/** Drum-lane kit tokens. A jingle's drums lane also accepts every CHAR_SFX name. */
export const DRUMS = ['K', 'S', 'H', 'BELL'];

/** Wave types a jingle voice may ask for. pulse25 is a 25 % pulse built as a PeriodicWave. */
export const WAVES = ['square', 'triangle', 'sine', 'sawtooth', 'pulse25'];

/** `place` variants, one per board theme (themes.js `placeSound`). */
export const PLACE_THEMES = ['mat', 'neon', 'dojo', 'pixel', 'wood'];

// ---------------------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------------------

const MASTER = 0.9;            // master gain = 0.9 × the volume setting (ux.md §4.1)
const DEFAULT_VOLUME = 0.8;    // storage.js DEFAULT_PREFS.volume
// The compressor is the safety net that lets a K.O. at 0.9 and a menu tick at 0.05 share one
// bus. Note that Web Audio adds automatic make-up gain (about +6 dB with these settings), so
// quiet sounds come out louder than their table value; the offline QA measures the result.
const COMP = { threshold: -14, knee: 6, ratio: 4, attack: 0.003, release: 0.15 };
// After the compressor sits a guard: a WaveShaper that is exactly linear up to 0.85 and bends
// softly towards 0.99 above it. Every single sound peaks well under 0.85 (the offline QA checks
// that), so the guard only ever acts when many loud sounds pile up at once, where the
// compressor's 3 ms attack would otherwise let a transient clip.
const GUARD_KNEE = 0.85;
const GUARD_CEIL = 0.99;
const NOISE_S = 1;            // one shared second of white noise per context
const IR_S = 1.6;              // synthetic reverb tail (-60 dB at the end)
const LEAD_S = 0.008;          // schedule a few render quanta ahead so the attack is never cut
const NOTE_ATTACK_S = 0.004;   // jingle notes: 4 ms linear attack (as in pumal)
const BOING_S = 0.04;          // '^': glide up from a fourth below in 40 ms
const FOURTH = 2 ** (5 / 12);
const GLIDE_PART = 0.8;        // '>X': reach the target at 80 % of the note, then hold it
const VIB_HZ = 6;              // '~': 6 Hz, ±15 cents, eased in so the attack stays in tune
const VIB_CENTS = 15;
const VIB_ONSET_S = 0.06;
const JINGLE_REV = 0.1;        // a little room around every jingle
const MAX_JINGLE_MS = 1600;    // SPEC §8.4: a jingle is at most 1.6 s (tails may ring on)
const DEFAULT_GAIN = 0.07;     // a jingle voice without `gain`; also the drums' "house level"
const MAX_GAIN = 0.2;
const VARY = 0.06;             // place: ±6 % pitch per stone, peak 0.9–1.0
const WHITE_UP = 1.08;         // place: white stones are 8 % brighter (shell stones)
const DEBOUNCE_MS = 40;        // the same sound never retriggers within 40 ms
const DUCK_MS = 700;           // after a K.O. hit, small ticks stay quiet this long

// Lifecycle (pumal js/audio.js, unchanged values)
const WATCH_MS = 400;          // how long the audio clock gets to prove it is moving
const KICK_GAP_MS = 200;       // pause between suspend() and resume() on rung 2 (WebKit bug 281566)
const FROZEN_MS = 250;         // "running" but currentTime unchanged for this long = stuck clock
const MAX_REBUILDS = 3;        // stop recreating contexts when there is clearly no audio device
// A sound is often requested on pointerdown, but a finger only grants audio activation on
// touchend. Keep the most recent locked-out request this long so the unlocking tap itself still
// sounds (the title screen's "화면을 터치하세요" tap). 0 = strict "drop when locked".
const REPLAY_MS = 300;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Small deterministic PRNG for the noise buffer, the reverb tail and the crackle layout, so an
// offline render is reproducible and a measurement means the same thing twice.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------
// Pitch: equal temperament, A4 = 440 Hz
// ---------------------------------------------------------------------------------------

const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_RE = /^([A-G])(#|b)?([0-8])$/;

/** 'A4' → 440, 'C#5' → 554.37, 'Eb3' → 155.56. Anything else → 0. */
export function noteHz(name) {
  const m = NOTE_RE.exec(String(name));
  if (!m) return 0;
  const midi = 12 * (Number(m[3]) + 1) + SEMITONE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
}

// ---------------------------------------------------------------------------------------
// Jingle format (SPEC §8.4)
//
//   { at, voices: [ { wave, gain, lowpass?, notes:'C3:316 Eb3~:158 A4>C5:180 C5^:110 -:50' },
//                   { drums:'K:158 -:158 S:158 BELL:400 TING:140' } ] }
//
// A token is <head>:<ms>. Note heads are <name><octave> plus any of '~' (vibrato), '>X' (glide
// to X) and '^' (boing up from a fourth below); '-' is a rest. Drum heads are K S H BELL or any
// CHAR_SFX name, and the ms is the step to the next token (the hit itself rings its own length).
// ---------------------------------------------------------------------------------------

const TOKEN_RE = /^([^:\s]+):(\d+(?:\.\d+)?)$/;
const HEAD_RE = /^([A-G](?:#|b)?[0-8])((?:>[A-G](?:#|b)?[0-8]|~|\^)*)$/;
const GLIDE_RE = />([A-G](?:#|b)?[0-8])/g;

/**
 * Pure parser (no Web Audio). Returns
 *   { events, total, errors }
 * events: sorted by start time, then voice index:
 *   { kind:'note', voice, t, dur, hz, glide:[hz…], vibrato, boing, wave, gain, lowpass }
 *   { kind:'drum', voice, t, dur, name, gain }
 * t and dur are in ms; total = the longest voice in ms (rests included).
 * A bad token becomes a rest of its length (or is skipped) and is listed in `errors`: a typo in
 * one character file must not take the whole app down.
 */
export function parseJingle(spec) {
  const voices = Array.isArray(spec) ? spec : (spec && Array.isArray(spec.voices) ? spec.voices : []);
  const events = [];
  const errors = [];
  let total = 0;
  voices.forEach((v, i) => {
    if (!v || typeof v !== 'object') { errors.push(`voice ${i}: not an object`); return; }
    const drums = typeof v.drums === 'string';
    const src = drums ? v.drums : (typeof v.notes === 'string' ? v.notes : null);
    if (src === null) { errors.push(`voice ${i}: needs notes or drums`); return; }
    const gain = typeof v.gain === 'number' && Number.isFinite(v.gain) && v.gain > 0
      ? Math.min(MAX_GAIN, v.gain) : DEFAULT_GAIN;
    let wave = 'square';
    if (!drums) {
      if (WAVES.includes(v.wave)) wave = v.wave;
      else errors.push(`voice ${i}: unknown wave "${v.wave}" (square used)`);
    }
    const lowpass = typeof v.lowpass === 'number' && Number.isFinite(v.lowpass) ? clamp(v.lowpass, 200, 20000) : 0;
    let t = 0;
    for (const tok of src.trim().split(/\s+/)) {
      if (!tok) continue;
      const m = TOKEN_RE.exec(tok);
      if (!m) { errors.push(`voice ${i}: bad token "${tok}"`); continue; }
      const head = m[1];
      const dur = Number(m[2]);
      if (head !== '-' && dur > 0) {
        if (drums) {
          if (DRUMS.includes(head) || CHAR_SFX.includes(head)) events.push({ kind: 'drum', voice: i, t, dur, name: head, gain });
          else errors.push(`voice ${i}: unknown drum "${head}"`);
        } else {
          const n = HEAD_RE.exec(head);
          if (!n) errors.push(`voice ${i}: bad note "${head}"`);
          else {
            const mods = n[2];
            const glide = [...mods.matchAll(GLIDE_RE)].map((x) => noteHz(x[1]));
            events.push({
              kind: 'note', voice: i, t, dur, hz: noteHz(n[1]), glide,
              vibrato: mods.includes('~'), boing: mods.includes('^'), wave, gain, lowpass,
            });
          }
        }
      }
      t += dur;
    }
    total = Math.max(total, t);
  });
  events.sort((a, b) => a.t - b.t || a.voice - b.voice);
  return { events, total, errors };
}

/** Length of a jingle in ms (the longest voice, rests included). */
export function jingleLength(spec) {
  return parseJingle(spec).total;
}

// ---------------------------------------------------------------------------------------
// The one table to tweak: name -> patch
//
// A patch is { layers:[…], rev?, small?, vary? } or { tune:<jingle spec>, rev?, small? }.
// Layer fields (times in ms, levels are envelope peaks before the master gain):
//   src     'noise' | 'sine' | 'triangle' | 'square' | 'sawtooth' | 'pulse25'
//   at      start offset inside the sound
//   f       Hz, or a path [[ms, Hz], …] of exponential glides (ignored for noise)
//   filter  { type:'lowpass'|'highpass'|'bandpass', f: Hz | path, q }
//   peak    envelope peak; attack (default 1), hold (default 0), tau = exponential decay
//           time constant (0 = sustain), dur = hard stop (default attack + hold + 6·tau)
//   drive   tanh saturation amount: harmonics are what make a low thump audible on an iPhone
//           speaker, which reproduces almost nothing below 300 Hz
//   detune  cents
//   lfo     { hz, depth, to:'pitch' (cents) | 'freq' (Hz) | 'filter' (Hz) | 'amp' (0–1) }
// rev = reverb send (0–1); small = a tick that a K.O. cuts; vary = place's random variation;
// ms = the animation length the layers' `at` times are written for: play(name, { ms }) scales
// those offsets (not the sounds themselves) so the patch follows a faster or slower animation.
// All tunes are composed for this project (no imitation of known game fanfares).
//
// The recipes follow ux.md §4.2 and characters.md §7; the levels do not copy their numbers.
// They were calibrated with the offline QA (tools/demo-audio.html, tests/audio.test.js) against
// what a phone speaker gives back (loudness after a 300 Hz high-pass), into this order:
//   K.O. ≈ −12 dB > VS / FIGHT! / TIME OVER ≈ −15 > fanfares, cues ≈ −16…−21 > the stone ≈ −18
//   > menu / ok ≈ −22…−24 > ticks ≈ −25…−28 > the drag tick ≈ −34
// Two things drove most of the changes: band-passed noise needs a far higher envelope peak than a
// tone to be as loud, and the compressor's make-up gain (~+6 dB) reaches a sharp transient before
// its gain reduction does, so clicks have 1.5 ms attacks and loud noise is saturated (low crest
// factor) to keep every single sound under 0.85 out of the compressor.
// ---------------------------------------------------------------------------------------

// "탁": the most frequent sound in the game (ux.md §4.2). Shared by wood and dojo.
const PLACE_CLASSIC = [
  { src: 'noise', filter: { type: 'bandpass', f: 2800, q: 2.5 }, peak: 1.1, attack: 1.5, tau: 9, dur: 40 },
  { src: 'triangle', f: [[0, 900], [25, 600]], peak: 0.5, attack: 1.5, tau: 18, dur: 110 },
  { src: 'sine', f: [[0, 220], [60, 160]], peak: 0.1, attack: 1.5, tau: 28, dur: 170 },
];

const PLACE = {
  wood: { vary: true, layers: PLACE_CLASSIC },
  dojo: { vary: true, rev: 0.08, layers: PLACE_CLASSIC },   // the same stone, in a wooden hall
  // battle mat: cardboard swallows the click, so the noise is a dull low-passed thud
  mat: {
    vary: true,
    layers: [
      { src: 'noise', filter: { type: 'lowpass', f: 1200, q: 0 }, peak: 1.2, attack: 1.5, tau: 9, dur: 45 },
      PLACE_CLASSIC[1],
      { ...PLACE_CLASSIC[2], drive: 2, peak: 0.12 },
    ],
  },
  // neon arcade: the classic click with a square-wave blip mixed in
  neon: {
    vary: true,
    layers: [
      ...PLACE_CLASSIC,
      { src: 'square', f: [[0, 1200], [40, 700]], filter: { type: 'lowpass', f: 4000, q: 0 }, peak: 0.1, attack: 1.5, tau: 25, dur: 60 },
    ],
  },
  // 8-bit: a two-step beep, plus a faint click so it still feels like a stone landing
  pixel: {
    vary: true,
    layers: [
      { src: 'square', f: 880, filter: { type: 'lowpass', f: 6000, q: 0 }, peak: 0.13, attack: 1, hold: 22, tau: 0, dur: 30 },
      { src: 'square', at: 30, f: 1320, filter: { type: 'lowpass', f: 6000, q: 0 }, peak: 0.12, attack: 1, hold: 12, tau: 0, dur: 20 },
      { src: 'noise', filter: { type: 'bandpass', f: 2400, q: 1.5 }, peak: 0.6, attack: 1, tau: 3, dur: 15 },
    ],
  },
};

// The drum kit (characters.md §7). The kick's sine is pushed through tanh and gets a beater
// click: a bare 150→45 Hz sine is silent on a phone speaker.
const KIT = {
  K: {
    layers: [
      { src: 'sine', f: [[0, 150], [120, 45]], drive: 4, peak: 0.3, attack: 1.5, tau: 60, dur: 180 },
      { src: 'noise', filter: { type: 'bandpass', f: 3200, q: 1 }, peak: 0.9, attack: 1.5, tau: 3, dur: 12 },
    ],
  },
  S: {
    layers: [
      { src: 'noise', filter: { type: 'highpass', f: 1200, q: 0 }, peak: 0.26, attack: 1.5, tau: 40, dur: 140 },
      { src: 'triangle', f: 190, drive: 2, peak: 0.22, attack: 1.5, tau: 20, dur: 60 },
    ],
  },
  H: {
    layers: [
      { src: 'noise', filter: { type: 'highpass', f: 7000, q: 0 }, peak: 0.25, attack: 1, tau: 9, dur: 40 },
    ],
  },
};

// Coin toss: eight ticks that speed up while the coin spins, then a "띵" as it lands. The UI lands
// the coin at 0.8 × its duration (1.2 s at normal speed); play('coin', { ms }) re-times the whole
// patch to another duration (see `ms` below).
const COIN_TICKS = [0, 190, 350, 480, 590, 685, 765, 835];

// Crackle: a fixed, irregular spray of tiny high clicks (fireworks, a flickering lantern).
const CRACKLE_LAYERS = (() => {
  const r = prng(0xC4AC);
  const out = [];
  let at = 0;
  for (let i = 0; i < 14; i++) {
    out.push({
      src: 'noise', at: Math.round(at), filter: { type: 'bandpass', f: 1800 + r() * 3200, q: 1.2 },
      peak: 0.35 + r() * 0.45, attack: 0.2, tau: 2 + r() * 3, dur: 14,
    });
    at += 10 + r() * 28;
  }
  return out;
})();

// Character confirmed: a two-note square stab, a bright click and a small driven kick.
function pick(lo, hi) {
  return {
    layers: [
      { src: 'square', f: lo, filter: { type: 'lowpass', f: 5000, q: 0 }, peak: 0.09, attack: 1, hold: 70, tau: 0, dur: 90 },
      { src: 'square', f: hi, filter: { type: 'lowpass', f: 5000, q: 0 }, peak: 0.08, attack: 1, hold: 70, tau: 0, dur: 90 },
      { src: 'noise', filter: { type: 'highpass', f: 2000, q: 0 }, peak: 0.4, attack: 0.5, tau: 10, dur: 40 },
      { src: 'sine', f: [[0, 150], [80, 60]], drive: 2, peak: 0.4, attack: 1, tau: 30, dur: 80 },
    ],
  };
}

export const PATCHES = {
  // ---- board
  arm: { small: true, layers: [{ src: 'sine', f: 2000, peak: 0.14, attack: 1, tau: 7, dur: 22 }] },
  cursor: { small: true, layers: [{ src: 'sine', f: 3000, peak: 0.11, attack: 0.5, tau: 3, dur: 9 }] },
  occupied: {
    small: true,
    layers: [
      { src: 'triangle', f: 400, peak: 0.15, attack: 1, tau: 14, dur: 40 },
      { src: 'sine', f: 1200, peak: 0.06, attack: 0.5, tau: 6, dur: 24 },
    ],
  },
  // 금수 버저 "삐빅": 196 + 207.7 Hz beat against each other, the 392 Hz octave carries it on a phone
  deny: {
    layers: [0, 130].flatMap((at) => [196, 207.7, 392].map((f) => (
      { src: 'square', at, f, filter: { type: 'lowpass', f: 1500, q: 0 }, peak: 0.07, attack: 2, hold: 82, tau: 0, dur: 90 }
    ))),
  },

  // ---- menus
  menu: { small: true, layers: [{ src: 'square', f: 1568, filter: { type: 'lowpass', f: 4000, q: 0 }, peak: 0.085, attack: 1, hold: 12, tau: 0, dur: 20 }] },
  ok: { tune: { voices: [{ wave: 'square', gain: 0.06, lowpass: 4000, notes: 'C6:40 G6:70' }] } },
  cancel: { tune: { voices: [{ wave: 'square', gain: 0.06, lowpass: 4000, notes: 'G6:40 C6:70' }] } },
  toast: { tune: { voices: [{ wave: 'sine', gain: 0.05, notes: 'E6:50 -:20 A6:90' }] } },

  // ---- character select / VS
  pick1: pick(659, 988),
  pick2: pick(587, 880),                    // 2P: a step lower
  // VS collision: kick + a body hit you can hear on a phone + a long bright crash
  vs: {
    rev: 0.3,
    layers: [
      { src: 'sine', f: [[0, 160], [120, 45]], drive: 2.5, peak: 0.37, attack: 6, tau: 70, dur: 260 },
      { src: 'noise', filter: { type: 'bandpass', f: 1200, q: 0.8 }, drive: 2, peak: 0.5, attack: 6, tau: 40, dur: 160 },
      { src: 'noise', filter: { type: 'highpass', f: 3000, q: 0 }, peak: 0.41, attack: 6, tau: 200, dur: 500 },
    ],
  },

  // ---- round start: a 180 ms riser that slams with the ROUND banner (ban-slam is 200 ms)
  round: {
    rev: 0.25,
    layers: [
      { src: 'noise', filter: { type: 'bandpass', f: [[0, 300], [180, 2500]], q: 1.2 }, peak: 0.6, attack: 180, hold: 0, tau: 0, dur: 195 },
      { src: 'sine', at: 190, f: [[0, 150], [120, 45]], drive: 2.5, peak: 0.4, attack: 1, tau: 60, dur: 200 },
      { src: 'noise', at: 190, filter: { type: 'bandpass', f: 1500, q: 0.9 }, peak: 0.9, attack: 1, tau: 30, dur: 120 },
      ...[220, 330, 440].flatMap((f) => [-7, 7].map((detune) => (
        { src: 'sawtooth', at: 190, f, detune, filter: { type: 'lowpass', f: 2500, q: 0 }, peak: 0.05, attack: 3, hold: 120, tau: 60, dur: 330 }
      ))),
    ],
  },
  // FIGHT!: the whoosh sweeps up while the word flies in; the hit lands with the slam (30 % of 500 ms)
  fight: {
    rev: 0.2,
    layers: [
      { src: 'noise', filter: { type: 'bandpass', f: [[0, 600], [250, 5000], [380, 2000]], q: 1.2 }, peak: 0.75, attack: 30, hold: 220, tau: 80, dur: 400 },
      { src: 'square', at: 150, f: 523, filter: { type: 'lowpass', f: 5000, q: 0 }, peak: 0.06, attack: 1, hold: 100, tau: 0, dur: 120 },
      { src: 'square', at: 150, f: 784, filter: { type: 'lowpass', f: 5000, q: 0 }, peak: 0.05, attack: 1, hold: 100, tau: 0, dur: 120 },
      { src: 'sine', at: 150, f: [[0, 150], [120, 45]], drive: 2.5, peak: 0.5, attack: 1, tau: 60, dur: 180 },
      { src: 'sawtooth', at: 150, f: [[0, 1200], [150, 200]], filter: { type: 'lowpass', f: 6000, q: 0 }, peak: 0.08, attack: 1, tau: 60, dur: 160 },
    ],
  },

  // ---- K.O.: the biggest sound in the game. A clean kick for earphones (landing 8 ms after the
  // crunch, so the two transients do not stack); for the phone speaker a hard
  // tanh crunch, a saturated 1.5 kHz body and a driven mid thump; a slow-motion saw dive; 35 %
  // reverb. Heavily saturated noise has a low crest factor, so it is loud without spiking: the
  // worst peak over many noise offsets stays near 0.8 out of the compressor.
  ko: {
    rev: 0.35,
    layers: [
      { src: 'sine', at: 8, f: [[0, 120], [250, 35]], peak: 0.28, attack: 6, tau: 160, dur: 600 },
      { src: 'noise', filter: { type: 'lowpass', f: 3500, q: 0 }, drive: 8, peak: 0.57, attack: 8, tau: 80, dur: 360 },
      { src: 'noise', filter: { type: 'bandpass', f: 1500, q: 0.8 }, drive: 3, peak: 0.36, attack: 8, tau: 50, dur: 200 },
      { src: 'triangle', f: [[0, 180], [150, 90]], drive: 3, peak: 0.4, attack: 6, tau: 50, dur: 200 },
      { src: 'sawtooth', f: [[0, 400], [600, 80]], filter: { type: 'lowpass', f: 800, q: 0 }, peak: 0.11, attack: 5, hold: 400, tau: 80, dur: 620 },
    ],
  },
  roundWin: {
    tune: {
      voices: [
        { wave: 'square', gain: 0.09, lowpass: 5000, notes: 'G5:80 E5:80 G5:80 C6~:420' },
        { wave: 'triangle', gain: 0.1, notes: 'C3:160 G3:80 C4~:420' },
      ],
    },
  },
  // ~1.6 s fanfare, composed for this game: a rising C-major call, then A-B leading home to C.
  matchWin: {
    rev: 0.15,
    tune: {
      voices: [
        { wave: 'square', gain: 0.09, lowpass: 5000, notes: 'C5:120 E5:120 G5:120 C6:360 -:60 A5:120 B5:120 C6~:580' },
        { wave: 'triangle', gain: 0.07, notes: 'E4:360 G4:360 -:60 F4:120 G4:120 E4~:580' },
        { wave: 'triangle', gain: 0.1, notes: 'C3:720 -:60 F3:120 G3:120 C3:580' },
        { drums: 'K:360 S:360 -:60 K:120 K:120 S:580' },
      ],
    },
  },
  lose: { tune: { voices: [{ wave: 'square', gain: 0.11, lowpass: 2000, notes: 'G4:150 F#4:150 F4:150 E4~:400' }] } },

  // ---- timer and misc
  tick: { small: true, layers: [{ src: 'sine', f: 1000, peak: 0.08, attack: 1, hold: 16, tau: 0, dur: 25 }] },
  tickHi: { small: true, layers: [{ src: 'sine', f: 1500, peak: 0.115, attack: 1, hold: 16, tau: 0, dur: 25 }] },
  timeover: {
    rev: 0.15,
    layers: [
      { src: 'square', f: [[0, 880], [400, 220]], filter: { type: 'lowpass', f: 3000, q: 0 }, peak: 0.15, attack: 2, hold: 360, tau: 30, dur: 420 },
      ...KIT.K.layers,
    ],
  },
  // 되감기: everything sweeps down
  undo: {
    layers: [
      { src: 'noise', filter: { type: 'bandpass', f: [[0, 3000], [220, 400]], q: 1.5 }, peak: 0.4, attack: 5, hold: 150, tau: 30, dur: 220 },
      { src: 'sawtooth', f: [[0, 800], [220, 200]], filter: { type: 'lowpass', f: 3000, q: 0 }, peak: 0.05, attack: 5, hold: 160, tau: 25, dur: 220 },
    ],
  },
  coin: {
    ms: 1200,
    layers: [
      ...COIN_TICKS.map((at, i) => (
        { src: 'square', at, f: 1900 + 70 * i, filter: { type: 'lowpass', f: 5000, q: 0 }, peak: 0.05, attack: 0.5, tau: 4, dur: 16 }
      )),
      { src: 'sine', at: 960, f: 1760, peak: 0.08, attack: 2, tau: 300, dur: 1500 },
      { src: 'sine', at: 960, f: 2640, peak: 0.05, attack: 2, tau: 200, dur: 1100 },
    ],
  },
  draw: { tune: { voices: [{ wave: 'sine', gain: 0.1, notes: 'E5:200 -:80 E5:200' }] } },

  // ---- character cue sounds (characters.md §7)
  WHOOSH: {
    layers: [{ src: 'noise', filter: { type: 'bandpass', f: [[0, 300], [250, 2400]], q: 1.2 }, peak: 0.6, attack: 140, hold: 0, tau: 50, dur: 300 }],
  },
  SWISH: {
    layers: [{ src: 'noise', filter: { type: 'bandpass', f: [[0, 1500], [90, 6000], [160, 3000]], q: 2 }, peak: 0.53, attack: 60, hold: 0, tau: 30, dur: 170 }],
  },
  // DJ scratch: a saw whose pitch is rocked by a 14 Hz LFO, through a 1 kHz band
  SCRATCH: {
    layers: [
      { src: 'sawtooth', f: 500, lfo: { hz: 14, depth: 250, to: 'freq' }, filter: { type: 'bandpass', f: 1000, q: 1.5 }, peak: 0.28, attack: 5, hold: 150, tau: 0, dur: 180 },
      { src: 'noise', filter: { type: 'bandpass', f: 2500, q: 2 }, lfo: { hz: 14, depth: 0.8, to: 'amp' }, peak: 0.2, attack: 5, hold: 150, tau: 0, dur: 180 },
    ],
  },
  POP: {
    layers: [
      { src: 'sine', f: [[0, 900], [50, 300]], peak: 0.15, attack: 1, hold: 30, tau: 10, dur: 70 },
      { src: 'sine', f: [[0, 1800], [50, 600]], peak: 0.05, attack: 1, tau: 12, dur: 50 },
    ],
  },
  TING: {
    layers: [
      { src: 'sine', f: 3520, peak: 0.14, attack: 1, hold: 10, tau: 30, dur: 160 },
      { src: 'sine', f: 3520 * 2.76, peak: 0.02, attack: 1, tau: 12, dur: 60 },
    ],
  },
  BOING: {
    layers: [
      { src: 'sine', f: [[0, 660 / 1.33], [40, 660]], lfo: { hz: 11, depth: 80, to: 'pitch' }, peak: 0.11, attack: 2, hold: 60, tau: 110, dur: 420 },
      { src: 'triangle', f: [[0, 1320 / 1.33], [40, 1320]], lfo: { hz: 11, depth: 80, to: 'pitch' }, peak: 0.028, attack: 2, hold: 40, tau: 80, dur: 300 },
    ],
  },
  // A glove hit: a low-passed thud as asked, plus two saturated slap bands so it reads on a phone
  PUNCH: {
    layers: [
      { src: 'noise', filter: { type: 'lowpass', f: 900, q: 0 }, peak: 0.3, attack: 2, tau: 15, dur: 60 },
      { src: 'noise', filter: { type: 'bandpass', f: 800, q: 1 }, drive: 4, peak: 0.5, attack: 2, tau: 15, dur: 60 },
      { src: 'noise', filter: { type: 'bandpass', f: 1800, q: 1 }, drive: 4, peak: 0.55, attack: 1.5, tau: 9, dur: 40 },
      { src: 'sine', f: [[0, 140], [50, 60]], drive: 3, peak: 0.12, attack: 2, tau: 25, dur: 80 },
    ],
  },
  CLUNK: {
    layers: [
      { src: 'triangle', f: [[0, 140], [40, 110]], drive: 3, peak: 0.4, attack: 0.5, tau: 22, dur: 70 },
      { src: 'noise', filter: { type: 'bandpass', f: 2500, q: 3 }, peak: 2.2, attack: 1, tau: 6, dur: 24 },
      { src: 'square', f: 523, filter: { type: 'lowpass', f: 1800, q: 0 }, peak: 0.1, attack: 0.5, tau: 18, dur: 80 },
      { src: 'sine', f: 1170, peak: 0.3, attack: 0.5, tau: 25, dur: 100 },
    ],
  },
  ZAP: {
    layers: [
      { src: 'square', f: [[0, 1800], [140, 120]], filter: { type: 'lowpass', f: 6000, q: 0 }, peak: 0.085, attack: 0.5, hold: 110, tau: 20, dur: 160 },
      { src: 'noise', filter: { type: 'highpass', f: 3000, q: 0 }, peak: 0.3, attack: 1, tau: 15, dur: 60 },
    ],
  },
  // Ring bell "땡": inharmonic partials at f, 2.76 f, 5.40 f; the higher ones die sooner
  BELL: {
    rev: 0.15,
    layers: [
      { src: 'sine', f: 880, peak: 0.13, attack: 1, tau: 260, dur: 1300 },
      { src: 'sine', f: 880 * 2.76, peak: 0.065, attack: 1, tau: 150, dur: 900 },
      { src: 'sine', f: 880 * 5.4, peak: 0.032, attack: 1, tau: 70, dur: 450 },
      { src: 'noise', filter: { type: 'highpass', f: 4000, q: 0 }, peak: 0.1, attack: 0.5, tau: 3, dur: 12 },
    ],
  },
  // robot "삐"
  BLIP: {
    layers: [{ src: 'pulse25', f: [[0, 1400], [30, 1760]], filter: { type: 'lowpass', f: 5000, q: 0 }, peak: 0.13, attack: 1, hold: 30, tau: 8, dur: 55 }],
  },
  // a quick nasal inhale "흡"
  SNIFF: {
    layers: [
      { src: 'noise', filter: { type: 'bandpass', f: [[0, 2000], [170, 4200]], q: 2.5 }, peak: 0.4, attack: 140, hold: 0, tau: 15, dur: 200 },
      { src: 'noise', filter: { type: 'bandpass', f: 900, q: 3 }, peak: 0.15, attack: 120, hold: 0, tau: 15, dur: 180 },
    ],
  },
  // a dry "켁": noise through two formant bands, saturated, over a falling driven grunt
  COUGH: {
    layers: [
      { src: 'noise', filter: { type: 'bandpass', f: 900, q: 1.5 }, drive: 2, peak: 0.65, attack: 4, tau: 45, dur: 180 },
      { src: 'noise', filter: { type: 'bandpass', f: 2300, q: 4 }, peak: 0.47, attack: 4, tau: 35, dur: 150 },
      { src: 'triangle', f: [[0, 260], [120, 170]], drive: 2.5, peak: 0.17, attack: 4, tau: 40, dur: 160 },
    ],
  },
  // ghost "키득키득": four high, wobbly hee-notes stepping down, with a little breath
  GIGGLE: {
    layers: [
      ...[[0, 1318], [95, 1175], [190, 1318], [285, 1046]].map(([at, f]) => (
        { src: 'triangle', at, f, lfo: { hz: 18, depth: 60, to: 'pitch' }, filter: { type: 'lowpass', f: 3500, q: 0 }, peak: 0.12, attack: 6, hold: 30, tau: 20, dur: 75 }
      )),
      ...[0, 95, 190, 285].map((at) => (
        { src: 'noise', at, filter: { type: 'bandpass', f: 3200, q: 2 }, peak: 0.12, attack: 6, tau: 20, dur: 60 }
      )),
    ],
  },
  // boxer "흡!": a voiced saw through a vowel band, a short breath on top
  HUP: {
    layers: [
      { src: 'sawtooth', f: [[0, 220], [110, 180]], filter: { type: 'bandpass', f: 900, q: 2 }, peak: 0.65, attack: 8, hold: 30, tau: 35, dur: 140 },
      { src: 'sawtooth', f: [[0, 220], [110, 180]], filter: { type: 'bandpass', f: 2400, q: 4 }, peak: 0.33, attack: 8, hold: 30, tau: 30, dur: 130 },
      { src: 'noise', filter: { type: 'bandpass', f: 1600, q: 1 }, peak: 0.16, attack: 3, tau: 25, dur: 90 },
    ],
  },
  // a small motor spinning up (headspin, malfunction spin)
  WHIRR: {
    layers: [
      { src: 'sawtooth', f: [[0, 180], [400, 420]], lfo: { hz: 28, depth: 0.6, to: 'amp' }, filter: { type: 'bandpass', f: 1200, q: 1.2 }, peak: 0.45, attack: 60, hold: 260, tau: 40, dur: 420 },
      { src: 'square', f: [[0, 360], [400, 840]], filter: { type: 'lowpass', f: 2500, q: 0 }, peak: 0.03, attack: 60, hold: 260, tau: 40, dur: 420 },
    ],
  },
  // pudding "철퍼덕": a wet noise slap closing down, over a driven falling thump
  SPLAT: {
    layers: [
      { src: 'noise', filter: { type: 'lowpass', f: [[0, 3000], [150, 500]], q: 4 }, peak: 0.65, attack: 3, tau: 60, dur: 240 },
      { src: 'triangle', f: [[0, 260], [120, 90]], drive: 2.5, peak: 0.3, attack: 3, tau: 50, dur: 200 },
      { src: 'noise', filter: { type: 'bandpass', f: 1100, q: 3 }, peak: 0.5, attack: 2, tau: 25, dur: 90 },
    ],
  },
  CRACKLE: { layers: CRACKLE_LAYERS },
};

// ---------------------------------------------------------------------------------------
// Synthesis over any BaseAudioContext
// ---------------------------------------------------------------------------------------

function makeNoise(c) {
  const sr = c.sampleRate;
  const buf = c.createBuffer(1, Math.round(sr * NOISE_S), sr);
  const d = buf.getChannelData(0);
  const r = prng(0x0D01);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return buf;
}

// 1.6 s stereo impulse response: decorrelated noise under an exponential decay, darkening as it
// fades (a one-pole low-pass that closes over time), after an 8 ms pre-delay.
function makeIR(c) {
  const sr = c.sampleRate;
  const n = Math.round(sr * IR_S);
  const buf = c.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const r = prng(0x1E5 + ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const k = 0.2 + 0.75 * (t / IR_S);
      lp += (1 - k) * ((r() * 2 - 1) - lp);
      const fadeIn = t < 0.008 ? 0 : Math.min(1, (t - 0.008) / 0.004);
      d[i] = lp * Math.exp(-6.9 * t / IR_S) * fadeIn;
    }
  }
  return buf;
}

// 25 % pulse: c_n = 2/(nπ)·sin(nπ/4) on the cosine terms (DC left out).
function makePulse25(c) {
  const N = 48;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let n = 1; n < N; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25);
  return c.createPeriodicWave(real, imag);
}

function tanhCurve(graph, drive) {
  const key = Math.round(drive * 100);
  let curve = graph.curves.get(key);
  if (!curve) {
    const n = 1025;
    curve = new Float32Array(n);
    const norm = Math.tanh(drive);
    for (let i = 0; i < n; i++) curve[i] = Math.tanh(drive * ((i / (n - 1)) * 2 - 1)) / norm;
    graph.curves.set(key, curve);
  }
  return curve;
}

// The guard's transfer curve: identity up to GUARD_KNEE, then a tanh shoulder that never
// passes GUARD_CEIL (inputs beyond ±1 map to the curve's ends, ≈ ±0.96).
function guardCurve() {
  const n = 4097;
  const curve = new Float32Array(n);
  const room = GUARD_CEIL - GUARD_KNEE;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= GUARD_KNEE ? a : GUARD_KNEE + room * Math.tanh((a - GUARD_KNEE) / room);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/**
 * Builds the output chain on `c` (an AudioContext or an OfflineAudioContext):
 *   voices → input → master gain (0.9 × volume) → DynamicsCompressor → guard → destination
 *   reverb sends → ConvolverNode (synthetic 1.6 s IR) → master gain
 * plus the shared 1 s noise buffer. `random` drives place's variation (pass a seeded one for
 * reproducible renders); `guard:false` leaves the soft clipper out (for measuring).
 */
export function createGraph(c, { volume = DEFAULT_VOLUME, random = Math.random, guard = true } = {}) {
  const input = c.createGain();
  const master = c.createGain();
  master.gain.value = MASTER * clamp(Number(volume) || 0, 0, 1);
  input.connect(master);
  let out = c.destination;
  if (guard) {
    try {
      const ws = c.createWaveShaper();
      ws.curve = guardCurve();
      ws.connect(c.destination);
      out = ws;
    } catch { out = c.destination; }
  }
  let comp = null;
  try {
    comp = c.createDynamicsCompressor();
    comp.threshold.value = COMP.threshold;
    comp.knee.value = COMP.knee;
    comp.ratio.value = COMP.ratio;
    comp.attack.value = COMP.attack;
    comp.release.value = COMP.release;
    master.connect(comp);
    comp.connect(out);
  } catch {
    comp = null;
    master.connect(out);
  }
  // The reverb is optional: a context that cannot build it still plays everything dry.
  let send = null;
  try {
    const verb = c.createConvolver();
    verb.buffer = makeIR(c);
    send = c.createGain();
    send.connect(verb);
    verb.connect(master);
  } catch { send = null; }
  return { c, input, master, comp, send, noise: makeNoise(c), curves: new Map(), pulse: null, random };
}

function setWave(graph, osc, wave) {
  if (wave === 'pulse25') {
    try {
      graph.pulse = graph.pulse || makePulse25(graph.c);
      osc.setPeriodicWave(graph.pulse);
      return;
    } catch { wave = 'square'; }
  }
  osc.type = wave === 'triangle' || wave === 'sine' || wave === 'sawtooth' ? wave : 'square';
}

// f is Hz or [[ms, Hz], …]; mul scales every point (place's pitch variation).
function automate(param, t, f, mul) {
  if (Array.isArray(f)) {
    param.setValueAtTime(Math.max(1, f[0][1] * mul), t + f[0][0] / 1000);
    for (let i = 1; i < f.length; i++) param.exponentialRampToValueAtTime(Math.max(1, f[i][1] * mul), t + f[i][0] / 1000);
  } else {
    param.setValueAtTime(Math.max(1, f * mul), t);
  }
}

function newVoice(graph, rev) {
  const c = graph.c;
  const out = c.createGain();
  out.connect(graph.input);
  let send = null;
  if (rev > 0 && graph.send) {
    send = c.createGain();
    send.gain.value = rev;
    out.connect(send);
    send.connect(graph.send);
  }
  return { graph, out, send, srcs: [], live: 0, end: 0, small: false, stopped: false };
}

// Every source is tracked so stop() can cut it, and so the voice unplugs itself once the last
// source has ended (nothing keeps growing on a long session).
function track(v, src, stopAt, tail) {
  v.srcs.push({ src, stopAt });
  v.live += 1;
  if (stopAt > v.end) v.end = stopAt;
  src.onended = () => {
    try { tail.disconnect(); } catch { /* ignore */ }
    v.live -= 1;
    if (v.live === 0) {
      try { v.out.disconnect(); } catch { /* ignore */ }
      try { if (v.send) v.send.disconnect(); } catch { /* ignore */ }
    }
  };
}

function layer(graph, v, L, t0, k) {
  const c = graph.c;
  const t = t0 + (L.at || 0) * k.t / 1000;
  const attack = Math.max(0.0002, (L.attack ?? 1) / 1000);
  const hold = (L.hold || 0) / 1000;
  const tau = (L.tau || 0) / 1000;
  const dur = Math.max(attack + 0.002, (L.dur ?? (L.attack ?? 1) + (L.hold || 0) + 6 * (L.tau || 0)) / 1000);
  const rel = Math.min(0.005, dur / 10);           // a short release so the hard stop never clicks
  const stopAt = t + dur + 2 * rel;

  let src;
  if (L.src === 'noise') {
    src = c.createBufferSource();
    src.buffer = graph.noise;
    src.loop = true;
  } else {
    src = c.createOscillator();
    setWave(graph, src, L.src);
    automate(src.frequency, t, L.f ?? 440, k.f);
    if (L.detune) src.detune.setValueAtTime(L.detune, t);
  }
  let node = src;
  let filter = null;
  if (L.filter) {
    filter = c.createBiquadFilter();
    filter.type = L.filter.type;
    filter.Q.setValueAtTime(L.filter.q ?? 1, t);
    automate(filter.frequency, t, L.filter.f, k.f);
    node.connect(filter);
    node = filter;
  }
  if (L.drive) {
    const ws = c.createWaveShaper();
    ws.curve = tanhCurve(graph, L.drive);
    ws.oversample = '2x';
    node.connect(ws);
    node = ws;
  }
  const lfo = L.lfo;
  if (lfo && lfo.to === 'amp') {
    // tremolo: the gain swings between 1 − depth and 1
    const am = c.createGain();
    am.gain.setValueAtTime(1 - lfo.depth / 2, t);
    node.connect(am);
    node = am;
    modulate(graph, v, am.gain, lfo, t, stopAt);
  } else if (lfo) {
    // pitch (cents on detune), freq (Hz on frequency) or filter (Hz on the filter's cutoff);
    // a noise source has no pitch to wobble, so only 'filter' applies to it
    const osc = L.src !== 'noise';
    const target = lfo.to === 'filter' ? filter && filter.frequency
      : !osc ? null : lfo.to === 'freq' ? src.frequency : src.detune;
    if (target) modulate(graph, v, target, lfo, t, stopAt);
  }
  const env = c.createGain();
  const p = env.gain;
  const peak = L.peak * k.g;
  const relAt = Math.max(t + attack, t + dur - 3 * rel);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  if (tau > 0 && t + attack + hold < relAt) p.setTargetAtTime(0, t + attack + hold, tau);
  p.setTargetAtTime(0, relAt, rel);
  node.connect(env);
  env.connect(v.out);
  if (L.src === 'noise') src.start(t, graph.random() * (NOISE_S * 0.9));
  else src.start(t);
  src.stop(stopAt);
  track(v, src, stopAt, env);
}

function modulate(graph, v, param, lfo, t, stopAt) {
  const c = graph.c;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(lfo.hz, t);
  const depth = c.createGain();
  depth.gain.setValueAtTime(lfo.to === 'amp' ? lfo.depth / 2 : lfo.depth, t);
  osc.connect(depth);
  depth.connect(param);
  osc.start(t);
  osc.stop(stopAt);
  track(v, osc, stopAt, depth);
}

/** The patch that `name` plays (place: the variant for opts.theme, default classic wood), or null. */
export function patchFor(name, opts) {
  if (name === 'place') {
    const theme = opts && own(PLACE, opts.theme) ? opts.theme : 'wood';
    return PLACE[theme];
  }
  if (own(PATCHES, name)) return PATCHES[name];
  if (own(KIT, name)) return KIT[name];
  return null;
}

/** True when `name` can be played (a UI sound, a character cue or a drum-kit token). */
export function hasSound(name) {
  return typeof name === 'string' && (name === 'place' || own(PATCHES, name) || own(KIT, name));
}

const parsedTunes = new WeakMap();
function parsedOf(spec) {
  if (spec && typeof spec === 'object') {
    let p = parsedTunes.get(spec);
    if (!p) { p = parseJingle(spec); parsedTunes.set(spec, p); }
    return p;
  }
  return parseJingle(spec);
}

function playLayers(graph, v, patch, t, k) {
  if (patch.tune) notes(graph, v, parsedOf(patch.tune).events, t, k.g);
  else for (const L of patch.layers) layer(graph, v, L, t, k);
}

/**
 * Schedules one sound at context time `when`. opts: { color:1|2, theme } for 'place'; { ms } for a
 * patch written against an animation length (coin). Returns the voice handle { end, stop(at?) }
 * or null for an unknown name.
 */
export function scheduleSfx(graph, name, when, opts = {}) {
  const patch = patchFor(name, opts);
  if (!patch) return null;
  const ms = opts && Number(opts.ms);
  const k = { f: 1, g: 1, t: patch.ms && ms > 0 ? clamp(ms / patch.ms, 0.25, 2) : 1 };
  if (patch.vary) {
    k.f = (1 + (graph.random() * 2 - 1) * VARY) * (opts && opts.color === 2 ? WHITE_UP : 1);
    k.g = 0.9 + 0.1 * graph.random();
  }
  const v = newVoice(graph, patch.rev || 0);
  v.small = !!patch.small;
  playLayers(graph, v, patch, when, k);
  return handle(v);
}

// Melodic notes of a parsed jingle; one low-pass per voice, shared by its notes.
function notes(graph, v, events, t0, scale = 1) {
  const c = graph.c;
  const filters = new Map();
  for (const e of events) {
    if (e.t >= MAX_JINGLE_MS) continue;
    const t = t0 + e.t / 1000;
    if (e.kind === 'drum') {
      const patch = patchFor(e.name);
      if (patch) playLayers(graph, v, patch, t, { f: 1, g: (e.gain / DEFAULT_GAIN) * scale, t: 1 });
      continue;
    }
    if (!(e.hz > 0)) continue;
    let dest = v.out;
    if (e.lowpass) {
      dest = filters.get(e.voice);
      if (!dest) {
        dest = c.createBiquadFilter();
        dest.type = 'lowpass';
        dest.frequency.setValueAtTime(e.lowpass, t0);
        dest.Q.setValueAtTime(0, t0);
        dest.connect(v.out);
        filters.set(e.voice, dest);
      }
    }
    const dur = Math.min(e.dur, MAX_JINGLE_MS - e.t) / 1000;
    const osc = c.createOscillator();
    setWave(graph, osc, e.wave);
    const f = osc.frequency;
    let ft = t;
    if (e.boing) {
      const b = Math.min(BOING_S, dur / 2);
      f.setValueAtTime(e.hz / FOURTH, t);
      f.exponentialRampToValueAtTime(e.hz, t + b);
      ft = t + b;
    } else {
      f.setValueAtTime(e.hz, t);
    }
    if (e.glide.length) {
      const span = Math.max(0.005, dur * GLIDE_PART - (ft - t));
      e.glide.forEach((hz, i) => { if (hz > 0) f.exponentialRampToValueAtTime(hz, ft + span * (i + 1) / e.glide.length); });
    }
    // Release by time constant, never an exponential ramp to 0 (that throws / clicks).
    const tc = Math.min(0.008, Math.max(0.003, dur / 10));
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(e.gain * scale, t + NOTE_ATTACK_S);
    env.gain.setTargetAtTime(0, t + Math.max(NOTE_ATTACK_S, dur - 3 * tc), tc);
    osc.connect(env);
    env.connect(dest);
    const stopAt = t + dur + 5 * tc;
    if (e.vibrato) {
      const lfo = c.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(VIB_HZ, t);
      const depth = c.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(VIB_CENTS, t + Math.min(dur / 2, VIB_ONSET_S));
      lfo.connect(depth);
      depth.connect(osc.detune);
      lfo.start(t);
      lfo.stop(stopAt);
      track(v, lfo, stopAt, depth);
    }
    osc.start(t);
    osc.stop(stopAt);
    track(v, osc, stopAt, env);
  }
}

/**
 * Schedules a jingle (SPEC §8.4 format) at context time `when`. Returns { end, stop(at?) }, or
 * null when the spec holds nothing playable. Events past 1.6 s are dropped.
 */
export function scheduleJingle(graph, spec, when) {
  const { events } = parsedOf(spec);
  if (!events.length) return null;
  const v = newVoice(graph, JINGLE_REV);
  notes(graph, v, events, when);
  if (v.live) return handle(v);
  try { v.out.disconnect(); if (v.send) v.send.disconnect(); } catch { /* ignore */ }
  return null;
}

function stopVoice(v, at) {
  if (v.stopped) return;
  v.stopped = true;
  const c = v.graph.c;
  let now = at;
  try { now = Math.max(at ?? 0, c.currentTime); } catch { /* closed */ }
  try {
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setValueAtTime(v.out.gain.value, now);
    v.out.gain.setTargetAtTime(0, now, 0.004);
  } catch { /* closed */ }
  for (const s of v.srcs) {
    if (s.stopAt <= now + 0.03) continue;           // already ending on its own
    try { s.src.stop(now + 0.03); } catch { /* not started / ended */ }
  }
}

function handle(v) {
  v.stop = (at) => stopVoice(v, at);
  return v;
}

// ---------------------------------------------------------------------------------------
// Context lifecycle (pumal js/audio.js)
// ---------------------------------------------------------------------------------------

let ctx = null;
let graph = null;
let enabled = true;
let volume = DEFAULT_VOLUME;
let ignoreSilent = false;
let inited = false;
let verified = false;        // the clock was seen advancing since the last reason to doubt it
let rung = 0;                // 0 = plain resume, 1 = suspend+resume already tried
let needRebuild = false;     // rung 3 decided; carried out inside the next real tap
let sessionDirty = false;    // the audio-session type changed under a live context
let rebuilds = 0;
let watchTimer = null;
let probe = null;            // { c, wall, t }: last time the audio clock was seen to move
let pending = null;          // { name, opts, at }: see REPLAY_MS
let duckUntil = 0;
const live = new Set();      // voice handles that may still be sounding
const lastAt = new Map();    // name -> wall ms of its last start (debounce)

const noop = () => {};
const wallMs = () => Date.now();
const NOOP_HANDLE = Object.freeze({ stop: noop });

function isHidden() {
  const d = g.document;
  return !!d && (d.hidden === true || d.visibilityState === 'hidden');
}

// 'ambient' = respect the silent switch and mix with the owner's music (the default).
// 'playback' = sound even in silent mode, at the cost of pausing other audio (the setting warns).
// The API is Safari-only, so feature-detect. Returns true when the type actually changed.
function pinSession() {
  try {
    const s = g.navigator && g.navigator.audioSession;
    const want = ignoreSilent ? 'playback' : 'ambient';
    if (s && s.type !== want) { s.type = want; return true; }
  } catch { /* read-only or unsupported */ }
  return false;
}

function build() {
  const AC = g.AudioContext || g.webkitAudioContext;
  if (!AC) return;
  pinSession();
  let c = null;
  try { c = new AC({ latencyHint: 'interactive' }); } catch {
    try { c = new AC(); } catch { c = null; }
  }
  if (!c) return;
  try {
    graph = createGraph(c, { volume });
  } catch {
    graph = null;
    try { c.close(); } catch { /* ignore */ }
    return;
  }
  // iOS moves the context to 'interrupted' on backgrounding, calls and Siri without always
  // firing visibilitychange; any such change is a reason to re-check the clock, and whatever
  // was scheduled must not burst out when the context comes back.
  c.onstatechange = () => {
    if (c === ctx && c.state !== 'running') { verified = false; silence(); }
  };
  ctx = c;
  verified = false;
  rung = 0;
  probe = null;
}

function teardown() {
  const c = ctx;
  silence();
  ctx = null; graph = null; probe = null;
  if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
  if (!c) return;
  c.onstatechange = null;
  // Safari caps the number of live contexts, so the old one must be closed, not dropped.
  try { const p = c.close(); if (p && p.catch) p.catch(noop); } catch { /* already closed */ }
}

function resume(c) {
  try {
    const p = c.resume();
    if (p && p.then) p.then(() => { if (c === ctx) flushPending(); }, noop);
  } catch { /* closed */ }
}

// Rungs 2 and 3 of the recovery ladder. State alone cannot be trusted on iOS (WebKit bugs
// 263627 and 291892: 'running' with a frozen clock), so the test is that currentTime moves.
function armWatchdog() {
  if (watchTimer || !ctx) return;
  const c = ctx;
  const t0 = c.currentTime;
  watchTimer = setTimeout(() => {
    watchTimer = null;
    if (c !== ctx) return;
    if (isHidden()) return;                       // the clock is allowed to stop while hidden
    if (c.state === 'running' && c.currentTime > t0) {
      verified = true; rung = 0; rebuilds = 0;
      probe = { c, wall: wallMs(), t: c.currentTime };
      return;
    }
    if (rung === 0) {
      rung = 1;
      try { const p = c.suspend(); if (p && p.catch) p.catch(noop); } catch { /* ignore */ }
      watchTimer = setTimeout(() => {
        watchTimer = null;
        if (c !== ctx) return;
        resume(c);
        armWatchdog();
      }, KICK_GAP_MS);
    } else if (rebuilds < MAX_REBUILDS) {
      needRebuild = true;                         // close + recreate must happen inside a tap
    }
  }, WATCH_MS);
}

function clockFrozen(c) {
  const wall = wallMs();
  const t = c.currentTime;
  if (!probe || probe.c !== c || t > probe.t) { probe = { c, wall, t }; return false; }
  return wall - probe.wall >= FROZEN_MS;
}

function gesture(trusted) {
  if (!enabled || isHidden()) return;
  if (trusted) {
    // Creating (and rung 3, recreating) only ever happens inside a real gesture, where iOS lets
    // a new context start running at once. A changed audio-session type is applied the same
    // way: a fresh context is certain to pick the new category up. [VERIFY on iOS 26/27 whether
    // switching the type of a running context would be enough.]
    if (needRebuild) {
      needRebuild = false;
      rebuilds += 1;
      teardown();
    } else if (sessionDirty && ctx) {
      teardown();
    }
    sessionDirty = false;
    if (ctx && ctx.state === 'closed') teardown();
    if (!ctx) build();
  }
  if (!ctx || ctx.state === 'closed') return;
  if (ctx.state !== 'running') {
    verified = false;
    resume(ctx);
  } else {
    flushPending();
  }
  // Only a real gesture may start the clock, so only a real gesture may convict it.
  if (trusted && !verified) armWatchdog();
}

function onVisible() {
  if (isHidden()) return;
  verified = false;
  rebuilds = 0;
  // Usually enough on its own; when it is not, the next tap climbs the ladder.
  if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') resume(ctx);
}

function onHidden() {
  pending = null;
  // An interrupted context keeps its schedule and would finish a jingle on return.
  silence();
}

function silence() {
  if (!live.size) return;
  let now = 0;
  try { now = ctx ? ctx.currentTime : 0; } catch { now = 0; }
  for (const v of live) stopVoice(v, now);
  live.clear();
}

function prune() {
  if (!ctx || live.size < 16) return;
  const now = ctx.currentTime;
  for (const v of live) if (v.end < now) live.delete(v);
}

function start(name, opts) {
  const now = ctx.currentTime;
  if (name === 'ko') {
    // The K.O. hit owns the moment: cut cursor/arm/timer ticks and keep them out for a beat.
    duckUntil = wallMs() + DUCK_MS;
    for (const v of live) if (v.small) { stopVoice(v, now); live.delete(v); }
  }
  prune();
  const v = scheduleSfx(graph, name, now + LEAD_S, opts);
  if (v) live.add(v);
}

function flushPending() {
  const p = pending;
  pending = null;
  if (!p || !enabled || isHidden() || needRebuild || !ctx || ctx.state !== 'running') return;
  if (wallMs() - p.at > REPLAY_MS) return;
  try { start(p.name, p.opts); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

function unlock() {
  // Callers may invoke this from pointerdown, which is not an activation event for a finger.
  // Where the browser can tell us, only treat it as a gesture when it really is.
  const ua = g.navigator && g.navigator.userActivation;
  gesture(ua ? ua.isActive === true : true);
}

function init(prefs) {
  if (prefs && typeof prefs === 'object') {
    if (own(prefs, 'sound')) enabled = prefs.sound !== false;
    if (typeof prefs.volume === 'number') setVolume(prefs.volume);
    if (own(prefs, 'ignoreSilent')) ignoreSilent = prefs.ignoreSilent === true;
  }
  if (inited) return;
  inited = true;
  pinSession();
  const d = g.document;
  if (!d || typeof d.addEventListener !== 'function') return;
  // touchend / click / keydown are the events that grant activation on iOS (not touchstart, not
  // a finger's pointerdown). They stay attached for good: the context has to be re-resumed after
  // every interruption.
  const onGesture = () => gesture(true);
  for (const type of ['touchend', 'click', 'keydown']) d.addEventListener(type, onGesture, true);
  d.addEventListener('visibilitychange', () => (isHidden() ? onHidden() : onVisible()));
  if (typeof g.addEventListener === 'function') {
    g.addEventListener('pageshow', onVisible);
    g.addEventListener('focus', onVisible);
    g.addEventListener('pagehide', onHidden);
  }
}

function setEnabled(on) {
  enabled = !!on;
  if (!enabled) {
    pending = null;
    silence();
    return;
  }
  // Turning sound on in settings is itself a tap; use it so the next sound is not lost.
  const ua = g.navigator && g.navigator.userActivation;
  if (ua && ua.isActive === true) gesture(true);
}

function isEnabled() {
  return enabled;
}

function setVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return;
  volume = clamp(n, 0, 1);
  if (!graph || !ctx) return;
  try {
    const p = graph.master.gain;
    const now = ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(MASTER * volume, now, 0.015);   // smooth, so dragging a slider never zips
  } catch { /* closed */ }
}

function setIgnoreSilent(on) {
  ignoreSilent = !!on;
  if (!pinSession() || !ctx) return;
  sessionDirty = true;
  // The settings toggle is itself a tap: apply it now; otherwise the next tap does.
  const ua = g.navigator && g.navigator.userActivation;
  if (ua && ua.isActive === true) gesture(true);
}

// Shared gate for play() and jingle(): true when the context can take a schedule right now.
// On the way it does what pumal's play() did: resume a stopped context (rung 1) and drop work
// that would land on a frozen clock.
function ready(onLocked) {
  if (!ctx || needRebuild || ctx.state === 'closed') { onLocked(); return false; }
  if (ctx.state !== 'running') {                  // rung 1
    verified = false;
    onLocked();
    resume(ctx);
    return false;
  }
  if (clockFrozen(ctx)) {
    // Sounds put on a stopped clock would all burst out later. Drop, and let the next tap run
    // the watchdog.
    verified = false;
    return false;
  }
  return true;
}

function play(name, opts) {
  try {
    if (!enabled || !hasSound(name)) return;
    if (isHidden()) { pending = null; return; }   // dropped, never queued
    const now = wallMs();
    if (now - (lastAt.get(name) ?? -Infinity) < DEBOUNCE_MS) return;
    if (now < duckUntil && patchFor(name, opts).small) return;
    lastAt.set(name, now);
    const remember = () => { pending = REPLAY_MS > 0 ? { name, opts, at: now } : null; };
    if (!ready(remember)) return;
    start(name, opts);
  } catch { /* sound must never break the game */ }
}

// spec.at is the caller's business (js/fighter.js turns it into `delay`, in seconds from now).
function jingle(spec, opts) {
  try {
    if (!enabled || isHidden()) return NOOP_HANDLE;
    // A jingle belongs to an animation's timeline: when it cannot start now it is dropped, not
    // replayed late.
    if (!ready(noop)) return NOOP_HANDLE;
    const d = Math.max(0, Number(opts && opts.delay) || 0);
    const v = scheduleJingle(graph, spec, ctx.currentTime + LEAD_S + d);
    if (!v) return NOOP_HANDLE;
    live.add(v);
    return { stop() { stopVoice(v); live.delete(v); } };
  } catch {
    return NOOP_HANDLE;
  }
}

function stopAll() {
  pending = null;
  silence();
}

export const audio = {
  init, unlock, play, jingle, stopAll, setEnabled, isEnabled, setVolume, setIgnoreSilent,
};
