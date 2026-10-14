// js/ui/settings.js — 설정: every pref of SPEC §8.7 with Korean labels, plus 기록 초기화 (double
// confirm), 홈 화면 추가 방법, 친구에게 공유 and the version.

import { h, esc } from './dom.js';
import { app } from './ctx.js';
import { btn, seg, toggle, sfx, ICONS } from './widgets.js';
import { toast } from './toast.js';
import { shareWithToast } from './menu.js';
import { resetStatsFlow } from './records.js';
import { hapticsKind } from '../haptics.js';

// Rows for things this device can actually do: 무음 모드에서도 소리 needs navigator.audioSession
// (iOS 16.4+), 진동 a haptic path (iOS 17.4+ switch, Android vibrate; js/haptics.js).
const canIgnoreSilent = () => typeof navigator !== 'undefined' && 'audioSession' in navigator;
const canVibrate = () => { try { return hapticsKind() !== 'none'; } catch { return false; } };

const inputHint = (v) => (v === 'single' ? '한 번 탭하면 바로 둬요' : '탭하면 조준, 한 번 더 탭하면 착수');

function row(label, hint, control, { stack = false, warn = false } = {}) {
  const r = h(`div.row${stack ? '.row--stack' : ''}`);
  const main = h('div.row__main');
  main.innerHTML = `<div class="row__label">${esc(label)}</div>` + (hint ? `<div class="row__hint${warn ? ' row__hint--warn' : ''}">${esc(hint)}</div>` : '');
  r.append(main);
  if (control) r.append(control);
  return r;
}
function group(title, rows) {
  const g = h('section.group');
  g.append(h('h2.group__title', { text: title }));
  const c = h('div.group__card.card');
  c.append(...rows.filter(Boolean));
  g.append(c);
  return g;
}

export function createSettings() {
  const P = app.prefs;
  const set = (patch) => app.setPrefs(patch);
  const el = h('section', { 'aria-label': '설정' });
  const top = h('div.topbar');
  top.append(
    btn('', { cls: 'btn--dark btn--icon', icon: ICONS.back, aria: '뒤로', sound: 'cancel', onClick: () => app.go('menu') }),
    h('h1.topbar__title', { text: '설정' }),
  );
  const scroll = h('div.scroll');

  // 소리
  const silentRow = () => {
    const r = row('무음 모드에서도 소리', '', toggle(P.ignoreSilent === true, (on) => {
      set({ ignoreSilent: on });
      if (on) toast('켜면 듣던 음악이 멈춰요', { ms: 2400 });
    }, { label: '무음 모드에서도 소리' }));
    r.querySelector('.row__main').append(h('div.row__hint.row__hint--warn', { text: '켜면 듣던 음악이 멈춰요' }));
    return r;
  };
  const volOpts = [{ value: 0.5, label: '작게' }, { value: 0.8, label: '보통' }, { value: 1, label: '크게' }];
  const vol = [0.5, 0.8, 1].reduce((a, b) => (Math.abs(b - (P.volume ?? 0.8)) < Math.abs(a - (P.volume ?? 0.8)) ? b : a), 0.8);
  const vibrate = canVibrate();
  scroll.append(group(vibrate ? '소리 · 진동' : '소리', [
    row('효과음', '', toggle(P.sound !== false, (on) => { set({ sound: on }); if (on) sfx('ok'); }, { label: '효과음' })),
    row('소리 크기', '', seg(volOpts, vol, (v) => { set({ volume: v }); sfx('place', { color: 1, theme: 'mat' }); }, { cols: 3, name: '소리 크기' }), { stack: true }),
    canIgnoreSilent() ? silentRow() : null,
    vibrate ? row('진동', '버튼과 판을 누를 때\u00a0톡', toggle(P.haptics !== false, (on) => set({ haptics: on }), { label: '진동' })) : null,
  ]));

  // 연출
  scroll.append(group('연출', [
    row('연출 속도', '빠르게: 연출 시간을 줄여요\u00a0· 최소:\u00a0흔들림·VS\u00a0없이', seg([
      { value: 'normal', label: '보통' }, { value: 'fast', label: '빠르게' }, { value: 'min', label: '최소' },
    ], P.fxSpeed || 'normal', (v) => set({ fxSpeed: v }), { cols: 3, name: '연출 속도' }), { stack: true }),
    row('화면 흔들림', 'K.O. 때 화면이 흔들려요', toggle(P.shake !== false, (on) => set({ shake: on }), { label: '화면 흔들림' })),
    row('움직임 줄이기', '자동: 아이폰 설정을 따라요', seg([
      { value: 'auto', label: '자동' }, { value: 'reduce', label: '켬' }, { value: 'full', label: '끔' },
    ], P.motion || 'auto', (v) => set({ motion: v }), { cols: 3, name: '움직임 줄이기' }), { stack: true }),
  ]));

  // 대국
  scroll.append(group('대국', [
    row('착수 방식', inputHint(P.input === 'single' ? 'single' : 'double'), seg([
      { value: 'double', label: '두 번 탭', sub: '실수 방지' }, { value: 'single', label: '바로 착수', sub: '한 번 탭' },
    ], P.input === 'single' ? 'single' : 'double', (v) => {
      set({ input: v });
      const hint = inputRow.querySelector('.row__hint');
      if (hint) hint.textContent = inputHint(v);
    }, { cols: 2, name: '착수 방식' }), { stack: true }),
    row('금수 자리 미리 표시', '둘 수 없는 쌍삼 자리에\u00a0X\u00a0표시', toggle(P.showForbidden === true, (on) => set({ showForbidden: on }), { label: '금수 자리 미리 표시' })),
    row('6목 이상도 승리', '새 매치부터 적용', toggle(P.overlineWins === true, (on) => set({ overlineWins: on }), { label: '6목 이상도 승리' })),
    row('선공 규칙', '2라운드부터 누가 흑?\u00a0· 새 매치부터 적용', seg([
      { value: 'loser', label: '진 사람이 흑' }, { value: 'alternate', label: '번갈아' },
    ], P.firstRule === 'alternate' ? 'alternate' : 'loser', (v) => set({ firstRule: v }), { cols: 2, name: '선공 규칙' }), { stack: true }),
  ]));
  const inputRow = scroll.querySelectorAll('.group')[2].querySelector('.row');

  // 기타
  const extra = [];
  if (app.canInstall()) {
    extra.push(row('홈 화면 추가 방법', '앱처럼 바로 열려요', btn('보기', { cls: 'btn--paper btn--sm', onClick: () => app.openInstallGuide() })));
  }
  extra.push(row('친구에게 공유', '', btn('공유', { cls: 'btn--paper btn--sm', icon: '', onClick: () => shareWithToast() })));
  extra.push(row('기록 초기화', '전적이 모두 지워져요', btn('초기화', {
    cls: 'btn--danger btn--sm', sound: 'menu',
    onClick: () => { resetStatsFlow(); },
  })));
  extra.push(row('버전', '', h('span.row__val', { text: app.version })));
  scroll.append(group('기타', extra));

  el.append(top, scroll);
  return { el, quiet: () => true, destroy() {} };
}
