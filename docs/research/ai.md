# Omok Fighter CPU opponent (Gomoku AI): design brief

**I built and tested a working prototype, so these recommendations are measured, not guessed.** It is two files totalling 367 lines (`board.js` 160, `ai.js` 207), plain ES modules with no dependencies, all in `/tmp/claude-0/-home-user-skim-ai-os/164b20a1-3bf2-55a7-b177-d7513698c889/scratchpad/proto/`:
- `board.js`: rules, pattern table and incremental board.
- `ai.js`: VCF, alpha-beta with iterative deepening and a transposition table, difficulty levels, opening moves.
- `check.mjs`: tactics checks.
- `pairs.mjs` and `match.mjs`: strength matches.

Every number below was measured with **Node 22 in a Linux container, not on an iPhone**. iPhone speed is still unmeasured; how to measure it is in section 9.

---

## 0. Decisions in short

| Topic | Decision |
|---|---|
| Rules contract | **One shared `js/rules.js`** holds the pattern table and the incremental `Board`. The game and the AI both import it, so "forbidden" means the same thing everywhere. A 3-3 is forbidden for both colours; a move that makes five is always allowed. 4-4 and 4-3 are allowed. Overline (6 or more) is controlled by a `overlineWins` flag. **Default `false`**: Korean general rules don't count six as a win, but the stone may still be placed. Confirm with the owner. |
| 3-3 definition | **Geometric.** An "open three" is any line where one more stone makes a straight four. It is not the recursive Renju definition. This is simple and matches casual Korean apps. |
| Evaluation | A **precomputed table** of 3^10 = 59,049 entries maps an 11-cell line window (5 cells each side) to a pattern level. Each empty cell keeps its pattern per direction and per colour, updated after every move. No regex and no strings. |
| Search | Root shortcuts (win, block, forced moves), then VCF for the AI, then a filter against the opponent's VCF, then negamax alpha-beta with iterative deepening, a Zobrist transposition table and top-K candidates. **Nodes where we must defend are never pruned.** |
| Levels | easy: about 60 ms, depth 2, deliberate blunders (blocks fours 90% of the time, open threes 50%). normal: 450 ms, depth ≤6, VCF 8, softmax choice among the top 3. hard: 1300 ms (hard cap 1.8 s), depth ≤16, VCF 16 plus the opponent-VCF filter, deterministic apart from the opening. |
| Threading | A module Web Worker (Safari/iOS 15+). The protocol is **stateless**: every request sends the full move list, so undo and new game need no extra code. To cancel, ignore stale replies by id; on quit or undo while thinking, `terminate()` the worker and respawn it later. No SharedArrayBuffer, because GitHub Pages can't send the COOP/COEP headers it needs. |
| Fallback | If the worker fails, run the same pure engine on the main thread through a dynamic import, with the budget capped at 500 ms. |
| Code size | About 700–800 lines in total (breakdown in section 12). |
| Product implication | **The first player (black) wins about 90% of AI-vs-AI games** under these rules. Alternate colours game by game in multi-game matches. In vs-CPU, default the human to black for easy and normal. |

---

## 1. Open-source survey: what to take

- **lihongxun945/gobang** (JS, React/Vue, still active, v3.1.0 with August–September 2026 updates). Structure: `shape.js` (regex/string patterns), `eval.js` (scores per empty cell, incremental), `minmax.js` (VCT/VCF built from one search factory), BigInt Zobrist, a transposition table with bounds, iterative deepening, killer moves, quiescence on fours and threes, and candidate limits `rootPointsLimit 32 / pointsLimit 20 / deepPointsLimit 12`. Default depth 6, opening books in `opening-book/`.
  - **What to take:** the cell-based scoring idea, the 10× ratio between shape tiers, threat-only VCT/VCF reusing the same search, keeping more candidates at the root, and a tactics suite run in 8 rotations and mirrors.
  - **What not to take:**
    - Its regex string matching and BigInt hashing are slow in JavaScriptCore.
    - It scores **double-three as a winning shape**. That is wrong for us, because a double three can't be played.
    - Its opening books are **freestyle** (Rapfi/Gomocup) and don't fit our 3-3 rules.
  - **License:** there is no LICENSE file and no `license` field; the README says personal, non-commercial research. Treat it as **ideas only and reimplement clean**. The prototype shares no code with it.
- **dhbloo/rapfi** (C++, GPL-3.0). Strongest open engine: a classical evaluator plus an NNUE network, Piskvork protocol, and a WebAssembly SIMD build option. Too large, needs weight files, and the GPL would apply to our app. Its ideas (pattern codes from lookup tables, fast threat detection, VCF) are what the table approach below borrows.
- **Embryo** was not reviewed.
- **rdragon/gomoku-ai** combines threat-space search with alpha-beta. It confirms the hybrid design, but I did not verify its language or license.

---

## 2. Rules contract the AI depends on (`js/rules.js`)

Pattern levels per direction mean "what placing a stone here makes on this line":
`NONE 0, B2 1, F2 2, B3 3, F3 4 (open three), B4 5 (four, one winning cell), F4 6 (open four, two or more winning cells), F5 7 (five)`

The table is built by recursion with memoisation, so it is correct by construction. Split threes, `X.XXX.X` and exact-five versus overline all come out automatically. It builds in **19–30 ms** in the prototype.

```js
// window digit i: offsets -5..-1 -> 0..4, +1..+5 -> 5..9 ; digit 0 empty, 1 own, 2 opponent/wall
export function buildTable(overlineWins = false) {
  const POW3 = [1,3,9,27,81,243,729,2187,6561,19683], t = new Int8Array(59049).fill(-1);
  const d = (k, i) => ((k / POW3[i]) | 0) % 3;
  const isFive = (k) => { let run = 1;
    for (let i = 4; i >= 0 && d(k, i) === 1; i--) run++;
    for (let i = 5; i <= 9 && d(k, i) === 1; i++) run++;
    return overlineWins ? run >= 5 : run === 5; };
  const level = (k) => {
    if (t[k] >= 0) return t[k];
    let r = NONE;
    if (isFive(k)) r = F5;
    else { let wins = 0;
      for (let i = 0; i < 10; i++) if (d(k, i) === 0 && isFive(k + POW3[i])) wins++;
      if (wins >= 2) r = F4; else if (wins === 1) r = B4;
      else for (let i = 0; i < 10; i++) if (d(k, i) === 0) {
        const l = level(k + POW3[i]);
        const down = l === F4 ? F3 : l === B4 ? B3 : l === F3 ? F2 : l === B3 ? B2 : NONE;
        if (down > r) r = down; } }
    return (t[k] = r); };
  for (let k = 0; k < 59049; k++) level(k);
  return t;
}
```

Per-cell flags for each colour combine the 4 directions:
- `FIVE`: any direction is F5.
- `FORBID`: no five, and two or more directions are F3. This is the 3-3 rule, and it also catches 4-3-3.
- `FOUR`: any direction is B4 or F4.
- `WIN3`: an open four, or two or more fours (4-4).
- `THREE`.

`legal(i,c) = empty && !FORBID`. **The game layer must check every move with this, whether it came from the human, the worker or the fallback.** My first match harness skipped that check. An illegal block was placed and the result of the game flipped without any error. A test for this is in section 11.

---

## 3. Board representation and incremental evaluation

- **Padded 1-D board.** `W = 15 + 2*5 = 25`, so `cells = Uint8Array(625)`. Values: 0 empty, 1 black, 2 white, 3 wall. Direction steps are `[1, W, W+1, W-1]`, so window reads never need a bounds check.
- **Per-cell state**, all in typed arrays:
  - `pat[(c*WW+i)*4+d]` (Uint8)
  - `flags[c*WW+i]`
  - `pval[c*WW+i]` (Int32)
  - running totals `tot[c]`
  - counters `cnt5[c]`, `cntOpen4[c]` (WIN3 cells), `cntFour[c]`
  - `nb[i]`: number of stones within the surrounding 5×5 square, used for candidate generation.
- **On `put(i,c)`:** clear cell i's flags, XOR the Zobrist key, update `nb` over 5×5, then for each of the 4 directions and k = ±1..±5, recompute that one direction for every empty cell, for both colours. That is about 80 window reads of 10 cells each, about 800 reads per move.
- **`undo()`** does the reverse and fully recomputes cell i.
- **Zobrist hashing** uses two Int32 halves (`ZLO`, `ZHI`) from a seeded mulberry32. **No BigInt.** XOR a side-to-move constant into the key.
- **Score per direction level** (`VAL`, starting values, tune by self-play):

| NONE | B2 | F2 | B3 | F3 | B4 | F4 | F5 |
|---|---|---|---|---|---|---|---|
| 0 | 2 | 10 | 12 | 60 | 80 | 400 | 10000 |

  - Add +3000 for a WIN3 cell (open four or 4-4) and +1500 for a 4-3 cell.
  - A FORBID cell is worth 0 to that colour.
  - The scale must not treat 3-3 as a threat, unlike gobang.
- **Static evaluation** from the side to move `c`, opponent `o`:

```js
if (cnt5[c] > 0) return WIN - ply - 1;                       // we complete five
if (cnt5[o] > 1) return -(WIN - ply - 2);                    // they have two winning cells, can't block both
if (cnt5[o] === 0 && cntOpen4[c] > 0 && cntFour[o] === 0) return WIN - ply - 3; // our open four / 4-4, they can't counter with a four
return tot[c] - ((tot[o] * 9) >> 3) + 50;                    // potential difference + tempo
```

---

## 4. Candidates and threat shortcuts (`gen(c, ply, limit)`)

1. **Opponent has a four** (`cnt5[o] > 0`): the only candidate is the blocking cell. If that cell is FORBID for us, return 0 moves, which means we have lost.
2. **Opponent has a WIN3 cell** (open three or a 4-4 setup): candidates are our own FOUR cells plus every cell where the opponent has FOUR or WIN3. That covers the ends, the gap and the outer ends of a three. **Never cut this set to top-K.** Defensive completeness is what prevents false "mate found" results.
3. **Otherwise:** every empty, legal cell with `nb > 0`, scored `pval[c]*2 + pval[o]`, where `pval[o]` counts as 0 if the cell is FORBID for the opponent, because they can't use it. Sort by insertion sort into the per-ply typed buffer and keep the top K:

| Level | Root K | Ply < 2 | Ply < 4 | Deeper |
|---|---|---|---|---|
| hard | 24 | 16 | 12 | 8 |
| normal | 16 | 12 | 10 | 7 |

4. **The AI uses the 3-3 rule against the human automatically.** Search generates opponent moves with the same legality check, so cells forbidden to the human never appear as human replies. VCF also checks this explicitly (next section).

---

## 5. VCF, defending against the opponent's VCF, and VCT

```js
vcf(a, depth, ply) {                       // attacker a to move; true = forced win by continuous fours
  if (cnt5[a] > 0) return true;
  if (depth <= 0 || timeUp()) return false;
  if (failedTable has (hash(a), storedDepth >= depth)) return false;
  forced = cnt5[d] ? (cnt5[d] > 1 ? return false : the defender's five cell) : -1; // must block the defender's four, and only with a four
  for each legal cell m with FOUR for a (only m == forced if forced >= 0), WIN3 cells first:
    put(m, a)
    if (cnt5[a] >= 2) win                               // open four or 4-4
    else if (cnt5[d] === 0) {                           // defender can't win first
      r = the single five cell of a
      if (!legal(r, d)) win                             // only block is 3-3 for the defender: unstoppable
      else { put(r, d); win = vcf(a, depth-1, ply+1); undo() }
    }
    undo(); if (win) { vcfMove = m; return true }
  record (hash, depth) as failed; return false
}
```

- **Rules for the failed-position table:**
  - Key it on hash **plus attacker plus remaining depth**.
  - Clear it on every root search.
  - Never record a node that failed because time ran out.
- **Defending against the opponent's VCF at the root:**
  - If the opponent has a VCF (depth 12 on hard, 6 on normal), keep only the root moves after which their VCF fails.
  - Each check costs a few milliseconds.
  - If no move refutes it, the game is lost; search everything and play the longest resistance.
  - In the prototype this turned a hard position into a single forced refutation in 2 ms.
- **VCT** (wins through threes as well as fours) is optional and hard-level only, behind a flag. The alpha-beta search already acts as a threat-space search, because defending nodes keep every candidate and fours get an extension. Add VCT only if hard feels weak, with depth ≤ 8 and at most 15% of the time budget.

---

## 6. Alpha-beta, iterative deepening, transposition table, time

- **Negamax, fail-soft.**
  - If we can make five, return `WIN - ply - 1`.
  - Check time every 1024 nodes with `performance.now()`.
  - At depth 0, return the static evaluation.
- **Extension:** if our move makes a four and depth ≤ 2, the reply is forced, so add one ply instead of losing depth.
- **Transposition table:** 2^18 slots in separate typed arrays (`Int32` lo, hi, score; `Int8` depth; `Uint8` flag; `Int16` move), about **4 MB**.
  - Normalise mate scores by ply: add ply when storing, subtract when reading.
  - Use the stored move for ordering.
  - Keep the table across moves within a game; clear it on reset or new game.
- **Root loop:**
  1. Opening moves (section 7).
  2. Win now.
  3. Block now. If the block is forbidden, return the best *legal* move with `reason: 'lost'`.
  4. Our VCF, with at most 20% of the budget.
  5. Generate root candidates.
  6. Filter by the opponent's VCF, with at most 10% of the budget.
  7. If one candidate is left, play it (`forced`).
  8. Iterative deepening from depth 1, putting the previous best move first.
  9. **Stop after any depth that took more than 45% of the budget**, because the next one won't finish.
  10. If time runs out partway through a depth, keep the previous best move. Accept a new one only if the previous best was re-searched first and a later move strictly beat it in the same iteration.
- **Never use a score from an iteration that was cut off.** After a cutoff, every value returned to the parent is garbage.
- **Measured in Node:** 65–110k nodes/s. Hard at 1.3 s reaches **depth 8–11** in the middle game, with a worst-case think time of 1,309 ms against a 1,300 ms budget. Normal finishes depth 6 in ≤ 220 ms.

---

## 7. Difficulty levels that feel human

| | easy (쉬움) | normal (보통) | hard (어려움) |
|---|---|---|---|
| Search budget | 60 ms, depth 2 | 450 ms, depth ≤ 6 | 1300 ms (cap 1800), depth ≤ 16 |
| Own VCF / opponent-VCF filter | none | 8 / 6 | 16 / 12 |
| Wins in one move | always | always | always |
| Blocks a four | **90%** (otherwise a plausible quiet "blunder" move) | 100% | 100% |
| Stops an open three | **50%** | 100% | 100% |
| Root choice | softmax, T = 220, among top 6 | softmax, T = 40, among top 3, never a move proven to lose | best move |
| Opening | random cell in the central 3×3 | centre (7,7) | centre (7,7) |

- **Measured with seeded runs:** easy blocks fours **90%** of the time and stops open threes **50%** (both match the config).
- **Matches with paired openings and colours swapped:**
  - hard vs easy: **8/8**
  - normal vs easy: **8/8**
  - hard vs normal: **9/12** (hard won all 6 as black and 3 of 6 as white)
- **Opening moves.**
  - Move 1 as black: centre.
  - Move 2 as white: a random neighbour of black's first stone (orthogonal or diagonal).
  - From move 3: search with softmax among near-best moves, so games differ.
  - **Don't ship freestyle opening books.** They assume different rules.
- **Randomness** comes from a seeded mulberry32. Pass `seed` in each request: `Date.now() ^ moveNo` in production, fixed values in tests.
- **Make the CPU feel human in the UI** (not in the worker): reveal the move at `max(actual think time, minimum delay)`.
  - easy: 500–900 ms
  - normal: 600–1100 ms
  - hard: 700–1300 ms
  - forced moves: about 450 ms
  - Show a character "thinking" animation meanwhile.
- **Hook for character reactions** (cheap to add): the worker returns `reason` and `score`. Map them to moods:
  - `vcf` → "finisher" pose before the win
  - score > 3000 → confident
  - score < −3000 → nervous
  - `lost` → despair
  - `blunder` → oops

---

## 8. Worker protocol, fallback and cancellation

- **Module workers are supported on Safari and iOS 15 and later** (caniuse lists Safari 15 through 27.x and iOS 15 through 27.2; 14.x is not supported).
- **Stateless protocol.** Coordinates at the boundary are `0..224 = y*15 + x`; padded indices stay internal.

```
main → worker  {t:'init', rules:{size:15, overlineWins:false}}
               {t:'think', id, moves:[...], level:'easy'|'normal'|'hard', seed, timeMs?}
               {t:'reset'}                       // new game: clear the transposition table
worker → main  {t:'ready'}
               {t:'move', id, move, reason:'book'|'win'|'block'|'vcf'|'forced'|'search'|'search~'|'blunder'|'lost'|'draw',
                score, depth, nodes, ms}
               {t:'error', id, message}
```

- Rebuilding the board from the move list costs about 1–2 ms (≤ 225 moves), so undo and replays never get out of sync.

```js
// js/ai/worker.js
import { createEngine } from './engine.js';
let engine = null;
self.onmessage = ({ data: m }) => {
  try {
    if (m.t === 'init') { engine = createEngine(m.rules); self.postMessage({ t: 'ready' }); }
    else if (m.t === 'reset') engine?.reset();
    else if (m.t === 'think') self.postMessage({ t: 'move', id: m.id, ...engine.think(m) });
  } catch (e) { self.postMessage({ t: 'error', id: m.id, message: String(e?.message ?? e) }); }
};

// js/ai-client.js (main thread)
export function createAiClient(rules) {
  let w = null, ready = null, broken = false, seq = 0, pending = null, local = null;
  const kill = () => { w?.terminate(); w = null; ready = null; pending?.reject(new Error('cancelled')); pending = null; };
  const spawn = () => new Promise((res) => {
    try { w = new Worker(new URL('./ai/worker.js', import.meta.url), { type: 'module' }); }
    catch { broken = true; return res(false); }
    const to = setTimeout(() => { broken = true; kill(); res(false); }, 3000);
    w.onerror = () => { clearTimeout(to); broken = true; kill(); res(false); };
    w.onmessage = ({ data: m }) => {
      if (m.t === 'ready') { clearTimeout(to); return res(true); }
      if (pending && m.id === pending.id) { const p = pending; pending = null; m.t === 'move' ? p.resolve(m) : p.reject(new Error(m.message)); }
    };
    w.postMessage({ t: 'init', rules });
  });
  async function think(req) {
    if (pending) kill();                       // a search in progress can't be interrupted: terminate it
    const id = ++seq;
    if (!broken && (await (ready ??= spawn())) && w)
      return new Promise((resolve, reject) => { pending = { id, resolve, reject }; w.postMessage({ t: 'think', id, ...req }); });
    local ??= (await import('./ai/engine.js')).createEngine(rules);   // fallback on the main thread
    await new Promise((r) => setTimeout(r, 30));                     // let the "thinking" frame paint
    if (id !== seq) throw new Error('cancelled');
    return local.think({ ...req, timeMs: Math.min(req.timeMs ?? 1300, 500) });
  }
  return { think, cancel: () => { seq++; if (pending) kill(); }, dispose: kill };
}
```

- **Cancellation.**
  - Call `cancel()` on undo, quit or new game. The game layer also drops any reply whose id isn't current.
  - Call `dispose()` when leaving vs-CPU, to free about 4 MB and stop CPU use.
  - Respawning costs module load plus about 25 ms to build the table.
- **Backgrounding on iOS.** Workers are suspended while the app is in the background. When resumed, the deadline has already passed, so the search would return a shallow move. On `visibilitychange → hidden`, call `cancel()`; on `visible`, send the think request again.
- **Service worker.** Precache `js/rules.js`, `js/ai/engine.js`, `js/ai/worker.js` and `js/ai-client.js`. ⚠ I did not verify that Safari's service worker intercepts module-worker script fetches, so **test offline in airplane mode from the home-screen app**.
- **SharedArrayBuffer and Atomics are not an option.** GitHub Pages can't send the COOP/COEP headers they need. The `coi-serviceworker` workaround forces a reload on first visit, which isn't worth it.

---

## 9. Safari / JavaScriptCore performance pitfalls

- **Use typed arrays only:**
  - no `[x][y]` nested arrays
  - no BigInt
  - no regex or strings on hot paths
  - no `Array.sort` with a comparator, closures, spread or `Array.from` inside the search
  - preallocate per-ply move and score buffers (`Int16Array(64*225)`)
- **Control flow.** Stop with a `stop` flag, not a thrown exception (gobang throws a Symbol on timeout). Use `| 0` integer arithmetic. Keep scores within Int32.
- **Budget by time, never by depth.**
  - **Lockdown Mode turns off the JIT (roughly 10× slower JavaScript) and WebAssembly.** Low Power Mode also slows the CPU.
  - A depth-based budget would freeze; a time-based one just plays weaker.
- **Messages.** Send no per-node or per-depth messages; one reply per request.
- **iPhone speed is unmeasured.** Add a `?bench` debug hook, reusing pumal's `js/debug.js` pattern, that runs the 3 fixed middle-game positions and shows nodes/s and depth reached. Then set the hard budget so iPhone 12 reaches depth 6 or more. My estimate, unverified: the same order of magnitude as the Node numbers.

---

## 10. Other pitfalls

- **Horizon effect and false mates.** Pruning in quiet nodes can make a line look like a forced win. The guards are:
  - never prune defending nodes
  - single forced reply to a four
  - extend after a four
  - trust "mate" scores only from forced sequences
  - and when everything looks lost, still pick the longest resistance or the best legal move.
- **Forbidden cells inside search.** Always use the shared `legal()`, for both sides. Make a parity test (engine flags versus `rules.isForbidden`) part of CI.
- **When our only block is forbidden, we have lost.** The engine must still return a *legal* move. The prototype initially returned the illegal block; that is now fixed and tested.
- **First-player advantage.** In AI-vs-AI testing, black won 9 of 10 games at 1000 ms vs 150 ms. Measure strength with tactics suites and paired openings, not raw win rate.
- **3-3 traps confuse humans.** The AI will deliberately leave the human a block they cannot play. With no hints on screen, the UI should at least say why a tap was refused, e.g. a shake plus a "쌍삼 금지" toast. That decision belongs to UI/rules.

---

## 11. AI unit tests (`tests/ai.test.js`, `node --test`)

Build positions from ASCII helpers, run each tactical case in **all 8 rotations and mirrors**, and use fixed seeds.

| # | Test | Expected |
|---|---|---|
| 1 | Table classification | `.XXXX.`→F4; `OXXXX.`→B4; `XXX.X` gap→F5; `..XXX..` and `.XX.X.`→F3; `OXXX..`→B3, not F3 |
| 2 | Overline | `XXXX.X`, the gap is **not** five when `overlineWins=false`, and is five when `true` |
| 3 | 3-3 detection | A cross 3-3 is FORBID. A split 3-3 is FORBID. 4-3 and 4-4 are legal. 3-3 that also makes five is legal. A 3-3 where one three is blocked is legal. |
| 4 | Parity fuzz | 300 random positions: engine `flags & FORBID` equals `rules.isForbidden` for every empty cell |
| 5 | Incremental consistency | 2000 random put/undo steps: incremental `pat`, `flags`, `tot` and hash equal a full recompute |
| 6 | Win in 1 | Plays one of the five cells (both ends allowed) |
| 7 | Prefers its own five over blocking | `reason === 'win'` |
| 8 | Blocks a four, including a split four `OO.OO` | `reason === 'block'` |
| 9 | Opponent has an open four | Returns a legal move with `reason` `lost`, no exception |
| 10 | Our only block is 3-3 for us | Returns a **legal** move, `reason: 'lost'` |
| 11 | Blocks an open three (hard and normal) | Afterwards `cntOpen4[opp] === 0`, or the AI played a four that leads to VCF |
| 12 | Finds a VCF at depths 3, 5 and 7 | `reason: 'vcf'`, first move in the expected set, under 100 ms |
| 13 | Exploit | The human's only block is 3-3 for them, so the AI plays the four with `reason: 'vcf'` |
| 14 | Defends the opponent's VCF | Precondition: opponent VCF true, AI VCF false. After the AI's move, opponent `vcf(12)` is false. |
| 15 | Never forbidden or occupied | 200 random positions × 3 levels: `legal(move)` is always true |
| 16 | Timing | Hard returns within `timeMs + 150` ms; easy (no UI delay) under 100 ms |
| 17 | Determinism | Same moves and same seed give the same move |
| 18 | Easy blunder rates over 400 seeds | Blocks fours 0.80–0.97; stops open threes 0.35–0.65 |
| 19 | Full board or no legal move | Returns `move: -1, reason: 'draw'` |
| 20 | Self-play smoke test | One hard-vs-normal game completes with no illegal moves (the harness checks legality) |
| 21 | Worker protocol (in Node, call `onmessage` with a fake `self`) | `init` → `ready`, `think` → a `move` with the same id |

The prototype's `check.mjs` already covers 1–3, 6, 8, 10, 12–14 and 18. All pass.

---

## 12. Files and line budget

| File | Lines (est.) | Contents |
|---|---|---|
| `js/rules.js` | ~170 | constants, `buildTable`, `Board` (put, undo, flags, legal, win), Zobrist |
| `js/ai/engine.js` | ~330 | gen, evaluate, vcf, ab, think, LEVELS, opening moves, `createEngine` |
| `js/ai/worker.js` | ~15 | message handler |
| `js/ai-client.js` | ~60 | spawn, fallback, cancel, dispose, visibility handling |
| `tests/ai.test.js` | ~250 | section 11 |
| `tools/selfplay.mjs` | ~40 | paired-opening matches for tuning (dev only, not precached) |

The prototype `board.js` and `ai.js` can be moved into these files almost unchanged. Rename them, add `createEngine({size, overlineWins})` that takes `{moves, level, seed, timeMs}`, and switch to the seeded RNG.

---

Sources:
- [lihongxun945/gobang](https://github.com/lihongxun945/gobang) (cloned and read: `src/ai/eval.js`, `shape.js`, `minmax.js`, `candidate/minmax.js`, `config.js`, `zobrist.js`)
- [dhbloo/rapfi](https://github.com/dhbloo/rapfi)
- [rdragon/gomoku-ai](https://github.com/rdragon/gomoku-ai)
- [caniuse: Worker `type` option (module workers)](https://caniuse.com/mdn-api_worker_worker_options_type_parameter)
- [WebKit bug 164860 (module workers)](https://bugs.webkit.org/show_bug.cgi?id=164860)
- [Safari 15 module workers write-up](https://itnext.io/safari-webkit-just-released-support-for-js-modules-inside-the-worker-scope-b2d29e67178)
- [GitHub community discussion #13309 (no COOP/COEP on Pages)](https://github.com/orgs/community/discussions/13309)
- [web.dev cross-origin isolation guide](https://web.dev/cross-origin-isolation-guide/)
- [Schneier on Lockdown Mode](https://www.schneier.com/blog/archives/2022/07/apples-lockdown-mode-2.html)
- [Access Now: Lockdown Mode constraints](https://communitydocs.accessnow.org/433-Apple_lockdown_mode.html)
- [Namu Wiki: 렌주 (general rules vs Renju, 장목)](https://namu.moe/w/%EB%A0%8C%EC%A3%BC)