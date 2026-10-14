// tests/audio.test.js — js/audio.js (SPEC §8.4). node --test tests/audio.test.js
//
// Three layers, as in pumal's audio tests:
//   1. pure data: the name lists, the patch table, the jingle parser and its lengths;
//   2. scheduling and the iOS recovery ladder against a minimal fake Web Audio / DOM (nobody can
//      hear anything here, so these check routing, envelopes and timing on the audio clock);
//   3. the objective audio QA: every sound rendered through an OfflineAudioContext in a real
//      browser (Playwright Chromium) via tools/demo-audio.html's window.audioQA, asserting it is
//      audible, never clips, lasts as long as its table says and is built for a phone speaker.
//      Skipped when Playwright or its browser is not available.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// SPEC §8.4, verbatim
const SPEC_SFX = ['place', 'arm', 'cursor', 'occupied', 'deny', 'menu', 'ok', 'cancel', 'pick1', 'pick2', 'vs', 'round',
  'fight', 'ko', 'roundWin', 'matchWin', 'lose', 'tick', 'tickHi', 'timeover', 'undo', 'coin', 'draw', 'toast'];
const SPEC_CHAR_SFX = ['WHOOSH', 'SWISH', 'SCRATCH', 'POP', 'TING', 'BOING', 'PUNCH', 'CLUNK', 'ZAP', 'BELL', 'BLIP',
  'SNIFF', 'COUGH', 'GIGGLE', 'HUP', 'WHIRR', 'SPLAT', 'CRACKLE'];
const THEME_IDS = ['mat', 'neon', 'dojo', 'pixel', 'wood'];            // SPEC §8.3
const CHAR_IDS = ['bulttong', 'nyangja', 'bigom', 'beonjjeok', 'jaepjaep', 'ppibik', 'kkakkung', 'taenggeul'];
const SMALL = ['arm', 'cursor', 'occupied', 'menu', 'tick', 'tickHi'];

// ---------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------

class FakeParam {
  constructor(owner, name, value) { this.owner = owner; this.name = name; this.value = value; this.events = []; }
  setValueAtTime(v, t) { this.#check(v, t); this.events.push({ kind: 'set', v, t }); return this; }
  linearRampToValueAtTime(v, t) { this.#check(v, t); this.events.push({ kind: 'lin', v, t }); return this; }
  exponentialRampToValueAtTime(v, t) {
    this.#check(v, t);
    // a real AudioParam throws on a non-positive target; a gain must never be ramped this way
    if (!(v > 0)) throw new RangeError('exponential ramp to a non-positive value');
    if (this.name === 'gain') throw new Error('exponential ramps on gains are banned (release by time constant)');
    this.events.push({ kind: 'exp', v, t });
    return this;
  }
  setTargetAtTime(v, t, tc) { this.#check(v, t); assert.ok(tc > 0, 'time constant'); this.events.push({ kind: 'target', v, t, tc }); return this; }
  cancelScheduledValues(t) { this.events.push({ kind: 'cancel', t }); return this; }
  #check(v, t) {
    if (!Number.isFinite(v) || !Number.isFinite(t)) throw new TypeError(`non-finite automation ${this.owner.kind}.${this.name}: ${v} @ ${t}`);
    assert.ok(t >= 0, 'automation time must not be negative');
  }
}

class FakeNode {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outputs = []; ctx.nodes.push(this); }
  connect(dest) { this.outputs.push(dest); return dest; }
  disconnect() { this.outputs = []; }
  param(name, value) { this[name] = new FakeParam(this, name, value); }
}

class FakeSource extends FakeNode {
  constructor(ctx, kind) { super(ctx, kind); this.started = null; this.offset = 0; this.stopped = []; this.onended = null; }
  start(t = 0, offset = 0) {
    assert.equal(this.started, null, 'start() twice');
    assert.ok(Number.isFinite(t) && t >= 0, 'start time');
    this.started = t; this.offset = offset;
  }
  stop(t = 0) {
    assert.notEqual(this.started, null, 'stop() before start()');
    assert.ok(Number.isFinite(t), 'stop time');
    this.stopped.push(t);
  }
}

function makeFakeAudioContext(behavior) {
  return class FakeAudioContext {
    static instances = [];
    constructor(opts) {
      this.opts = opts;
      this.state = behavior.startState;
      this.sampleRate = 48000;
      this.nodes = [];
      this.destination = new FakeNode(this, 'destination');
      this.calls = { resume: 0, suspend: 0, close: 0 };
      this.onstatechange = null;
      this._t = 0;
      this._since = Date.now();
      FakeAudioContext.instances.push(this);
    }
    get currentTime() {
      const moving = this.state === 'running' && behavior.clockRuns;
      return this._t + (moving ? (Date.now() - this._since) / 1000 : 0);
    }
    _freeze() { this._t = this.currentTime; this._since = Date.now(); }
    _setState(s) { this._freeze(); this.state = s; if (this.onstatechange) this.onstatechange(); }
    get sources() { return this.nodes.filter((n) => n instanceof FakeSource); }
    get oscillators() { return this.nodes.filter((n) => n.kind === 'osc'); }
    createOscillator() {
      const o = new FakeSource(this, 'osc');
      o.type = 'sine'; o.wave = null;
      o.param('frequency', 440); o.param('detune', 0);
      o.setPeriodicWave = (w) => { o.type = 'custom'; o.wave = w; };
      return o;
    }
    createBufferSource() {
      const s = new FakeSource(this, 'buffer');
      s.buffer = null; s.loop = false;
      s.param('playbackRate', 1); s.param('detune', 0);
      return s;
    }
    createGain() { const n = new FakeNode(this, 'gain'); n.param('gain', 1); return n; }
    createBiquadFilter() {
      const n = new FakeNode(this, 'filter');
      n.type = 'lowpass';
      n.param('frequency', 350); n.param('Q', 1); n.param('gain', 0);
      return n;
    }
    createWaveShaper() { const n = new FakeNode(this, 'shaper'); n.curve = null; n.oversample = 'none'; return n; }
    createDynamicsCompressor() {
      const n = new FakeNode(this, 'compressor');
      n.param('threshold', -24); n.param('knee', 30); n.param('ratio', 12); n.param('attack', 0.003); n.param('release', 0.25);
      return n;
    }
    createConvolver() { const n = new FakeNode(this, 'convolver'); n.buffer = null; n.normalize = true; return n; }
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (i) => data[i] };
    }
    createPeriodicWave(real, imag) { return { real, imag }; }
    resume() {
      this.calls.resume += 1;
      if (behavior.resumeWorks && this.state !== 'closed') this._setState('running');
      return Promise.resolve();
    }
    suspend() {
      this.calls.suspend += 1;
      if (this.state === 'running') this._setState('suspended');
      return Promise.resolve();
    }
    close() { this.calls.close += 1; this._setState('closed'); return Promise.resolve(); }
  };
}

function fakeDocument() {
  const listeners = {};
  return {
    hidden: false,
    visibilityState: 'visible',
    listeners,
    addEventListener(type, fn, opt) { (listeners[type] ||= []).push({ fn, opt }); },
    fire(type) { for (const l of listeners[type] || []) l.fn({ type }); },
    setHidden(h) {
      this.hidden = h;
      this.visibilityState = h ? 'hidden' : 'visible';
      this.fire('visibilitychange');
    },
  };
}

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let importCount = 0;

// Installs fakes on globalThis, imports a fresh copy of the module, and returns handles.
async function setup(t, opts = {}) {
  const behavior = { startState: 'suspended', resumeWorks: true, clockRuns: true, ...opts.behavior };
  const doc = opts.document === false ? undefined : fakeDocument();
  const AC = opts.audio === false ? undefined : makeFakeAudioContext(behavior);
  const nav = { userAgent: 'node-test', ...opts.navigator };
  if (doc) globalThis.document = doc;
  if (AC) globalThis.AudioContext = AC;
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  t.after(() => {
    delete globalThis.document;
    delete globalThis.AudioContext;
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
    else delete globalThis.navigator;
  });
  const mod = await import(new URL(`../js/audio.js?case=${++importCount}`, import.meta.url).href);
  return { ...mod, doc, AC, nav, behavior };
}

const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function reachesDestination(node, ctx, seen = new Set()) {
  if (node === ctx.destination) return true;
  if (seen.has(node) || !(node instanceof FakeNode)) return false;
  seen.add(node);
  return node.outputs.some((n) => reachesDestination(n, ctx, seen));
}

// A context that is created, unlocked by a tap and proven healthy.
async function unlocked(t, opts) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const env = await setup(t, opts);
  env.audio.init();
  env.doc.fire('touchend');
  await settle();
  t.mock.timers.tick(450);
  env.ctx = env.AC.instances[0];
  return env;
}

// A bare fake context for the synthesis functions (no lifecycle involved).
async function bare(t) {
  const env = await setup(t, { behavior: { startState: 'running' } });
  const ctx = new env.AC();
  return { ...env, ctx };
}

// ---------------------------------------------------------------------------------------
// 1. Names, patches, parser
// ---------------------------------------------------------------------------------------

test('SFX_NAMES and CHAR_SFX are exactly the SPEC §8.4 lists', async (t) => {
  const { SFX_NAMES, CHAR_SFX, DRUMS, WAVES, PLACE_THEMES } = await setup(t);
  assert.deepEqual(SFX_NAMES, SPEC_SFX);
  assert.deepEqual(CHAR_SFX, SPEC_CHAR_SFX);
  assert.deepEqual(DRUMS, ['K', 'S', 'H', 'BELL']);
  assert.deepEqual(WAVES, ['square', 'triangle', 'sine', 'sawtooth', 'pulse25']);
  assert.deepEqual([...PLACE_THEMES].sort(), [...THEME_IDS].sort());
});

test('every UI sound, every cue sound, every kit token and every place theme has a patch', async (t) => {
  const { SFX_NAMES, CHAR_SFX, DRUMS, PLACE_THEMES, patchFor, hasSound } = await setup(t);
  for (const name of [...SFX_NAMES, ...CHAR_SFX, ...DRUMS]) {
    assert.ok(patchFor(name), `${name} has no patch`);
    assert.ok(hasSound(name), name);
  }
  const variants = new Set(PLACE_THEMES.map((theme) => patchFor('place', { theme })));
  assert.ok(variants.size >= 4, 'themes get their own stone sound');
  assert.equal(patchFor('place', { theme: 'nope' }), patchFor('place', { theme: 'wood' }), 'unknown theme = classic');
  assert.equal(patchFor('place'), patchFor('place', { theme: 'wood' }));
  assert.equal(patchFor('nope'), null);
  assert.equal(hasSound('nope'), false);
  assert.equal(hasSound(undefined), false);
});

test('every patch is well formed and short', async (t) => {
  const { SFX_NAMES, CHAR_SFX, DRUMS, PLACE_THEMES, WAVES, patchFor, parseJingle } = await setup(t);
  const SRC = ['noise', ...WAVES];
  const FILTERS = ['lowpass', 'highpass', 'bandpass'];
  const hz = (f) => (Array.isArray(f) ? f.every(([ms, v]) => ms >= 0 && v > 0) : f > 0);
  const all = [...SFX_NAMES.filter((n) => n !== 'place'), ...CHAR_SFX, ...DRUMS].map((n) => [n, patchFor(n)])
    .concat(PLACE_THEMES.map((th) => [`place/${th}`, patchFor('place', { theme: th })]));
  for (const [name, p] of all) {
    if (p.rev !== undefined) assert.ok(p.rev > 0 && p.rev <= 0.5, `${name}: reverb send ${p.rev}`);
    if (p.tune) {
      const { errors, total } = parseJingle(p.tune);
      assert.deepEqual(errors, [], `${name}: ${errors}`);
      assert.ok(total > 0 && total <= 1600, `${name}: tune ${total} ms`);
      continue;
    }
    assert.ok(Array.isArray(p.layers) && p.layers.length > 0, `${name}: layers`);
    let end = 0;
    for (const L of p.layers) {
      assert.ok(SRC.includes(L.src), `${name}: src ${L.src}`);
      assert.ok(L.peak > 0 && L.peak <= 3, `${name}: peak ${L.peak}`);
      if (L.src !== 'noise') assert.ok(hz(L.f), `${name}: frequency`);
      if (L.filter) {
        assert.ok(FILTERS.includes(L.filter.type), `${name}: filter ${L.filter.type}`);
        assert.ok(hz(L.filter.f), `${name}: filter frequency`);
      }
      for (const k of ['at', 'attack', 'hold', 'tau', 'dur']) if (L[k] !== undefined) assert.ok(L[k] >= 0, `${name}: ${k}`);
      if (L.lfo) assert.ok(L.lfo.hz > 0 && L.lfo.depth > 0 && ['pitch', 'freq', 'filter', 'amp'].includes(L.lfo.to), `${name}: lfo`);
      end = Math.max(end, (L.at || 0) + (L.dur ?? ((L.attack ?? 1) + (L.hold || 0) + 6 * (L.tau || 0))));
    }
    assert.ok(end <= 2500, `${name}: ${end} ms`);
  }
  for (const name of SMALL) assert.equal(patchFor(name).small, true, `${name} is a small tick (a K.O. ducks it)`);
  for (const name of ['place', 'ko', 'vs', 'deny', 'roundWin']) assert.ok(!patchFor(name).small, `${name} is not a tick`);
});

test('noteHz: equal temperament from A4 = 440 Hz', async (t) => {
  const { noteHz } = await setup(t);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} != ${b}`);
  near(noteHz('A4'), 440);
  near(noteHz('A5'), 880);
  near(noteHz('A0'), 27.5);
  near(noteHz('C4'), 261.626);
  near(noteHz('C8'), 4186.009);
  near(noteHz('Eb3'), 155.563);
  near(noteHz('E5'), 659.255);
  near(noteHz('G6'), 1567.982);
  near(noteHz('C#5'), noteHz('Db5'));
  near(noteHz('F#4'), noteHz('Gb4'));
  near(noteHz('A#4'), noteHz('Bb4'));
  near(noteHz('G#3'), noteHz('Ab3'));
  near(noteHz('B3') * 2 ** (1 / 12), noteHz('C4'));
  for (const bad of ['H4', 'C9', 'C', 'c4', 'C##4', '', null, 'Cx4']) assert.equal(noteHz(bad), 0, String(bad));
});

test('parseJingle: pitches, durations, rests and start times', async (t) => {
  const { parseJingle, noteHz } = await setup(t);
  const p = parseJingle({ at: 1.56, voices: [{ wave: 'square', gain: 0.07, lowpass: 2400, notes: 'C3:316 Eb3:158 -:50 F3:158 G3:316.5' }] });
  assert.deepEqual(p.errors, []);
  assert.equal(p.total, 316 + 158 + 50 + 158 + 316.5);
  assert.deepEqual(p.events.map((e) => e.t), [0, 316, 524, 682]);
  assert.deepEqual(p.events.map((e) => e.dur), [316, 158, 158, 316.5]);
  assert.deepEqual(p.events.map((e) => e.hz), ['C3', 'Eb3', 'F3', 'G3'].map(noteHz));
  for (const e of p.events) {
    assert.equal(e.kind, 'note');
    assert.equal(e.wave, 'square');
    assert.equal(e.gain, 0.07);
    assert.equal(e.lowpass, 2400);
    assert.deepEqual([e.vibrato, e.boing, e.glide], [false, false, []]);
  }
});

test('parseJingle: glide, vibrato and boing modifiers, alone and combined', async (t) => {
  const { parseJingle, noteHz } = await setup(t);
  const { events, errors } = parseJingle({ voices: [{ wave: 'sine', gain: 0.1, notes: 'A4>C5:180 A5~:420 C5^:110 C6^~:380 A4>C5>E5~:200' }] });
  assert.deepEqual(errors, []);
  const [glide, vib, boing, boingVib, path] = events;
  assert.equal(glide.hz, noteHz('A4'));
  assert.deepEqual(glide.glide, [noteHz('C5')]);
  assert.equal(glide.vibrato, false);
  assert.equal(vib.vibrato, true);
  assert.deepEqual(vib.glide, []);
  assert.equal(boing.boing, true);
  assert.equal(boing.hz, noteHz('C5'));
  assert.deepEqual([boingVib.boing, boingVib.vibrato], [true, true]);
  assert.deepEqual(path.glide, [noteHz('C5'), noteHz('E5')]);
  assert.equal(path.vibrato, true);
  assert.deepEqual(events.map((e) => e.t), [0, 180, 600, 710, 1090]);
});

test('parseJingle: drums lane takes K S H BELL, every CHAR_SFX and rests', async (t) => {
  const { parseJingle, CHAR_SFX } = await setup(t);
  const drums = ['K:158', '-:158', 'S:158', '-:79', 'H:79', 'BELL:400', ...CHAR_SFX.map((n) => `${n}:10`)].join(' ');
  const { events, errors, total } = parseJingle({ voices: [{ drums }] });
  assert.deepEqual(errors, []);
  assert.deepEqual(events.map((e) => e.name), ['K', 'S', 'H', 'BELL', ...CHAR_SFX]);
  assert.deepEqual(events.slice(0, 4).map((e) => e.t), [0, 316, 553, 632]);
  assert.ok(events.every((e) => e.kind === 'drum' && e.gain === 0.07));
  assert.equal(total, 158 * 3 + 79 * 2 + 400 + 10 * CHAR_SFX.length);
});

test('parseJingle: events of several voices are merged in time order; total = the longest voice', async (t) => {
  const { parseJingle } = await setup(t);
  const { events, total } = parseJingle({
    voices: [
      { wave: 'square', gain: 0.07, notes: 'C3:316 Eb3:158 F3:158 G3:316' },
      { drums: 'K:158 -:158 S:158 -:79 K:79 K:158 S:316' },
    ],
  });
  assert.equal(total, 1106);
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1], b = events[i];
    assert.ok(a.t < b.t || (a.t === b.t && a.voice <= b.voice), 'sorted by time, then voice');
  }
  assert.deepEqual(events.filter((e) => e.voice === 1).map((e) => [e.name, e.t]),
    [['K', 0], ['S', 316], ['K', 553], ['K', 632], ['S', 790]]);
});

test('parseJingle: typos become rests and are reported; gain and lowpass are clamped', async (t) => {
  const { parseJingle } = await setup(t);
  const p = parseJingle({
    voices: [
      { wave: 'kazoo', gain: 0.9, lowpass: 50, notes: 'C4:100 X9:100 E4 G4:100 C4~~:50' },
      { drums: 'K:100 TOM:100 S:100' },
      { notes: 'C4:100', gain: -1 },
      { nothing: true },
      null,
    ],
  });
  assert.equal(p.events[0].wave, 'square', 'unknown wave falls back to square');
  assert.equal(p.events[0].gain, 0.2, 'gain capped');
  assert.equal(p.events[0].lowpass, 200, 'lowpass clamped');
  const v0 = p.events.filter((e) => e.voice === 0);
  assert.deepEqual(v0.map((e) => e.t), [0, 200, 300], 'a bad note keeps its length as a rest; a bad token is skipped');
  assert.equal(v0[2].vibrato, true, 'a repeated modifier is harmless');
  assert.deepEqual(p.events.filter((e) => e.voice === 1).map((e) => [e.name, e.t]), [['K', 0], ['S', 200]]);
  assert.equal(p.events.find((e) => e.voice === 2).gain, 0.07, 'bad gain = house level');
  assert.equal(p.errors.length, 7);
  for (const word of ['kazoo', 'X9', '"E4"', 'TOM', 'voice 2: unknown wave "undefined"', 'voice 3', 'voice 4']) {
    assert.ok(p.errors.some((e) => e.includes(word)), word);
  }
  assert.deepEqual(parseJingle(null), { events: [], total: 0, errors: [] });
  assert.deepEqual(parseJingle({}), { events: [], total: 0, errors: [] });
});

test('jingleLength and the SPEC §8.4 example', async (t) => {
  const { jingleLength, parseJingle } = await setup(t);
  const spec = {
    at: 1.56,
    voices: [
      { wave: 'square', gain: 0.07, lowpass: 2400, notes: 'C3:316 Eb3:158 F3:158 G3:316' },
      { drums: 'K:158 -:158 S:158 -:79 K:79 K:158 S:316' },
    ],
  };
  assert.equal(jingleLength(spec), 1106);
  assert.equal(jingleLength(spec.voices), 1106, 'a bare voices array works too');
  assert.equal(jingleLength({ voices: [{ wave: 'sine', notes: 'A4>C5:180 Eb5:160 -:50 A5~:420' }] }), 810);
  assert.equal(jingleLength({ voices: [{ wave: 'square', notes: 'C5:100 -:20 C5:100 G5~:380' }] }), 600);
  assert.equal(jingleLength({ voices: [] }), 0);
  assert.equal(parseJingle(spec).events.length, 9);
});

test('every character jingle that exists parses cleanly, uses only known sounds and lasts ≤ 1.6 s', async (t) => {
  const { parseJingle, CHAR_SFX } = await setup(t);
  let seen = 0;
  for (const id of CHAR_IDS) {
    const file = join(ROOT, 'js', 'chars', `${id}.js`);
    if (!existsSync(file)) continue;                     // other agents may still be writing it
    let c;
    try { c = (await import(new URL(`../js/chars/${id}.js`, import.meta.url).href)).default; } catch { continue; }
    if (!c || !c.jingle) continue;
    seen += 1;
    const p = parseJingle(c.jingle);
    assert.deepEqual(p.errors, [], `${id}: ${p.errors}`);
    assert.ok(p.total > 0 && p.total <= 1600, `${id}: ${p.total} ms`);
    for (const q of c.cues || []) if (q.sfx) assert.ok(CHAR_SFX.includes(q.sfx), `${id}: cue ${q.sfx}`);
    if (c.turnSfx) assert.ok(CHAR_SFX.includes(c.turnSfx), `${id}: turnSfx ${c.turnSfx}`);
  }
  t.diagnostic(`${seen} character files checked`);
});

test('no <audio> element, no speechSynthesis, no network in js/audio.js', () => {
  const src = readFileSync(join(ROOT, 'js', 'audio.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  for (const bad of [/new\s+Audio\s*\(/, /createElement\(\s*['"]audio/, /speechSynthesis/, /SpeechSynthesisUtterance/, /fetch\(/, /XMLHttpRequest/, /import\s*\(/]) {
    assert.doesNotMatch(src, bad);
  }
});

// ---------------------------------------------------------------------------------------
// 2a. Synthesis on a fake context
// ---------------------------------------------------------------------------------------

test('createGraph: master (0.9 × volume) → compressor (SPEC values) → guard → destination, plus reverb and noise', async (t) => {
  const { createGraph, ctx } = await bare(t);
  const g = createGraph(ctx, { volume: 0.5 });
  assert.equal(g.master.gain.value, 0.45);
  assert.deepEqual(g.input.outputs, [g.master]);
  assert.deepEqual(g.master.outputs, [g.comp]);
  const c = g.comp;
  assert.deepEqual([c.threshold.value, c.knee.value, c.ratio.value, c.attack.value, c.release.value], [-14, 6, 4, 0.003, 0.15]);
  const [guard] = c.outputs;
  assert.equal(guard.kind, 'shaper');
  assert.deepEqual(guard.outputs, [ctx.destination]);
  // guard: exact identity up to 0.85, monotonic, never beyond 0.99
  const curve = guard.curve;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    if (Math.abs(x) <= 0.85) assert.ok(Math.abs(curve[i] - x) < 1e-6, `identity at ${x}`);
    else assert.ok(Math.abs(curve[i]) < Math.abs(x) + 1e-6, `shoulder at ${x}`);
    if (i) assert.ok(curve[i] >= curve[i - 1], 'monotonic');
  }
  assert.ok(Math.max(...curve.map(Math.abs)) <= 0.99);
  // reverb: send → convolver (1.6 s stereo IR) → master
  const verb = g.send.outputs[0];
  assert.equal(verb.kind, 'convolver');
  assert.deepEqual(verb.outputs, [g.master]);
  assert.equal(verb.buffer.numberOfChannels, 2);
  assert.equal(verb.buffer.length, Math.round(1.6 * 48000));
  assert.equal(g.noise.length, 48000, '1 s of noise');
  const d = g.noise.getChannelData(0);
  assert.ok(d.some((v) => v > 0.5) && d.some((v) => v < -0.5) && d.every((v) => v >= -1 && v <= 1));
  assert.equal(createGraph(ctx, { volume: 7 }).master.gain.value, 0.9, 'volume clamps to 1');
  assert.equal(createGraph(ctx, { guard: false }).comp.outputs[0], ctx.destination, 'guard:false for measuring');
});

test('every sound schedules sources on the audio clock that reach the destination with clean envelopes', async (t) => {
  const { createGraph, scheduleSfx, SFX_NAMES, CHAR_SFX, DRUMS, PLACE_THEMES, ctx } = await bare(t);
  const g = createGraph(ctx);
  const cases = [...SFX_NAMES.filter((n) => n !== 'place'), ...CHAR_SFX, ...DRUMS].map((n) => [n, {}])
    .concat(PLACE_THEMES.flatMap((theme) => [1, 2].map((color) => ['place', { theme, color }])));
  const when = 1.25;
  for (const [name, opts] of cases) {
    const before = ctx.nodes.length;
    const v = scheduleSfx(g, name, when, opts);
    const made = ctx.nodes.slice(before);
    const srcs = made.filter((n) => n instanceof FakeSource);
    assert.ok(srcs.length >= 1, `${name}: no source`);
    for (const s of srcs) {
      assert.ok(s.started >= when, `${name}: starts before its time`);
      assert.equal(s.stopped.length, 1, `${name}: every source is stopped once`);
      assert.ok(s.stopped[0] > s.started, `${name}: stop after start`);
      assert.ok(s.stopped[0] - when <= 2.6, `${name}: runs ${s.stopped[0] - when} s`);
      assert.equal(typeof s.onended, 'function', `${name}: cleans up after itself`);
      if (s.kind === 'buffer') assert.ok(s.buffer === g.noise && s.loop && s.offset >= 0 && s.offset < 1, `${name}: noise`);
      if (s.kind === 'osc') {
        for (const e of s.frequency.events) assert.ok(e.v > 0 && e.v < 20000, `${name}: ${e.v} Hz`);
      }
    }
    // the audible sources (not LFOs feeding a parameter) reach the speakers through their own envelope
    const audible = srcs.filter((s) => s.outputs.every((o) => !(o instanceof FakeParam)) && !s.outputs.some((o) => o.outputs.some((x) => x instanceof FakeParam)));
    assert.ok(audible.length >= 1, `${name}: nothing audible`);
    for (const s of audible) {
      assert.ok(reachesDestination(s, ctx), `${name}: not routed to the destination`);
      // walk to the voice output; its envelope is the last automated gain on the way
      let n = s, env = null;
      while (n && n !== v.out) {
        if (n.kind === 'gain' && n.gain.events.length) env = n;
        n = n.outputs.find((o) => o instanceof FakeNode);
      }
      assert.equal(n, v.out, `${name}: does not reach its voice output`);
      assert.ok(env, `${name}: no envelope`);
      const [e0, e1] = env.gain.events;
      assert.deepEqual([e0.kind, e0.v], ['set', 0], `${name}: envelope starts at 0 (no click)`);
      assert.ok(e0.t >= when);
      assert.equal(e1.kind, 'lin', `${name}: linear attack`);
      assert.ok(e1.v > 0, `${name}: peak`);
      assert.equal(env.gain.events.at(-1).kind, 'target', `${name}: released by time constant`);
      assert.equal(env.gain.events.at(-1).v, 0);
    }
    assert.ok(v && v.end > when && typeof v.stop === 'function', `${name}: handle`);
  }
});

test('place: ±6 % random pitch, white stones 8 % brighter, per-theme recipes', async (t) => {
  const { createGraph, scheduleSfx, ctx } = await bare(t);
  const fixed = (x) => () => x;
  const firstHz = (opts, r) => {
    const g = createGraph(ctx, { random: fixed(r) });
    const before = ctx.nodes.length;
    scheduleSfx(g, 'place', 0.5, opts);
    const osc = ctx.nodes.slice(before).find((n) => n.kind === 'osc');
    return { hz: osc.frequency.events[0].v, nodes: ctx.nodes.slice(before) };
  };
  const mid = firstHz({ theme: 'wood', color: 1 }, 0.5).hz;
  assert.ok(Math.abs(mid - 900) < 1e-9, 'random 0.5 = no detune');
  assert.ok(Math.abs(firstHz({ theme: 'wood', color: 1 }, 0).hz / mid - 0.94) < 1e-9, '-6 %');
  assert.ok(Math.abs(firstHz({ theme: 'wood', color: 1 }, 1).hz / mid - 1.06) < 1e-9, '+6 %');
  assert.ok(Math.abs(firstHz({ theme: 'wood', color: 2 }, 0.5).hz / mid - 1.08) < 1e-9, 'white +8 %');
  // themes
  const kinds = (theme) => firstHz({ theme, color: 1 }, 0.5).nodes;
  const filters = (nodes) => nodes.filter((n) => n.kind === 'filter').map((f) => f.type);
  assert.ok(filters(kinds('mat')).includes('lowpass'), 'mat: low-passed thud');
  assert.ok(kinds('neon').some((n) => n.kind === 'osc' && n.type === 'square'), 'neon: square blip');
  const pixel = kinds('pixel').filter((n) => n.kind === 'osc');
  assert.ok(pixel.every((o) => o.type === 'square'), 'pixel: 8-bit squares');
  assert.deepEqual(pixel.map((o) => Math.round(o.frequency.events[0].v)), [880, 1320]);
  assert.ok(filters(kinds('wood')).includes('bandpass'), 'wood: the classic bandpassed click');
  assert.ok(kinds('dojo').some((n) => n.kind === 'gain' && n.outputs.some((o) => o.kind === 'gain' && o.outputs.some((x) => x.kind === 'convolver'))), 'dojo: a little hall');
});

test('coin follows the coin animation: play("coin", { ms }) re-times ticks and the landing "띵"', async (t) => {
  const { createGraph, scheduleSfx, ctx } = await bare(t);
  const g = createGraph(ctx);
  const starts = (opts) => {
    const before = ctx.nodes.length;
    scheduleSfx(g, 'coin', 1, opts);
    return ctx.nodes.slice(before).filter((n) => n.kind === 'osc').map((o) => +(o.started - 1).toFixed(4));
  };
  const normal = starts({});
  assert.equal(normal.length, 10, 'eight ticks and a two-partial ding');
  for (let i = 2; i < 8; i++) assert.ok(normal[i] - normal[i - 1] < normal[i - 1] - normal[i - 2] + 1e-9, 'ticks speed up');
  assert.equal(normal.at(-1), 0.96, 'lands at 0.8 × 1.2 s');
  assert.deepEqual(starts({ ms: 1200 }), normal);
  const fast = starts({ ms: 720 });                    // 연출 속도 "빠르게" (× 0.6)
  assert.equal(fast.at(-1), 0.576);
  fast.forEach((x, i) => assert.ok(Math.abs(x - normal[i] * 0.6) < 1e-3));
  assert.deepEqual(starts({ ms: 'x' }), normal, 'nonsense ms is ignored');
  const before = ctx.nodes.length;
  scheduleSfx(g, 'ko', 1, { ms: 300 });
  assert.ok(ctx.nodes.slice(before).some((n) => n.kind === 'osc' && Math.abs(n.started - 1.008) < 1e-9), 'other sounds ignore ms (the K.O. kick stays at +8 ms)');
});

test('scheduleJingle: notes on the audio clock, boing, glide, vibrato, pulse25, one low-pass per voice, drums', async (t) => {
  const { createGraph, scheduleJingle, noteHz, ctx } = await bare(t);
  const g = createGraph(ctx);
  const when = 2;
  const before = ctx.nodes.length;
  const v = scheduleJingle(g, {
    at: 1.4,
    voices: [
      { wave: 'pulse25', gain: 0.06, lowpass: 3600, notes: 'C5:70 G5^:110 A4>C5:180 A5~:400' },
      { wave: 'triangle', gain: 0.08, notes: 'C3:140 -:60 C4:100' },
      { drums: 'K:140 H:70 S:300' },
    ],
  }, when);
  const made = ctx.nodes.slice(before);
  const oscs = made.filter((n) => n.kind === 'osc' && n.type !== 'sine');
  const lead = oscs.filter((o) => o.type === 'custom');
  assert.equal(lead.length, 4, 'four pulse25 notes');
  assert.ok(lead.every((o) => o.wave && o.wave.real.length > 8), 'pulse25 is a PeriodicWave');
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(lead.every((o, i) => near(o.started, when + [0, 0.07, 0.18, 0.36][i])), 'note start times');
  // boing: from a fourth below up to G5 in 40 ms
  const [, boing, glide, vib] = lead;
  const [b0, b1] = boing.frequency.events;
  assert.ok(Math.abs(b0.v - noteHz('G5') / 2 ** (5 / 12)) < 1e-6 && b0.t === boing.started);
  assert.equal(b1.kind, 'exp');
  assert.ok(Math.abs(b1.v - noteHz('G5')) < 1e-6 && Math.abs(b1.t - boing.started - 0.04) < 1e-9);
  // glide: A4 → C5, landing at 80 % of the note
  const [g0, g1] = glide.frequency.events;
  assert.ok(Math.abs(g0.v - 440) < 1e-9);
  assert.equal(g1.kind, 'exp');
  assert.ok(Math.abs(g1.v - noteHz('C5')) < 1e-6 && Math.abs(g1.t - glide.started - 0.144) < 1e-9);
  // vibrato: a 6 Hz LFO into detune, eased in to 15 cents
  const lfo = made.find((n) => n.kind === 'osc' && n.type === 'sine' && n.outputs[0]?.outputs[0] === vib.detune);
  assert.ok(lfo, 'vibrato LFO on detune');
  assert.equal(lfo.frequency.events[0].v, 6);
  assert.equal(lfo.outputs[0].gain.events.at(-1).v, 15);
  // one shared low-pass for the lead voice, none for the bass
  const lps = made.filter((n) => n.kind === 'filter' && n.type === 'lowpass' && n.frequency.events[0]?.v === 3600);
  assert.equal(lps.length, 1);
  assert.ok(lead.every((o) => o.outputs[0].outputs[0] === lps[0]));
  const bass = oscs.filter((o) => o.type === 'triangle' && o.outputs[0].outputs[0] === v.out);
  assert.deepEqual(bass.map((o) => Math.round((o.started - when) * 1000)), [0, 200]);
  // note envelopes: 4 ms linear attack to the voice gain, then a time-constant release
  const env = lead[0].outputs[0];
  assert.deepEqual(env.gain.events.slice(0, 2).map((e) => [e.kind, +e.v.toFixed(3)]), [['set', 0], ['lin', 0.06]]);
  assert.ok(Math.abs(env.gain.events[1].t - when - 0.004) < 1e-9);
  // drums: kick at 0, hat at 140 ms, snare at 210 ms
  const noise = made.filter((n) => n.kind === 'buffer').map((s) => Math.round((s.started - when) * 1000));
  assert.deepEqual([...new Set(noise)], [0, 140, 210]);
  assert.ok(v.end > when + 0.7);
});

test('scheduleJingle drops anything past 1.6 s and returns null for nothing playable', async (t) => {
  const { createGraph, scheduleJingle, ctx } = await bare(t);
  const g = createGraph(ctx);
  const before = ctx.nodes.length;
  scheduleJingle(g, { voices: [{ wave: 'square', notes: 'C5:1500 E5:400 G5:100' }] }, 0);
  const oscs = ctx.nodes.slice(before).filter((n) => n.kind === 'osc');
  assert.equal(oscs.length, 2, 'G5 starts at 1.9 s and is dropped');
  assert.ok(oscs[1].stopped[0] <= 1.6 + 0.05, 'E5 is cut at 1.6 s');
  assert.equal(scheduleJingle(g, { voices: [{ wave: 'square', notes: '-:100' }] }, 0), null);
  assert.equal(scheduleJingle(g, null, 0), null);
});

test('a voice handle stops everything right away, including notes that have not started', async (t) => {
  const { createGraph, scheduleJingle, ctx } = await bare(t);
  const g = createGraph(ctx);
  const before = ctx.nodes.length;
  const v = scheduleJingle(g, { voices: [{ wave: 'square', notes: 'C5:300 E5:300 G5:300' }] }, 0.5);
  const oscs = ctx.nodes.slice(before).filter((n) => n.kind === 'osc');
  v.stop(0.6);
  assert.deepEqual(v.out.gain.events.at(-1).kind, 'target');
  assert.equal(v.out.gain.events.at(-1).v, 0);
  for (const o of oscs) {
    assert.equal(o.stopped.length, 2);
    assert.ok(Math.abs(o.stopped[1] - 0.63) < 1e-9, 'stopped 30 ms later');
  }
  v.stop(0.7);
  assert.ok(oscs.every((o) => o.stopped.length === 2), 'stop() is idempotent');
});

// ---------------------------------------------------------------------------------------
// 2b. Lifecycle (ported from pumal's tests/audio.test.js)
// ---------------------------------------------------------------------------------------

test('no AudioContext and no document: every call is a silent no-op', async (t) => {
  const { audio } = await setup(t, { audio: false, document: false });
  assert.doesNotThrow(() => {
    audio.init({ sound: true, volume: 0.5, ignoreSilent: true });
    audio.unlock();
    for (const name of SPEC_SFX) audio.play(name);
    audio.play('no-such-sound');
    audio.play('place', { color: 2, theme: 'neon' });
    const j = audio.jingle({ voices: [{ wave: 'square', notes: 'C5:100' }] }, { delay: 1 });
    j.stop();
    audio.jingle(null, null).stop();
    audio.stopAll();
    audio.setVolume(0.3);
    audio.setIgnoreSilent(true);
    audio.setEnabled(false);
    audio.setEnabled(true);
    audio.unlock();
    audio.play('menu');
  });
  assert.equal(audio.isEnabled(), true);
});

test('no AudioContext but a document: init and taps do not throw', async (t) => {
  const { audio, doc } = await setup(t, { audio: false });
  assert.doesNotThrow(() => {
    audio.init();
    doc.fire('touchend'); doc.fire('click'); doc.fire('keydown');
    doc.setHidden(true); doc.setHidden(false);
    for (const name of [...SPEC_SFX, ...SPEC_CHAR_SFX]) audio.play(name);
  });
});

test('a constructor that throws is survived', async (t) => {
  const { audio, doc } = await setup(t);
  globalThis.AudioContext = class { constructor() { throw new Error('no audio hardware'); } };
  audio.init();
  assert.doesNotThrow(() => { doc.fire('click'); audio.play('menu'); audio.jingle({ voices: [] }).stop(); });
});

test('one shared interactive context, an ambient audio session pinned at init, permanent capture listeners', async (t) => {
  const session = { type: 'auto' };
  const { audio, doc, AC } = await setup(t, { navigator: { audioSession: session } });
  audio.init();
  audio.init();
  assert.equal(session.type, 'ambient', 'pinned at init');
  for (const type of ['touchend', 'click', 'keydown']) {
    assert.equal(doc.listeners[type].length, 1, type);
    assert.equal(doc.listeners[type][0].opt, true, `${type} must be a capture listener`);
  }
  assert.equal(doc.listeners.visibilitychange.length, 1);
  assert.equal(doc.listeners.touchstart, undefined, 'touchstart does not unlock audio on iOS');
  assert.equal(AC.instances.length, 0, 'no context before a gesture');
  doc.fire('touchend'); doc.fire('click'); doc.fire('keydown');
  audio.unlock(); audio.unlock();
  assert.equal(AC.instances.length, 1);
  assert.deepEqual(AC.instances[0].opts, { latencyHint: 'interactive' });
  assert.ok(AC.instances[0].nodes.some((n) => n.kind === 'compressor'), 'the output chain is built');
});

test('every name schedules on the audio clock, without timers, on one context', async (t) => {
  const env = await unlocked(t);
  const { audio, ctx } = env;
  assert.equal(ctx.state, 'running');
  const realSetTimeout = globalThis.setTimeout;
  let timers = 0;
  globalThis.setTimeout = (...a) => { timers += 1; return realSetTimeout(...a); };
  t.after(() => { globalThis.setTimeout = realSetTimeout; });
  for (const name of [...SPEC_SFX, ...SPEC_CHAR_SFX]) {
    const before = ctx.sources.length;
    const now = ctx.currentTime;
    audio.play(name, { color: 1, theme: 'mat' });
    const srcs = ctx.sources.slice(before);
    assert.ok(srcs.length >= 1, `${name} scheduled nothing`);
    assert.ok(srcs.every((s) => s.started >= now), `${name}: started in the past`);
    if (name === 'ko') t.mock.timers.tick(700);      // let the K.O.'s duck of small ticks pass
  }
  assert.equal(timers, 0, 'play() must not use setTimeout');
  assert.equal(env.AC.instances.length, 1, 'one shared context');
});

test('play() is a no-op when disabled, and a disabled module creates no context on taps', async (t) => {
  const { audio, ctx } = await unlocked(t);
  audio.setEnabled(false);
  assert.equal(audio.isEnabled(), false);
  for (const name of SPEC_SFX) audio.play(name);
  assert.equal(audio.jingle({ voices: [{ wave: 'square', notes: 'C5:100' }] }).stop.length, 0);
  assert.equal(ctx.sources.length, 0);
  assert.equal(ctx.calls.resume, 1, 'no extra resume while disabled');
  audio.setEnabled(true);
  audio.play('ok');
  assert.ok(ctx.sources.length > 0);

  const other = await setup(t);
  other.audio.init({ sound: false });
  other.doc.fire('touchend'); other.doc.fire('click');
  other.audio.unlock();
  assert.equal(other.AC.instances.length, 0);
});

test('play() is a no-op while document.hidden, and nothing is queued for later', async (t) => {
  const { audio, doc, ctx } = await unlocked(t);
  doc.setHidden(true);
  for (const name of SPEC_SFX) audio.play(name);
  audio.jingle({ voices: [{ wave: 'square', notes: 'C5:100' }] });
  assert.equal(ctx.sources.length, 0);
  doc.setHidden(false);
  doc.fire('touchend');
  await settle();
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(ctx.sources.length, 0, 'sounds requested while hidden must be dropped');
});

test('taps while hidden do not touch the context; play() never creates one by itself', async (t) => {
  const { audio, doc, AC } = await setup(t);
  audio.init();
  for (const name of SPEC_SFX) audio.play(name);
  assert.equal(AC.instances.length, 0, 'locked = silent');
  doc.hidden = true; doc.visibilityState = 'hidden';
  doc.fire('touchend');
  assert.equal(AC.instances.length, 0);
});

test('the tap that unlocks still sounds, but a stale request is dropped', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { audio, doc, AC } = await setup(t);
  audio.init();
  audio.play('ok');                   // pointerdown on the title screen: still locked
  t.mock.timers.tick(120);
  doc.fire('touchend');               // the gesture
  await settle();
  const ctx = AC.instances[0];
  const n = ctx.sources.length;
  assert.ok(n > 0, 'recent request replays inside the gesture');

  // a new lock (interruption), a request, and a slow finger
  ctx.state = 'interrupted';
  ctx._resume = ctx.resume;
  ctx.resume = () => { ctx.calls.resume += 1; return Promise.resolve(); };
  audio.play('cancel');
  t.mock.timers.tick(900);
  ctx.resume = ctx._resume;
  doc.fire('touchend');
  await settle();
  assert.equal(ctx.sources.length, n, 'a request older than the replay window is dropped');
});

test('a replayed place keeps its colour and theme', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { audio, doc, AC } = await setup(t);
  audio.init();
  audio.play('place', { color: 1, theme: 'pixel' });
  doc.fire('touchend');
  await settle();
  const oscs = AC.instances[0].oscillators;
  assert.deepEqual(oscs.map((o) => o.type), ['square', 'square'], 'the pixel variant played');
});

test('unlock() outside a real gesture does not create or convict a context', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const activation = { isActive: false };
  const { audio, AC } = await setup(t, { navigator: { userActivation: activation } });
  audio.init();
  audio.unlock();                     // e.g. called from a finger's pointerdown
  assert.equal(AC.instances.length, 0);
  activation.isActive = true;
  audio.unlock();
  assert.equal(AC.instances.length, 1);
});

test('ladder rung 1: play() and a tap resume a context that is not running', async (t) => {
  const { audio, doc, ctx } = await unlocked(t);
  ctx._freeze(); ctx.state = 'interrupted';
  const before = ctx.calls.resume;
  audio.play('menu');
  assert.equal(ctx.calls.resume, before + 1);
  await settle();
  ctx._freeze(); ctx.state = 'interrupted';
  doc.fire('touchend');
  assert.equal(ctx.calls.resume, before + 2);
});

test('ladder: a healthy clock is never suspended or closed', async (t) => {
  const { audio, doc, ctx, AC } = await unlocked(t);
  for (let i = 0; i < 20; i++) {
    doc.fire('touchend'); doc.fire('click');
    audio.play('menu');
    t.mock.timers.tick(300);
    await settle();
  }
  doc.setHidden(true); doc.setHidden(false);
  doc.fire('touchend');
  t.mock.timers.tick(2000);
  assert.equal(ctx.calls.suspend, 0);
  assert.equal(ctx.calls.close, 0);
  assert.equal(AC.instances.length, 1);
  assert.equal(ctx.sources.length, 20);
});

test('ladder rungs 2 and 3: frozen clock -> suspend+resume -> close and recreate inside the next tap', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { audio, doc, AC, behavior } = await setup(t, { behavior: { startState: 'suspended', clockRuns: false } });
  audio.init();
  doc.fire('touchend');               // gesture-time resume: state says running, clock is stuck
  await settle();
  const first = AC.instances[0];
  assert.equal(first.state, 'running');
  assert.equal(first.calls.resume, 1);

  t.mock.timers.tick(399);
  assert.equal(first.calls.suspend, 0, 'the clock gets ~400 ms to move');
  t.mock.timers.tick(1);
  assert.equal(first.calls.suspend, 1, 'rung 2 starts with suspend()');
  await settle();
  t.mock.timers.tick(200);
  assert.equal(first.calls.resume, 2, 'rung 2 ends with resume()');
  await settle();

  t.mock.timers.tick(400);
  assert.equal(first.calls.close, 0, 'recreating waits for a tap');
  assert.equal(AC.instances.length, 1);
  audio.play('menu');
  assert.equal(first.sources.length, 0, 'nothing is scheduled on a context that is given up on');

  behavior.clockRuns = true;          // the replacement works
  t.mock.timers.tick(500);            // let that request go stale so it is not replayed
  doc.fire('touchend');
  await settle();
  assert.equal(first.calls.close, 1, 'old context closed');
  assert.equal(AC.instances.length, 2, 'new context created inside the tap');
  const second = AC.instances[1];
  t.mock.timers.tick(450);
  audio.play('menu');
  assert.equal(second.sources.length, 1);
  assert.equal(second.calls.suspend, 0);
});

test('ladder gives up recreating after a few failures until the app is shown again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { audio, doc, AC } = await setup(t, { behavior: { startState: 'suspended', clockRuns: false } });
  audio.init();
  for (let i = 0; i < 12; i++) {
    doc.fire('touchend');
    await settle();
    t.mock.timers.tick(400); await settle();
    t.mock.timers.tick(200); await settle();
    t.mock.timers.tick(400); await settle();
  }
  assert.equal(AC.instances.length, 4, 'first context + 3 rebuilds');
  assert.equal(AC.instances.filter((c) => c.state !== 'closed').length, 1, 'old contexts are closed');
});

test('a clock that stops while "running" drops sounds and jingles instead of piling them up', async (t) => {
  const { audio, ctx, behavior } = await unlocked(t);
  audio.play('menu');
  assert.equal(ctx.sources.length, 1);
  ctx._freeze(); behavior.clockRuns = false;   // WebKit bug 263627
  t.mock.timers.tick(50);
  audio.play('arm');                           // cannot tell yet
  const n = ctx.sources.length;
  t.mock.timers.tick(300);
  audio.play('tick');
  audio.play('roundWin');
  audio.jingle({ voices: [{ wave: 'square', notes: 'C5:100' }] });
  assert.equal(ctx.sources.length, n);
});

test('return to visible tries resume() and sound works again', async (t) => {
  const { audio, doc, ctx } = await unlocked(t);
  doc.setHidden(true);
  ctx._freeze(); ctx.state = 'interrupted';
  const before = ctx.calls.resume;
  doc.setHidden(false);
  assert.equal(ctx.calls.resume, before + 1);
  await settle();
  t.mock.timers.tick(50);
  audio.play('matchWin');
  assert.ok(ctx.sources.length > 0);
});

const SPEC_TUNE = { at: 1.56, voices: [{ wave: 'square', gain: 0.07, notes: 'C5:300 E5:300 G5:400' }, { drums: 'K:300 S:300' }] };

test('jingle({delay}) lands on the audio clock and returns {stop}', async (t) => {
  const { audio, ctx } = await unlocked(t);
  const now = ctx.currentTime;
  const j = audio.jingle(SPEC_TUNE, { delay: 0.75 });
  assert.equal(typeof j.stop, 'function');
  const oscs = ctx.oscillators.filter((o) => o.type === 'square');
  assert.equal(oscs.length, 3);
  assert.ok(Math.abs(oscs[0].started - (now + 0.008 + 0.75)) < 1e-6, 'starts after the delay (+8 ms lead)');
  assert.ok(Math.abs(oscs[2].started - oscs[0].started - 0.6) < 1e-6);
  j.stop();
  assert.ok(ctx.sources.every((s) => s.stopped.length === 2 || s.stopped[0] <= ctx.currentTime + 0.03), 'stop() cuts every note, started or not');
  assert.doesNotThrow(() => j.stop());
  assert.equal(typeof audio.jingle(SPEC_TUNE).stop, 'function', 'no options needed');
  assert.equal(typeof audio.jingle(SPEC_TUNE, null).stop, 'function');
});

test('a jingle requested while locked is dropped, not replayed late', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { audio, doc, AC } = await setup(t);
  audio.init();
  const j = audio.jingle(SPEC_TUNE);
  assert.equal(typeof j.stop, 'function');
  doc.fire('touchend');
  await settle();
  assert.equal(AC.instances[0].sources.length, 0);
});

test('hiding the app, turning sound off, stopAll() and an interruption cut what is playing', async (t) => {
  const cuts = async (act) => {
    const env = await unlocked(t);
    env.audio.play('coin');
    env.audio.jingle(SPEC_TUNE, { delay: 0.5 });
    const srcs = env.ctx.sources.slice();
    assert.ok(srcs.length > 5);
    t.mock.timers.tick(100);
    act(env);
    return srcs.every((s) => s.stopped.length === 2 || s.stopped[0] <= env.ctx.currentTime + 0.031);
  };
  assert.ok(await cuts(({ doc }) => doc.setHidden(true)), 'hidden');
  t.mock.timers.reset();
  assert.ok(await cuts(({ audio }) => audio.setEnabled(false)), 'disabled');
  t.mock.timers.reset();
  assert.ok(await cuts(({ audio }) => audio.stopAll()), 'stopAll');
  t.mock.timers.reset();
  assert.ok(await cuts(({ ctx }) => ctx._setState('interrupted')), 'interrupted (a call, Siri)');
});

test('the same sound never retriggers within 40 ms; different sounds do', async (t) => {
  const { audio, ctx } = await unlocked(t);
  const count = () => ctx.sources.length;
  audio.play('menu');
  const one = count();
  audio.play('menu');
  t.mock.timers.tick(39);
  audio.play('menu');
  assert.equal(count(), one, 'debounced');
  audio.play('tick');
  assert.ok(count() > one, 'another name is not');
  t.mock.timers.tick(1);
  audio.play('menu');
  assert.equal(count(), one * 2 + (count() - one * 2), 'allowed again at 40 ms');
  const before = count();
  t.mock.timers.tick(40);
  audio.play('menu');
  assert.ok(count() > before);
});

test('a K.O. cuts the small ticks and keeps them out for a beat, but not the stone', async (t) => {
  const { audio, ctx } = await unlocked(t);
  // a voice's output gain is the one that only stopVoice() ever automates (cancel → 0)
  const cut = (nodes) => nodes.some((n) => n.kind === 'gain' && n.gain.events.some((e) => e.kind === 'cancel'));
  const n0 = ctx.nodes.length;
  audio.play('cursor');
  audio.play('tick');
  const n1 = ctx.nodes.length;
  audio.play('place', { color: 1, theme: 'mat' });
  const n2 = ctx.nodes.length;
  audio.play('ko');
  assert.ok(cut(ctx.nodes.slice(n0, n1)), 'running ticks are faded out at once');
  assert.ok(!cut(ctx.nodes.slice(n1, n2)), 'the stone is not a tick');
  const after = ctx.sources.length;
  t.mock.timers.tick(100);
  for (const name of SMALL) audio.play(name);
  assert.equal(ctx.sources.length, after, 'ticks are ducked right after a K.O.');
  audio.play('roundWin');
  assert.ok(ctx.sources.length > after, 'other sounds are not');
  t.mock.timers.tick(700);
  const n = ctx.sources.length;
  audio.play('arm');
  assert.ok(ctx.sources.length > n, 'ticks come back');
});

test('setVolume: 0.9 × volume on the master, smoothed, clamped, remembered for the next context', async (t) => {
  const { audio, ctx } = await unlocked(t);
  const master = ctx.nodes.find((n) => n.kind === 'gain' && n.outputs[0]?.kind === 'compressor');
  assert.ok(Math.abs(master.gain.value - 0.72) < 1e-9, 'default volume 0.8');
  audio.setVolume(0.5);
  const last = master.gain.events.at(-1);
  assert.equal(last.kind, 'target');
  assert.ok(Math.abs(last.v - 0.45) < 1e-9);
  audio.setVolume(3);
  assert.ok(Math.abs(master.gain.events.at(-1).v - 0.9) < 1e-9);
  audio.setVolume(-1);
  assert.equal(master.gain.events.at(-1).v, 0);
  const n = master.gain.events.length;
  audio.setVolume('loud');
  audio.setVolume(NaN);
  assert.equal(master.gain.events.length, n, 'nonsense is ignored');

  const fresh = await setup(t);
  fresh.audio.init({ volume: 0.5 });
  fresh.doc.fire('touchend');
  const m2 = fresh.AC.instances[0].nodes.find((x) => x.kind === 'gain' && x.outputs[0]?.kind === 'compressor');
  assert.ok(Math.abs(m2.gain.value - 0.45) < 1e-9, 'init(prefs) volume used when the context is made');
});

test('setIgnoreSilent toggles the audio session (feature-detected) and rebuilds a live context inside a tap', async (t) => {
  const session = { type: 'auto' };
  const activation = { isActive: false };
  const { audio, doc, AC } = await setup(t, { navigator: { audioSession: session, userActivation: activation } });
  audio.init({ ignoreSilent: true });
  assert.equal(session.type, 'playback', 'init(prefs) pins playback when asked');
  audio.setIgnoreSilent(false);
  assert.equal(session.type, 'ambient');
  assert.equal(AC.instances.length, 0, 'no context to rebuild yet');

  activation.isActive = true;
  doc.fire('touchend');
  await settle();
  const first = AC.instances[0];
  audio.setIgnoreSilent(true);       // the settings switch is itself a tap
  await settle();
  assert.equal(session.type, 'playback');
  assert.equal(first.calls.close, 1, 'old context closed');
  assert.equal(AC.instances.length, 2, 'new context made inside the tap');

  activation.isActive = false;       // e.g. restored from prefs at boot, outside a gesture
  audio.setIgnoreSilent(false);
  assert.equal(session.type, 'ambient');
  assert.equal(AC.instances.length, 2, 'waits for a real tap');
  activation.isActive = true;
  doc.fire('touchend');
  assert.equal(AC.instances.length, 3, 'applied on the next tap');
  audio.setIgnoreSilent(false);
  assert.equal(AC.instances.length, 3, 'no change, no rebuild');

  // rebuilding for the session never counts against the recovery ladder's budget
  for (let i = 0; i < 5; i++) { audio.setIgnoreSilent(i % 2 === 0); await settle(); }
  assert.equal(AC.instances.length, 8);
  assert.equal(AC.instances.filter((c) => c.state !== 'closed').length, 1);
});

test('setIgnoreSilent without navigator.audioSession is harmless', async (t) => {
  const { audio, doc, AC } = await setup(t);
  audio.init({ ignoreSilent: true });
  doc.fire('touchend');
  assert.doesNotThrow(() => { audio.setIgnoreSilent(true); audio.setIgnoreSilent(false); });
  assert.equal(AC.instances.length, 1);
});

test('init(prefs) applies sound, volume and the silent-switch setting', async (t) => {
  const { audio, doc, AC } = await setup(t);
  audio.init({ sound: false, volume: 0.5, ignoreSilent: false });
  assert.equal(audio.isEnabled(), false);
  doc.fire('touchend');
  assert.equal(AC.instances.length, 0);
  audio.init({ sound: true });
  assert.equal(audio.isEnabled(), true);
  assert.equal(doc.listeners.touchend.length, 1, 'listeners are attached once');
});

// ---------------------------------------------------------------------------------------
// 3. Objective audio QA in a real browser
// ---------------------------------------------------------------------------------------

async function loadPlaywright() {
  try { return (await import('playwright')).default; } catch { /* not a dependency of this repo */ }
  for (const base of [process.env.PLAYWRIGHT_NODE_MODULES, '/opt/node22/lib/node_modules/'].filter(Boolean)) {
    try { return createRequire(base.endsWith('/') ? base : `${base}/`)('playwright'); } catch { /* next */ }
  }
  return null;
}

test('offline render QA: every sound is audible, never clips, has its length and suits a phone speaker', { timeout: 240000 }, async (t) => {
  const pw = await loadPlaywright();
  if (!pw) { t.skip('playwright not available'); return; }
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { t.skip(`chromium not available: ${e.message.split('\n')[0]}`); return; }
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  await page.route('http://omok.test/**', async (route) => {
    const path = join(ROOT, decodeURIComponent(new URL(route.request().url()).pathname));
    if (!path.startsWith(ROOT)) return route.fulfill({ status: 403, body: '' });
    try { await route.fulfill({ status: 200, body: await readFile(path), contentType: TYPES[extname(path)] || 'application/octet-stream' }); }
    catch { await route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto('http://omok.test/tools/demo-audio.html');
  await page.waitForFunction(() => window.audioQA);
  const rows = await page.evaluate(() => window.audioQA.run({ draw: false }));
  const RULES = await page.evaluate(() => window.audioQA.RULES);
  assert.deepEqual(errors, []);

  const fmt = (r) => `${r.id.padEnd(18)} ${r.durMs.toFixed(0).padStart(5)} ms  peak ${r.peak.toFixed(3)}  phone ${r.phoneDb.toFixed(1).padStart(6)} dB  loss ${r.loss.toFixed(1).padStart(5)}  mid ${(r.mid * 100).toFixed(0).padStart(3)}%`;
  for (const r of rows) t.diagnostic(fmt(r) + (r.fail.length ? `  FAIL ${r.fail.join(',')}` : ''));

  const ids = rows.map((r) => r.id);
  for (const name of [...SPEC_SFX.filter((n) => n !== 'place'), ...SPEC_CHAR_SFX]) assert.ok(ids.includes(name), `${name} measured`);
  for (const th of THEME_IDS) for (const c of ['b', 'w']) assert.ok(ids.includes(`place/${th}/${c}`));
  for (const r of rows) assert.deepEqual(r.fail, [], fmt(r));
  assert.ok(rows.filter((r) => r.group !== 'stress').every((r) => r.peak <= RULES.single), 'single sounds keep their headroom');

  // the loudness hierarchy that ux.md §4.3 asks for, as heard through a phone speaker
  const phone = Object.fromEntries(rows.map((r) => [r.id, r.phoneDb]));
  const ui = rows.filter((r) => r.group === 'ui' || r.group === 'place');
  assert.equal(ui.reduce((a, b) => (b.phoneDb > a.phoneDb ? b : a)).id, 'ko', 'K.O. is the loudest UI sound');
  const stones = rows.filter((r) => r.group === 'place').map((r) => r.phoneDb);
  assert.ok(Math.max(...stones) - Math.min(...stones) <= 2.5, 'every board theme puts the stone down equally loud');
  for (const tick of SMALL) assert.ok(phone[tick] < Math.min(...stones) - 3, `${tick} sits under the stone`);
  assert.ok(phone.cursor < phone.arm, 'the drag tick is the quietest');
  for (const big of ['vs', 'fight', 'timeover']) assert.ok(phone[big] > Math.max(...stones), `${big} is a big moment`);
});
