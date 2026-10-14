// js/characters.js — the roster (docs/SPEC.md §6, §8.6).
// Pure data aggregation: every character lives in js/chars/<id>.js (art + timeline data) and
// css/chars/<id>.css (palette + motion). Order = SPEC §6 table order = selection-grid order.
import bulttong from './chars/bulttong.js';
import nyangja from './chars/nyangja.js';
import bigom from './chars/bigom.js';
import beonjjeok from './chars/beonjjeok.js';
import jaepjaep from './chars/jaepjaep.js';
import ppibik from './chars/ppibik.js';
import kkakkung from './chars/kkakkung.js';
import taenggeul from './chars/taenggeul.js';

export const CHARACTERS = Object.freeze([bulttong, nyangja, bigom, beonjjeok, jaepjaep, ppibik, kkakkung, taenggeul]);
export const CHARACTER_IDS = Object.freeze(CHARACTERS.map(c => c.id));

const BY_ID = new Map(CHARACTERS.map(c => [c.id, c]));

// → the character object, or null for an unknown id (callers decide how to recover).
export function getCharacter(id) {
  return BY_ID.get(id) || null;
}
