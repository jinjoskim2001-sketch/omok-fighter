// Entry point for `node --test tests/`. Node 26 resolves a directory argument as a module
// instead of searching it, so without this file that command fails before running anything.
// `node --test` (no argument) still discovers the *.test.js files by itself and skips this one.
// One line per test file in SPEC §7 (owners: core rules, core-engine, board, audio,
// fighter-infra, pwa-shell); tests/integration.test.js checks that none is missing.
import './rules.test.js';
import './match.test.js';
import './ai.test.js';
import './board.test.js';
import './audio.test.js';
import './characters.test.js';
import './install.test.js';
import './sw.test.js';
import './storage.test.js';
import './haptics.test.js';
import './integration.test.js';
