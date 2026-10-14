// js/ui/select.js — 파이터 선택 (SPEC §3, §6, ux.md §2.1).
// 3×3 grid, centre "?" = random. Big idle previews: 1P left, 2P/CPU right. Tap a cell to move the
// cursor, tap it again (or 결정) to confirm. 뒤로 undoes the last confirm. Mirror matches are allowed
// (2P gets the .alt palette). CPU: after 1P confirms, its cursor jitters 900 ms and stops on a
// different fighter.

import { h, esc, createTimers } from './dom.js';
import { app, ms } from './ctx.js';
import { btn, sfx, ICONS, haptic, artReach, guardTaps, endGuardAt, triggeringTap, TAP_GUARD_MS } from './widgets.js';
import { CHARACTERS, CHARACTER_IDS, getCharacter } from '../characters.js';
import { createFighter, portraitHTML } from '../fighter.js';
import { startFromSelect } from './flow.js';

const RAND = 4;                                     // centre cell
const CELL_TO_CHAR = [0, 1, 2, 3, -1, 4, 5, 6, 7];  // grid cell → CHARACTERS index (-1 = random)
const cellOf = (id) => {
  const ci = CHARACTER_IDS.indexOf(id);
  const cell = CELL_TO_CHAR.indexOf(ci);
  return cell >= 0 ? cell : RAND;
};
const charAt = (cell) => (CELL_TO_CHAR[cell] >= 0 ? CHARACTERS[CELL_TO_CHAR[cell]] : null);

export function createSelect(params = {}) {
  const mode = params.mode === 'cpu' ? 'cpu' : '2p';
  const cpu = mode === 'cpu';
  const timers = createTimers();
  const chars = app.setup.chars || {};
  const st = {
    step: 'p1',                       // p1 → p2 | cpu → done
    cur: [cellOf(cpu ? chars.cpuMe : chars.p1), cellOf(cpu ? chars.p2 : chars.p2)],
    lock: [null, null],               // confirmed character ids
    jitter: false,
  };
  if (cpu) st.cur[1] = RAND;

  const el = h('section', { 'aria-label': '파이터 선택' });
  // A step change (1P 결정 → 2P 차례, 뒤로) drops taps for a moment (widgets.js guardTaps: no
  // action, sound or tick; the press still shows), so the second tap of a double tap on 결정 / a cell
  // / 뒤로 cannot also act for the next step (lock 2P's remembered pick, or go back twice). The
  // window runs TAP_GUARD_MS from the pointerdown of the tap that changed the step (from the change
  // itself when a timer did, like the CPU's pick).
  const stepGuard = guardTaps(el);
  stepGuard.end();
  let stepGuardOff = null;
  const setStep = (step) => {
    st.step = step;
    const tap = triggeringTap();
    stepGuard.hold();
    if (stepGuardOff) stepGuardOff();
    stepGuardOff = endGuardAt(stepGuard, (tap != null ? tap : performance.now()) + TAP_GUARD_MS);
  };
  const top = h('div.sel__top');
  const back = btn('', { cls: 'btn--dark btn--icon', icon: ICONS.back, aria: '뒤로', sound: 'cancel', onClick: () => onBack() });
  const title = h('h1.sel__title', { text: '파이터 선택' });
  const status = h('div.sel__status');
  top.append(back, title, status);

  const preview = h('div.sel__preview');
  const pv = [mkPanel(1), mkPanel(2)];
  const vs = h('div.sel__vs.sticker-text', { text: 'VS', 'aria-hidden': 'true' });
  preview.append(pv[0].el, pv[1].el, vs);

  const grid = h('div.sel__grid', { role: 'grid', 'aria-label': '캐릭터' });
  const cells = [];
  for (let c = 0; c < 9; c++) {
    const ch = charAt(c);
    const cell = h('button.cell', { type: 'button', 'aria-label': ch ? ch.ko : '랜덤' });
    if (ch) {
      cell.style.setProperty('--cell-bg', ch.bg ? ch.bg[0] : ch.color);
      cell.innerHTML = `<span class="cell__pt">${portraitHTML(ch.id)}</span><span class="cell__name">${esc(ch.ko)}</span>`;
    } else {
      cell.classList.add('cell--rand');
      cell.innerHTML = `<span class="cell__q">?</span><span class="cell__name">랜덤</span>`;
    }
    cell.insertAdjacentHTML('beforeend', '<span class="cell__cur cell__cur--p1"></span><span class="cell__cur cell__cur--p2"></span>' +
      `<span class="cell__tags"><span class="tag tag--p1">1P</span><span class="tag tag--p2">${cpu ? 'CPU' : '2P'}</span></span>`);
    cell.addEventListener('click', () => onCell(c));
    haptic(cell);
    grid.append(cell);
    cells.push(cell);
  }

  const bar = h('div.sel__bar');
  const backBtn = btn('뒤로', { cls: 'btn--ghost', sound: 'cancel', onClick: () => onBack() });
  const okBtn = btn('결정', { cls: 'btn--gold', sound: '', onClick: () => confirm() });
  bar.append(backBtn, okBtn);
  el.append(top, preview, grid, bar);

  function mkPanel(p) {
    const e = h(`div.pv.pv--p${p}`);
    e.innerHTML = `<span class="pv__tag tag tag--p${p}">${p === 1 ? '1P' : (cpu ? 'CPU' : '2P')}</span>
      <div class="pv__fig"></div>
      <div class="pv__lock sticker-text" aria-hidden="true">결정!</div>
      <div class="pv__info"><div class="pv__name"></div><div class="pv__line"></div></div>
      <div class="pv__flash"></div>`;
    return { el: e, fig: e.querySelector('.pv__fig'), name: e.querySelector('.pv__name'), line: e.querySelector('.pv__line'), flash: e.querySelector('.pv__flash'), fighter: null, shown: null };
  }

  // ---- rendering -------------------------------------------------------------------------
  // Size and horizontal nudge of a preview fighter. Most art is ≈60 % of its square, so up to 1.1×
  // the panel width still clears the panel's sides and tall phones (tall panels) get a bigger
  // fighter instead of an empty upper half. The art's measured reach (widgets.js artReach) caps it
  // so the whole figure, side props included (까꿍's lantern hangs past its square), stays inside
  // the panel; a figure that would still touch a side is nudged away from it.
  const PV_PAD = 3;      // px kept clear inside the panel's border
  const FIG_TOP = 4;     // .pv__fig top inside the panel (css)
  function figFit(panel, id) {
    const r = panel.fig.getBoundingClientRect();
    const [l, rr, t] = artReach(id);
    const W = r.width, H = r.height;
    const size = Math.max(70, Math.floor(Math.min(W * 1.1, H + 8, (W - 2 * PV_PAD) / (rr - l), (H + FIG_TOP) / (1 - t))));
    const c = (W - size) / 2;                     // stage left when centred (flex, overflowing evenly)
    const lo = PV_PAD - (c + l * size);           // > 0: the art pokes out on the left
    const hi = W - PV_PAD - (c + rr * size);      // < 0: … on the right
    return { size, dx: W > size / 2 ? Math.round(lo > 0 ? lo : hi < 0 ? hi : 0) : 0 };   // (not laid out yet: no nudge)
  }
  function showPreview(p) {
    const panel = pv[p - 1];
    const i = p - 1;
    const waiting = p === 2 && st.step === 'p1';
    panel.el.classList.toggle('is-waiting', waiting);
    panel.el.classList.toggle('is-locked', !!st.lock[i]);
    const ch = st.lock[i] ? getCharacter(st.lock[i]) : charAt(st.cur[i]);
    const alt = p === 2 && ch && ((st.lock[0] || (charAt(st.cur[0]) || {}).id) === ch.id);
    const key = waiting ? 'wait' : ch ? `${ch.id}:${alt ? 1 : 0}` : 'rand';
    panel.el.style.setProperty('--pv-bg', ch ? ch.bg[0] : 'var(--bg2)');
    if (panel.shown === key) return;
    panel.shown = key;
    if (panel.fighter) { panel.fighter.destroy(); panel.fighter = null; }
    panel.fig.replaceChildren();
    if (waiting) {
      panel.name.textContent = cpu ? 'CPU' : '2P';
      panel.line.textContent = cpu ? '1P가 고르면 CPU 차례' : '1P가 고르면 2P 차례';
      panel.fig.innerHTML = '<span class="pv__q">?</span>';
      return;
    }
    if (!ch) {
      panel.name.textContent = '랜덤';
      panel.line.textContent = '누가 나올지 몰라요!';
      panel.fig.innerHTML = '<span class="pv__q">?</span>';
      return;
    }
    panel.name.innerHTML = `${esc(ch.ko)}<span class="tag">${esc(ch.type)}</span>`;
    panel.line.textContent = ch.tagline;
    const fit = figFit(panel, ch.id);
    const f = createFighter(ch.id, { size: fit.size, alt: !!alt, dir: p === 1 ? 1 : -1 });
    if (fit.dx) f.el.style.left = fit.dx + 'px';
    panel.fighter = f;
    panel.fig.append(f.el);
    if (app.frozen) return;
  }
  function render() {
    const i1 = st.cur[0], i2 = st.cur[1];
    const show2 = st.step !== 'p1';
    cells.forEach((c, k) => {
      c.classList.toggle('has-p1', k === i1);
      c.classList.toggle('has-p2', show2 && k === i2);
      c.classList.toggle('is-p1-locked', !!st.lock[0]);
      c.classList.toggle('is-p2-locked', !!st.lock[1]);
      c.classList.toggle('is-jitter', st.jitter);
    });
    status.className = 'sel__status';
    if (st.step === 'p1') status.textContent = '1P 차례';
    else if (st.step === 'p2') { status.textContent = '2P 차례'; status.classList.add('is-p2'); }
    else if (st.step === 'cpu') { status.textContent = 'CPU 고르는 중…'; status.classList.add('is-p2'); }
    else { status.textContent = '준비 완료!'; status.classList.add('is-done'); }
    okBtn.disabled = st.step === 'cpu' || st.step === 'done';
    showPreview(1);
    showPreview(2);
  }

  // ---- input -----------------------------------------------------------------------------
  function activeSlot() { return st.step === 'p1' ? 0 : st.step === 'p2' ? 1 : -1; }
  function onCell(c) {
    const i = activeSlot();
    if (i < 0) return;
    if (st.cur[i] === c) { confirm(); return; }
    st.cur[i] = c;
    sfx('cursor');
    render();
  }
  function resolveRandom(i) {
    const pool = CHARACTER_IDS.filter((id) => !(cpu && i === 1 && id === st.lock[0]));
    return pool[Math.floor(app.rng() * pool.length) % pool.length];
  }
  function confirm() {
    const i = activeSlot();
    if (i < 0) return;
    const ch = charAt(st.cur[i]);
    const id = ch ? ch.id : resolveRandom(i);
    if (!ch) st.cur[i] = cellOf(id);
    st.lock[i] = id;
    sfx(i === 0 ? 'pick1' : 'pick2');
    setStep(i === 0 ? (cpu ? 'cpu' : 'p2') : 'done');
    if (i === 0 && !cpu && st.cur[1] == null) st.cur[1] = st.cur[0];
    render();
    const panel = pv[i];
    panel.flash.classList.remove('go'); void panel.flash.offsetWidth; panel.flash.classList.add('go');
    if (panel.fighter) panel.fighter.set('turn', { sound: false });
    if (st.step === 'cpu') cpuPick();
    else if (st.step === 'done') finish();
  }
  function cpuPick() {
    const finalId = resolveRandom(1);
    const end = cellOf(finalId);
    st.jitter = true;
    let t = 0;
    const hop = () => {
      if (st.step !== 'cpu') return;
      if (t >= 900) {
        st.cur[1] = end;
        st.jitter = false;
        st.lock[1] = finalId;
        setStep('done');
        sfx('pick2');
        render();
        if (pv[1].fighter) pv[1].fighter.set('turn', { sound: false });
        pv[1].flash.classList.remove('go'); void pv[1].flash.offsetWidth; pv[1].flash.classList.add('go');
        finish();
        return;
      }
      let next;
      do { next = Math.floor(app.rng() * 9); } while (next === st.cur[1] || next === RAND);
      st.cur[1] = next;
      sfx('cursor');
      render();
      const step = 70 + Math.floor(t / 900 * 80);
      t += step;
      timers.set(hop, step);
    };
    timers.set(hop, 120);
  }
  function finish() {
    const [p1, p2] = st.lock;
    const c = app.setup.chars || (app.setup.chars = {});
    if (cpu) c.cpuMe = p1; else { c.p1 = p1; c.p2 = p2; }
    app.saveSetup();
    timers.set(() => startFromSelect(mode, p1, p2), ms(400) + 300);
  }
  function onBack() {
    timers.clearAll();
    st.jitter = false;
    if (st.step === 'done' && !cpu) { st.lock[1] = null; setStep('p2'); }
    else if (st.step === 'done' || st.step === 'cpu' || st.step === 'p2') { st.lock = [null, null]; setStep('p1'); if (cpu) st.cur[1] = RAND; }
    else { app.go('menu'); return; }
    render();
  }

  return {
    el,
    quiet: () => true,
    mount() { render(); },
    destroy() {
      timers.destroy();
      if (stepGuardOff) stepGuardOff();
      for (const p of pv) if (p.fighter) p.fighter.destroy();
    },
    // debug: put the screen in a fixed state
    debugState({ p1, p2 } = {}) {
      if (p1) { st.cur[0] = cellOf(p1); st.lock[0] = p1; st.step = cpu ? 'done' : 'p2'; }
      if (p2) { st.cur[1] = cellOf(p2); }
      render();
    },
  };
}
