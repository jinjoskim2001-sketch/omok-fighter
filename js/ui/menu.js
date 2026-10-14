// js/ui/menu.js — 메인 메뉴 (SPEC §3):
// [이어하기*] [한 판 붙자 · 둘이서 한 폰으로] [CPU랑 붙기] [전적] [설정] [홈 화면에 추가*] [친구에게 공유]

import { h } from './dom.js';
import { app } from './ctx.js';
import { btn, ICONS, artReach } from './widgets.js';
import { openSetup } from './setup.js';
import { confirmDialog } from './sheet.js';
import { toast } from './toast.js';
import { getCharacter, CHARACTER_IDS } from '../characters.js';
import { createFighter } from '../fighter.js';

function resumeLabel(m) {
  if (!m) return '';
  const a = getCharacter(m.cfg.p1), b = getCharacter(m.cfg.p2);
  const who = `${a ? a.ko : '1P'} vs ${b ? b.ko : (m.cfg.mode === 'cpu' ? 'CPU' : '2P')}`;
  // A save taken on the round-result card ('roundOver') resumes into the next round.
  const round = m.status === 'roundOver' ? m.round + 1 : m.round;
  return `${who} · ${m.score[0]} : ${m.score[1]} · ${round}라운드`;
}

export function createMenu() {
  const fighters = [];
  const el = h('section', { 'aria-label': '메뉴' });
  const head = h('div.menu__head');
  head.innerHTML = `<h1 class="menu__logo sticker-text">돌주먹</h1>`;
  const duo = h('div.menu__duo', { 'aria-hidden': 'true' });
  const chars = app.setup.chars || {};
  const a = CHARACTER_IDS.includes(chars.p1) ? chars.p1 : 'bigom';
  const b = CHARACTER_IDS.includes(chars.p2) && chars.p2 !== a ? chars.p2 : CHARACTER_IDS.find((id) => id !== a);
  for (const [id, dir] of [[a, 1], [b, -1]]) {
    const f = createFighter(id, { size: 100, dir });
    fighters.push(f);
    duo.append(f.el);
  }
  duo.insertAdjacentHTML('beforeend', '<span class="menu__vs sticker-text">VS</span>');

  const list = h('div.menu__list');
  const saved = app.loadMatch();
  const startNew = async (mode) => {
    if (app.hasMatch()) {
      const ok = await confirmDialog({ title: '새로 시작할까요?', text: '이어하던 경기는 사라져요.', ok: '새로 시작', cancel: '취소', danger: true });
      if (!ok) return;
    }
    openSetup(mode);
  };
  if (saved && saved.match) {
    list.append(btn('이어하기', {
      cls: 'btn--hero btn--resume', icon: ICONS.play, sub: resumeLabel(saved.match), sound: 'ok',
      onClick: () => app.go('battle', { match: saved.match, theme: saved.theme, resume: true }),
    }));
  }
  list.append(btn('한 판 붙자', { cls: 'btn--hero btn--p1', icon: ICONS.duo, sub: '둘이서 한 폰으로', onClick: () => startNew('2p') }));
  list.append(btn('CPU랑 붙기', { cls: 'btn--hero btn--p2', icon: ICONS.cpu, sub: '쉬움 · 보통 · 어려움', onClick: () => startNew('cpu') }));
  const pair = h('div.menu__pair');
  pair.append(
    btn('전적', { cls: 'btn--dark', icon: ICONS.trophy, onClick: () => app.go('records') }),
    btn('설정', { cls: 'btn--dark', icon: ICONS.gear, onClick: () => app.go('settings') }),
  );
  list.append(pair);

  const foot = h('div.menu__foot');
  if (app.canInstall()) {
    foot.append(btn('홈 화면에 추가', { cls: 'btn--ghost btn--sm', icon: ICONS.plus, onClick: () => app.openInstallGuide() }));
  }
  foot.append(btn('친구에게 공유', { cls: 'btn--ghost btn--sm', icon: ICONS.share, onClick: () => shareWithToast() }));

  el.append(head, duo, list, foot);
  // The duo fills its box (css: it gets 1.6 parts of the free height, the logo band 1): as tall as
  // the box allows, as wide as two overlapping fighters can be (stages overlap 17 % of a side), and
  // never so wide that either one's art leaves the screen. Around the duo's centre the 1P stage
  // spans −0.83…−0.17 sides and the 2P one −0.17…+0.83, so the art reaches out (0.83 − left) on one
  // side and (right − 0.17) on the other (widgets.js artReach; 까꿍's lantern hangs out on its
  // right). A pair that reaches further out on one side is nudged toward the other (--duo-x moves
  // both stages and the VS) rather than shrunk.
  const EDGE = 4;   // px kept clear of the screen edges
  const outL = 0.83 - artReach(a)[0], outR = artReach(b)[1] - 0.17;
  const fit = () => {
    const r = duo.getBoundingClientRect();
    const s = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const roomL = cx - s.left - EDGE, roomR = s.right - cx - EDGE;
    const size = Math.max(70, Math.min(300, Math.floor(r.height - 4), Math.floor(r.width * 0.72),
      Math.floor((roomL + roomR) / (outL + outR))));
    const lo = outL * size - roomL;    // > 0: 1P's art would leave on the left
    const hi = roomR - outR * size;    // < 0: 2P's art would leave on the right
    for (const f of fighters) f.setSize(size);
    duo.style.setProperty('--duo', size + 'px');
    duo.style.setProperty('--duo-x', Math.round(lo > 0 ? lo : hi < 0 ? hi : 0) + 'px');
  };
  let ro = null;
  return {
    el,
    quiet: () => true,
    mount() {
      fit();
      if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(fit); ro.observe(duo); }
    },
    destroy() {
      if (ro) ro.disconnect();
      for (const f of fighters) { try { f.destroy(); } catch { /* gone */ } }
    },
  };
}

export async function shareWithToast() {
  let r = 'failed';
  try { r = await app.share(); } catch { r = 'failed'; }
  if (r === 'copied') toast('주소를 복사했어요! 친구에게 붙여 넣어 주세요', { kind: 'good', sound: true });
  else if (r === 'shared') toast('공유했어요!', { kind: 'good', sound: true });
  else toast('공유하지 못했어요');
}
