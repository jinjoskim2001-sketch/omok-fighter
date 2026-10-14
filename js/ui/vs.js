// js/ui/vs.js — VS splash (SPEC §3.1): 0–300 ms fighters slide in, 300 "VS" slams 3×→1× in 200 ms
// with a 4px shake + clash sound, 500–1600 names and stage hold. Tap to skip after 400 ms.
// 빠르게: ×0.6 with no hold. (최소 never shows this screen — js/ui/flow.js.)

import { h, esc, createTimers } from './dom.js';
import { app, speed, shakeOn } from './ctx.js';
import { sfx } from './widgets.js';
import { getCharacter } from '../characters.js';
import { figureHTML } from '../fighter.js';
import { THEMES } from '../themes.js';

export function createVs(params) {
  const { match, theme, coin } = params;
  const timers = createTimers();
  const cfg = match.cfg;
  const a = getCharacter(cfg.p1), b = getCharacter(cfg.p2);
  const mirror = cfg.p1 === cfg.p2;
  const fast = speed() === 'fast';
  const T = fast
    ? { in: 180, slam: 180, slamDur: 120, meta: 300, end: 560, skip: 240 }
    : { in: 300, slam: 300, slamDur: 200, meta: 500, end: 1600, skip: 400 };

  const el = h('section', { 'aria-label': `${a.ko} 대 ${b.ko}` });
  el.style.setProperty('--a1', a.bg[0]);
  el.style.setProperty('--b1', mirror ? (b.colorAlt || b.bg[1]) : b.bg[0]);
  el.style.setProperty('--d-in', T.in + 'ms');
  el.style.setProperty('--t-slam', T.slam + 'ms');
  el.style.setProperty('--d-slam', T.slamDur + 'ms');
  el.style.setProperty('--t-meta', T.meta + 'ms');
  const p2Label = cfg.mode === 'cpu' ? `CPU · ${({ easy: '쉬움', normal: '보통', hard: '어려움' })[cfg.cpuLevel] || ''}` : '2P';
  el.innerHTML = `
    <div class="vs__half vs__half--a"></div>
    <div class="vs__half vs__half--b"></div>
    <div class="vs__slash"></div>
    <div class="vs__side vs__side--a">
      <div class="vs__fig">${figureHTML(a.id)}</div>
      <div class="vs__meta"><span class="tag tag--p1">1P</span><span class="vs__name disp">${esc(a.ko)}</span><span class="vs__type">${esc(a.tagline)}</span></div>
    </div>
    <div class="vs__side vs__side--b">
      <div class="vs__fig">${figureHTML(b.id, { alt: mirror })}</div>
      <div class="vs__meta"><span class="tag tag--p2">${esc(p2Label)}</span><span class="vs__name disp">${esc(b.ko)}</span><span class="vs__type">${esc(b.tagline)}</span></div>
    </div>
    <div class="vs__mark sticker-text" aria-hidden="true">VS</div>
    <div class="vs__stage"><span class="tape">STAGE · ${esc((THEMES[theme] && THEMES[theme].name) || theme)}</span></div>`;

  let gone = false;
  let t0 = 0;
  const next = () => {
    if (gone) return;
    gone = true;
    app.go('battle', { match, theme, coin, intro: true }, { transition: 'fade' });
  };
  el.addEventListener('pointerup', () => { if (performance.now() - t0 >= T.skip) next(); });

  return {
    el,
    mount() {
      t0 = performance.now();
      if (app.frozen) { el.classList.add('go'); return; }
      requestAnimationFrame(() => el.classList.add('go'));
      timers.set(() => {
        sfx('vs');
        if (shakeOn()) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
      }, T.slam);
      timers.set(next, T.end);
    },
    destroy() { timers.destroy(); },
  };
}
