// worker.js — module Worker around engine.js (SPEC §8.2). Stateless protocol: every request
// carries the full move list, so undo / new game need no messages of their own.
//
//   main → worker  { t:'init', rules:{ overlineWins } }   → { t:'ready' }
//                  { t:'think', id, moves, level, seed, timeMs? } → { t:'move', id, move, reason, score, depth, nodes, ms }
//                  { t:'reset' }                          (new game: clear the transposition table)
//   worker → main  { t:'error', id, message }             (bad request or engine failure)
//
// One reply per request, no progress messages. A search cannot be interrupted from outside
// (the thread is busy), so the client cancels by terminate() and ignores stale ids.

import { createEngine } from './engine.js';

let engine = null;
let rules = { overlineWins: false };

// Handles one message; `post` sends the reply. Exported so tests can drive it without a Worker.
export function handle(m, post) {
  const id = m && typeof m === 'object' ? m.id : undefined;
  try {
    if (!m || typeof m !== 'object') throw new TypeError('message must be an object');
    if (m.t === 'init') {
      rules = { overlineWins: m.rules?.overlineWins === true };
      engine = createEngine(rules);                 // builds the pattern table (~20 ms)
      post({ t: 'ready' });
    } else if (m.t === 'reset') {
      engine?.reset();
    } else if (m.t === 'think') {
      engine ??= createEngine(rules);
      post({ t: 'move', id, ...engine.think(m) });
    } else {
      throw new TypeError(`unknown message type: ${String(m.t)}`);
    }
  } catch (e) {
    post({ t: 'error', id, message: String(e?.message ?? e) });
  }
}

// Wire up only inside a worker (no `window`). Importing this file on the main thread by
// mistake must not take over window.onmessage.
if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (e) => handle(e.data, (msg) => self.postMessage(msg));
}
