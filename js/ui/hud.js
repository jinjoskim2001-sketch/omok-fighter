// js/ui/hud.js — the battle HUD (SPEC §4): portraits, names, stone icons, round pips,
// MATCH POINT tags, the move timer bars and the round label.
// [1P 초상52][이름·돌·핍 / 타이머바]   [R n]   [타이머바 / 핍·돌·이름][2P 초상52]

import { h, esc } from './dom.js';
import { stoneIcon } from './widgets.js';
import { getCharacter, CHARACTERS } from '../characters.js';
import { portraitHTML } from '../fighter.js';
import { colorOf, needOf, matchPoint, isFinalRound, toMove } from '../match.js';

// An unknown id (an old save) falls back the same way js/fighter.js draws it: the first fighter.
export const charOf = (id) => getCharacter(id) || CHARACTERS[0];
// The portrait tile tint (--ptbg): the character's own backdrop colour.
export const ptbg = (ch) => esc((ch && ch.bg && ch.bg[0]) || (ch && ch.color) || '');

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

export function createHud(S) {
  const cfg = S.cfg;
  const cpu = cfg.mode === 'cpu';
  const mirror = cfg.p1 === cfg.p2;
  const el = h('header.hud');
  const panels = {};
  for (const p of [1, 2]) {
    const ch = charOf(p === 1 ? cfg.p1 : cfg.p2);
    const tag = p === 1 ? '1P' : (cpu ? 'CPU' : '2P');
    const panel = h(`div.hud__p.hud__p--${p}`, { dataset: { p: String(p) } });
    panel.innerHTML = `
      <div class="hud__pt" style="--ptbg:${ptbg(ch)}">${portraitHTML(ch.id, { alt: p === 2 && mirror })}
        <span class="hud__think" aria-live="polite">생각 중…</span></div>
      <div class="hud__info">
        <div class="hud__name"><span class="hud__tag">${tag}</span><b>${esc(ch.ko)}</b><span class="hud__stone"></span></div>
        <div class="hud__pips"></div>
        <div class="hud__timer"><i class="hud__tfill"></i><i class="hud__tticks"></i></div>
      </div>
      <span class="hud__mp">MATCH POINT</span>`;
    panels[p] = {
      el: panel,
      stone: panel.querySelector('.hud__stone'),
      pips: panel.querySelector('.hud__pips'),
      timer: panel.querySelector('.hud__timer'),
      fill: panel.querySelector('.hud__tfill'),
      anim: null,
    };
  }
  const round = h('div.hud__round');
  el.append(panels[1].el, round, panels[2].el);
  if (!cfg.timer) el.classList.add('no-timer');

  function update(st = S, { pipAnim = 0 } = {}) {
    const need = needOf(st);
    const turn = st.status === 'playing' ? toMove(st) : 0;
    for (const p of [1, 2]) {
      const P = panels[p];
      P.stone.innerHTML = stoneIcon(colorOf(st, p));
      P.stone.setAttribute('aria-label', colorOf(st, p) === 1 ? '흑' : '백');
      const won = st.score[p - 1];
      let pips = '';
      for (let i = 0; i < need; i++) {
        const on = i < won;
        const fresh = pipAnim === p && i === won - 1;
        pips += `<i class="pip${on ? ' is-on' : ''}${fresh ? ' is-new' : ''}"></i>`;
      }
      P.pips.innerHTML = pips;
      P.el.classList.toggle('is-mp', matchPoint(st, p) && st.status !== 'matchOver');
      P.el.classList.toggle('is-turn', turn === p);
      P.el.classList.toggle('is-wait', turn !== 0 && turn !== p);
    }
    const fin = isFinalRound(st);
    round.classList.toggle('is-final', fin);
    round.innerHTML = fin ? '<small>FINAL</small><b>R' + st.round + '</b>' : `<small>ROUND</small><b>${st.round}</b>`;
  }

  // ---- move timer bar ----------------------------------------------------------------------
  // The battle never redraws the bar per frame: runTimer() hands the whole run to a compositor
  // animation (WAAPI, transform only), setTimer() shows a still bar (paused, frozen shots), and
  // level() flips the low / critical colours once, at the 5 s and 3 s boundaries.
  function stopAnim(P) {
    if (!P.anim) return;
    try { P.anim.cancel(); } catch { /* fine */ }
    P.anim = null;
  }
  function level(P, secsLeft) {
    P.timer.classList.toggle('is-low', secsLeft <= 5);
    P.timer.classList.toggle('is-crit', secsLeft <= 3);
  }
  // Still bar: frac 0..1 of player p's time, secs left (for the low / critical states).
  function setTimer(p, frac, secsLeft) {
    for (const q of [1, 2]) {
      const P = panels[q];
      const mine = q === p;
      stopAnim(P);
      P.fill.style.transform = `scaleX(${mine ? clamp01(frac) : 1})`;
      if (mine) level(P, secsLeft);
      else P.timer.classList.remove('is-low', 'is-crit');
      P.timer.classList.toggle('is-live', mine);
    }
  }
  // Running bar: from frac down to 0 over ms (the time player p has left).
  function runTimer(p, frac, ms) {
    setTimer(p, frac, ms / 1000);
    const P = panels[p];
    if (!(ms > 0) || typeof P.fill.animate !== 'function') return;
    try {
      P.anim = P.fill.animate(
        [{ transform: `scaleX(${clamp01(frac)})` }, { transform: 'scaleX(0)' }],
        { duration: ms, easing: 'linear', fill: 'forwards' });
    } catch { P.anim = null; }
  }
  // Once per second while running: the colour states, and the bar itself where WAAPI is missing.
  function timerLevel(p, frac, secsLeft) {
    const P = panels[p];
    if (!P) return;
    level(P, secsLeft);
    if (!P.anim) P.fill.style.transform = `scaleX(${clamp01(frac)})`;
  }
  function clearTimer() {
    for (const q of [1, 2]) {
      const P = panels[q];
      stopAnim(P);
      P.fill.style.transform = 'scaleX(1)';
      P.timer.classList.remove('is-low', 'is-crit', 'is-live');
    }
  }
  function thinking(on) { panels[2].el.classList.toggle('is-thinking', !!on); }
  function clearTurn() { for (const q of [1, 2]) panels[q].el.classList.remove('is-turn', 'is-wait'); }

  update();
  return { el, panels, update, setTimer, runTimer, timerLevel, clearTimer, thinking, clearTurn };
}
