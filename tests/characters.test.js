// tests/characters.test.js — contract lints for the 8 fighters (docs/SPEC.md §6, §8.5, §8.6).
// node --test tests/characters.test.js
//
// Data checks import each js/chars/<id>.js on its own (so one broken/missing character doesn't hide the
// others); SVG and CSS checks are string-level parses of the svg/fx strings and css/chars/<id>.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rel = p => join(ROOT, p);

// ---------------------------------------------------------------------------------- contract lists
// SPEC §6 (order = selection grid order)
const ROSTER = [
  ['bulttong', '불똥'], ['nyangja', '냥자'], ['bigom', '비곰'], ['beonjjeok', '번쩍'],
  ['jaepjaep', '잽잽'], ['ppibik', '삐빅'], ['kkakkung', '까꿍'], ['taenggeul', '탱글'],
];
const IDS = ROSTER.map(r => r[0]);
// SPEC §8.4 — character cue sound effects (this list only)
const CHAR_SFX = ['WHOOSH', 'SWISH', 'SCRATCH', 'POP', 'TING', 'BOING', 'PUNCH', 'CLUNK', 'ZAP', 'BELL', 'BLIP',
  'SNIFF', 'COUGH', 'GIGGLE', 'HUP', 'WHIRR', 'SPLAT', 'CRACKLE'];
// characters.md §6 — particle presets (js/particles.js FX)
const FX_NAMES = ['sparkle', 'firework', 'smoke', 'petals', 'bolts', 'confetti', 'hearts', 'wisps', 'jelly', 'dust', 'sweat'];
// SPEC §8.4 — jingle format
const WAVES = ['square', 'triangle', 'sine', 'sawtooth', 'pulse25'];
const DRUMS = ['K', 'S', 'H', 'BELL', ...CHAR_SFX];
const NOTE = '[A-G](?:#|b)?[0-8]';
const NOTE_TOKEN = new RegExp(`^(?:-|${NOTE}(?:>${NOTE}|~|\\^)*):(\\d+(?:\\.\\d+)?)$`);
const DRUM_TOKEN = new RegExp(`^(?:-|${DRUMS.join('|')}):(\\d+(?:\\.\\d+)?)$`);
const RM_SEL = /\[data-motion=(["']?)reduce\1\]/;
const STATES = ['idle', 'turn', 'attack', 'hit', 'win', 'lose'];
const CUE_KEYS = ['t', 'sfx', 'fx', 'at', 'shake', 'flash'];
const ANCHOR_KEYS = ['head', 'center', 'feet', 'sky'];
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const len = s => [...s].length;   // characters, not UTF-16 units

// ---------------------------------------------------------------------------------- tiny XML parser
function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const errors = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('<!--')) continue;
    const [, close, name, attrSrc, selfClose] = m;
    if (close) {
      if (cur.name !== name) errors.push(`</${name}> closes <${cur.name}>`);
      else cur = cur.parent;
      continue;
    }
    const attrs = {};
    const dup = [];
    for (const a of attrSrc.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
      if (a[1] in attrs) dup.push(a[1]);
      attrs[a[1]] = a[2] ?? a[3] ?? '';
    }
    if (dup.length) errors.push(`<${name}> duplicate attribute ${dup.join(',')}`);
    const node = { name, attrs, children: [], parent: cur, classes: (attrs.class || '').split(/\s+/).filter(Boolean) };
    cur.children.push(node);
    if (!selfClose) cur = node;
  }
  if (cur !== root) errors.push(`unclosed <${cur.name}>`);
  return { root, errors };
}
function* walk(node) {
  for (const c of node.children) { yield c; yield* walk(c); }
}

// ---------------------------------------------------------------------------------- tiny CSS parser
function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }
function matchBrace(s, open) {   // index of the } matching s[open] === '{'
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}
function parseDecls(body) {
  const out = [];
  for (const part of splitTop(body, ';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    out.push({ prop: part.slice(0, i).trim().toLowerCase(), value: part.slice(i + 1).trim() });
  }
  return out;
}
// → { rules:[{selectors:[...], decls, media}], keyframes:[{name, frames:[{sel, decls}]}], errors }
function parseCss(src) {
  const css = stripComments(src);
  const rules = [], keyframes = [], errors = [];
  (function block(s, media) {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) { if (s.slice(i).trim()) errors.push(`trailing text: ${s.slice(i).trim().slice(0, 40)}`); break; }
      const head = s.slice(i, open).trim();
      const close = matchBrace(s, open);
      if (close < 0) { errors.push(`unbalanced braces after "${head.slice(0, 40)}"`); break; }
      const body = s.slice(open + 1, close);
      if (/^@(-webkit-)?keyframes\b/.test(head)) {
        const name = head.replace(/^@(-webkit-)?keyframes\s+/, '').trim();
        const frames = [];
        let j = 0;
        while (j < body.length) {
          const o = body.indexOf('{', j);
          if (o < 0) break;
          const c = matchBrace(body, o);
          frames.push({ sel: body.slice(j, o).trim(), decls: parseDecls(body.slice(o + 1, c)) });
          j = c + 1;
        }
        keyframes.push({ name, frames });
      } else if (head.startsWith('@media') || head.startsWith('@supports')) {
        block(body, head);
      } else if (head.startsWith('@')) {
        errors.push(`unexpected at-rule ${head.slice(0, 30)}`);
      } else {
        rules.push({ selectors: splitTop(head, ',').map(x => x.trim()).filter(Boolean), decls: parseDecls(body), media });
      }
      i = close + 1;
    }
  })(css, null);
  return { rules, keyframes, errors };
}
function splitTop(s, sep) {     // split on sep outside (), [] and quotes
  const out = [];
  let depth = 0, quote = null, start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === sep && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}
function topFunctions(value) {  // 'translate(calc(1%*2), 0) rotate(3deg)' → ['translate','rotate']
  const names = [];
  let depth = 0;
  const re = /([a-zA-Z-]+)\(|\(|\)/g;
  let m;
  while ((m = re.exec(value))) {
    if (m[0] === ')') depth--;
    else { if (depth === 0 && m[1]) names.push(m[1]); depth++; }
  }
  return names.length ? names : [value.trim()];
}
const TIME = /^(-?\d*\.?\d+)(m?s)$/;
const toSec = t => { const m = TIME.exec(t); return m[2] === 'ms' ? +m[1] / 1000 : +m[1]; };
const ANIM_KEYWORDS = new Set(['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'step-start', 'step-end',
  'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'none', 'forwards', 'backwards', 'both',
  'running', 'paused', 'initial', 'inherit', 'unset', 'revert']);
// one entry of the `animation` shorthand → {name, duration, delay, iterations}
function parseAnimation(entry) {
  const tokens = [];
  let depth = 0, cur = '';
  for (const ch of entry.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) tokens.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) tokens.push(cur);
  const times = [];
  let name = null, iterations = 1;
  for (const t of tokens) {
    if (TIME.test(t)) times.push(toSec(t));
    else if (t === 'infinite') iterations = Infinity;
    else if (/^\d*\.?\d+$/.test(t)) iterations = +t;
    else if (ANIM_KEYWORDS.has(t) || /^(cubic-bezier|steps|linear)\(/.test(t) || t === '!important') continue;
    else name = t;
  }
  return { name, duration: times[0] ?? 0, delay: times[1] ?? 0, iterations };
}
function animationsOf(decls) {
  let out = [];
  const longhand = {};
  for (const d of decls) {
    const v = d.value.replace(/!important/, '').trim();
    if (d.prop === 'animation') out = splitTop(v, ',').map(parseAnimation);
    else if (d.prop.startsWith('animation-')) longhand[d.prop.slice(10)] = splitTop(v, ',').map(x => x.trim());
  }
  if (longhand.name) out = longhand.name.map(name => ({ name, duration: 0, delay: 0, iterations: 1 }));
  out.forEach((a, i) => {
    const pick = list => list[i % list.length];
    if (longhand.duration) a.duration = TIME.test(pick(longhand.duration)) ? toSec(pick(longhand.duration)) : 0;
    if (longhand.delay) a.delay = TIME.test(pick(longhand.delay)) ? toSec(pick(longhand.delay)) : 0;
    if (longhand['iteration-count']) { const c = pick(longhand['iteration-count']); a.iterations = c === 'infinite' ? Infinity : +c; }
  });
  return out.filter(a => a.name && a.name !== 'none');
}
// classes of the last compound selector: '.stage[x] .fx-dizzy .star:nth-child(2)' → ['star']
function targetClasses(sel) {
  const last = sel.replace(/\[[^\]]*\]/g, '').replace(/::?[\w-]+(\([^)]*\))?/g, '').trim().split(/[\s>+~]+/).pop() || '';
  return [...last.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
}

// ---------------------------------------------------------------------------------- loading
const shared = parseCss(readFileSync(rel('css/fighters.css'), 'utf8'));
const sharedKeyframes = new Set(shared.keyframes.map(k => k.name));

const loaded = new Map();   // id → { data?, error?, cssSrc? }
for (const id of IDS) {
  const entry = {};
  const jsPath = rel(`js/chars/${id}.js`);
  if (!existsSync(jsPath)) entry.error = `missing js/chars/${id}.js`;
  else {
    try { entry.data = (await import(pathToFileURL(jsPath).href)).default; }
    catch (e) { entry.error = `js/chars/${id}.js failed to import: ${e.message}`; }
  }
  const cssPath = rel(`css/chars/${id}.css`);
  entry.cssSrc = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : null;
  loaded.set(id, entry);
}
function need(id) {
  const e = loaded.get(id);
  assert.ok(!e.error, e.error);
  assert.ok(e.data && typeof e.data === 'object', `js/chars/${id}.js must default-export an object`);
  return e.data;
}
function needCss(id) {
  const src = loaded.get(id).cssSrc;
  assert.ok(src !== null, `missing css/chars/${id}.css`);
  return src;
}

// ---------------------------------------------------------------------------------- roster
test('roster: characters.js imports the 8 character modules in SPEC §6 order', () => {
  const src = readFileSync(rel('js/characters.js'), 'utf8');
  const imports = [...src.matchAll(/^import\s+(\w+)\s+from\s+'\.\/chars\/([\w-]+)\.js';/gm)].map(m => m[2]);
  assert.deepEqual(imports, IDS);
  const list = /CHARACTERS\s*=\s*Object\.freeze\(\[([^\]]*)\]\)/.exec(src);
  assert.ok(list, 'CHARACTERS array literal');
  assert.deepEqual(list[1].split(',').map(s => s.trim()).filter(Boolean), IDS);
});

test('roster: every character module is present and ids are unique and match file names', () => {
  const missing = IDS.filter(id => loaded.get(id).error);
  assert.deepEqual(missing, [], `not loadable: ${missing.map(id => loaded.get(id).error).join('; ')}`);
  const ids = IDS.map(id => loaded.get(id).data.id);
  assert.deepEqual(ids, IDS);
  assert.equal(new Set(ids).size, 8);
});

test('roster: CHARACTERS / CHARACTER_IDS / getCharacter (when all 8 exist)', async t => {
  if (IDS.some(id => loaded.get(id).error)) { t.skip('not all character modules exist yet'); return; }
  const m = await import(pathToFileURL(rel('js/characters.js')).href);
  assert.equal(m.CHARACTERS.length, 8);
  assert.deepEqual([...m.CHARACTER_IDS], IDS);
  for (const id of IDS) assert.equal(m.getCharacter(id).id, id);
  assert.equal(m.getCharacter('nope'), null);
  const colors = m.CHARACTERS.map(c => c.color.toUpperCase());
  assert.equal(new Set(colors).size, 8, 'each character needs its own UI colour');
});

test('particles.js provides every FX preset name the lints allow', async () => {
  const { FX } = await import(pathToFileURL(rel('js/particles.js')).href);
  for (const n of FX_NAMES) assert.ok(FX[n], `FX.${n}`);
});

test('audio.js agrees: CHAR_SFX list, and every jingle parses with length ≤ 1600 ms (when audio.js exists)', async t => {
  let m;
  try { m = await import(pathToFileURL(rel('js/audio.js')).href); }
  catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' || /is not defined/.test(e.message)) { t.skip(`audio.js not importable (${e.message.split('\n')[0]})`); return; }
    throw e;
  }
  assert.deepEqual([...m.CHAR_SFX].sort(), [...CHAR_SFX].sort());
  for (const id of IDS) {
    const c = loaded.get(id).data;
    if (!c) continue;
    if (typeof m.parseJingle === 'function') assert.doesNotThrow(() => m.parseJingle(c.jingle), `${id}: audio.parseJingle`);
    if (typeof m.jingleLength === 'function') assert.ok(m.jingleLength(c.jingle) <= 1600, `${id}: audio.jingleLength ${m.jingleLength(c.jingle)}`);
    if (typeof m.hasSound === 'function') {
      for (const q of c.cues) if (q.sfx) assert.ok(m.hasSound(q.sfx), `${id}: audio has no sound "${q.sfx}"`);
      if (c.turnSfx) assert.ok(m.hasSound(c.turnSfx), `${id}: audio has no sound "${c.turnSfx}"`);
    }
  }
});

// ---------------------------------------------------------------------------------- per character
for (const [id, ko] of ROSTER) {
  test(`${id}: data fields`, () => {
    const c = need(id);
    assert.equal(c.id, id);
    assert.equal(c.ko, ko, `ko must be "${ko}" (SPEC §6)`);
    assert.match(c.ko, /^[가-힣]{2,3}$/, 'ko: 2–3 Hangul syllables');
    assert.match(c.en, /^[A-Z][A-Za-z' -]{1,15}$/, 'en: short romanized name');
    assert.ok(typeof c.tagline === 'string' && len(c.tagline) >= 2 && len(c.tagline) <= 12, `tagline ≤ 12 chars (${c.tagline})`);
    assert.ok(typeof c.type === 'string' && len(c.type) >= 1 && len(c.type) <= 4, `type ≤ 4 chars (${c.type})`);
    assert.match(c.color, HEX, 'color');
    assert.match(c.colorAlt, HEX, 'colorAlt');
    assert.ok(Array.isArray(c.bg) && c.bg.length === 2, 'bg: two colours');
    for (const b of c.bg) assert.match(b, HEX, 'bg');
    assert.equal(c.winMs, 2400);
    assert.ok(typeof c.hitAt === 'number' && c.hitAt > 0 && c.hitAt < 2.4, 'hitAt in (0, 2.4)');
    assert.ok(typeof c.excerptFrom === 'number' && c.excerptFrom >= 0 && c.excerptFrom < c.hitAt, 'excerptFrom < hitAt');
    assert.ok(c.hitAt - c.excerptFrom <= 0.8, 'excerptFrom ≈ hitAt − 0.3 (no more than 0.8 s before HIT)');
    assert.ok(c.quote && typeof c.quote === 'object', 'quote');
    assert.ok(typeof c.quote.win === 'string' && len(c.quote.win) >= 2 && len(c.quote.win) <= 22, `quote.win ≤ 22 chars (${c.quote.win}: ${len(c.quote.win || '')})`);
    assert.ok(typeof c.quote.winEn === 'string' && c.quote.winEn.length >= 2, 'quote.winEn');
    assert.ok(typeof c.quote.lose === 'string' && len(c.quote.lose) >= 2 && len(c.quote.lose) <= 30, 'quote.lose');
    assert.ok(c.anchors && typeof c.anchors === 'object', 'anchors');
    for (const k of ANCHOR_KEYS) {
      const a = c.anchors[k];
      assert.ok(Array.isArray(a) && a.length === 2 && a.every(v => typeof v === 'number' && v >= -60 && v <= 180), `anchors.${k} = [vx, vy]`);
    }
    if (c.turnSfx !== undefined) assert.ok(CHAR_SFX.includes(c.turnSfx), `turnSfx ${c.turnSfx} not in CHAR_SFX`);
    const pv = String(c.portrait).trim().split(/[\s,]+/).map(Number);
    assert.ok(pv.length === 4 && pv.every(Number.isFinite), `portrait viewBox "${c.portrait}"`);
    assert.ok(pv[2] > 20 && Math.abs(pv[2] - pv[3]) < 0.01, 'portrait crop must be square (it is shown in square boxes)');
    assert.ok(pv[0] >= -20 && pv[1] >= -30 && pv[0] + pv[2] <= 140 && pv[1] + pv[3] <= 140, 'portrait crop inside the art');
    const allowed = new Set(['id', 'ko', 'en', 'tagline', 'type', 'color', 'colorAlt', 'bg', 'winMs', 'hitAt', 'excerptFrom',
      'quote', 'anchors', 'cues', 'turnSfx', 'jingle', 'portrait', 'svg', 'fx']);
    const extra = Object.keys(c).filter(k => !allowed.has(k));
    assert.deepEqual(extra, [], 'unknown top-level fields (SPEC §8.5)');
  });

  test(`${id}: cues`, () => {
    const c = need(id);
    assert.ok(Array.isArray(c.cues) && c.cues.length >= 1, 'cues[]');
    let prev = -1;
    for (const q of c.cues) {
      const where = JSON.stringify(q);
      assert.deepEqual(Object.keys(q).filter(k => !CUE_KEYS.includes(k)), [], `cue keys ${where}`);
      assert.ok(typeof q.t === 'number' && q.t >= 0 && q.t <= 2.4, `cue t in 0..2.4 ${where}`);
      assert.ok(q.t >= prev, `cues sorted by t ${where}`);
      prev = q.t;
      assert.ok(q.sfx || q.fx || q.shake || q.flash, `cue does something ${where}`);
      if (q.sfx !== undefined) assert.ok(CHAR_SFX.includes(q.sfx), `sfx ${q.sfx} not in CHAR_SFX`);
      if (q.fx !== undefined) assert.ok(FX_NAMES.includes(q.fx), `fx ${q.fx} not a particles FX preset`);
      if (q.at !== undefined) {
        assert.ok(q.fx, `"at" only makes sense with fx ${where}`);
        const ok = (typeof q.at === 'string' && c.anchors[q.at]) ||
          (Array.isArray(q.at) && q.at.length === 2 && q.at.every(v => typeof v === 'number' && v >= -60 && v <= 180));
        assert.ok(ok, `at must be an anchors key or [vx, vy] ${where}`);
      }
      if (q.shake !== undefined) assert.ok(typeof q.shake === 'number' && q.shake > 0 && q.shake <= 400, `shake ms ${where}`);
      if (q.flash !== undefined) assert.equal(q.flash, true, `flash: true ${where}`);
    }
  });

  test(`${id}: jingle`, () => {
    const c = need(id);
    const j = c.jingle;
    assert.ok(j && typeof j === 'object', 'jingle');
    assert.ok(typeof j.at === 'number' && j.at >= 0 && j.at <= 2.4, 'jingle.at in 0..2.4');
    assert.ok(Array.isArray(j.voices) && j.voices.length >= 1 && j.voices.length <= 4, '1–4 voices');
    let longest = 0;
    for (const v of j.voices) {
      const isNotes = typeof v.notes === 'string', isDrums = typeof v.drums === 'string';
      assert.ok(isNotes !== isDrums, `a voice has exactly one of notes/drums: ${JSON.stringify(v)}`);
      if (v.gain !== undefined) assert.ok(typeof v.gain === 'number' && v.gain > 0 && v.gain <= 0.2, `gain ${v.gain}`);
      if (v.lowpass !== undefined) assert.ok(typeof v.lowpass === 'number' && v.lowpass >= 200 && v.lowpass <= 20000, `lowpass ${v.lowpass}`);
      const tokens = (isNotes ? v.notes : v.drums).trim().split(/\s+/);
      let ms = 0;
      for (const tok of tokens) {
        const m = (isNotes ? NOTE_TOKEN : DRUM_TOKEN).exec(tok);
        assert.ok(m, `bad ${isNotes ? 'note' : 'drum'} token "${tok}"`);
        ms += +m[1];
      }
      if (isNotes) assert.ok(WAVES.includes(v.wave), `wave ${v.wave}`);
      longest = Math.max(longest, ms);
    }
    assert.ok(longest > 0 && longest <= 1600, `jingle length ${longest} ms (≤ 1600)`);
  });

  test(`${id}: svg + fx markup lint`, () => {
    const c = need(id);
    assert.ok(typeof c.svg === 'string' && typeof c.fx === 'string', 'svg and fx strings');
    assert.match(c.svg.trim(), new RegExp(`^<svg class="ch ch-${id}" viewBox="0 0 120 120" role="img" aria-label="${c.ko}"`), 'svg root');
    assert.match(c.fx.trim(), /^<svg class="fx" viewBox="0 0 120 120" aria-hidden="true"/, 'fx root');
    for (const [label, src] of [['svg', c.svg], ['fx', c.fx]]) {
      for (const bad of [/\sid\s*=/, /<filter/i, /<linearGradient/i, /<radialGradient/i, /<mask/i, /<clipPath/i,
        /<script/i, /<style/i, /<image/i, /<foreignObject/i, /\son\w+\s*=/i, /href\s*=/i, /url\(/i]) {
        assert.doesNotMatch(src, bad, `${label}: forbidden ${bad}`);
      }
      const { root, errors } = parseXml(src.trim());
      assert.deepEqual(errors, [], `${label}: well-formed`);
      assert.equal(root.children.length, 1, `${label}: one root <svg>`);
      const parts = [];
      for (const n of walk(root)) {
        if (!n.classes.includes('p')) continue;
        parts.push(n.classes.filter(k => k !== 'p').join('.'));
        const where = `${label} <${n.name} class="${n.attrs.class}">`;
        assert.equal(n.name, 'g', `${where}: a part must be a <g>`);
        assert.ok(!('transform' in n.attrs), `${where}: an animated part must not have a transform attribute`);
        const p = n.parent;
        assert.ok(p.name === 'g' && /^\s*translate\(\s*-?[\d.]+(?:[\s,]+-?[\d.]+)?\s*\)\s*$/.test(p.attrs.transform || ''),
          `${where}: parent must be <g transform="translate(jx jy)"> (joint sandwich)`);
      }
      if (label === 'svg') {
        assert.ok(parts.length >= 3, 'svg: at least 3 animated parts');
        assert.ok(parts.length <= 14, `svg: ≤ 14 animated parts (WebKit repaints SVG children in software): ${parts.length}`);
        for (const f of ['face-a', 'face-b', 'face-c']) {
          const n = [...walk(root)].filter(x => x.classes.includes(f)).length;
          assert.equal(n, 1, `svg: exactly one .${f}`);
        }
      } else {
        // every visible bit of the effect layer sits inside an fx-* element (hidden until a state shows it)
        const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'use']);
        for (const n of walk(root)) {
          if (!SHAPES.has(n.name)) continue;
          let a = n, ok = false;
          while (a && !ok) { ok = (a.classes || []).some(x => x.startsWith('fx-')); a = a.parent; }
          assert.ok(ok, `fx: <${n.name}${n.attrs.class ? ` class="${n.attrs.class}"` : ''}> must be inside an fx-* element`);
        }
        const dz = [...walk(root)].find(x => x.classes.includes('fx-dizzy'));
        if (dz) assert.equal(dz.children.filter(x => x.classes.includes('star')).length, 3, 'fx-dizzy holds 3 .star');
      }
    }
  });

  test(`${id}: css lint`, () => {
    const c = need(id);
    const src = needCss(id);
    const { rules, keyframes, errors } = parseCss(src);
    assert.deepEqual(errors, [], 'css parses');
    const flat = stripComments(src);
    assert.doesNotMatch(flat, /\blinear\(/, 'no linear() easing');
    assert.doesNotMatch(flat, /(^|[{;\s])(rotate|scale|translate)\s*:/, 'no individual rotate:/scale:/translate: properties');
    assert.doesNotMatch(flat, /prefers-reduced-motion/, 'reduced motion keys only off [data-motion="reduce"]');
    for (const bad of ['filter', 'backdrop-filter', '-webkit-backdrop-filter', 'mix-blend-mode', 'clip-path', 'mask', '-webkit-mask']) {
      for (const r of rules) for (const d of r.decls) assert.notEqual(d.prop, bad, `no ${bad} (${r.selectors[0]})`);
    }

    // keyframes: prefix, and one transform function list per @keyframes
    const own = new Set();
    const transformKf = new Set([...shared.keyframes.filter(k => k.frames.some(f => f.decls.some(d => d.prop === 'transform'))).map(k => k.name)]);
    for (const k of keyframes) {
      assert.ok(k.name.startsWith(`${id}-`), `@keyframes ${k.name} must start with "${id}-"`);
      assert.ok(!own.has(k.name), `duplicate @keyframes ${k.name}`);
      own.add(k.name);
      const seqs = new Set();
      for (const f of k.frames) for (const d of f.decls) {
        if (d.prop === 'transform') seqs.add(topFunctions(d.value).join(' '));
        assert.ok(!['rotate', 'scale', 'translate'].includes(d.prop), `${k.name}: individual ${d.prop}`);
      }
      assert.ok(seqs.size <= 1, `@keyframes ${k.name}: transform function lists differ: ${[...seqs].join(' | ')}`);
      if (seqs.size) transformKf.add(k.name);
    }

    // selectors: scoped to the character; only known states
    const scope = new RegExp(`\\.ch-${id}\\b|\\[data-char=(["']?)${id}\\1\\]`);
    for (const r of rules) for (const s of r.selectors) {
      assert.match(s, scope, `selector not scoped to ${id}: ${s}`);
      for (const m of s.matchAll(/\[data-state=(["']?)([\w-]+)\1\]/g)) assert.ok(STATES.includes(m[2]), `unknown state ${m[2]} in ${s}`);
    }

    // animations: names exist; animated rules are stage-state/fidget scoped; per-state durations
    const svgTree = parseXml(c.svg.trim()).root, fxTree = parseXml(c.fx.trim()).root;
    const nodes = [...walk(svgTree), ...walk(fxTree)];
    let winRig = null;
    for (const r of rules) {
      const list = animationsOf(r.decls);
      if (!list.length) continue;
      for (const a of list) assert.ok(own.has(a.name) || sharedKeyframes.has(a.name), `animation "${a.name}" is not defined (${r.selectors[0]})`);
      const rm = r.selectors.every(s => RM_SEL.test(s));
      for (const s of r.selectors) {
        if (!rm) assert.match(s, new RegExp(`\\.stage\\[data-char=(["']?)${id}\\1\\]`), `animated selector must be .stage[data-char="${id}"]…: ${s}`);
        // never animate (transform) an element that carries a transform="" attribute
        if (list.some(a => transformKf.has(a.name))) {
          const cls = targetClasses(s);
          if (cls.length) for (const n of nodes) {
            if (cls.every(k => n.classes.includes(k))) assert.ok(!('transform' in n.attrs), `"${s}" animates <${n.name} class="${n.attrs.class}"> which has a transform attribute`);
          }
        }
        const st = /\[data-state=(["']?)([\w-]+)\1\]/.exec(s)?.[2];
        const fidget = /\.fidget\b/.test(s);
        if (rm) continue;
        for (const a of list) {
          const end = a.delay + a.duration * a.iterations;
          if (st === 'win') {
            if (a.iterations === Infinity) assert.ok(a.delay >= 2.4 - 1e-9, `win loop "${a.name}" must start at animation-delay 2.4s: ${s}`);
            else assert.ok(end <= 2.4 + 1e-9, `win one-shot "${a.name}" must end by 2.4s (${end}s): ${s}`);
          }
          if (st === 'turn' && a.iterations !== Infinity) assert.ok(end <= 0.6 + 1e-9, `turn "${a.name}" must end by 0.6s (${end}s): ${s}`);
          if (st === 'lose' && a.iterations !== Infinity) assert.ok(end <= 1.0 + 1e-9, `lose one-shot "${a.name}" must end by 1.0s (${end}s): ${s}`);
          if (fidget) assert.ok(a.iterations !== Infinity && end <= 0.8 + 1e-9, `fidget "${a.name}" must be ≤ 0.8s once (${end}s): ${s}`);
        }
        if (st === 'win' && /\s\.rig$/.test(s.trim())) winRig = list;
      }
    }
    assert.ok(winRig, `needs .stage[data-char="${id}"][data-state="win"] .rig { animation: ${id}-win 2.4s … }`);
    const main = winRig.find(a => a.name === `${id}-win`);
    assert.ok(main, `the win .rig animation must be named ${id}-win (the director reads its clock)`);
    assert.ok(Math.abs(main.duration - 2.4) < 1e-9 && main.delay === 0 && main.iterations === 1, `${id}-win is exactly 2.4s, no delay, once`);

    // required states + reduced-motion pose + alt palette
    const has = re => rules.some(r => r.selectors.some(s => re.test(s)));
    assert.ok(has(new RegExp(`\\[data-state=(["']?)turn\\1\\]`)), 'turn state');
    assert.ok(has(new RegExp(`\\[data-state=(["']?)lose\\1\\]`)), 'lose state');
    assert.ok(has(/\.fidget\b/), '.fidget flourish');
    assert.ok(rules.some(r => r.selectors.some(s => RM_SEL.test(s) && /\[data-state=(["']?)win\1\]/.test(s))), 'reduced-motion victory pose');
    assert.ok(has(new RegExp(`\\.alt\\s+\\.ch-${id}\\b`)), `alt palette: .alt .ch-${id} { … }`);
  });
}

// ---------------------------------------------------------------------------------- shared rig
test('css/fighters.css: shared rig lint', () => {
  assert.deepEqual(shared.errors, []);
  const flat = stripComments(readFileSync(rel('css/fighters.css'), 'utf8'));
  assert.doesNotMatch(flat, /\blinear\(/);
  assert.doesNotMatch(flat, /(^|[{;\s])(rotate|scale|translate)\s*:/);
  for (const k of shared.keyframes) {
    assert.ok(k.name.startsWith('fighter-'), `@keyframes ${k.name} must start with "fighter-"`);
    const seqs = new Set();
    for (const f of k.frames) for (const d of f.decls) if (d.prop === 'transform') seqs.add(topFunctions(d.value).join(' '));
    assert.ok(seqs.size <= 1, `@keyframes ${k.name}: ${[...seqs].join(' | ')}`);
  }
  for (const r of shared.rules) for (const a of animationsOf(r.decls)) assert.ok(sharedKeyframes.has(a.name), `undefined animation ${a.name}`);
});

test('linter self-check', () => {
  assert.deepEqual(topFunctions('translate(calc(var(--dir, 1) * 14%), -4%) rotate(calc(var(--dir,1) * 8deg)) scale(1.08, .94)'), ['translate', 'rotate', 'scale']);
  assert.deepEqual(parseAnimation('bigom-loop 1.26s 2.4s ease-in-out infinite'), { name: 'bigom-loop', duration: 1.26, delay: 2.4, iterations: Infinity });
  assert.deepEqual(parseAnimation('x-win 2.4s cubic-bezier(.5, 0, 1, 1) both'), { name: 'x-win', duration: 2.4, delay: 0, iterations: 1 });
  assert.deepEqual(animationsOf(parseDecls('animation-name: a-x, a-y; animation-duration: 2.4s; animation-delay: 0s, 2.4s; animation-iteration-count: 1, infinite')),
    [{ name: 'a-x', duration: 2.4, delay: 0, iterations: 1 }, { name: 'a-y', duration: 2.4, delay: 2.4, iterations: Infinity }]);
  assert.deepEqual(animationsOf(parseDecls('animation: a-x .6s both; animation-delay: .1s')), [{ name: 'a-x', duration: 0.6, delay: 0.1, iterations: 1 }]);
  assert.deepEqual(targetClasses('.stage[data-state="lose"] .fx-dizzy .star:nth-child(2)'), ['star']);
  assert.ok(NOTE_TOKEN.test('A4>C5:180') && NOTE_TOKEN.test('G5~:420') && NOTE_TOKEN.test('C5^:110') && NOTE_TOKEN.test('-:50') && NOTE_TOKEN.test('Eb3:158'));
  assert.ok(!NOTE_TOKEN.test('H4:100') && !NOTE_TOKEN.test('C9:10') && !NOTE_TOKEN.test('C4'));
  assert.ok(DRUM_TOKEN.test('BELL:160') && DRUM_TOKEN.test('K:79') && !DRUM_TOKEN.test('X:10'));
  const { errors } = parseXml('<svg><g transform="translate(1 2)"><g class="p a"><path d="M0 0"/></g></g></svg>');
  assert.deepEqual(errors, []);
  assert.notDeepEqual(parseXml('<svg><g></svg>').errors, []);
});

// ---------------------------------------------------------------------------------- fighter.js static markup
test('fighter.js / characters.js / particles.js parse as ES modules', () => {
  for (const f of ['js/fighter.js', 'js/characters.js', 'js/particles.js']) execFileSync(process.execPath, ['--check', rel(f)]);
});

test('fighter.js: portraitHTML / figureHTML are static, cropped, alt-aware (when all modules exist)', async t => {
  let m;
  try { m = await import(pathToFileURL(rel('js/fighter.js')).href); }
  catch (e) {
    // other owners' modules (audio.js, the 8 characters) may still be missing or browser-only
    if (e.code === 'ERR_MODULE_NOT_FOUND' || /is not defined/.test(e.message)) { t.skip(`fighter.js not importable yet (${e.message.split('\n')[0]})`); return; }
    throw e;
  }
  for (const [id] of ROSTER) {
    const c = loaded.get(id).data;
    const p = m.portraitHTML(id), f = m.figureHTML(id, { alt: true });
    assert.match(p, new RegExp(`^<div class="fig fig-portrait" data-id="${id}"><svg class="ch ch-${id}" viewBox="${c.portrait}"`));
    assert.match(f, new RegExp(`^<div class="fig fig-full alt" data-id="${id}"><svg class="ch ch-${id}" viewBox="0 0 120 120"`));
    for (const s of [p, f]) assert.doesNotMatch(s, /data-state|data-char|class="stage/);
  }
  assert.equal(typeof m.createFighter, 'function');
});
