// js/ui/setup.js — 매치 설정 시트 (remembers the last values per mode, SPEC §3).
// 판 수 · 시간제한 · 무르기 · 스테이지(5 테마 + 랜덤) · (CPU: 난이도, 내 돌) → [캐릭터 고르기]

import { h } from './dom.js';
import { app } from './ctx.js';
import { seg, btn } from './widgets.js';
import { openLayer } from './sheet.js';
import { FORMATS } from '../match.js';
import { THEMES, THEME_IDS } from '../themes.js';
import { UNDO_OPTS } from './flow.js';

const TIMER_OPTS = [
  { value: 0, label: '없음' }, { value: 10, label: '10초' }, { value: 20, label: '20초' }, { value: 30, label: '30초' },
];
const UNDO_LABEL = { 0: '없음', 1: '1번', 3: '3번', '-1': '무제한' };
const LEVELS = [
  { value: 'easy', label: '쉬움', sub: '몸풀기' },
  { value: 'normal', label: '보통', sub: '실전' },
  { value: 'hard', label: '어려움', sub: '지옥' },
];
const COLORS = [
  { value: 'black', label: '흑 ●', sub: '선공' }, { value: 'white', label: '백 ○', sub: '후공' }, { value: 'random', label: '랜덤', sub: '운에 맡겨' },
];

const STAGE_SHORT = { mat: '장판', neon: '네온', dojo: '도장', pixel: '8비트', wood: '원목' };
// a 3×3-ish mini board: the board colour with two grid lines each way
function boardSwatch(id, t) {
  const line = id === 'neon' ? (t.accent || '#FF2BD6') : 'rgba(42,30,47,.55)';
  const g = (deg) => `repeating-linear-gradient(${deg}deg, transparent 0 4px, ${line} 4px 5.5px)`;
  return `${g(0)}, ${g(90)}, ${t.backdrop || t.accent || '#C9A06A'}`;
}

function row(label, control) {
  const r = h('div.setup__row');
  r.append(h('div.setup__label', { text: label }), control);
  return r;
}

export function openSetup(mode, { onGo } = {}) {
  const s = app.setup[mode];
  const save = () => app.saveSetup();
  const body = h('div.setup');

  body.append(row('판 수', seg(
    [1, 3, 5, 7].map((n) => ({ value: n, label: n === 1 ? '단판' : `${n}판`, sub: n === 1 ? '승부' : `${FORMATS[n].need}선승` })),
    s.bestOf, (v) => { s.bestOf = v; save(); }, { name: '판 수' },
  )));
  body.append(row('시간제한 (한 수)', seg(TIMER_OPTS, s.timer, (v) => { s.timer = v; save(); }, { name: '시간제한' })));
  const undoOpts = UNDO_OPTS[mode].map((v) => ({ value: v, label: UNDO_LABEL[v] }));
  if (!UNDO_OPTS[mode].includes(s.undo)) s.undo = mode === 'cpu' ? 3 : 1;
  body.append(row(mode === 'cpu' ? '무르기 (판마다, 내 수 + CPU 수)' : '무르기 (판마다, 상대 허락)', seg(undoOpts, s.undo, (v) => { s.undo = v; save(); }, { cols: undoOpts.length, name: '무르기' })));

  // One row of six stage chips: a tiny board (the theme's board colour with grid lines) over a short
  // name; the full name shows on the VS tape.
  const stageOpts = THEME_IDS.map((id) => {
    const t = THEMES[id] || {};
    return { value: id, label: STAGE_SHORT[id] || t.name || id, aria: t.name || id, swatch: boardSwatch(id, t) };
  }).concat([{ value: 'random', label: '랜덤', aria: '랜덤 스테이지', swatch: 'conic-gradient(#FF4757 0 25%, #FFD23F 0 50%, #3FE0B5 0 75%, #2E9BFF 0)' }]);
  if (s.stage !== 'random' && !THEME_IDS.includes(s.stage)) s.stage = 'mat';
  body.append(row('스테이지', seg(stageOpts, s.stage, (v) => { s.stage = v; save(); }, { cols: stageOpts.length, cls: 'seg--stage', name: '스테이지' })));

  if (mode === 'cpu') {
    // side by side on short screens (css: .setup__pair), stacked otherwise
    const pair = h('div.setup__pair');
    pair.append(
      row('CPU 난이도', seg(LEVELS, s.level, (v) => { s.level = v; save(); }, { cols: 3, name: '난이도' })),
      row('내 돌', seg(COLORS, s.myColor, (v) => { s.myColor = v; save(); }, { cols: 3, name: '내 돌' })),
    );
    body.append(pair);
  }

  let layer = null;
  const foot = h('div.setup__foot');
  foot.append(btn('캐릭터 고르기', {
    cls: `btn--gold setup__go`, sound: 'ok',
    onClick: () => { layer.close('go'); if (onGo) onGo(); else app.go('select', { mode }); },
  }));
  body.append(foot);
  // When the sheet's top edge would cut through the menu logo, fade the logo out instead of leaving
  // half of it peeking over the sheet.
  const head = document.querySelector('.scr--menu .menu__head');
  layer = openLayer({
    kind: 'sheet',
    title: mode === 'cpu' ? 'CPU랑 붙기' : '한 판 붙자',
    sub: mode === 'cpu' ? '나 vs CPU' : '둘이서 한 폰으로',
    body,
    cls: 'layer--setup',
    onClose: () => { if (head) head.classList.remove('is-covered'); },
  });
  const logo = head && head.querySelector('.menu__logo');
  if (logo) {
    const sheetTop = (window.innerHeight || 0) - layer.card.offsetHeight;
    if (sheetTop < logo.getBoundingClientRect().bottom) head.classList.add('is-covered');
  }
  return layer;
}
