// Whole-product checks: the things no single module can test for itself (SPEC §7, §10, §11).
// - every relative import resolves, and names an export that exists (read statically: most
//   modules touch the DOM when they run, so nothing here imports them)
// - the service worker precaches exactly what the page can load, and nothing from tools/
// - the version constant is the same in sw.js and js/main.js
// - shipped files use relative URLs only and never reach for another host
// - no real franchise or character names anywhere (IP guard)
// - every Hangul syllable the app shows is in the self-hosted font subset
// - the page still honours the DOM contract of SPEC §7–8
//
// Shipped = index.html, manifest.webmanifest, sw.js, js/**, css/**, fonts/**, icons/**.
// tools/, tests/ and docs/ are development files: never precached, never loaded by the page.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel)) && fs.statSync(path.join(ROOT, rel)).isFile();
const posix = path.posix;

function walk(dir, skip = []) {
  const out = [];
  if (!fs.existsSync(path.join(ROOT, dir))) return out;
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (skip.includes(rel)) continue;
    if (entry.isDirectory()) out.push(...walk(rel, skip));
    else out.push(rel);
  }
  return out;
}

// Everything in the repository except git, the research notes (they quote the names the IP
// guard bans, as examples), the font source and the gitignored scratch folder.
const FILES = walk('.', ['.git', 'docs', 'node_modules', 'tools/dev', 'tools/src-fonts'])
  .filter((f) => !f.endsWith('.DS_Store'));
const TEXT_RE = /\.(js|mjs|html|css|webmanifest|md|py|sh|json|txt)$/;
const SHIPPED = FILES.filter((f) => f === 'index.html' || f === 'sw.js' || f === 'manifest.webmanifest' || /^(js|css|fonts|icons)\//.test(f));
const SHIPPED_TEXT = SHIPPED.filter((f) => /\.(js|html|css|webmanifest)$/.test(f));

// ---------------------------------------------------------------------------
// The module graph, read from the source text
// ---------------------------------------------------------------------------

// Whole-line comments are dropped first, so a commented-out import does not count. (Strings
// that contain "//" stay intact because only lines that start with a comment are removed.)
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

const SPEC = String.raw`['"]([^'"\n]+)['"]`;
const STATIC_IMPORT = new RegExp(String.raw`(?:^|[;\s])import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+[\w$]+)?\s*from\s*${SPEC}`, 'g');
const BARE_IMPORT = new RegExp(String.raw`(?:^|[;\s])import\s*${SPEC}`, 'g');
const RE_EXPORT = new RegExp(String.raw`(?:^|[;\s])export\s+(?:\{([^}]*)\}|\*(?:\s+as\s+[\w$]+)?)\s*from\s*${SPEC}`, 'g');
const DYNAMIC_IMPORT = new RegExp(String.raw`\bimport\(\s*${SPEC}\s*\)`, 'g');
const URL_META = new RegExp(String.raw`new\s+URL\(\s*${SPEC}\s*,\s*import\.meta\.url\s*\)`, 'g');

const names = (list) => (list || '')
  .split(',')
  .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
  .filter((s) => s && s !== 'default');

/** Every reference a module makes: { spec, names, wantsDefault, kind: 'module' | 'asset' }. */
function refsOf(source) {
  const src = code(source);
  const out = [];
  for (const m of src.matchAll(STATIC_IMPORT)) out.push({ spec: m[3], names: names(m[2]), wantsDefault: Boolean(m[1]), kind: 'module' });
  for (const m of src.matchAll(BARE_IMPORT)) out.push({ spec: m[1], names: [], wantsDefault: false, kind: 'module' });
  for (const m of src.matchAll(RE_EXPORT)) out.push({ spec: m[2], names: names(m[1]), wantsDefault: false, kind: 'module' });
  for (const m of src.matchAll(DYNAMIC_IMPORT)) out.push({ spec: m[1], names: [], wantsDefault: false, kind: 'module' });
  // new Worker(new URL('./ai/worker.js', import.meta.url)) and assets such as the gate's icon.
  for (const m of src.matchAll(URL_META)) out.push({ spec: m[1], names: [], wantsDefault: false, kind: /\.m?js$/.test(m[1].split('?')[0]) ? 'module' : 'asset' });
  return out;
}

/**
 * The names bound by one `const|let|var` statement starting at `i` (just after the keyword):
 * `A = 1, B = [2, 3], { c, d: e } = obj;` → A, B, c, e. Commas inside brackets, strings and
 * templates do not split declarators; the statement ends at `;` or at a line break that does
 * not continue it.
 */
function declaredNames(src, i) {
  const out = [];
  let expectName = true;
  let depth = 0;
  while (i < src.length) {
    const ch = src[i];
    if (expectName) {
      if (/\s/.test(ch)) { i += 1; continue; }
      const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 200));
      if (id) { out.push(id[0]); i += id[0].length; expectName = false; continue; }
      if (ch === '{' || ch === '[') {
        let d = 0, j = i;
        for (; j < src.length; j += 1) { if ('{['.includes(src[j])) d += 1; else if ('}]'.includes(src[j]) && --d === 0) break; }
        const body = src.slice(i + 1, j).replace(/=[^,}\]]*/g, '');
        for (const part of body.split(',')) { const k = part.split(':').pop().replace(/\.\.\./, '').trim(); if (/^[A-Za-z_$][\w$]*$/.test(k)) out.push(k); }
        i = j + 1; expectName = false; continue;
      }
      return out;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i += 1; i < src.length && src[i] !== ch; i += 1) if (src[i] === '\\') i += 1;
      i += 1; continue;
    }
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (depth === 0 && ch === ',') expectName = true;
    else if (depth === 0 && ch === ';') return out;
    else if (depth === 0 && ch === '\n') {
      const before = src.slice(0, i).trimEnd().slice(-1);
      const after = src.slice(i).trimStart()[0] || '';
      if (!/[,=+\-*/%&|^?:<>!(]/.test(before) && !/[,.?:+\-*/%&|^)\]}=<>]/.test(after)) return out;
    }
    i += 1;
  }
  return out;
}

/** The names a module exports, read from its source. */
function exportsOf(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const src = code(read(file));
  const out = new Set();
  for (const m of src.matchAll(/(?:^|[;\s])export\s+(?:async\s+)?(?:function\*?|class)\s+([\w$]+)/g)) out.add(m[1]);
  for (const m of src.matchAll(/(?:^|[;\s])export\s+(?:const|let|var)\b/g)) {
    for (const n of declaredNames(src, m.index + m[0].length)) out.add(n);
  }
  if (/(?:^|[;\s])export\s+default\b/.test(src)) out.add('default');
  for (const m of src.matchAll(/(?:^|[;\s])export\s*\{([^}]*)\}(?!\s*from)/g)) {
    for (const n of m[1].split(',')) { const parts = n.trim().split(/\s+as\s+/); const k = (parts[1] || parts[0]).trim(); if (k) out.add(k); }
  }
  for (const m of src.matchAll(new RegExp(String.raw`(?:^|[;\s])export\s*\{([^}]*)\}\s*from\s*${SPEC}`, 'g'))) {
    for (const n of m[1].split(',')) { const parts = n.trim().split(/\s+as\s+/); const k = (parts[1] || parts[0]).trim(); if (k) out.add(k); }
  }
  for (const m of src.matchAll(new RegExp(String.raw`(?:^|[;\s])export\s+\*\s+as\s+([\w$]+)\s+from\s*${SPEC}`, 'g'))) out.add(m[1]);
  for (const m of src.matchAll(new RegExp(String.raw`(?:^|[;\s])export\s+\*\s+from\s*${SPEC}`, 'g'))) {
    const target = posix.join(posix.dirname(file), m[1]);
    if (exists(target)) for (const n of exportsOf(target, seen)) if (n !== 'default') out.add(n);
  }
  return out;
}

const resolve = (from, spec) => posix.normalize(posix.join(posix.dirname(from), spec.split(/[?#]/)[0]));

/** The CSS files a stylesheet pulls in and the files its url() points at. */
function cssRefs(file) {
  const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of src.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)/g)) out.push(m[1]);
  for (const m of src.matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/g)) out.push(m[1]);
  return out
    .filter((u) => !/^(data:|#|[a-z][\w+.-]*:)/i.test(u))
    .map((u) => resolve(file, u));
}

/**
 * Everything index.html can make the browser fetch: its stylesheets (and what they reference),
 * icons, the manifest and the manifest's icons, preloads, and the module graph behind its
 * scripts — static imports, dynamic import('…'), and new URL('…', import.meta.url) (the AI
 * worker, the gate's icon). Returns a sorted array of repository-relative paths.
 */
function pageGraph() {
  const html = read('index.html');
  const needed = new Set();
  const missing = [];
  const add = (file, from) => {
    if (needed.has(file)) return false;
    if (!exists(file)) { missing.push(`${file} (from ${from})`); return false; }
    needed.add(file);
    return true;
  };
  for (const m of html.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g)) {
    const href = m[1];
    if (/^[a-z][\w+.-]*:/i.test(href)) continue;
    const file = href.split(/[?#]/)[0];
    if (add(file, 'index.html') && file.endsWith('.css')) {
      const queue = [file];
      while (queue.length) {
        const css = queue.pop();
        for (const ref of cssRefs(css)) if (add(ref, css) && ref.endsWith('.css')) queue.push(ref);
      }
    }
  }
  if (exists('manifest.webmanifest')) {
    for (const icon of JSON.parse(read('manifest.webmanifest')).icons || []) add(icon.src, 'manifest.webmanifest');
  }
  const queue = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  for (const s of queue) if (!exists(s)) missing.push(`${s} (from index.html)`);
  const seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !exists(file)) continue;
    seen.add(file);
    needed.add(file);
    for (const ref of refsOf(read(file))) {
      if (!ref.spec.startsWith('.')) continue;
      const target = resolve(file, ref.spec);
      if (ref.kind === 'module') {
        if (!exists(target)) missing.push(`${target} (from ${file})`);
        else queue.push(target);
      } else {
        add(target, file);
      }
    }
  }
  return { files: [...needed].sort(), missing: [...new Set(missing)].sort() };
}

function parsePrecache() {
  const sw = read('sw.js');
  const list = /const PRECACHE = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(list, 'sw.js has a PRECACHE list');
  return [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('every relative import resolves to a file and to exports that exist', () => {
  const sources = FILES.filter((f) => /^(js|tests)\/.*\.m?js$/.test(f) || f === 'sw.js');
  const problems = [];
  const cache = new Map();
  const exp = (file) => { if (!cache.has(file)) cache.set(file, exportsOf(file)); return cache.get(file); };
  for (const file of sources) {
    for (const ref of refsOf(read(file))) {
      if (!ref.spec.startsWith('.')) {
        // Shipped code has no dependencies at all. (Tests may reach for node: modules and, guarded,
        // for the machine's Playwright.)
        if (ref.kind === 'module' && !file.startsWith('tests/')) problems.push(`${file}: non-relative import ${ref.spec}`);
        continue;
      }
      const target = resolve(file, ref.spec);
      if (!exists(target)) { problems.push(`${file}: ${ref.spec} does not exist`); continue; }
      if (ref.kind !== 'module' || !/\.m?js$/.test(target)) continue;
      const names = exp(target);
      if (ref.wantsDefault && !names.has('default')) problems.push(`${file}: ${ref.spec} has no default export`);
      for (const n of ref.names) if (!names.has(n)) problems.push(`${file}: ${ref.spec} does not export ${n}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the page graph has no dangling reference', () => {
  assert.deepEqual(pageGraph().missing, [], 'every file index.html, a stylesheet or a module asks for exists');
});

test('the precache list is exactly what the page can load', () => {
  const precache = parsePrecache();
  for (const p of precache) {
    assert.ok(!/^(tools|tests|docs)\//.test(p), `dev file is not precached: ${p}`);
    assert.ok(!p.startsWith('/') && !p.includes('://'), `relative path: ${p}`);
  }
  assert.equal(new Set(precache).size, precache.length, 'no duplicates');

  const { files } = pageGraph();
  const missing = files.filter((f) => !precache.includes(f));
  const extra = precache.filter((f) => !files.includes(f)).sort();
  // Ready to paste into sw.js when the module graph has changed.
  const paste = `const PRECACHE = [\n${files.map((f) => `  '${f}',`).join('\n')}\n];`;
  assert.deepEqual(missing, [], `every file the page loads is precached. Expected list:\n${paste}`);
  assert.deepEqual(extra, [], `nothing is precached that the page never loads. Expected list:\n${paste}`);
});

/**
 * The modules js/main.js reaches through static imports only (import … from, bare import,
 * export … from), in dependency order (a module after everything it imports), without main.js
 * itself. That is exactly the set the browser must fetch before main.js can run.
 */
function staticModuleGraph(entry = 'js/main.js') {
  const order = [];
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file) || !exists(file)) return;
    seen.add(file);
    const src = code(read(file));
    const specs = [
      ...[...src.matchAll(STATIC_IMPORT)].map((m) => m[3]),
      ...[...src.matchAll(BARE_IMPORT)].map((m) => m[1]),
      ...[...src.matchAll(RE_EXPORT)].map((m) => m[2]),
    ];
    for (const spec of specs) if (spec.startsWith('.')) visit(resolve(file, spec));
    order.push(file);
  };
  visit(entry);
  return order.filter((f) => f !== entry);
}

test('index.html modulepreloads exactly the static module graph of js/main.js', () => {
  // Without these the browser discovers the graph one import level per round trip (about 1 s
  // on a slow 4G first visit, review finding 23). Lazy code (the AI worker, dynamic imports)
  // is not preloaded: it is precached and fetched when it is needed.
  const html = read('index.html');
  const listed = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
  const expected = staticModuleGraph();
  const paste = expected.map((f) => `<link rel="modulepreload" href="${f}">`).join('\n');
  assert.equal(new Set(listed).size, listed.length, 'no duplicates');
  assert.deepEqual([...listed].sort(), [...expected].sort(), `index.html <head> modulepreload list. Paste:\n${paste}`);
  // Every one must sit in <head>, before the stylesheets (they start in parallel with them).
  const head = html.slice(0, html.indexOf('</head>'));
  assert.equal([...head.matchAll(/rel="modulepreload"/g)].length, listed.length, 'all in <head>');
  assert.ok(head.lastIndexOf('rel="modulepreload"') < head.indexOf('rel="stylesheet"'), 'before the stylesheets');
});

test('every shipped script and stylesheet is reachable from index.html', () => {
  // A file under js/ or css/ that nothing loads is either dead or a missing import/link.
  const { files } = pageGraph();
  const orphans = SHIPPED.filter((f) => /^(js|css)\//.test(f) && !files.includes(f));
  assert.deepEqual(orphans, []);
});

test('the version constant is the same in sw.js and js/main.js', () => {
  const sw = /^const VERSION = '([^']+)';/m.exec(read('sw.js'));
  const main = /^export const VERSION = '([^']+)';/m.exec(read('js/main.js'));
  assert.ok(sw, 'sw.js: const VERSION = \'…\';');
  assert.ok(main, 'js/main.js: export const VERSION = \'…\';');
  assert.equal(main[1], sw[1]);
  assert.match(sw[1], /^omok-/, 'cache names carry the omok- prefix (the origin is shared with /pumal/)');
});

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

test('shipped files use relative URLs only', () => {
  const rootAbsolute = /(?:src|href)=["']\/(?!\/)|url\(\s*["']?\/(?!\/)|(?:from|import\(|fetch\(|register\()\s*["']\/(?!\/)|new\s+(?:URL|Worker)\(\s*["']\/(?!\/)/;
  const hits = SHIPPED_TEXT.filter((f) => rootAbsolute.test(code(read(f))));
  assert.deepEqual(hits, []);
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(!('id' in manifest), 'no id member: it resolves against the origin, outside our folder');
  for (const icon of manifest.icons) assert.ok(!/^\/|:\/\//.test(icon.src), icon.src);
});

test('shipped files never reach for another host (no CDN, no web font service, no analytics)', () => {
  // Allowed: our own canonical address (og:url, og:image, the share and copy links) and XML
  // namespace names, which are identifiers, not requests.
  const CANONICAL = 'https://jinjoskim2001-sketch.github.io/omok-fighter/';
  const hits = [];
  for (const f of SHIPPED_TEXT) {
    for (const m of read(f).matchAll(/\b(?:https?:)?\/\/([a-z0-9-]+\.)+[a-z]{2,}[^\s'"`)<>]*/gi)) {
      const url = m[0];
      if (url.startsWith(CANONICAL)) continue;
      if (/^http:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink|1999\/xhtml|XML\/1998\/namespace)/.test(url)) continue;
      hits.push(`${f}: ${url}`);
    }
  }
  assert.deepEqual(hits, []);
  assert.ok(!/<link[^>]+rel="preconnect"/.test(read('index.html')), 'no preconnect: everything is self-hosted');
});

// ---------------------------------------------------------------------------
// IP guard
// ---------------------------------------------------------------------------

test('no real franchise or character name in any file or file name', () => {
  // Spelled in pieces so that this file passes its own check.
  const words = [
    '포켓' + '몬', '피카' + '츄', '스트리트 ?' + '파이터', '춘' + '리', '커' + '비', '마리' + '오', '루이' + '지',
    '소' + '닉', '젤' + '다', '철' + '권', '디지' + '몬', '도라에' + '몽', '짱' + '구', '뽀로' + '로', '카카오' + '프렌즈',
    '닌텐' + '도', '캡' + '콤', '킹 ?오브 ?' + '파이터',
    'Poke' + 'mon', 'Pok' + 'émon', 'Pika' + 'chu', 'Street ?' + 'Fighter', 'Chun[- ]?' + 'Li', '\\bRy' + 'u\\b',
    'Hadou' + 'ken', '\\bKir' + 'by\\b', '\\bMar' + 'io\\b', '\\bLui' + 'gi\\b', '\\bSon' + 'ic\\b', '\\bZel' + 'da\\b',
    'Tek' + 'ken', 'Digi' + 'mon', 'Dora' + 'emon', 'Poro' + 'ro', 'Nin' + 'tendo', 'Cap' + 'com',
    'King of ' + 'Fighters', 'Mortal ' + 'Kombat',
  ];
  const re = new RegExp(words.join('|'), 'i');
  // Binary files are scanned too (as latin1): an icon must not carry a name in its metadata.
  // Only the long Latin names there: a three-letter word turns up in compressed bytes by chance.
  const latinLetters = (w) => w.replace(/\\b/g, '').replace(/\[[^\]]*\]/g, '').replace(/[^A-Za-z]/g, '');
  const binWords = words.filter((w) => !/[^\x00-\x7f]/.test(w) && latinLetters(w).length >= 5);
  const binRe = new RegExp(binWords.join('|'), 'i');
  const hits = [];
  for (const file of FILES) {
    if (re.test(file)) hits.push(`file name: ${file}`);
    const text = TEXT_RE.test(file) || file === '.gitignore';
    const body = fs.readFileSync(path.join(ROOT, file), text ? 'utf8' : 'latin1');
    const m = (text ? re : binRe).exec(body);
    if (m) hits.push(`${file}: "${body.slice(Math.max(0, m.index - 20), m.index + 24).replace(/\s+/g, ' ')}"`);
  }
  assert.deepEqual(hits, []);
});

// ---------------------------------------------------------------------------
// The display font
// ---------------------------------------------------------------------------

function uintBase128(buf, at) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const byte = buf[at.i++];
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error('bad UIntBase128');
}

/** The code points a WOFF2 font maps (cmap formats 4 and 12). */
function woff2Cmap(file) {
  const buf = fs.readFileSync(path.join(ROOT, file));
  assert.equal(buf.toString('latin1', 0, 4), 'wOF2', `${file} is a WOFF2 font`);
  const numTables = buf.readUInt16BE(12);
  const compressedSize = buf.readUInt32BE(20);
  const at = { i: 48 };
  const tables = [];
  for (let t = 0; t < numTables; t += 1) {
    const flags = buf[at.i++];
    let tag = flags & 0x3f;
    if (tag === 63) { tag = buf.toString('latin1', at.i, at.i + 4); at.i += 4; } else tag = { 0: 'cmap', 10: 'glyf', 11: 'loca' }[tag] || `#${tag}`;
    const version = flags >> 6;
    const origLength = uintBase128(buf, at);
    const glyfLoca = tag === 'glyf' || tag === 'loca';
    const transformed = glyfLoca ? version === 0 : version !== 0;
    const length = transformed ? uintBase128(buf, at) : origLength;
    tables.push({ tag, length });
  }
  const data = zlib.brotliDecompressSync(buf.subarray(at.i, at.i + compressedSize));
  let offset = 0;
  let cmap = null;
  for (const t of tables) {
    if (t.tag === 'cmap') cmap = data.subarray(offset, offset + t.length);
    offset += t.length;
  }
  assert.ok(cmap, 'the font has a cmap table');
  const codes = new Set();
  const n = cmap.readUInt16BE(2);
  for (let i = 0; i < n; i += 1) {
    const sub = cmap.readUInt32BE(4 + i * 8 + 4);
    const format = cmap.readUInt16BE(sub);
    if (format === 4) {
      const segX2 = cmap.readUInt16BE(sub + 6);
      const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s += 1) {
        const end = cmap.readUInt16BE(ends + s * 2), start = cmap.readUInt16BE(starts + s * 2);
        const delta = cmap.readInt16BE(deltas + s * 2), rangeOffset = cmap.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c += 1) {
          let glyph;
          if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
          else {
            const g = cmap.readUInt16BE(ranges + s * 2 + rangeOffset + (c - start) * 2);
            glyph = g === 0 ? 0 : (g + delta) & 0xffff;
          }
          if (glyph !== 0) codes.add(c);
        }
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g += 1) {
        const base = sub + 16 + g * 12;
        const start = cmap.readUInt32BE(base), end = cmap.readUInt32BE(base + 4), glyph = cmap.readUInt32BE(base + 8);
        for (let c = start; c <= end; c += 1) if (glyph + (c - start) !== 0) codes.add(c);
      }
    }
  }
  return codes;
}

test('every Hangul character the app shows is in the font subset (fonts/bhs.woff2)', () => {
  assert.ok(exists('fonts/bhs.woff2'), 'fonts/bhs.woff2 exists (python3 tools/make_font.py)');
  assert.ok(exists('fonts/OFL.txt'), 'the SIL Open Font License ships next to the font');
  assert.match(read('fonts/OFL.txt'), /SIL OPEN FONT LICENSE Version 1\.1/);
  const cmap = woff2Cmap('fonts/bhs.woff2');
  for (const c of 'ABCZabcz0189!?') assert.ok(cmap.has(c.codePointAt(0)), `basic Latin "${c}"`);
  const missing = new Map();
  for (const f of SHIPPED_TEXT) {
    for (const ch of read(f)) {
      const cp = ch.codePointAt(0);
      const hangul = (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x3131 && cp <= 0x318e);
      if (hangul && !cmap.has(cp) && !missing.has(ch)) missing.set(ch, f);
    }
  }
  const list = [...missing].map(([ch, f]) => `${ch} (${f})`);
  assert.deepEqual(list, [], 'run python3 tools/make_font.py again; if it reports the syllable as missing from Black Han Sans itself, choose another word');
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

test('index.html keeps the DOM contract and loads no dev harness', () => {
  const html = read('index.html');
  for (const id of ['app', 'sheetRoot', 'toastRoot', 'gateRoot']) {
    assert.ok(new RegExp(`id="${id}"`).test(html), `#${id} is in the page`);
  }
  // The sheet, toast and gate roots must be truly empty: their CSS hides them with :empty.
  for (const id of ['sheetRoot', 'toastRoot', 'gateRoot']) assert.ok(new RegExp(`<div id="${id}"></div>`).test(html), `#${id} is empty`);
  assert.ok(/<script type="module" src="js\/main\.js"><\/script>/.test(html));
  assert.ok(!/tools\/|demo-/.test(html), 'no reference to tools/ or a demo page');
  const css = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  const chars = ['bulttong', 'nyangja', 'bigom', 'beonjjeok', 'jaepjaep', 'ppibik', 'kkakkung', 'taenggeul'];
  assert.deepEqual(css, ['css/app.css', 'css/battle.css', 'css/fighters.css', ...chars.map((c) => `css/chars/${c}.css`), 'css/gate.css']);
  assert.match(html, /<html lang="ko">/);
  assert.match(html, /<style>html,body\{background:#17121F\}<\/style>/, 'first paint in the app colour');
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="돌주먹">/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon-180\.png">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/jinjoskim2001-sketch\.github\.io\/omok-fighter\/icons\/og-800x400\.png\?v=\d+">/);
});

test('icons are the opaque PNGs SPEC §10 lists, at their exact size', () => {
  const expect = {
    'icons/apple-touch-icon-180.png': [180, 180],
    'icons/icon-192.png': [192, 192],
    'icons/icon-512.png': [512, 512],
    'icons/icon-maskable-512.png': [512, 512],
    'icons/favicon-32.png': [32, 32],
    'icons/og-800x400.png': [800, 400],
  };
  for (const [file, [w, h]] of Object.entries(expect)) {
    const buf = fs.readFileSync(path.join(ROOT, file));
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${file}: PNG`);
    assert.equal(buf.toString('latin1', 12, 16), 'IHDR');
    assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [w, h], `${file}: size`);
    // Colour type 2 = RGB, or 3 = palette without a transparency chunk: no alpha at all (iOS
    // fills transparency with black). The iOS icon itself is always full RGB.
    assert.ok(buf[25] === 2 || (buf[25] === 3 && !buf.includes(Buffer.from('tRNS'))), `${file}: opaque`);
    if (file.includes('apple-touch-icon')) assert.equal(buf[25], 2, `${file}: RGB`);
  }
});

test('tests/index.js runs every test file (node --test tests/)', () => {
  const listed = [...read('tests/index.js').matchAll(/^import '\.\/([^']+)';$/gm)].map((m) => m[1]);
  const files = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.test.js'));
  assert.deepEqual(files.filter((f) => !listed.includes(f)), [], 'every *.test.js is imported');
  for (const f of ['rules', 'match', 'ai', 'board', 'audio', 'characters', 'install', 'sw', 'storage', 'integration']) {
    assert.ok(listed.includes(`${f}.test.js`), `SPEC §7 test file ${f}.test.js is listed`);
  }
});

test('the dev server, screenshot tool and generators are where the README says', () => {
  for (const f of ['tools/serve.py', 'tools/shot.mjs', 'tools/make_icons.mjs', 'tools/make_font.py', 'tools/demo-gate.html', '.nojekyll', 'README.md']) {
    assert.ok(exists(f), f);
  }
  assert.match(read('.gitignore'), /^tools\/dev\/$/m, 'scratch files stay out of git');
});
