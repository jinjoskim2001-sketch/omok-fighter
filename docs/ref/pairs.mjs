// paired-opening match: each random opening (4 stones near center) played twice with colors swapped
import { buildTable, Board, idxOf, BLACK, WHITE, EMPTY } from './board.js';
import { Searcher } from './ai.js';
const T = buildTable(false);
function rng(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const [lvA = 'hard', lvB = 'normal', pairsS = '4'] = process.argv.slice(2); const pairs = +pairsS; let maxMs = 0;
const r = rng(7); let a = 0, games = 0, draws = 0;
for (let p = 0; p < pairs; p++) {
  const open = []; const used = new Set();
  while (open.length < 4) { const i = idxOf(5 + ((r() * 5) | 0), 5 + ((r() * 5) | 0)); if (!used.has(i)) { used.add(i); open.push(i); } }
  for (const aColor of [BLACK, WHITE]) {
    const b = new Board(T); const sA = new Searcher(b), sB = new Searcher(b);
    open.forEach((i, k) => b.put(i, k % 2 ? WHITE : BLACK));
    let c = BLACK, winner = 0;
    for (let ply = 0; ply < 200 && !winner; ply++) {
      const isA = c === aColor; const t = (isA ? sA : sB).think(c, isA ? lvA : lvB, r); if (isA && t.ms > maxMs) maxMs = t.ms;
      if (t.move < 0 || !b.legal(t.move, c)) { winner = 3 - c; break; }
      const five = b.isWinMove(t.move, c); b.put(t.move, c); if (five) winner = c; c = 3 - c;
    }
    games++; if (winner === aColor) a++; else if (!winner) draws++;
    console.log(`pair ${p} A=${aColor === BLACK ? 'B' : 'W'} -> ${winner === aColor ? 'A' : winner ? 'B' : 'draw'} (${b.n} stones)`);
  }
}
console.log(`A(${lvA}) vs B(${lvB}): ${a}/${games} draws ${draws}; A max think ${maxMs}ms`);
