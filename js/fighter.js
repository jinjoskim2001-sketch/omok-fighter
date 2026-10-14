// js/fighter.js — builds a character "stage" and drives its states (docs/SPEC.md §7, §8.6).
//
//   <div class="stage [alt]" data-char="<id>" data-state="idle|turn|attack|hit|win|lose" style="--size;--dir">
//     <div class="shadow"></div><div class="flash"></div>
//     <div class="rig"><svg class="ch ch-<id>">…</svg></div>   ← whole-body motion (composited)
//     <svg class="fx">…</svg>                                    ← effects that must not spin with the body
//   </div>
//
// All motion is CSS (css/fighters.css + css/chars/<id>.css). This module only switches data-state,
// returns one-shots to idle, schedules idle fidgets, and runs the victory "director": every frame it
// reads currentTime of the .rig's `*-win` CSS animation and fires the character's cues (sfx, particle
// bursts, shake, flash) when that clock crosses them, so cues stay in sync at 30 fps (Low Power Mode),
// through hit-stops/pauses, excerpts and skips. The jingle is scheduled once on the AudioContext clock.
//
// Idle cost (SPEC §8.5: at rest only composited .rig loops run forever):
// - Once a win/lose timeline is over, settle() drops each finished timeline animation that an
//   infinite loop on the same HTML layer (.rig, .shadow) fully covers, so the loop runs alone and
//   can be composited, and gives every loop on an SVG part (and the dizzy stars) a few more
//   cycles before it rests at an iteration boundary. SVG parts are repainted on the main thread
//   (WebKit never composites them), so they must not loop forever on a screen people sit on.
// - Idle fidgets are rationed page-wide: one fighter at a time, with a short pause between two,
//   so a screen with 8 fighters (title) is mostly still.
import { CHARACTERS, getCharacter } from './characters.js';
import { burst, anchor, FX, clear as clearParticles } from './particles.js';
import { audio } from './audio.js';

const STATES = new Set(['idle', 'turn', 'attack', 'hit', 'win', 'lose']);
const ONE_SHOT_MS = { turn: 600, attack: 280, hit: 220 };   // nominal lengths (timeout fallback)
const FIDGET_GAP = [5000, 9000];      // random gap between idle fidgets
const FIDGET_MS = 800;                // how long .fidget stays on (longer if the char's fidget runs longer)
const RM_HOLD = { full: 1200, excerpt: 600 };   // reduced motion: how long the static victory pose holds
const FLASH_GAP = 340;                // ≤ 3 flashes per second, one at a time (SPEC §3.1)
const FX_REF = 240;                   // stage width (px) the particle presets were tuned for
const LOOKAHEAD = 0.008;              // s: fire a cue up to half a 60 Hz frame early rather than a frame late
const JINGLE_LATE = 0.15;             // s: a jingle we notice later than this is dropped (not played off-beat)
const STALE = 0.35;                   // s: after a main-thread hitch, cues this late are dropped (no sound a second late)
const LOOP_REST_MS = 4000;            // SVG-part loops run about this long after their start, then rest
const REST_EPS = 0.001;               // of a cycle: where a resting loop stops past its boundary (see restAfterLoops)
const FIDGET_MAX = 1;                 // fighters fidgeting at once, page-wide (the title has 8)
const FIDGET_PAUSE = 600;             // ms, page-wide, between the end of one fidget and the next

const DEFAULT_ANCHORS = { head: [60, 10], center: [60, 63], feet: [60, 110], sky: [60, -15] };

let lastFlash = -1e9;
const fidgeting = new Set();          // fighters showing a fidget right now (page-wide ration)
let fidgetFreeAt = 0;                 // performance.now() before which no new fidget starts
const activeWins = new Set();         // directors in flight (for visibilitychange)
let visHooked = false;
const warned = new Set();

const hasDoc = typeof document !== 'undefined';
const reduced = () => hasDoc && document.documentElement.dataset.motion === 'reduce';
const isCss = a => typeof a.animationName === 'string';           // CSSAnimation (not our own WAAPI)
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// An element inside a character's SVG (repainted on the main thread), as opposed to an HTML layer
// or an outer <svg> box, whose transform/opacity animations the compositor can run.
const isSvgPart = t => typeof SVGElement !== 'undefined' && t instanceof SVGElement && !!t.ownerSVGElement;
function propsOf(a) {
  const out = new Set();
  try {
    for (const k of a.effect.getKeyframes()) {
      for (const p of Object.keys(k)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(p)) out.add(p);
    }
  } catch { out.add('*'); }    // unknown: never treat as covered
  return out;
}

function warnOnce(key, ...msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn('[fighter]', ...msg);
}
function safe(fn, ...args) {
  if (typeof fn !== 'function') return undefined;
  try { return fn(...args); } catch (e) { console.warn('[fighter]', e); return undefined; }
}
function playSfx(name) {
  try { audio?.play?.(name); } catch (e) { warnOnce('sfx', 'audio.play failed', e); }
}

function resolve(idOrChar) {
  if (idOrChar && typeof idOrChar === 'object' && idOrChar.svg) return idOrChar;
  const c = getCharacter(idOrChar);
  if (c) return c;
  warnOnce('id:' + idOrChar, `unknown character "${idOrChar}", using "${CHARACTERS[0].id}"`);
  return CHARACTERS[0];
}

// ---------------------------------------------------------------- static markup (HUD, select grid)
const withViewBox = (svg, vb) => svg.replace(/viewBox="[^"]*"/, `viewBox="${vb}"`);

// Head crop. No .stage and no data-state, so no state/fidget animation selector can ever match;
// css/fighters.css (.fig rules) hides face-b/face-c.
export function portraitHTML(id, { alt = false } = {}) {
  const c = resolve(id);
  return `<div class="fig fig-portrait${alt ? ' alt' : ''}" data-id="${c.id}">${withViewBox(c.svg, c.portrait || '24 6 72 72')}</div>`;
}
// Full body, static (default face).
export function figureHTML(id, { alt = false } = {}) {
  const c = resolve(id);
  return `<div class="fig fig-full${alt ? ' alt' : ''}" data-id="${c.id}">${c.svg}</div>`;
}

// ---------------------------------------------------------------- visibility: finish wins when hidden
function hookVisibility() {
  if (visHooked || !hasDoc) return;
  visHooked = true;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    for (const w of [...activeWins]) w.hide();
    try { clearParticles(); } catch { /* particles never created */ }
  });
}

// ---------------------------------------------------------------- the fighter
export function createFighter(id, { alt = false, size = 120, dir = 1 } = {}) {
  const char = resolve(id);
  const T = num(char.winMs, 2400) / 1000;
  const hitAt = num(char.hitAt, T * 0.65);
  const anchors = { ...DEFAULT_ANCHORS, ...(char.anchors || {}) };
  const cues = (Array.isArray(char.cues) ? char.cues : [])
    .filter(c => c && typeof c.t === 'number')
    .slice().sort((a, b) => a.t - b.t);

  const el = document.createElement('div');
  el.className = 'stage' + (alt ? ' alt' : '');
  el.dataset.char = char.id;
  el.dataset.state = 'idle';
  el.innerHTML = `<div class="shadow"></div><div class="flash"></div><div class="rig">${char.svg}</div>${char.fx || ''}`;
  const rig = el.querySelector('.rig');
  const flashEl = el.querySelector('.flash');

  let state = 'idle';
  let destroyed = false;
  let oneShot = null;          // { state, timer }
  let fidgetTimer = 0, fidgetOff = 0, fidgetMisses = 0, seenConnected = false;
  let director = null;
  let frozen = false;          // pose() paused the CSS clock
  let settleTimer = 0, settleTries = 0;
  let pinned = [];             // [element, property]: inline values settle() left behind (cleared by apply)
  const me = {};               // this fighter's token in the page-wide fidget ration

  setSize(size);
  setDir(dir);

  function setSize(s) { el.style.setProperty('--size', typeof s === 'number' ? s + 'px' : String(s)); }
  function setDir(d) { el.style.setProperty('--dir', d < 0 ? '-1' : '1'); }
  function setAlt(on) { el.classList.toggle('alt', !!on); }

  function anims() {
    try { return el.getAnimations({ subtree: true }).filter(isCss); } catch { return []; }
  }
  // remaining ms of the finite CSS animations in the subtree (forces a style flush, which is what we want)
  function finiteRemaining() {
    let ms = 0;
    for (const a of anims()) {
      const end = a.effect?.getComputedTiming?.().endTime;
      if (typeof end === 'number' && isFinite(end)) ms = Math.max(ms, end - (a.currentTime || 0));
    }
    return ms;
  }
  function finiteRunning() {
    return anims().some(a => {
      const end = a.effect?.getComputedTiming?.().endTime;
      return typeof end === 'number' && isFinite(end) && a.playState !== 'finished';
    });
  }

  // Switch data-state. The style engine only sees the state at its next flush, so "idle then win" in one
  // task would look like "win → win" and keep the old animations. Clearing the attribute and flushing
  // style (getAnimations does a style-only flush, no layout) guarantees fresh animations from 0.
  function apply(next) {
    clearTimeout(settleTimer);
    settleTimer = 0;
    settleTries = 0;
    for (const [t, p] of pinned) t.style.removeProperty(p);
    pinned = [];
    el.classList.remove('fidget');
    if (el.dataset.state) {
      el.dataset.state = '';
      anims();
    }
    frozen = false;
    el.dataset.state = state = next;
  }

  // ---- one-shots (turn / attack / hit) return to idle on animationend, with a timeout fallback
  function clearOneShot() {
    if (oneShot) clearTimeout(oneShot.timer);
    oneShot = null;
  }
  function startOneShot(next) {
    const ms = clamp(Math.max(ONE_SHOT_MS[next], finiteRemaining()), 0, 3000);
    const o = { state: next, timer: 0 };
    o.timer = setTimeout(() => endOneShot(o), ms + 120);
    oneShot = o;
  }
  function endOneShot(o) {
    if (oneShot !== o) return;
    oneShot = null;
    if (state === o.state && !destroyed) { apply('idle'); scheduleFidget(); }
  }
  function onAnimEnd() {
    if (oneShot && !finiteRunning()) endOneShot(oneShot);
  }
  el.addEventListener('animationend', onAnimEnd);

  // ---- idle fidget: .fidget for ~0.8 s every 5–9 s while idle (stops when not idle or detached)
  function stopFidget() {
    clearTimeout(fidgetTimer); clearTimeout(fidgetOff);
    fidgetTimer = fidgetOff = 0;
    el.classList.remove('fidget');
    releaseFidget();
  }
  function releaseFidget() {
    if (!fidgeting.delete(me)) return;
    fidgetFreeAt = Math.max(fidgetFreeAt, performance.now() + FIDGET_PAUSE);
  }
  function scheduleFidget() {
    clearTimeout(fidgetTimer);
    fidgetTimer = 0;
    if (destroyed || state !== 'idle') return;
    fidgetTimer = setTimeout(fidget, FIDGET_GAP[0] + Math.random() * (FIDGET_GAP[1] - FIDGET_GAP[0]));
  }
  function fidget() {
    fidgetTimer = 0;
    if (destroyed || state !== 'idle') return;
    if (!el.isConnected) {
      // detached after being shown = abandoned (don't keep it alive); never shown yet = keep waiting a bit
      if (seenConnected || ++fidgetMisses > 8) return;
      scheduleFidget();
      return;
    }
    seenConnected = true;
    fidgetMisses = 0;
    if (document.hidden || reduced()) { scheduleFidget(); return; }
    // Someone else is fidgeting (or just was): skip this one, try again after a full gap.
    if (fidgeting.size >= FIDGET_MAX || performance.now() < fidgetFreeAt) { scheduleFidget(); return; }
    fidgeting.add(me);
    el.classList.add('fidget');
    const ms = clamp(Math.max(FIDGET_MS, finiteRemaining()), FIDGET_MS, 2000);
    fidgetOff = setTimeout(() => {
      fidgetOff = 0;
      el.classList.remove('fidget');
      releaseFidget();
      scheduleFidget();
    }, ms + 40);
  }

  // ---- states
  function set(next, { sound = true } = {}) {
    if (destroyed) return;
    if (next === 'win') { win({ sound }); return; }
    if (!STATES.has(next)) { warnOnce('state:' + next, `unknown state "${next}"`); return; }
    endDirector(false);
    clearOneShot();
    stopFidget();
    const isOneShot = next in ONE_SHOT_MS;
    if (next === state && !isOneShot && !frozen) {          // idle→idle / lose→lose: keep the running loop
      if (next === 'idle') scheduleFidget();
      return;
    }
    apply(next);
    if (el.isConnected) seenConnected = true;
    if (isOneShot) startOneShot(next);
    else if (next === 'idle') scheduleFidget();
    else if (next === 'lose') scheduleSettle();
    if (next === 'turn' && sound && char.turnSfx) playSfx(char.turnSfx);
  }

  // ---- settle: after the win/lose timeline only composited loops keep running
  function scheduleSettle() {
    clearTimeout(settleTimer);
    // When the last finite part (timeline, one-shot droop, the stars' fade-in…) has ended. The
    // loops are infinite, so finiteRemaining() ignores them.
    settleTimer = setTimeout(settle, clamp(finiteRemaining(), 0, 5000) + 50);
  }
  function settle() {
    settleTimer = 0;
    if (destroyed || frozen || reduced() || (state !== 'win' && state !== 'lose')) return;
    const list = anims();
    if (!list.length) return;
    // A hit-stop or a debug freeze holds the clock: leave every animation as it is, look again
    // later. Started later than planned (a busy frame when the screen mounted): wait for the rest.
    const held = list.some(a => a.playState === 'paused');
    if (held || finiteRunning()) {
      if (++settleTries < 6) { if (held) settleTimer = setTimeout(settle, 500); else scheduleSettle(); }
      return;
    }
    const byTarget = new Map();
    for (const a of list) {
      const t = a.effect?.target;
      if (!t) continue;
      if (!byTarget.has(t)) byTarget.set(t, []);
      byTarget.get(t).push(a);
    }
    for (const [target, group] of byTarget) {
      const loops = group.filter(a => a.effect.getTiming().iterations === Infinity);
      if (!loops.length) continue;
      if (isSvgPart(target)) { for (const a of loops) restAfterLoops(a); continue; }
      // HTML layer: a finished timeline under the loop makes the browser run the loop on the main
      // thread ("incompatible animations"). Drop it when the loop overrides everything it set.
      const covered = new Set();
      for (const a of loops) for (const p of propsOf(a)) covered.add(p);
      let dropped = false;
      const firstLoop = Math.min(...loops.map(a => group.indexOf(a)));
      for (const a of group) {
        // Only one the loops override (earlier in composite order): dropping it changes nothing.
        if (loops.includes(a) || a.playState !== 'finished' || group.indexOf(a) > firstLoop) continue;
        const extra = [...propsOf(a)].filter(p => !covered.has(p));
        if (extra.includes('*')) continue;
        // A property only the finished one sets (the opacity of a vanish-and-return) keeps its
        // final value: read it, cancel, and pin it inline if the cancel changed it.
        const cs = getComputedStyle(target);
        const css = p => p.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
        const kept = extra.map(p => [css(p), cs.getPropertyValue(css(p))]);
        a.cancel();
        dropped = true;
        for (const [p, v] of kept) {
          if (cs.getPropertyValue(p) === v) continue;
          target.style.setProperty(p, v);
          pinned.push([target, p]);
        }
      }
      // Re-seat the loop where it is (no visual change) so it is started afresh, alone.
      if (dropped) for (const a of loops) { try { a.currentTime = a.currentTime; } catch { /* gone */ } }
    }
  }
  // Let an infinite loop on an SVG part play about LOOP_REST_MS from its start, then stop on the
  // cycle boundary and hold the loop's home frame (keyframe 0%: the pose it set out from, which
  // the timeline handed over; for a cyclic loop it is also the frame just shown, so no jump).
  // Holding a hair past the boundary (REST_EPS of a cycle) rather than exactly on it makes the
  // held frame keyframe 0% even for a stepped blink whose last frame is "off".
  // A negative delay is a phase offset (the dizzy stars are spread around their orbit that way):
  // such loops stop at the same moment as an unshifted one, so the spread survives.
  function restAfterLoops(a) {
    try {
      const tm = a.effect.getTiming();
      const dur = typeof tm.duration === 'number' ? tm.duration : a.effect.getComputedTiming().duration;
      if (!(dur > 0)) return;
      const delay = tm.delay || 0;
      const phase = delay < 0 ? -delay / dur : 0;
      const local = (a.currentTime || 0) - Math.max(0, delay);           // time since the loop began
      const n = Math.max(2, Math.ceil(LOOP_REST_MS / dur), Math.floor(local / dur) + 1);
      a.effect.updateTiming({ iterations: n + phase + REST_EPS, fill: 'forwards' });
    } catch { /* timing API missing: the loop just keeps going */ }
  }

  // ---- victory + director
  function findWinAnim() {
    try { return rig.getAnimations().find(a => isCss(a) && a.animationName.endsWith('-win')) || null; } catch { return null; }
  }
  function tryExcerpt(d) {
    const list = anims();
    if (!list.length) return;
    const ms = d.startT * 1000;
    for (const a of list) a.currentTime = (a.currentTime || 0) + ms;
    d.excerptDone = true;
  }
  function startJingle(d, delay) {
    d.jingleDone = true;
    if (!d.sound || !char.jingle) return;
    try {
      d.jingle = audio?.jingle?.(char.jingle, { delay }) || null;
      d.jingleStart = performance.now() + delay * 1000;
    } catch (e) { warnOnce('jingle', 'audio.jingle failed', e); }
  }
  function stopJingle(d) {
    try { d.jingle?.stop?.(); } catch { /* ignore */ }
    d.jingle = null;
  }
  function jingleSounding(d) {
    return !!d.jingle && performance.now() >= d.jingleStart - 30;
  }
  function anchorPoint(at) {
    if (Array.isArray(at) && at.length === 2) return at;
    return anchors[at] || anchors.center;
  }
  function spawn(name, at) {
    const preset = FX[name];
    if (!preset) { warnOnce('fx:' + name, `unknown fx "${name}"`); return; }
    if (!el.isConnected) return;
    const [vx, vy] = anchorPoint(at);
    const pos = anchor(el, vx, vy);
    const w = el.getBoundingClientRect().width;
    if (!w) return;
    // presets are tuned for a ~240 px stage; scale so bursts stay in proportion on the small battle stage
    const k = clamp(w / FX_REF, 0.5, 1.25);
    const sc = r => r && [r[0] * k, r[1] * k];
    try {
      burst({
        ...preset, ...pos,
        n: Math.max(4, Math.round((preset.n || 24) * clamp(k, 0.6, 1))),
        size: sc(preset.size), speed: sc(preset.speed),
        gravity: (preset.gravity ?? 320) * k,
      });
    } catch (e) { warnOnce('burst', 'particles.burst failed', e); }
  }
  function flash(d) {
    const now = performance.now();
    if (now - lastFlash < FLASH_GAP) return;
    lastFlash = now;
    safe(d.onFlash);
    try {
      flashEl.animate([
        { opacity: 0, transform: 'scale(.5)' },
        { opacity: 0.95, transform: 'scale(.95)', offset: 0.18 },
        { opacity: 0, transform: 'scale(1.35)' },
      ], { duration: 360, easing: 'ease-out' });
    } catch { /* WAAPI missing: the CSS flash (if any) still plays */ }
  }
  function fire(d, cue, t) {
    const dropped = t - cue.t > STALE;
    safe(d.onCue, cue, t, dropped);
    if (dropped) return;
    if (cue.sfx && d.sound) playSfx(cue.sfx);
    if (cue.fx) spawn(cue.fx, cue.at);
    if (cue.shake) safe(d.onShake, cue.shake);
    if (cue.flash) flash(d);
  }
  function step(d, t) {
    if (!d.jingleDone && !d.anim?.pending) {
      const delay = num(char.jingle?.at, hitAt) - t;
      if (delay >= -JINGLE_LATE) startJingle(d, Math.max(0, delay));
      else d.jingleDone = true;      // started past the jingle (late excerpt): don't play it off-beat
    }
    while (d.next < cues.length && cues[d.next].t <= t + LOOKAHEAD) fire(d, cues[d.next++], t);
    if (!d.hitDone && t + LOOKAHEAD >= hitAt) { d.hitDone = true; safe(d.onHit); }
    if (t >= T) endDirector(true);
  }
  function frame(now) {
    const d = director;
    if (!d) return;
    d.raf = 0;
    if (el.dataset.state !== 'win') { endDirector(false); return; }   // someone switched state under us
    if (el.isConnected) d.seen = true;
    else if (d.seen) { endDirector(true); return; }                  // removed from the DOM mid-show
    if (!d.excerptDone) tryExcerpt(d);
    let t = null;
    if (!d.clock) {
      if (!d.anim || d.anim.playState === 'idle') d.anim = findWinAnim();
      const ct = d.anim?.currentTime;
      if (d.excerptDone && typeof ct === 'number') t = ct / 1000;
      else if (now - d.t0 > 400) d.clock = true;   // no CSS timeline (display:none? no CSS?): wall clock from win()
    }
    if (d.clock) t = d.startT + (now - d.t0) / 1000;
    if (t !== null) step(d, t);
    if (director === d) d.raf = requestAnimationFrame(frame);
  }
  // Jump every win animation to the end of the 2.4 s timeline (the loops start from their beginning).
  function jumpToEnd() {
    const end = T * 1000;
    try {
      for (const a of el.getAnimations({ subtree: true })) {
        if (!isCss(a)) { a.cancel(); continue; }        // our WAAPI flash
        if ((a.currentTime || 0) < end) a.currentTime = end;
      }
    } catch { /* ignore */ }
  }
  function endDirector(completed) {
    const d = director;
    if (!d) return;
    director = null;
    activeWins.delete(d.handle);
    if (d.raf) cancelAnimationFrame(d.raf);
    clearTimeout(d.hold);
    if (!completed && !jingleSounding(d)) stopJingle(d);   // interrupted before the tune began: cancel it
    if (completed && !d.hitDone) { d.hitDone = true; safe(d.onHit); }
    if (completed && !d.rm && !destroyed && state === 'win') scheduleSettle();
    d.resolve();
  }

  function win({ excerpt = false, sound = true, onShake, onHit, onFlash, onCue } = {}) {
    if (destroyed) return Promise.resolve();
    endDirector(false);
    clearOneShot();
    stopFidget();
    apply('win');
    if (el.isConnected) seenConnected = true;
    const startT = excerpt ? clamp(num(char.excerptFrom, hitAt - 0.3), 0, T) : 0;
    return new Promise(res => {
      const d = {
        resolve: res, sound, onShake, onHit, onFlash, onCue, startT,
        next: cues.findIndex(c => c.t >= startT - 1e-6),   // cues before the excerpt start are skipped
        hitDone: false, jingle: null, jingleStart: 0, jingleDone: !(sound && char.jingle),
        excerptDone: startT === 0, anim: null, clock: false, seen: false,
        t0: performance.now(), raf: 0, hold: 0, rm: false,
      };
      if (d.next < 0) d.next = cues.length;
      d.handle = {
        hide() {                          // page hidden: end the show now, silently
          if (director !== d) return;
          if (!d.rm) jumpToEnd();
          stopJingle(d);
          endDirector(true);
        },
      };
      director = d;
      activeWins.add(d.handle);
      hookVisibility();
      if (reduced()) {
        // static victory pose from CSS; no cues/particles/shake/flash. Jingle still plays.
        d.rm = true;
        d.hitDone = true;
        safe(onHit);
        startJingle(d, 0);
        d.hold = setTimeout(() => endDirector(true), excerpt ? RM_HOLD.excerpt : RM_HOLD.full);
        return;
      }
      if (!d.excerptDone) tryExcerpt(d);
      // in the DOM but no *-win CSS animation (display:none host, CSS missing): run on the wall clock now.
      // (Not yet attached: frame() waits up to 400 ms for the CSS clock to appear.)
      if (el.isConnected && !findWinAnim()) d.clock = true;
      d.raf = requestAnimationFrame(frame);
    });
  }

  // Jump the running victory to 2.4 s (tap-to-skip). Remaining cues are dropped; a jingle that has
  // not started sounding yet starts now, so the winner still gets their tune. No-op otherwise.
  function skip() {
    const d = director;
    if (!d) return;
    if (!d.rm) jumpToEnd();
    d.next = cues.length;
    if (d.sound && char.jingle && !jingleSounding(d)) {
      stopJingle(d);
      startJingle(d, 0);
    }
    endDirector(true);
  }

  // Deterministic still for screenshots/debug (?shot=…&t=): show `next` frozen at t seconds of its
  // timeline. No director, sound, particles or fidget. Needs the stage in the DOM with its CSS loaded.
  // Any later set()/win() restarts live animation.
  function pose(next, t = 0) {
    if (destroyed || !STATES.has(next)) return;
    endDirector(false);
    clearOneShot();
    stopFidget();
    apply(next);
    frozen = true;
    for (const a of anims()) { a.pause(); a.currentTime = Math.max(0, t) * 1000; }
  }

  function destroy() {
    if (destroyed) return;
    endDirector(false);                           // a pending jingle dies with the fighter; a playing one rings out
    destroyed = true;
    clearTimeout(settleTimer);
    clearOneShot();
    stopFidget();
    el.removeEventListener('animationend', onAnimEnd);
    el.remove();
  }

  scheduleFidget();

  return {
    el, id: char.id, char,
    get state() { return state; },
    set, win, skip, pose, destroy,
    setAlt, setDir, setSize,
  };
}
