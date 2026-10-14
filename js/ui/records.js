// js/ui/records.js — 전적 (ux.md §2.9): totals, CPU record by level + streaks, per-fighter use and
// win rate, fastest K.O. / longest round, the last 20 matches. 기록 초기화 asks twice (the same
// flow as the 설정 row: resetStatsFlow).

import { h, esc } from './dom.js';
import { app } from './ctx.js';
import { btn, ICONS } from './widgets.js';
import { confirmDialog } from './sheet.js';
import { toast } from './toast.js';
import { CHARACTERS, getCharacter } from '../characters.js';
import { portraitHTML } from '../fighter.js';

const LV = [['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']];
// portrait tile tinted with the fighter's own colour (as in the 파이터별 list), not plain bg3
const ptbg = (ch) => (ch && ch.bg ? ` style="--ptbg:${esc(ch.bg[0])}"` : '');

// 기록 초기화 — asks twice. Shared with the 설정 row. Promise<boolean> (true = wiped).
export async function resetStatsFlow() {
  if (!await confirmDialog({ title: '기록을 초기화할까요?', text: '전적이 모두 지워져요.', ok: '초기화', cancel: '취소', danger: true })) return false;
  if (!await confirmDialog({ title: '정말요?', text: '되돌릴 수 없어요!', ok: '진짜 초기화', cancel: '그만두기', danger: true })) return false;
  app.resetStats();
  toast('기록을 초기화했어요');
  return true;
}

function fmtDate(at) {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function createRecords() {
  const el = h('section', { 'aria-label': '전적' });
  const top = h('div.topbar');
  top.append(
    btn('', { cls: 'btn--dark btn--icon', icon: ICONS.back, aria: '뒤로', sound: 'cancel', onClick: () => app.go('menu') }),
    h('h1.topbar__title', { text: '전적' }),
  );
  const scroll = h('div.scroll');
  el.append(top, scroll);

  function render() {
    const st = app.loadStats();
    scroll.replaceChildren();
    const num = (v, unit = '') => (v == null || v === 0 && unit === '수' ? '–' : `${v}${unit ? `<small>${unit}</small>` : ''}`);
    const tiles = h('div.stats');
    tiles.innerHTML = [
      ['매치', num(st.matches | 0)],
      ['라운드', num(st.rounds | 0)],
      ['최단 K.O.', st.fastestKO ? num(st.fastestKO, '수') : '–'],
      ['최장 라운드', st.longestRound ? num(st.longestRound, '수') : '–'],
      ['CPU 연승', num(st.cpuStreak | 0)],
      ['최다 연승', num(st.cpuBestStreak | 0)],
    ].map(([l, v]) => `<div class="stat card"><div class="stat__num">${v}</div><div class="stat__label">${l}</div></div>`).join('');
    scroll.append(tiles);

    const g1 = h('section.group');
    g1.append(h('h2.group__title', { text: 'CPU 전적' }));
    const lvl = h('div.lvl');
    lvl.innerHTML = LV.map(([k, n]) => {
      const r = (st.cpu && st.cpu[k]) || { w: 0, l: 0 };
      const tot = (r.w | 0) + (r.l | 0);
      return `<div class="lvl__item card"><div class="lvl__name">${n}</div><div class="lvl__wl"><span class="w">${r.w | 0}</span>승 <span class="l">${r.l | 0}</span>패</div><div class="lvl__rate">${tot ? `승률 ${Math.round((r.w / tot) * 100)}%` : '아직 없음'}</div></div>`;
    }).join('');
    g1.append(lvl);
    scroll.append(g1);

    const g2 = h('section.group');
    g2.append(h('h2.group__title', { text: '파이터별' }));
    const card = h('div.group__card.card');
    const list = h('div.chars');
    const by = st.byChar || {};
    const maxPlayed = Math.max(1, ...CHARACTERS.map((c) => (by[c.id] && by[c.id].played) | 0));
    list.innerHTML = CHARACTERS.map((c) => {
      const r = by[c.id] || { played: 0, won: 0 };
      const played = r.played | 0, won = r.won | 0;
      const rate = played ? Math.round((won / played) * 100) : 0;
      return `<div class="crow"><span class="crow__pt" style="--cbg:${esc(c.bg[0])}">${portraitHTML(c.id)}</span>
        <span class="crow__name">${esc(c.ko)}</span>
        <span class="crow__bar"><i class="crow__fill" style="--c:${esc(c.color)};transform:scaleX(${played / maxPlayed})"></i></span>
        <span class="crow__num"><b>${played}</b>판 ${played ? `${rate}%` : ''}</span></div>`;
    }).join('');
    card.append(list);
    g2.append(card);
    scroll.append(g2);

    const g3 = h('section.group');
    g3.append(h('h2.group__title', { text: '최근 매치' }));
    const card3 = h('div.group__card.card');
    const recent = Array.isArray(st.recent) ? st.recent : [];
    if (!recent.length) {
      card3.innerHTML = '<div class="empty">아직 끝낸 매치가 없어요. 한 판 붙어 봐요!</div>';
    } else {
      const rl = h('div.recent');
      rl.innerHTML = recent.slice(0, 20).map((m) => {
        const a = getCharacter(m.p1), b = getCharacter(m.p2);
        const mode = m.mode === 'cpu' ? `CPU ${({ easy: '쉬움', normal: '보통', hard: '어려움' })[m.level] || ''}` : '친구랑';
        const sc = Array.isArray(m.score) ? m.score : [0, 0];
        return `<div class="rrow"><span class="rrow__date">${fmtDate(m.at)}</span>
          <span class="rrow__pts"><span class="rrow__pt${m.winner === 1 ? ' is-win' : ''}"${ptbg(a)}>${a ? portraitHTML(a.id) : ''}</span><span class="rrow__vs">VS</span><span class="rrow__pt${m.winner === 2 ? ' is-win' : ''}"${ptbg(b)}>${b ? portraitHTML(b.id, { alt: m.p1 === m.p2 }) : ''}</span></span>
          <span class="rrow__mode">${esc(mode)}</span>
          <span class="rrow__score">${sc[0] | 0} : ${sc[1] | 0}</span></div>`;
      }).join('');
      card3.append(rl);
    }
    g3.append(card3);
    scroll.append(g3);

    const clear = btn('기록 초기화', {
      cls: 'btn--ghost btn--sm', sound: 'menu',
      onClick: async () => { if (await resetStatsFlow()) render(); },
    });
    clear.style.margin = '4px auto 0';
    scroll.append(clear);
  }
  render();
  return { el, quiet: () => true, destroy() {} };
}
