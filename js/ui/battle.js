// js/ui/battle.js — the battle screen controller (SPEC §2, §3.1, §4, §4.1).
// Owns: the match state (js/match.js), the board (js/board.js), the two fighters on the stage strip,
// the CPU (js/ai-client.js), the move timer, undo (with 2P approval), pause / resign / forfeit, the
// round intro, coin toss, K.O. / TIME OVER / DRAW sequences, the round result and saving.
//
// Rules of thumb that shape this file:
// - The match state is saved synchronously after every change (iOS kills background PWAs).
// - Board input is open only in phase 'play' with no hold (pause / dialog / hidden / landscape) and
//   ≥ 250 ms after the last stone (one phone, two players: a double tap must not leak).
// - The move timer runs only for a human in phase 'play' with no hold; pause, dialogs, sequences,
//   hidden and landscape all stop it.
// - Every sequence is a createSeq timeline, so a tap-to-skip and a debug shot jump to exactly the
//   state the full timeline would reach.

import { h, esc, createTimers, createSeq, randInt } from './dom.js';
import { app, speed, fxScale, shakeOn, motionReduced } from './ctx.js';
import { btn, sfx, ICONS, haptic, stoneIcon } from './widgets.js';
import { toast } from './toast.js';
import { openLayer, confirmDialog, chooseDialog, isSheetOpen, closeAll } from './sheet.js';
import { createHud, charOf, ptbg } from './hud.js';
import * as M from '../match.js';
import { createBoard } from '../board.js';
import { THEMES } from '../themes.js';
import { createAiClient } from '../ai-client.js';
import { createFighter } from '../fighter.js';
import { keepAwake } from '../wake.js';
import { N, EMPTY, BLACK, isForbidden, judgeMove } from '../rules.js';
import { release as releaseParticles } from '../particles.js';

const PCOL = { 1: '#FF4757', 2: '#2E9BFF' };
const INK = '#2A1E2F';         // --ink (SPEC §9)

// a·t + b·(1 − t) for #rrggbb colours — what color-mix(in srgb, a t, b) gives, without needing
// Safari 16.2. Anything else comes back as `a` unchanged.
export function mixHex(a, b, t) {
  const p = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
  const x = p(a), y = p(b);
  if (!x || !y) return a;
  return '#' + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
}
const THINK_MS = { easy: [500, 900], normal: [600, 1100], hard: [700, 1300] };
const FORCED_MS = 450;
const LOCK_MS = 250;           // after a stone or an undo
const HOLD_LOCK_MS = 250;      // after a pause / dialog closes and on 이어하기: a double tap must not leak
const UNDO_GUARD_MS = 400;     // a quick double tap on 무르기 is one request
const CLOCK_MIN_MS = 2000;     // 이어하기 with the move clock nearly out: at least this much to find the board
const PEEK_AFTER_MS = 1200;    // 판 보기 released after the auto-advance came due: this long, then go on

// The screen shake (8 px → 0), as WAAPI keyframes: the same curve as @keyframes bt-shake.
const SHAKE_CURVE = [[0, 0, 0], [0.08, 1, -0.6], [0.17, -0.88, 0.7], [0.26, 0.76, 0.5], [0.35, -0.64, -0.62], [0.44, 0.52, 0.4],
  [0.53, -0.42, -0.3], [0.62, 0.32, 0.3], [0.71, -0.22, -0.2], [0.8, 0.14, 0.1], [0.9, -0.06, -0.05], [1, 0, 0]];
export function shakeFrames(amp) {
  return SHAKE_CURVE.map(([offset, x, y]) => ({ offset, transform: `translate(${(x * amp).toFixed(2)}px, ${(y * amp).toFixed(2)}px)` }));
}

export function createBattle(params) {
  const theme = THEMES[params.theme] ? params.theme : 'mat';
  const T = THEMES[theme];
  let S = params.match;
  const cfg = S.cfg;
  const cpu = cfg.mode === 'cpu';
  const mirror = cfg.p1 === cfg.p2;
  const chars = { 1: charOf(cfg.p1), 2: charOf(cfg.p2) };
  const label = (p) => (p === 1 ? '1P' : cpu ? 'CPU' : '2P');
  const timers = createTimers();

  let phase = 'init';            // init | intro | play | cpu | seq | result | over
  let destroyed = false;
  let board = null;
  let ai = null;
  let lockUntil = 0;
  let lockTimer = 0;
  let thinkSeq = 0;
  let recorded = false;
  let undoGuard = 0;             // performance.now() until which 무르기 ignores taps
  let pendingClock = null;       // 이어하기: the saved move clock, used by the first startTurn
  let tapHandler = null;         // what a tap on the sequence catcher does
  const holds = new Set();       // pause | dialog | hidden | landscape
  const fighters = {};

  // ---- DOM -------------------------------------------------------------------------------
  const el = h('section', { 'aria-label': '대국', dataset: { theme, mode: cfg.mode } });
  el.style.setProperty('--accent', T.accent || '#FFD23F');
  el.style.setProperty('--accent-floor', mixHex(T.accent || '#FFD23F', INK, 0.7));
  if (cfg.timer) el.classList.add('bt--timer');     // HUD headroom for the MATCH POINT tag (battle.css)
  const bg = h('div.bt__bg');
  if (T.pageBg) bg.style.background = T.pageBg;
  const shake = h('div.bt__shake');
  const hud = createHud(S);
  const mid = h('div.bt__mid');
  const wrap = h('div.bt__boardwrap');
  const host = h('div.bt__board', { 'aria-label': '오목판' });
  const ov = h('div.bt__ov');
  wrap.append(host, ov);
  const stage = h('div.bt__stage');
  stage.innerHTML = '<div class="bt__floor"></div><div class="bt__slot bt__slot--1"></div><div class="bt__slot bt__slot--2"></div>';
  mid.append(wrap, stage);

  const bar = h('footer.bt__bar');
  const undoBtn = btn('무르기', { cls: 'btn--dark btn--sm bt__undo', icon: ICONS.undo, sound: 'menu', onClick: () => requestUndo() });
  const turnChip = h('div.bt__turn', { 'aria-live': 'polite' });
  const pauseBtn = btn('', { cls: 'btn--dark btn--icon bt__pause', icon: ICONS.pause, aria: '일시정지', sound: '', onClick: () => openPause() });
  bar.append(undoBtn, turnChip, pauseBtn);

  const dim = h('div.bt__dim');
  shake.append(hud.el, mid, bar, dim);
  const flashEl = h('div.bt__flash');
  const tap = h('div.bt__tap');
  tap.addEventListener('pointerup', (e) => { if (tapHandler) { e.preventDefault(); tapHandler(e); } });
  el.append(bg, shake, flashEl, tap);

  // ---- helpers ---------------------------------------------------------------------------
  const persist = () => app.saveMatch(S, theme, clockSave());
  const lastMove = () => (S.moves.length ? S.moves[S.moves.length - 1] : -1);
  const moverAt = (k) => (k % 2 === 0 ? S.black : 3 - S.black);
  const isCpuTurn = () => cpu && S.status === 'playing' && M.toMove(S) === 2;

  function setTap(fn) {
    tapHandler = fn;
    tap.classList.toggle('is-on', !!fn);
  }

  function holdOn(r) { holds.add(r); syncLock(); }
  // Every hold (pause, dialog, hidden, landscape) ends with a short input lock: the tap that
  // closed the dialog may be the first half of a double tap whose second half lands on the board.
  function holdOff(r) {
    holds.delete(r);
    lockFor(HOLD_LOCK_MS);
    syncLock();
  }
  function lockFor(ms) { lockUntil = Math.max(lockUntil, performance.now() + ms); }
  function inputOpen() {
    return phase === 'play' && holds.size === 0 && !isSheetOpen() && performance.now() >= lockUntil && !destroyed;
  }
  function syncLock() {
    timerSync();
    if (!board) return;
    board.setLocked(!inputOpen());
    timers.clear(lockTimer);
    const wait = lockUntil - performance.now();
    if (phase === 'play' && wait > 0) lockTimer = timers.set(syncLock, wait + 5);
    updateBar();
  }

  // ---- move timer --------------------------------------------------------------------------
  // Nothing runs per frame. The bar is one compositor animation per stretch of running time
  // (hud.runTimer); the 5…1 ticks, the low / critical colours and the timeout are timeouts at the
  // second boundaries. Every hold, sheet or phase change goes through syncLock → timerSync, which
  // banks the time used and stops both, so nothing runs while paused, hidden or rotated.
  const TT = { total: cfg.timer * 1000, p: 0, left: 0, since: 0, running: false, sec: 99, t: 0 };
  const timerShouldRun = () => !!TT.p && !destroyed && phase === 'play' && holds.size === 0 && !isSheetOpen();
  const timeLeft = () => (TT.running ? TT.left - (performance.now() - TT.since) : TT.left);
  function timerStart(p, left = TT.total) {
    timerStop();
    if (!cfg.timer) return;
    TT.p = p;
    TT.left = Math.max(0, Math.min(TT.total, left));
    TT.sec = Math.ceil(TT.left / 1000);
    hud.setTimer(p, TT.left / TT.total, TT.left / 1000);
    timerSync();
  }
  function timerSync() {
    if (!TT.p) return;
    const run = timerShouldRun();
    if (run === TT.running) return;
    if (run) {
      TT.running = true;
      TT.since = performance.now();
      hud.runTimer(TT.p, TT.left / TT.total, TT.left);
      timerArm();
    } else {
      TT.left = Math.max(0, TT.left - (performance.now() - TT.since));
      TT.running = false;
      timers.clear(TT.t);
      TT.t = 0;
      hud.setTimer(TT.p, TT.left / TT.total, TT.left / 1000);
    }
  }
  // Wake at the next whole second below the time left (or at 0: the timeout).
  function timerArm() {
    timers.clear(TT.t);
    const left = timeLeft();
    const next = Math.max(0, Math.floor((left - 1) / 1000) * 1000);
    TT.t = timers.set(timerTick, Math.max(0, left - next));
  }
  function timerTick() {
    TT.t = 0;
    if (!TT.p || !TT.running) return;
    if (!timerShouldRun()) { timerSync(); return; }      // e.g. a sheet opened without a hold
    const left = timeLeft();
    if (left <= 4) { onTimeout(); return; }
    const secs = Math.ceil((left - 4) / 1000);           // 4 ms: a timeout may land a hair early
    if (secs < TT.sec) {
      TT.sec = secs;
      if (secs >= 1 && secs <= 5) sfx(secs <= 3 ? 'tickHi' : 'tick');
      hud.timerLevel(TT.p, left / TT.total, secs);
    }
    timerArm();
  }
  function timerStop() {
    TT.p = 0;
    TT.running = false;
    timers.clear(TT.t);
    TT.t = 0;
    hud.clearTimer();
  }
  // The running clock goes into the save (메뉴로 / hidden / reload → 이어하기 resumes it).
  function clockSave() {
    if (!TT.p || !cfg.timer || S.status !== 'playing') return null;
    return { p: TT.p, left: Math.max(0, Math.round(timeLeft())), moves: S.moves.length, round: S.round };
  }
  function clockFor(p) {
    const c = pendingClock;
    pendingClock = null;
    if (!c || c.p !== p || c.moves !== S.moves.length || c.round !== S.round || !Number.isFinite(c.left)) return TT.total;
    return Math.min(TT.total, Math.max(CLOCK_MIN_MS, c.left));
  }
  function onTimeout() {
    const p = TT.p;
    timerStop();
    const before = S.moves.length;
    if (board.armed() >= 0) {
      const idx = board.commitArmed();
      if (S.moves.length === before && idx >= 0) commitMove(idx);
      if (S.moves.length > before || S.status !== 'playing') return;
    }
    const r = M.timeoutRound(S, p);
    if (r.ok) roundEnd(r);
  }

  // ---- bottom bar ------------------------------------------------------------------------------
  function undoRequester() {
    if (cpu) return 1;
    return S.moves.length ? moverAt(S.moves.length - 1) : 0;
  }
  function canUndoNow() {
    if (S.status !== 'playing' || !(phase === 'play' || phase === 'cpu')) return false;
    const p = undoRequester();
    if (!p || M.undoLeft(S, p) < 1) return false;
    const probe = JSON.parse(JSON.stringify(S));
    return M.undo(probe, p).ok;
  }
  function updateBar() {
    const p = undoRequester() || (S.status === 'playing' ? M.toMove(S) : 1);
    const left = M.undoLeft(S, p);
    const n = left === Infinity ? '∞' : String(left);
    undoBtn.querySelector('.btn__label').textContent = `무르기 (${n})`;
    undoBtn.disabled = !canUndoNow() || holds.has('pause');
    pauseBtn.disabled = !(phase === 'play' || phase === 'cpu');
    if (S.status !== 'playing') {
      const last = S.rounds[S.rounds.length - 1];
      const w = S.forfeit ? 3 - S.forfeit : last ? last.winner : 0;
      turnChip.className = `bt__turn is-over${w ? ` is-p${w}` : ''}`;
      turnChip.innerHTML = w ? `<span class="bt__who">${label(w)}</span><span class="bt__what">승!</span>` : '<span class="bt__what">무승부</span>';
      return;
    }
    const t = M.toMove(S);
    const c = M.colorOf(S, t);
    const thinking = cpu && t === 2 && phase === 'cpu';
    turnChip.className = `bt__turn is-p${t}`;
    turnChip.innerHTML = thinking
      ? `<span class="bt__who">CPU</span>${stoneIcon(c)}<span class="bt__what">생각 중…</span>`
      : `<span class="bt__who">${label(t)}</span>${stoneIcon(c)}<span class="bt__what">${c === BLACK ? '흑' : '백'} 차례</span>`;
  }

  // ---- forbidden preview marks (설정 "금수 자리 미리 표시") -------------------------------------
  function marks() {
    if (!board) return;
    if (!app.prefs.showForbidden || S.status !== 'playing' || isCpuTurn()) { board.setForbiddenMarks(null); return; }
    const b = M.boardOf(S);
    const c = M.colorOf(S, M.toMove(S));
    const rules = M.rulesOf(S);
    const out = [];
    for (let i = 0; i < N * N; i++) {
      if (b[i] !== EMPTY) continue;
      const x = i % N, y = (i / N) | 0;
      let near = false;
      for (let dy = -3; dy <= 3 && !near; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < N && yy < N && b[yy * N + xx] === c) { near = true; break; }
        }
      }
      if (near && isForbidden(b, x, y, c, rules)) out.push(i);
    }
    board.setForbiddenMarks(out.length ? out : null);
  }

  // ---- turns -------------------------------------------------------------------------------
  function startTurn() {
    if (destroyed || S.status !== 'playing') return;
    const p = M.toMove(S);
    board.setTurn(M.colorOf(S, p), PCOL[p]);
    el.dataset.turn = String(p);
    hud.update();
    marks();
    if (cpu && p === 2) {
      phase = 'cpu';
      syncLock();
      if (app.frozen) hud.thinking(true);          // debug shot: show the state, never think
      else if (holds.size === 0) cpuThink();
    } else {
      phase = 'play';
      syncLock();
      if (!app.frozen) timerStart(p, clockFor(p));
      else if (cfg.timer) hud.setTimer(p, 0.62, cfg.timer * 0.62);
    }
    updateBar();
  }

  function commitMove(idx) {
    if (S.status !== 'playing') return false;
    const p = M.toMove(S);
    const color = M.colorOf(S, p);
    const r = M.play(S, idx);
    if (!r.ok) {
      if (r.reason === '33' || r.reason === '44') rejectFeedback(idx, r.reason);
      return false;
    }
    timerStop();
    lockFor(LOCK_MS);
    try { board.clearArmed(); } catch { /* fine */ }
    board.place(idx, color, { animate: !app.frozen });
    sfx('place', { color, theme });
    fighters[p].set('attack');
    fighters[3 - p].set('hit');
    persist();
    if (r.overline) toast('6목은 승리가 아니에요');
    if (r.roundOver) { roundEnd(r); return true; }
    const next = M.toMove(S);
    timers.set(() => {
      if (!destroyed && S.status === 'playing' && M.toMove(S) === next) fighters[next].set('turn', { sound: !cpu || next === 1 });
    }, 300);
    startTurn();
    return true;
  }

  function onHumanCommit(idx) {
    if (phase !== 'play' || isCpuTurn() || holds.size || isSheetOpen()) return;
    commitMove(idx);
  }

  // The first three arms ever get a how-to toast (prefs.seenArmHint counts them).
  function onArm() {
    if (app.prefs.input === 'single') return;
    const seen = app.prefs.seenArmHint | 0;
    if (seen < 3) {
      app.setPrefs({ seenArmHint: seen + 1 });
      toast('한 번 더 탭하면 착수!', { ms: 1600, sound: true });
    }
  }
  function rejectFeedback(idx, reason) {
    try { board.flashForbidden(idx); } catch { /* fine */ }
    forbidToast(idx, reason);
  }
  function onReject(idx, reason) {
    if (reason === '33' || reason === '44') forbidToast(idx, reason);
  }
  // 금수 함정: the rejected point is where the opponent completes five, so this player cannot
  // block it at all. Said only after the tap (no hint before it, SPEC §1), and longer.
  function forbidToast(idx, reason) {
    sfx('deny');
    if (opponentFiveAt(idx)) {
      toast(`금수 함정! 막을 자리가 ${reason === '44' ? '사사예요' : '쌍삼이에요'}`, { ms: 2200, kind: 'bad' });
    } else {
      toast(reason === '44' ? '사사 금지!' : '쌍삼 금지!', { ms: 900, kind: 'bad' });
    }
  }
  function opponentFiveAt(idx) {
    try {
      if (S.status !== 'playing' || !Number.isInteger(idx)) return false;
      const opp = 3 - M.colorOf(S, M.toMove(S));
      return judgeMove(M.boardOf(S), idx % N, (idx / N) | 0, opp, M.rulesOf(S)).win === true;
    } catch { return false; }
  }
  // After a five: was the winning point forbidden for the loser on the loser's last turn?
  // Then the four could not be blocked there — the K.O. says 금수 함정!.
  function koTrap(r) {
    try {
      if (!r || r.how !== 'five' || !r.winner || S.moves.length < 3) return false;
      const last = S.moves[S.moves.length - 1];
      const b = M.boardOf(S);
      b[last] = EMPTY;
      b[S.moves[S.moves.length - 2]] = EMPTY;
      const loserColor = 3 - M.colorOf(S, r.winner);
      return isForbidden(b, last % N, (last / N) | 0, loserColor, M.rulesOf(S));
    } catch { return false; }
  }

  // ---- CPU ---------------------------------------------------------------------------------
  function seedNow() { return (Math.floor(app.rng() * 0x7fffffff) ^ (S.moves.length * 2654435761)) >>> 0; }
  function fallbackMove() {
    const legal = M.legalMoves(S);
    if (!legal.length) return -1;
    const b = M.boardOf(S);
    const near = legal.filter((i) => {
      const x = i % N, y = (i / N) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if ((dx || dy) && xx >= 0 && yy >= 0 && xx < N && yy < N && b[yy * N + xx]) return true;
      }
      return false;
    });
    const pool = near.length ? near : legal;
    return pool.includes(112) && !S.moves.length ? 112 : pool[Math.floor(app.rng() * pool.length)];
  }
  async function cpuThink() {
    const my = ++thinkSeq;
    hud.thinking(true);
    updateBar();
    const t0 = performance.now();
    let res = null;
    try {
      if (!ai) ai = createAiClient({ overlineWins: cfg.overlineWins });
      res = await ai.think({ moves: S.moves.slice(), level: cfg.cpuLevel, seed: seedNow() });
    } catch (err) {
      // AbortError = cancelled (undo, pause, hidden, leaving): the caller asks again when it resumes.
      if (my !== thinkSeq || destroyed || (err && err.name === 'AbortError')) return;
      console.warn('[battle] AI failed, using a simple move', err);
      res = { move: fallbackMove(), reason: 'fallback' };
    }
    if (my !== thinkSeq || destroyed) return;
    const reason = String((res && res.reason) || '');
    const forced = /^(win|block|vcf|forced)$/.test(reason);
    const [lo, hi] = THINK_MS[cfg.cpuLevel] || THINK_MS.normal;
    const want = forced ? FORCED_MS : randInt(app.rng, lo, hi);
    const wait = Math.max(0, want - (performance.now() - t0));
    timers.set(() => {
      if (my !== thinkSeq || destroyed || phase !== 'cpu' || holds.size) return;
      hud.thinking(false);
      let idx = res && Number.isInteger(res.move) ? res.move : -1;
      if (idx < 0 || !M.canPlace(S, idx).ok) idx = fallbackMove();
      if (idx < 0) return;
      commitMove(idx);
    }, wait);
  }
  function cancelThink() {
    thinkSeq++;
    try { if (ai) ai.cancel(); } catch { /* fine */ }
    hud.thinking(false);
  }

  // ---- undo ---------------------------------------------------------------------------------
  async function requestUndo() {
    if (performance.now() < undoGuard) return;          // the second half of a double tap
    if (!canUndoNow()) {
      const p = undoRequester();
      if (p && M.undoLeft(S, p) < 1) toast('무르기를 다 썼어요');
      return;
    }
    const p = undoRequester();
    if (cpu) {
      if (phase === 'cpu') cancelThink();
      doUndo(1);
      return;
    }
    undoGuard = performance.now() + UNDO_GUARD_MS;
    holdOn('dialog');
    try { board.clearArmed(); } catch { /* fine */ }
    const ok = await undoAsk(p);
    holdOff('dialog');
    if (destroyed || S.status !== 'playing') return;
    if (ok) doUndo(p);
    else { toast(`${label(3 - p)}: 안 돼!`); syncLock(); }
  }
  // Only the opponent's answer decides: no scrim / Escape dismiss, so a stray tap (the requester's
  // double tap) can never count as '안 돼'.
  function undoAsk(p) {
    const o = 3 - p;
    const body = h('div.dlg');
    body.append(h('p.dlg__text', { text: `${label(o)}(${chars[o].ko})가 허락하면 무를 수 있어요.` }));
    const row = h('div.dlg__row');
    let layer = null;
    row.append(
      btn('안 돼', { cls: 'btn--ghost', sound: 'cancel', onClick: () => layer.close(false) }),
      btn('봐준다', { cls: 'btn--gold', sound: 'ok', onClick: () => layer.close(true) }),
    );
    body.append(row);
    layer = openLayer({ kind: 'dialog', title: `${label(p)}: 한 수만 물러줘~`, body, cls: `undo-ask undo-ask--p${o}`, dismiss: false });
    return layer.done.then((v) => v === true);
  }
  function doUndo(p) {
    const r = M.undo(S, p);
    if (!r.ok) { if (r.reason === 'limit') toast('무르기를 다 썼어요'); syncLock(); return; }
    timerStop();
    for (const idx of r.removed) board.remove(idx);
    timers.set(() => { if (!destroyed && S.status === 'playing') board.setPosition(M.boardOf(S), lastMove()); }, 200);
    sfx('undo');
    persist();
    const left = M.undoLeft(S, p);
    if (left !== Infinity) toast(left > 0 ? `무르기 ${left}번 남음` : '무르기 끝! 이제 못 물러요', { ms: 1400 });
    undoGuard = performance.now() + UNDO_GUARD_MS;
    lockFor(LOCK_MS);
    startTurn();
  }

  // ---- pause ---------------------------------------------------------------------------------
  function openPause() {
    if (!(phase === 'play' || phase === 'cpu') || holds.has('pause')) return;
    sfx('menu');
    holdOn('pause');
    if (phase === 'cpu') cancelThink();
    try { board.clearArmed(); } catch { /* fine */ }
    const body = h('div.pause');
    const info = h('div.pause__info');
    info.innerHTML = `<span class="tag tag--p1">1P ${esc(chars[1].ko)}</span><b class="pause__score">${S.score[0]} : ${S.score[1]}</b><span class="tag tag--p2">${label(2)} ${esc(chars[2].ko)}</span>`;
    const list = h('div.dlg__list');
    let layer = null;
    let after = null;
    const left = M.undoLeft(S, undoRequester() || (S.status === 'playing' ? M.toMove(S) : 1));   // same player as the bar
    const undoOk = canUndoNow();
    const soundBtn = btn(app.prefs.sound !== false ? '소리 끄기' : '소리 켜기', {
      cls: 'btn--ghost btn--sm', icon: app.prefs.sound !== false ? ICONS.mute : ICONS.sound,
      onClick: () => {
        app.setPrefs({ sound: app.prefs.sound === false });
        const on = app.prefs.sound !== false;
        soundBtn.querySelector('.btn__label').textContent = on ? '소리 끄기' : '소리 켜기';
        soundBtn.querySelector('.btn__icon').innerHTML = on ? ICONS.mute : ICONS.sound;
        if (on) sfx('ok');
      },
    });
    list.append(
      btn('계속', { cls: 'btn--gold', sound: 'ok', onClick: () => layer.close() }),
      btn(`무르기 (${left === Infinity ? '∞' : left})`, { cls: 'btn--paper btn--sm', icon: ICONS.undo, disabled: !undoOk, onClick: () => { after = 'undo'; layer.close(); } }),
      h('div.pause__pair', null,
        btn('이번 판 기권', { cls: 'btn--ghost btn--sm', onClick: () => { after = 'resign'; layer.close(); } }),
        btn('매치 포기', { cls: 'btn--ghost btn--sm', onClick: () => { after = 'forfeit'; layer.close(); } })),
      h('div.pause__pair', null,
        soundBtn,
        btn('메뉴로', { cls: 'btn--ghost btn--sm', sound: 'cancel', onClick: () => { after = 'menu'; layer.close(); } })),
    );
    body.append(info, list);
    layer = openLayer({ kind: 'dialog', title: '일시정지', sub: `${M.isFinalRound(S) ? 'FINAL ROUND' : `ROUND ${S.round}`} · ${M.FORMATS[cfg.bestOf].label}`, body, cls: 'layer--pause' });
    layer.done.then(async () => {
      if (destroyed) return;
      if (after === 'menu') { persist(); app.go('menu'); return; }
      if (after === 'resign' || after === 'forfeit') await resignFlow(after);
      holdOff('pause');
      if (after === 'undo') { requestUndo(); return; }
      resume();
    });
    return layer;
  }
  async function resignFlow(kind) {
    let p = 1;
    if (!cpu) {
      p = await chooseDialog({
        title: kind === 'resign' ? '누가 기권해요?' : '누가 매치를 포기해요?',
        options: [
          { label: '1P 기권', sub: chars[1].ko, value: 1, cls: 'btn--p1' },
          { label: '2P 기권', sub: chars[2].ko, value: 2, cls: 'btn--p2' },
        ],
        cancel: '취소',
      });
      if (!p || destroyed) return;
    }
    const ok = await confirmDialog(kind === 'resign'
      ? { title: '정말 기권?', text: '이번 판을 내줘요.', ok: '기권', cancel: '계속', danger: true }
      : { title: '정말 포기?', text: '매치를 내줘요. 전적엔 패로 남아요.', ok: '포기', cancel: '계속', danger: true });
    if (!ok || destroyed || S.status !== 'playing') return;
    const r = kind === 'resign' ? M.resignRound(S, p) : M.forfeitMatch(S, p);
    if (r.ok) roundEnd(r, p);
  }
  function resume() {
    if (destroyed || S.status !== 'playing') return;
    if (phase === 'cpu' && holds.size === 0) cpuThink();
    syncLock();
    updateBar();
  }

  // ---- overlays: banners ------------------------------------------------------------------------
  const ban = h('div.ban');
  ban.innerHTML = '<div class="ban__main"></div><div class="ban__sub"></div>';
  ov.append(ban);
  function banner(text, { kind = '', sub = '', slam = true, pos = '' } = {}) {
    ban.className = `ban ban--${kind}`;
    ban.dataset.pos = pos;
    ban.querySelector('.ban__main').textContent = text;
    const s = ban.querySelector('.ban__sub');
    s.innerHTML = sub;
    s.hidden = !sub;
    void ban.offsetWidth;
    ban.classList.add('is-on', slam && !motionReduced() ? 'slam' : 'fade');
  }
  function hideBanner() { ban.className = 'ban'; }
  function setDim(on, level = '') {
    dim.className = 'bt__dim' + (on ? ` is-on ${level}` : '');
  }
  // Flash, shake and hit-stop never restyle the screen: the flash and the shake are WAAPI
  // animations (no class restart, no layout read, no inherited custom property on the ancestor of
  // ~600 elements), and the hit-stop pauses only the stage's own running animations.
  function flash() {
    if (motionReduced() || speed() === 'min') return;
    if (typeof flashEl.animate === 'function') {
      try { flashEl.animate([{ opacity: 0.35 }, { opacity: 0.35, offset: 0.25 }, { opacity: 0 }], { duration: 200, easing: 'linear' }); return; } catch { /* below */ }
    }
    flashEl.classList.remove('go'); void flashEl.offsetWidth; flashEl.classList.add('go');
  }
  let shakeAnim = null;
  function doShake(ms = 320, amp = 8) {
    if (!shakeOn()) return;
    if (typeof shake.animate === 'function') {
      try {
        if (shakeAnim) shakeAnim.cancel();
        shakeAnim = shake.animate(shakeFrames(amp), { duration: ms, easing: 'linear' });
        return;
      } catch { /* below */ }
    }
    shake.style.setProperty('--amp', amp + 'px');
    shake.style.setProperty('--shake-ms', ms + 'ms');
    shake.classList.remove('shaking'); void shake.offsetWidth; shake.classList.add('shaking');
    timers.set(() => shake.classList.remove('shaking'), ms + 20);
  }
  let stopped = null;            // the stage animations a hit-stop paused
  function hitstop(on) {
    if (on) {
      if (stopped || motionReduced() || speed() === 'min') return;
      stopped = [];
      if (typeof stage.getAnimations === 'function') {
        try {
          for (const a of stage.getAnimations({ subtree: true })) if (a.playState === 'running') { a.pause(); stopped.push(a); }
          return;
        } catch { /* below */ }
      }
      stage.classList.add('hitstop');                     // css/fighters.css: .hitstop .stage *
    } else if (stopped) {
      for (const a of stopped) { try { if (a.playState === 'paused') a.play(); } catch { /* gone */ } }
      stopped = null;
      stage.classList.remove('hitstop');
    }
  }

  // ---- round intro / coin --------------------------------------------------------------------------
  function blackLine() {
    const p = S.black;
    return `<span class="who who--p${p}">${label(p)}</span> 흑 · 선공`;
  }
  function roundIntro(done) {
    phase = 'intro';
    syncLock();
    const f = fxScale();
    const later = S.round >= 2;
    const tR = Math.round((later ? 500 : 700) * f);
    const tF = Math.round((later ? 400 : 500) * f);
    const sq = createSeq(timers);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      hideBanner();
      setTap(null);
      timers.set(done, 150);
    };
    const fin = M.isFinalRound(S);
    sq.at(0, () => { banner(fin ? 'FINAL ROUND' : `ROUND ${S.round}`, { kind: fin ? 'final' : 'round', sub: blackLine() }); sfx('round'); });
    sq.at(tR, () => { banner('FIGHT!', { kind: 'fight' }); sfx('fight'); });
    sq.at(tR + tF, finish);
    const from = performance.now() + 250;                 // not the tail of the tap that got us here
    setTap(() => { if (performance.now() < from) return; sq.skipTo(tR + tF); finish(); });
    sq.run();
    return sq;
  }
  function coinToss(done) {
    phase = 'intro';
    syncLock();
    const f = speed() === 'normal' ? 1 : 0.6;
    const D = Math.round(1200 * f);
    const blackP = S.black;
    const c = h('div.coin');
    c.innerHTML = `
      <div class="coin__title sticker-text">선공 결정!</div>
      <div class="coin__row">
        <div class="coin__p coin__p--1"><div class="coin__pt" style="--ptbg:${ptbg(chars[1])}"></div><span class="tag tag--p1">1P</span></div>
        <div class="coin__track"><div class="coin__disc" style="--land:${blackP === 1 ? -1 : 1}; --dur:${D}ms"><i class="coin__face coin__face--b"></i><i class="coin__face coin__face--w"></i></div></div>
        <div class="coin__p coin__p--2"><div class="coin__pt" style="--ptbg:${ptbg(chars[2])}"></div><span class="tag tag--p2">${label(2)}</span></div>
      </div>
      <div class="coin__res">${blackLine()}</div>`;
    c.querySelector('.coin__p--1 .coin__pt').innerHTML = hud.panels[1].el.querySelector('.hud__pt').innerHTML.replace(/<span class="hud__think"[^]*?<\/span>/, '');
    c.querySelector('.coin__p--2 .coin__pt').innerHTML = hud.panels[2].el.querySelector('.hud__pt').innerHTML.replace(/<span class="hud__think"[^]*?<\/span>/, '');
    ov.append(c);
    setDim(true, 'is-deep');
    const sq = createSeq(timers);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setTap(null);
      c.classList.add('is-out');
      timers.set(() => { c.remove(); setDim(false); done(); }, 160);
    };
    sq.at(0, () => { c.classList.add('go'); sfx('coin', { ms: D }); });   // the ticks follow this coin's duration
    sq.at(Math.round(D * 0.8), () => c.classList.add('is-landed'));
    sq.at(D + Math.round(500 * f), finish);
    setTap(() => { sq.skipTo(D); finish(); });
    sq.run();
    return { sq, el: c };
  }

  // ---- round end sequences -------------------------------------------------------------------------
  function roundEnd(r) {
    phase = 'seq';
    cancelThink();
    timerStop();
    try { board.clearArmed(); } catch { /* fine */ }
    board.setLocked(true);
    board.setForbiddenMarks(null);
    closeAll();
    persist();
    if (S.status === 'matchOver') recordOnce();
    hud.clearTurn();
    el.dataset.turn = '';
    updateBar();
    const w = r.winner;
    if (r.how === 'five') return koSeq(r);
    if (r.how === 'draw') return drawSeq();
    if (r.how === 'timeout') return endSeq(w, { text: 'TIME OVER', kind: 'timeover', sub: `${label(3 - w)} 시간 초과`, sound: 'timeover' });
    if (r.how === 'resign') return endSeq(w, { text: '기권승', kind: 'resign', sub: `${label(3 - w)} 기권`, sound: 'ko' });
    if (r.how === 'forfeit') return endSeq(w, { text: '기권승', kind: 'resign', sub: `${label(3 - w)} 매치 포기`, sound: 'ko' });
    return null;
  }
  function recordOnce() {
    if (recorded) return;
    recorded = true;
    app.recordMatch(M.summary(S));
    app.clearMatch();
  }
  function fightersEnd(w, { sound = true } = {}) {
    if (!w) return;
    const final = S.status === 'matchOver';
    const lose = 3 - w;
    fighters[lose].set('lose');
    fighters[w].win({ excerpt: true, sound: false, onShake: (ms) => doShake(Math.min(ms, 200), 4) }).catch(() => {});
    if (sound) sfx(final ? (cpu && w === 2 ? 'lose' : 'matchWin') : 'roundWin');
  }
  function koSeq(r) {
    const f = fxScale();
    const min = speed() === 'min';
    const w = r.winner;
    const sq = createSeq(timers);
    const line = r.line || S.lastLine;
    const showLine = () => { if (line) board.showWin(line).catch?.(() => {}); };
    // keep the five in sight: the K.O. lettering moves to the half of the board away from the line
    const avgRow = line && line.length ? line.reduce((a, c) => a + c[1], 0) / line.length : 7;
    const pos = avgRow >= 4 && avgRow <= 10 ? (avgRow >= 7 ? 'top' : 'bottom') : '';
    r.trap = koTrap(r);
    const ko = () => banner('K.O.', { kind: 'ko', pos, sub: r.trap ? '금수 함정!' : '' });
    if (min) {
      sq.at(0, () => { sfx('ko'); showLine(); ko(); setDim(true); fightersEnd(w); });
      sq.at(400, () => afterRound(r));
      setTap(null);
    } else {
      sq.at(110 * f, () => { hitstop(true); flash(); });
      sq.at(250 * f, () => { hitstop(false); doShake(320, 8); sfx('ko'); showLine(); });
      sq.at(500 * f, () => { ko(); setDim(true); });
      sq.at(1400 * f, () => fightersEnd(w));
      sq.at(2000 * f, () => afterRound(r));
      const from = performance.now() + 600 * f;
      setTap(() => { if (performance.now() >= from) { setTap(null); sq.skipTo(2000 * f); } });
    }
    sq.run();
    return sq;
  }
  function endSeq(w, { text, kind, sub, sound }) {
    const f = fxScale();
    const min = speed() === 'min';
    const sq = createSeq(timers);
    sq.at(0, () => { banner(text, { kind, sub: esc(sub) }); setDim(true); sfx(sound); if (!min) doShake(220, 5); });
    sq.at(min ? 0 : 700 * f, () => fightersEnd(w));
    const end = min ? 400 : 1700 * f;
    sq.at(end, () => afterRound({ winner: w, how: kind }));
    const from = performance.now() + 600 * f;
    setTap(() => { if (performance.now() >= from) { setTap(null); sq.skipTo(end); } });
    sq.run();
    return sq;
  }
  function drawSeq() {
    const f = fxScale();
    const sq = createSeq(timers);
    const end = speed() === 'min' ? 1000 : 2200 * f;
    sq.at(0, () => { banner('DRAW', { kind: 'draw', sub: '더 둘 곳이 없다!' }); setDim(true); sfx('draw'); });
    sq.at(end, () => { setTap(null); hideBanner(); setDim(false); nextRoundGo(); });
    const from = performance.now() + 600 * f;
    setTap(() => { if (performance.now() >= from) { setTap(null); sq.skipTo(end); } });
    sq.run();
    return sq;
  }
  function afterRound(r) {
    setTap(null);
    if (S.status === 'matchOver') {
      phase = 'over';
      app.go('result', { match: S, theme }, { transition: 'wipe' });
      return;
    }
    roundResult(r);
  }

  // ---- round result ------------------------------------------------------------------------------
  function roundResult(r, { frozen = false } = {}) {
    phase = 'result';
    hideBanner();
    setDim(false);
    const w = r.winner;
    hud.update(S, { pipAnim: w });
    const big = cpu ? (w === 1 ? 'YOU WIN' : 'CPU WIN') : `${label(w)} WIN`;
    const how = ({ five: 'K.O.', timeout: 'TIME OVER', timeover: 'TIME OVER', resign: '기권승' })[r.how] || 'K.O.';
    const moves = S.rounds.length ? S.rounds[S.rounds.length - 1].moves : 0;
    const nb = (() => {
      const probe = JSON.parse(JSON.stringify(S));
      M.nextRound(probe);
      return probe.black;
    })();
    const need = M.needOf(S);
    const pips = (p) => {
      let s = '';
      for (let i = 0; i < need; i++) s += `<i class="pip${i < S.score[p - 1] ? ' is-on' : ''}${i === S.score[p - 1] - 1 && p === w ? ' is-new' : ''}"></i>`;
      return s;
    };
    const card = h('div.rr', { dataset: { w: String(w) } });
    card.innerHTML = `
      <div class="rr__card">
        <div class="rr__big sticker-text">${big}</div>
        <div class="rr__who">${esc(chars[w].ko)} · ${how}${r.how === 'five' ? ` · ${moves}수` : ''}</div>
        ${r.trap ? '<div class="rr__trap">금수 함정! 막을 자리가 금수였어요</div>' : ''}
        <div class="rr__score">
          <span class="rr__side"><span class="tag tag--p1">1P</span><span class="rr__pips">${pips(1)}</span></span>
          <b class="rr__num">${S.score[0]} : ${S.score[1]}</b>
          <span class="rr__side"><span class="rr__pips">${pips(2)}</span><span class="tag tag--p2">${label(2)}</span></span>
        </div>
        <div class="rr__next">다음 ${M.isFinalRound(S) ? 'FINAL ROUND' : `ROUND ${S.round + 1}`} · <span class="who who--p${nb}">${label(nb)}</span>가 흑</div>
      </div>
      <div class="rr__hint">탭해서 계속</div>`;
    const eye = btn('판 보기', { cls: 'btn--dark btn--sm rr__eye', icon: ICONS.eye, sound: '', aria: '누르고 있는 동안 판 보기' });
    card.append(eye);
    ov.append(card);
    let gone = false;
    let peeking = false;
    let due = false;               // the auto-advance came due while the board was being looked at
    if (frozen) { card.classList.add('is-in', 'can-skip'); return; }
    timers.raf(() => { if (!gone) card.classList.add('is-in'); });
    const min = speed() === 'min';
    const auto = min ? 1000 : Math.round(3600 * fxScale());
    const skipAt = min ? 300 : 1000;
    const go = () => {
      if (gone || destroyed) return;
      gone = true;
      peeking = false;
      setTap(null);
      card.classList.remove('is-peek');
      card.classList.add('is-out');
      timers.set(() => card.remove(), 180);
      nextRoundGo();
    };
    // Never moves on under a finger that is holding 판 보기: wait for the release, then a beat.
    const autoGo = () => {
      if (gone) return;
      if (peeking) { due = true; return; }
      go();
    };
    // Closes over this card (not a shared variable): a pointerup/leave that lands while the card
    // is leaving finds it still there and does nothing.
    const peek = (on) => (e) => {
      if (e) e.stopPropagation();
      if (gone || peeking === on) return;
      peeking = on;
      card.classList.toggle('is-peek', on);
      if (!on && due) {
        due = false;
        timers.set(autoGo, Math.round(PEEK_AFTER_MS * (min ? 0.5 : fxScale())));
      }
    };
    eye.addEventListener('pointerdown', peek(true));
    eye.addEventListener('pointerup', peek(false));
    eye.addEventListener('pointercancel', peek(false));
    eye.addEventListener('pointerleave', peek(false));
    eye.addEventListener('click', (e) => e.stopPropagation());
    eye.addEventListener('contextmenu', (e) => e.preventDefault());
    const t0 = performance.now();
    timers.set(() => { if (!gone) card.classList.add('can-skip'); }, skipAt);
    timers.set(autoGo, auto);
    setTap((e) => {
      if (peeking) return;
      if (e && e.target && e.target.closest && e.target.closest('.rr__eye')) return;
      if (performance.now() - t0 >= skipAt) go();
    });
  }
  function nextRoundGo() {
    M.nextRound(S);
    persist();
    fighters[1].set('idle');
    fighters[2].set('idle');
    enterRound({ intro: true });
  }

  // ---- round entry -------------------------------------------------------------------------------
  function enterRound({ intro = true, coin = false } = {}) {
    board.setPosition(M.boardOf(S), lastMove());
    try { board.clearArmed(); } catch { /* fine */ }
    const p = M.toMove(S);
    board.setTurn(M.colorOf(S, p), PCOL[p]);
    el.dataset.turn = String(p);
    hud.update();
    updateBar();
    if (!intro) { startTurn(); return; }
    const go = () => roundIntro(() => startTurn());
    if (coin) coinToss(go); else go();
  }

  function savedClock() {
    if (params.clock !== undefined) return params.clock;
    try { const sv = app.loadMatch(); return (sv && sv.clock) || null; } catch { return null; }
  }

  // ---- fighters ---------------------------------------------------------------------------------
  // Width: at most 0.46 of the stage each. Two boxes at 4 % from the edges then just meet, and the
  // art of any pair still keeps ≥ 14 % of a box between them.
  // Height: as before, a box may rise a little above the stage top (the art has headroom) up to
  // the old 0.42·w size; beyond that it only grows where even the tallest art (까꿍's flame, 2.6 %
  // above its box) stays below the board: box top ≥ 3 % of the size under the 4 px gap.
  // 0.46, 1.03 + 4 and 200 are also the stage's --fit in css/battle.css.
  function fighterSize() {
    const { width: w, height: h } = stage.getBoundingClientRect();
    const byHeight = Math.max(Math.min(h * 1.02, w * 0.42), (h - 4) / 1.03);
    return Math.max(72, Math.min(200, Math.round(Math.min(byHeight, w * 0.46))));
  }
  function buildFighters() {
    const size = fighterSize();
    fighters[1] = createFighter(cfg.p1, { size, dir: 1 });
    fighters[2] = createFighter(cfg.p2, { size, dir: -1, alt: mirror });
    stage.querySelector('.bt__slot--1').append(fighters[1].el);
    stage.querySelector('.bt__slot--2').append(fighters[2].el);
  }
  let ro = null;

  // ---- screen API --------------------------------------------------------------------------------
  const api = {
    el,
    get phase() { return phase; },
    get state() { return S; },
    mount() {
      board = createBoard(host, {
        theme,
        input: app.prefs.input === 'single' ? 'single' : 'double',
        canPlace: (idx) => M.canPlace(S, idx),
        onCommit: (idx) => onHumanCommit(idx),
        onArm: (idx) => onArm(idx),
        onReject: (idx, reason) => onReject(idx, reason),
        sfx: (name) => sfx(name),
        shake: () => app.prefs.shake !== false && speed() !== 'min',
      });
      haptic(board.el || host);
      buildFighters();
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => {
          const s = fighterSize();
          for (const p of [1, 2]) if (fighters[p] && fighters[p].setSize) fighters[p].setSize(s);
        });
        ro.observe(stage);
      }
      keepAwake(true);
      if (app.isLandscape && app.isLandscape()) holds.add('landscape');
      if (cpu && !app.frozen) {
        try { ai = createAiClient({ overlineWins: cfg.overlineWins }); if (ai.warm) ai.warm().catch(() => {}); } catch (err) { console.warn('[battle] AI', err); }
      }
      if (app.frozen) { enterRound({ intro: false }); return; }
      if (S.status === 'matchOver') { phase = 'over'; app.go('result', { match: S, theme }); return; }
      if (params.resume) {
        if (S.status === 'roundOver') {
          // Saved on the round-result card: the next round starts the usual way, with its intro
          // (ROUND n · who has black now) — the intro's tap catcher also eats a double tap.
          M.nextRound(S);
          persist();
          enterRound({ intro: true });
          return;
        }
        pendingClock = savedClock();      // the move clock as it was when the match was left
        lockFor(HOLD_LOCK_MS);            // the second tap of a double tap on 이어하기 lands on the board
        enterRound({ intro: false });
        persist();
        toast(`이어하기 · ROUND ${S.round}`, { ms: 1400, sound: true });
        return;
      }
      persist();
      enterRound({ intro: params.intro !== false, coin: !!params.coin && S.round === 1 && !S.moves.length });
    },
    destroy() {
      destroyed = true;
      cancelThink();
      timerStop();
      hitstop(false);
      timers.destroy();
      if (ro) ro.disconnect();
      try { if (shakeAnim) shakeAnim.cancel(); } catch { /* fine */ }
      try { releaseParticles(); } catch { /* fine */ }   // the full-screen canvas goes back to iOS
      try { if (ai) ai.dispose(); } catch { /* fine */ }
      try { if (board) board.destroy(); } catch { /* fine */ }
      for (const p of [1, 2]) if (fighters[p]) fighters[p].destroy();
      keepAwake(false);
    },
    onHide() {
      if (destroyed) return;
      if (S.status !== 'matchOver') persist();
      holdOn('hidden');
      if (phase === 'cpu') cancelThink();
      keepAwake(false);
    },
    onShow() {
      if (destroyed) return;
      holdOff('hidden');
      keepAwake(true);
      resume();
    },
    onLandscape(on) {
      if (on) holdOn('landscape'); else { holdOff('landscape'); resume(); }
    },
    // A reload into an update: never at once mid-match; on a return to the app only when the board
    // is simply waiting for a human move (the match is saved and 이어하기 brings it back).
    quiet(when) {
      if (when !== 'show') return false;
      return phase === 'play' && !isSheetOpen() && [...holds].every((h) => h === 'hidden');
    },
    // ---- debug shots (js/debug.js) ----
    shot(name, opt = {}) { return shotState(name, opt); },
  };

  function shotState(name, opt) {
    switch (name) {
      case 'coin': {
        const c = coinToss(() => {});
        c.sq.skipTo(Math.round(1200 * 0.8));
        timers.clearAll();                 // hold the landed coin: no finish, no next round
        setTap(null);
        c.el.classList.add('go', 'is-landed', 'is-frozen');
        return;
      }
      case 'roundIntro': {
        const sq = roundIntro(() => {});
        if (opt.fight) sq.skipTo(800);
        setTap(null);
        return;
      }
      case 'armed': {
        armAt(opt.idx);
        return;
      }
      case 'forbidden': {
        rejectFeedback(opt.idx, '33');
        return;
      }
      case 'ko': {
        const color = M.colorOf(S, M.toMove(S));
        const r = M.play(S, opt.idx);
        board.place(opt.idx, color, { animate: false });
        phase = 'seq';
        board.setLocked(true);
        const sq = createSeq(timers);
        if (r.ok) {
          const w = r.winner;
          const avg = r.line ? r.line.reduce((a, c) => a + c[1], 0) / r.line.length : 7;
          sq.at(0, () => { if (r.line) board.showWin(r.line); banner('K.O.', { kind: 'ko', pos: avg >= 7 ? 'top' : 'bottom' }); setDim(true); hud.clearTurn(); updateBar(); });
          sq.at(10, () => fightersEnd(w, { sound: false }));
          sq.run();
        }
        setTap(null);
        return r;
      }
      case 'roundResult': {
        const color = M.colorOf(S, M.toMove(S));
        const r = M.play(S, opt.idx);
        board.place(opt.idx, color, { animate: false });
        phase = 'seq';
        if (r.line) board.showWin(r.line);
        hud.clearTurn();
        updateBar();
        roundResult(r, { frozen: true });
        setTap(null);
        fighters[r.winner].win({ excerpt: true, sound: false });
        fighters[3 - r.winner].set('lose');
        return r;
      }
      case 'pause': openPause(); return;
      case 'undoAsk': {
        holdOn('dialog');
        undoAsk(undoRequester() || 1);
        return;
      }
      case 'draw': {
        phase = 'seq';
        hud.clearTurn();
        hud.clearTimer();
        turnChip.className = 'bt__turn is-over';
        turnChip.innerHTML = '<span class="bt__what">무승부</span>';
        banner('DRAW', { kind: 'draw', sub: '더 둘 곳이 없다!' }); setDim(true);
        return;
      }
      case 'timeover': {
        const p = M.toMove(S);
        const r = M.timeoutRound(S, p);
        phase = 'seq';
        hud.setTimer(p, 0, 0);
        hud.clearTurn();
        updateBar();
        banner('TIME OVER', { kind: 'timeover', sub: `${label(p)} 시간 초과` }); setDim(true);
        fightersEnd(r.winner, { sound: false });
        return r;
      }
      default: return null;
    }
  }

  // Arm a point the way a finger would (debug shots): a real pointer tap on the board canvas.
  function armAt(idx) {
    const target = board.el || host;
    const rect = target.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const cell = size / 15.2;
    const x = rect.left + cell * (0.6 + (idx % N));
    const y = rect.top + cell * (0.6 + ((idx / N) | 0));
    const pt = { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
    const node = document.elementFromPoint(x, y) || target;
    node.dispatchEvent(new PointerEvent('pointerdown', pt));
    node.dispatchEvent(new PointerEvent('pointerup', { ...pt, buttons: 0 }));
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  }

  return api;
}
