// js/ui/title.js — 타이틀: logo slam + OMOK FIGHTER tape + the 8 fighters idling + "탭해서 시작!".
// The first tap is the gesture that unlocks Web Audio (iOS) — arcade convention and the unlock in one.
// Layout: [gap] logo [gap · tagline · gap] lineup · CTA — the lineup scales with the screen (width-
// bound on phones, capped by height on short tabs) and the sunburst radiates from the logo, so tall
// phones get a bigger cast and a lit logo instead of empty bands. The burst is a static background layer of the
// screen (no spinning 760 px composited layer).

import { h, createTimers } from './dom.js';
import { app } from './ctx.js';
import { sfx } from './widgets.js';
import { audio } from '../audio.js';
import { CHARACTER_IDS } from '../characters.js';
import { createFighter } from '../fighter.js';

export const LOGO_FIST = `<svg class="logo__fist" viewBox="0 0 60 60" aria-hidden="true">
  <circle cx="26" cy="34" r="20" fill="#141218" stroke="#2A1E2F" stroke-width="4"/>
  <ellipse cx="19" cy="26" rx="6" ry="3.4" fill="#fff" opacity=".3" transform="rotate(-35 19 26)"/>
  <path d="M33 9c6-4 15-2 18 5 2 5 1 10-3 13l-9 6c-5 3-11 1-13-4l-2-6c-2-6 3-11 9-14Z" fill="#FF4757" stroke="#2A1E2F" stroke-width="4" stroke-linejoin="round"/>
  <path d="M30 20c3-2 7-2 9 1" fill="none" stroke="#2A1E2F" stroke-width="3" stroke-linecap="round"/>
  <path d="M41 11c3 0 6 2 7 5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".55"/>
</svg>`;

export function createTitle() {
  const timers = createTimers();
  const fighters = [];
  const el = h('section', { 'aria-label': '돌주먹 타이틀' });
  el.innerHTML = `
    <i class="title__sp" aria-hidden="true"></i>
    <div class="title__logo">
      <h1 class="logo sticker-text logo-in">돌주먹${LOGO_FIST}</h1>
      <div class="tape title__tape">OMOK FIGHTER<small>오목 파이터</small></div>
    </div>
    <i class="title__sp title__sp--mid" aria-hidden="true"></i>
    <p class="title__tag">친구랑 한 폰으로 · CPU랑 한 판</p>
    <i class="title__sp title__sp--mid" aria-hidden="true"></i>
    <div class="lineup" aria-hidden="true">
      <div class="lineup__row lineup__row--back"></div>
      <div class="lineup__row lineup__row--front"></div>
      <div class="lineup__floor"></div>
    </div>
    <div class="title__bottom">
      <p class="title__touch">탭해서 시작!</p>
    </div>
    <span class="title__ver">${app.version}</span>`;

  // Lineup size: four front fighters overlap to ≈2.64·fs wide, so fs ≤ W/2.75; on short browser
  // tabs the height caps it (logo + CTA need ≈300 px, the two rows ≈1.55·fs).
  const W = Math.min(window.innerWidth || 375, 480) - 24;
  const H = window.innerHeight || 667;
  const fs = Math.max(64, Math.min(150, Math.floor(W / 2.75), Math.floor((H - 300) / 1.55)));
  const lineup = el.querySelector('.lineup');
  lineup.style.setProperty('--fs', fs + 'px');
  const back = el.querySelector('.lineup__row--back');
  const front = el.querySelector('.lineup__row--front');
  // back row (on a riser): 냥자 번쩍 삐빅 까꿍 — 까꿍 last so its lantern hangs into open space;
  // front: 불똥 비곰 잽잽 탱글 (bigger silhouettes in front)
  const order = { back: ['nyangja', 'beonjjeok', 'ppibik', 'kkakkung'], front: ['bulttong', 'bigom', 'jaepjaep', 'taenggeul'] };
  const ok = (id) => CHARACTER_IDS.includes(id);
  order.back.filter(ok).forEach((id, i) => {
    const f = createFighter(id, { size: Math.round(fs * 0.84), dir: i < 2 ? 1 : -1 });
    fighters.push(f); back.append(f.el);
  });
  order.front.filter(ok).forEach((id, i) => {
    const f = createFighter(id, { size: fs, dir: i < 2 ? 1 : -1 });
    fighters.push(f); front.append(f.el);
  });

  // The sunburst (a background layer of the screen, css/app.css) is centred on the logo.
  const logoWrap = el.querySelector('.title__logo');
  const logoEl = el.querySelector('.logo');
  const placeBurst = () => {
    const y = logoWrap.offsetTop + logoEl.offsetTop + logoEl.offsetHeight / 2;
    if (y > 0) el.style.setProperty('--burst-y', Math.round(y) + 'px');
  };
  let ro = null;

  let left = false;
  const onTap = (e) => {
    if (left) return;
    if (e && e.pointerType === 'mouse' && e.button !== 0) return;
    left = true;
    try { audio.unlock(); } catch { /* optional */ }
    sfx('ok');
    timers.set(() => app.go('menu'), 60);
  };
  el.addEventListener('click', onTap);
  const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') onTap(); };
  document.addEventListener('keydown', onKey);

  return {
    el,
    quiet: () => true,
    mount() {
      placeBurst();
      if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(placeBurst); ro.observe(el); }
    },
    destroy() {
      if (ro) ro.disconnect();
      timers.destroy();
      document.removeEventListener('keydown', onKey);
      for (const f of fighters) { try { f.destroy(); } catch { /* gone */ } }
    },
  };
}
