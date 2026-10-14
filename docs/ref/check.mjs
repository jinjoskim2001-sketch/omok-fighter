import { buildTable, fromAscii, idxOf, xyOf, BLACK, WHITE, FL_FORBID, FL_FIVE, WW, Board } from './board.js';
import { Searcher } from './ai.js';

let t0 = performance.now();
const T = buildTable(false);
console.log('table build ms', (performance.now() - t0).toFixed(1));
t0 = performance.now(); const T2 = buildTable(true); console.log('table(overline) build ms', (performance.now() - t0).toFixed(1));
const E = '...............';
const pad = (rows) => { const r = rows.slice(); while (r.length < 15) r.push(E); return r.map((s) => s.padEnd(15, '.')); };
const xy = (i) => xyOf(i).join(',');
function run(name, rows, c, expect, opts = {}) {
  const b = fromAscii(T, pad(rows));
  const s = new Searcher(b);
  const r = s.think(c, opts.level || 'hard', Math.random, opts);
  const got = xy(r.move);
  const ok = typeof expect === 'function' ? expect(r, b) : (Array.isArray(expect) ? expect.includes(got) : got === expect);
  console.log(ok ? 'PASS' : 'FAIL', name, got, r.reason, `d=${r.depth ?? '-'} ${r.ms}ms nodes=${r.nodes}`);
}
run('win-in-1', ['', '', '', '...XXXX', '...OOO', '....O'], BLACK, ['2,3','7,3']);
run('block-four', ['', '', '', '..OOOO.', '...XX.', '....X'], BLACK, ['1,3', '6,3']);
run('block-open-three', ['', '', '', '', '', '.....OOO', '......X', '.....X..X'], BLACK, ['4,5', '8,5', '3,5', '9,5']);
// exact five: XXXX.X -> playing the gap makes six (no win), must not be flagged five
{ const b = fromAscii(T, pad(['', '', '..XXXX.X'])); console.log((b.flags[BLACK * WW + idxOf(6, 2)] & FL_FIVE) ? 'FAIL' : 'PASS', 'overline-not-five');
  const b2 = fromAscii(T2, pad(['', '', '..XXXX.X'])); console.log((b2.flags[BLACK * WW + idxOf(6, 2)] & FL_FIVE) ? 'PASS' : 'FAIL', 'overline-five-when-allowed'); }
// 3-3 point detection: black at (5,5) would make two open threes
{ const b = fromAscii(T, pad(['', '', '', '.....X', '.....X', '...XX.', '', ''])); const f = b.flags[BLACK * WW + idxOf(5, 5)];
  console.log((f & FL_FORBID) ? 'PASS' : 'FAIL', '33-forbidden-detected'); }
// AI never plays forbidden: the obvious attacking point (5,5) is 3-3 for black
run('never-forbidden', ['', '', '', '.....X', '.....X', '...XX.', '', '..........O', '.........O', '........O..'], BLACK, (r, b) => r.move !== idxOf(5, 5) && b.legal(r.move, BLACK));
// VCF: black to move has a VCF chain
run('vcf', [
  '', '', '',
  '....X.X.X',
  '.....O..',
  '...X.....',
  '...X.O...',
  '...X.O...',
  '....O....',
], BLACK, (r) => r.reason === 'vcf' || r.score > 500000);
// exploit: white's only block point is a 3-3 for white -> black four wins
run('exploit-defender-33', [
  '', '', '', '', '', '', '',
  '........O',
  '........O',
  '...OXXX..',
  '.........O',
  '..........O',
], BLACK, (r) => r.move === idxOf(7, 9) && r.reason === 'vcf');
// defend: white (opponent) has a VCF, black has none; black must break it
{
  const rows = pad(['', '', '',
  '....O.O.O',
  '...........X',
  '...O.......',
  '...O........X',
  '...O..X....',
  '.X..........',
  '..........X']);
  const b = fromAscii(T, rows); const s = new Searcher(b);
  s.deadline = performance.now() + 1e9;
  const had = s.vcfFresh(WHITE, 14, 1e9), mine = s.vcfFresh(BLACK, 14, 1e9);
  const r = s.think(BLACK, 'hard');
  b.put(r.move, BLACK); s.deadline = performance.now() + 1e9;
  const still = s.vcfFresh(WHITE, 14, 1e9);
  console.log(had && !mine && !still ? 'PASS' : 'FAIL', 'defend-opponent-vcf', 'whiteVcf', had, 'blackVcf', mine, 'move', xy(r.move), r.reason, 'd=' + r.depth, 'stillVcf', still, r.ms + 'ms');
}

// our forced block is itself 3-3 for us -> must still return a LEGAL move
{
  const rows = pad(['', '', '', '', '', '', '',
  '........X',
  '........X',
  '...XOOO..',
  '.........X',
  '..........X']);
  const b = fromAscii(T, rows); b.put(idxOf(7, 9), WHITE); // white makes four; block (8,9) is 3-3 for black
  const s = new Searcher(b); const r = s.think(BLACK, 'hard');
  console.log(b.legal(r.move, BLACK) && r.reason === 'lost' ? 'PASS' : 'FAIL', 'forced-block-forbidden-returns-legal', xy(r.move), r.reason);
}
// easy: block-four rate and open-three rate over seeds
{
  let blocked = 0, blocked3 = 0; const R = 400;
  for (let k = 0; k < R; k++) {
    const b = fromAscii(T, pad(['', '', '', '..OOOO.', '...XX.', '....X'])); const s = new Searcher(b);
    let a = k * 7919 + 1; const rnd = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    const r = s.think(BLACK, 'easy', rnd); if (r.reason === 'block') blocked++;
    const b3 = fromAscii(T, pad(['', '', '', '', '', '.....OOO', '......X', '.....X..X'])); const s3 = new Searcher(b3);
    const r3 = s3.think(BLACK, 'easy', rnd); b3.put(r3.move, BLACK); if (b3.cntOpen4[WHITE] === 0) blocked3++;
  }
  console.log('easy block-four rate', (blocked / R).toFixed(2), 'easy stops-open-three rate', (blocked3 / R).toFixed(2));
}
// self-play speed
function selfplay(ms, plies = 30) {
  const b = new Board(T); let c = BLACK; const s = new Searcher(b); const log = [];
  for (let p = 0; p < plies; p++) {
    const r = s.think(c, 'hard', Math.random, { timeMs: ms });
    if (r.move < 0) break;
    log.push(`${xy(r.move)}:${r.reason}:d${r.depth ?? '-'}:${r.ms}ms:${(r.nodes / Math.max(1, r.ms)).toFixed(0)}kn/s`);
    b.put(r.move, c);
    if (r.reason === 'win') { log.push('WIN ' + (c === BLACK ? 'B' : 'W')); break; }
    c = 3 - c;
  }
  return log;
}
if (process.argv[2]==='self') console.log(selfplay(+process.argv[3]||1500).join('\n'));
