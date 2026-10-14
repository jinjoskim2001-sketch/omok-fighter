// mini match: search AI (timeMs) vs greedy 1-ply heuristic, alternating colors, random 2-stone openings
import { buildTable, Board, idxOf, xyOf, BLACK, WHITE, WW, EMPTY, FL_FIVE } from './board.js';
import { Searcher } from './ai.js';
const T = buildTable(false);
function rng(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function greedy(b, c) {
  const o = 3 - c;
  if (b.cnt5[c]) return b.findFlag(c, FL_FIVE);
  if (b.cnt5[o]) { const r = b.findFlag(o, FL_FIVE); if (b.legal(r, c)) return r; }
  let best = -1, bs = -1;
  for (let i = 0; i < WW; i++) if (b.cells[i] === EMPTY && b.nb[i] && b.legal(i, c)) { const s = b.pval[c * WW + i] * 2 + b.pval[o * WW + i]; if (s > bs) { bs = s; best = i; } }
  return best;
}
const [ms = 500, games = 6, oppMs = 0] = process.argv.slice(2).map(Number);
let score = 0; const r = rng(42);
for (let g = 0; g < games; g++) {
  const b = new Board(T); const s1 = new Searcher(b), s2 = new Searcher(b);
  const aiColor = g % 2 ? WHITE : BLACK;
  b.put(idxOf(7, 7), BLACK); b.put(idxOf(7 + ((r() * 3) | 0) - 1 || 1, 8), WHITE);
  let c = BLACK, winner = 0;
  for (let p = 0; p < 200 && !winner; p++) {
    const mv = c === aiColor ? s1.think(c, { timeMs: ms }).move : (oppMs ? s2.think(c, { timeMs: oppMs }).move : greedy(b, c));
    if (mv < 0 || !b.legal(mv, c)) { winner = 3 - c; console.log('  illegal/no move by', c === aiColor ? 'AI' : 'opp'); break; }
    const five = b.isWinMove(mv, c);
    b.put(mv, c);
    if (five) winner = c;
    c = 3 - c;
  }
  if (winner === aiColor) score++;
  console.log(`game ${g} ai=${aiColor === BLACK ? 'B' : 'W'} winner=${winner === aiColor ? 'AI' : winner ? 'opp' : 'draw'} moves=${b.n}`);
}
console.log(`AI(${ms}ms) vs ${oppMs ? `AI(${oppMs}ms)` : 'greedy'}: ${score}/${games}`);
