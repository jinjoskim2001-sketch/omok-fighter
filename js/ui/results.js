// js/ui/results.js — 매치 결과 (SPEC §3.1): the winner's FULL 2.4 s victory motion on a big stage
// (≈ min(64vw, 260px)) then its loop, the win quote typed at 30 ms/char, the loser small in grey
// with its lose pose, score "2 : 1", round summary, 최단 K.O., PERFECT / 역전승! badges, buttons
// after 900 ms: [한 판 더!] [캐릭터 변경] [메뉴로]. CPU: YOU WIN / YOU LOSE — when you lose, the
// CPU fighter plays its victory.

import { h, esc, createTimers } from './dom.js';
import { app, motionReduced, shakeOn } from './ctx.js';
import { btn } from './widgets.js';
import { summary } from '../match.js';
import { createFighter, portraitHTML } from '../fighter.js';
import { release as releaseParticles } from '../particles.js';
import { startRematch } from './flow.js';
import { charOf, ptbg } from './hud.js';
import { shakeFrames } from './battle.js';

// Round chips read from the winner's side: "R1 1P K.O.승", "R2 2P 시간승", "R3 1P 기권승", "R2 무승부".
const HOW = { five: 'K.O.승', timeout: '시간승', resign: '기권승' };
const chipText = (i, r, label) => (r.winner ? `R${i + 1} ${label(r.winner)} ${HOW[r.how] || '승'}` : `R${i + 1} 무승부`);

// A fighter's .stage is a fixed square: never let a flex parent stretch or shrink it.
function noStretch(stageEl) {
  stageEl.style.flex = 'none';
  stageEl.style.alignSelf = 'flex-end';
}

export function createResult(params) {
  const S = params.match;
  const theme = params.theme;
  const cfg = S.cfg;
  const cpu = cfg.mode === 'cpu';
  const sum = summary(S);
  const w = S.winner === 2 ? 2 : 1;
  const l = 3 - w;
  const id = (p) => (p === 1 ? cfg.p1 : cfg.p2);
  const alt = (p) => p === 2 && cfg.p1 === cfg.p2;
  const wc = charOf(id(w));
  const label = (p) => (p === 1 ? '1P' : cpu ? 'CPU' : '2P');
  const timers = createTimers();
  let winner = null, loser = null;

  const el = h('section', { 'aria-label': '매치 결과' });
  el.style.setProperty('--w1', wc.bg[1] || '#17121F');
  el.style.setProperty('--w2', (alt(w) ? wc.colorAlt : wc.bg[0]) || 'rgba(0,0,0,.2)');
  const big = cpu ? (w === 1 ? 'YOU WIN' : 'YOU LOSE') : `${label(w)} WIN`;
  const lose = cpu && w === 2;

  const rounds = S.rounds.map((r, i) => `<span class="rchip rchip--${r.winner | 0}">${chipText(i, r, label)}</span>`).join('') +
    (S.forfeit ? `<span class="rchip rchip--${3 - S.forfeit}">${label(3 - S.forfeit)} 기권승 · 매치 포기</span>` : '');
  const stats = [];
  if (sum.fastestKO) stats.push(`최단 K.O. ${sum.fastestKO}수`);
  if (sum.longestRound) stats.push(`최장 라운드 ${sum.longestRound}수`);

  el.innerHTML = `
    <div class="res__bg" aria-hidden="true"></div>
    <div class="res__head">
      <div class="res__big sticker-text${lose ? ' is-lose' : ''}">${big}</div>
      <div class="res__who">${cpu && w === 2 ? 'CPU ' : ''}${esc(wc.ko)} 승리!</div>
    </div>
    <div class="res__badges">${sum.perfect ? '<span class="badge">PERFECT</span>' : ''}${sum.comeback ? '<span class="badge badge--comeback">역전승!</span>' : ''}</div>
    <div class="res__arena"><div class="res__floor"></div><div class="res__winner"></div><div class="res__loser${w === 2 ? ' res__loser--left' : ''}"></div></div>
    <div class="res__quote" aria-live="polite"><span class="res__qt"></span><span class="caret"></span></div>
    <div class="res__card card">
      <div class="res__score">
        <span class="res__side"><span class="res__pt" style="--ptbg:${ptbg(charOf(cfg.p1))}">${portraitHTML(cfg.p1)}</span><span class="tag tag--p1">1P</span></span>
        <span class="res__num${w === 1 ? ' is-win' : ''}">${S.score[0]}</span><span class="res__colon">:</span><span class="res__num${w === 2 ? ' is-win' : ''}">${S.score[1]}</span>
        <span class="res__side"><span class="tag tag--p2">${label(2)}</span><span class="res__pt" style="--ptbg:${ptbg(charOf(cfg.p2))}">${portraitHTML(cfg.p2, { alt: alt(2) })}</span></span>
      </div>
      <div class="res__rounds">${rounds}</div>
      ${stats.length ? `<div class="res__stats">${stats.join(' · ')}</div>` : ''}
    </div>
    <div class="res__btns is-hidden"></div>`;

  const btns = el.querySelector('.res__btns');
  btns.append(
    btn('한 판 더!', { cls: 'btn--gold', sound: 'ok', onClick: () => startRematch(S, theme) }),
    btn('캐릭터 변경', { cls: 'btn--paper btn--sm', onClick: () => app.go('select', { mode: cfg.mode }) }),
    btn('메뉴로', { cls: 'btn--ghost btn--sm', sound: 'cancel', onClick: () => app.go('menu') }),
  );

  // The win quote, typed at 30 ms a character by one timer; a tap finishes it. Both paths end in
  // doneTyping(), which is safe to reach any number of times.
  const qt = el.querySelector('.res__qt');
  const quote = (wc.quote && wc.quote.win) || '';
  let typed = 0;
  let typeT = 0;
  function doneTyping() {
    timers.clear(typeT);
    typeT = 0;
    typed = quote.length;
    qt.textContent = quote;
    const caret = el.querySelector('.caret');
    if (caret) caret.remove();
  }
  function type() {
    typeT = 0;
    if (typed >= quote.length) { doneTyping(); return; }
    typed++;
    qt.textContent = quote.slice(0, typed);
    typeT = timers.set(type, 30);
  }
  function startTyping(delay) { timers.clear(typeT); typeT = timers.set(type, delay); }
  function finishType() { doneTyping(); }

  // The victory motion's screen shakes: one WAAPI animation (no class restart, no layout read).
  let shakeAnim = null;
  function shakeScreen(ms) {
    if (!shakeOn()) return;
    const d = Math.min(ms, 260);
    if (typeof el.animate === 'function') {
      try {
        if (shakeAnim) shakeAnim.cancel();
        shakeAnim = el.animate(shakeFrames(5), { duration: d, easing: 'linear' });
        return;
      } catch { /* below */ }
    }
    el.style.setProperty('--amp', '5px');
    el.style.setProperty('--shake-ms', d + 'ms');
    el.classList.remove('shaking'); void el.offsetWidth; el.classList.add('shaking');
    timers.set(() => el.classList.remove('shaking'), d + 20);
  }

  let t0 = 0;
  el.querySelector('.res__arena').addEventListener('click', () => {
    if (performance.now() - t0 < 800) return;
    if (winner) winner.skip();
    finishType();
  });

  return {
    el,
    quiet: () => false,
    mount() {
      t0 = performance.now();
      const arena = el.querySelector('.res__arena');
      const r = arena.getBoundingClientRect();
      const vw = Math.min(window.innerWidth || 375, 480);
      // ≈ min(64vw, 260) (SPEC §3.1), bigger on tall phones (the arena is the room there), and
      // never taller than the arena less ~12 % headroom: the winner's head (and the motion's
      // jumps) stay under the '○○ 승리!' header.
      const tall = r.height >= 330;
      const size = Math.max(120, Math.floor(Math.min(vw * (tall ? 0.7 : 0.64), tall ? 300 : 260, (r.height - 6) / 1.12)));
      winner = createFighter(id(w), { size, alt: alt(w), dir: w === 1 ? 1 : -1 });
      noStretch(winner.el);
      el.querySelector('.res__winner').append(winner.el);
      loser = createFighter(id(l), { size: Math.round(size * 0.4), alt: alt(l), dir: l === 1 ? 1 : -1 });
      noStretch(loser.el);
      el.querySelector('.res__loser').append(loser.el);
      loser.set('lose');
      const head = el.querySelector('.res__big');
      if (app.frozen) {
        doneTyping();
        btns.classList.remove('is-hidden');
        winner.win({ excerpt: false, sound: false });
        return;
      }
      head.classList.add('anim');
      winner.win({ excerpt: false, sound: true, onShake: shakeScreen }).catch(() => {});
      startTyping(motionReduced() ? 0 : 400);
      timers.set(() => { btns.classList.remove('is-hidden'); btns.classList.add('anim'); }, 900);
    },
    destroy() {
      timers.destroy();
      try { if (shakeAnim) shakeAnim.cancel(); } catch { /* fine */ }
      if (winner) winner.destroy();
      if (loser) loser.destroy();
      try { releaseParticles(); } catch { /* fine */ }   // the full-screen canvas goes back to iOS
    },
    get winner() { return winner; },
  };
}
