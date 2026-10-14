// js/ui/flow.js — how a match gets from the setup sheet to the board and back.
// Decides the things js/match.js leaves to the UI (coin toss, "random" colour / stage) and picks
// the screen sequence for the current fxSpeed (최소 = no VS splash).

import { app, speed } from './ctx.js';
import { createMatch, rematch } from '../match.js';
import { THEME_IDS } from '../themes.js';
import { CHARACTER_IDS } from '../characters.js';

export const UNDO_OPTS = { '2p': [0, 1, 3, -1], cpu: [0, 3, -1] };

export function resolveStage(stage, rng = app.rng) {
  if (THEME_IDS.includes(stage)) return stage;
  return THEME_IDS[Math.floor(rng() * THEME_IDS.length) % THEME_IDS.length];
}

// Build a fresh match from the remembered setup + prefs. → { match, theme, coin }
export function newMatch(mode, p1, p2, rng = app.rng) {
  const s = app.setup[mode];
  let round1Black = 1;
  let coin = false;
  if (mode === '2p') {
    round1Black = rng() < 0.5 ? 1 : 2;
    coin = true;                        // the coin toss shows who got black
  } else {
    round1Black = s.myColor === 'white' ? 2 : s.myColor === 'random' ? (rng() < 0.5 ? 1 : 2) : 1;
  }
  const match = createMatch({
    mode, bestOf: s.bestOf, p1, p2,
    cpuLevel: mode === 'cpu' ? s.level : undefined,
    cpuPlayer: mode === 'cpu' ? 2 : undefined,
    round1Black,
    firstRule: app.prefs.firstRule === 'alternate' ? 'alternate' : 'loser',
    overlineWins: app.prefs.overlineWins === true,
    timer: s.timer,
    undoLimit: s.undo,
  });
  return { match, theme: resolveStage(s.stage, rng), coin };
}

// VS → (coin) → battle. 연출 "최소" has no VS screen.
export function startMatch({ match, theme, coin }) {
  if (speed() === 'min') app.go('battle', { match, theme, coin, intro: true }, { transition: 'fade' });
  else app.go('vs', { match, theme, coin }, { transition: 'fade' });
}

// "한 판 더!" keeps the match's own settings (format, timer, undo, fighters) but is a new match, so
// the rule prefs marked "새 매치부터 적용" (6목 이상도 승리, 선공 규칙) are read again now.
export function startRematch(prev, theme) {
  const match = rematch(prev);                 // a fresh cfg object: safe to adjust
  match.cfg.overlineWins = app.prefs.overlineWins === true;
  match.cfg.firstRule = app.prefs.firstRule === 'alternate' ? 'alternate' : 'loser';
  startMatch({ match, theme, coin: false });
}

export function startFromSelect(mode, p1, p2) {
  if (!CHARACTER_IDS.includes(p1) || !CHARACTER_IDS.includes(p2)) return;
  const made = newMatch(mode, p1, p2);
  startMatch(made);
}
