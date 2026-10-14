// js/ui/sheet.js — modal layers in #sheetRoot: bottom sheets (match setup) and centred dialogs
// (pause, undo approval, confirms). #sheetRoot is empty whenever nothing is open — js/install.js
// reads that to hold back an update reload, and the CSS hides the root with :empty.

import { h, esc } from './dom.js';
import { btn, sfx, guardTaps, triggeringTap, TAP_GUARD_MS } from './widgets.js';

const layers = [];

// Ghost-tap guard (see js/ui/router.js): a freshly opened layer (.is-entering) drops every gesture
// that starts on it until its card has slid / popped in (animationend) and TAP_GUARD_MS have passed
// since the tap that opened it, whichever is later. The layer covers the screen, so nothing falls
// through to the screen below either; the controls still show their press (widgets.js guardTaps).
// A double tap on 한 판 붙자 therefore neither flips a setup option nor closes the sheet from its own
// scrim; a double tap on 무르기 cannot dismiss the approval dialog it opened. A closing layer
// (.is-leaving) keeps catching touches through its exit animation (its scrim and card ignore them),
// so a double tap on 계속 does not reach the board.
const ENTER_MAX_MS = 600;   // no animationend (animations off, hidden tab): stop waiting for it

export const isSheetOpen = () => layers.length > 0;

// opts: { kind:'sheet'|'dialog', title, sub, body:Node|Node[], cls, dismiss:true, onClose(result) }
export function openLayer(opts = {}) {
  const root = document.getElementById('sheetRoot');
  const { kind = 'dialog', title = '', sub = '', body = null, cls = '', dismiss = true, onClose } = opts;
  const layer = h(`div.layer.layer--${kind}${cls ? '.' + cls : ''}`);
  const scrim = h('div.layer__scrim');
  const card = h(`div.${kind === 'sheet' ? 'sheet' : 'dialog'}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || null });
  if (kind === 'sheet') card.append(h('div.sheet__grab', { 'aria-hidden': 'true' }));
  if (title) {
    const head = h('div.layer__head');
    head.innerHTML = `<h2 class="layer__title">${esc(title)}</h2>` + (sub ? `<p class="layer__sub">${esc(sub)}</p>` : '');
    card.append(head);
  }
  const content = h('div.layer__body');
  if (Array.isArray(body)) content.append(...body.filter(Boolean)); else if (body) content.append(body);
  card.append(content);
  layer.append(scrim, card);

  let closed = false;
  let resolveDone;
  const done = new Promise((res) => { resolveDone = res; });
  const close = (result = null) => {
    if (closed) return;
    closed = true;
    const i = layers.indexOf(api);
    if (i >= 0) layers.splice(i, 1);
    document.removeEventListener('keydown', onKey);
    layer.classList.add('is-leaving');
    // Remove synchronously from the stack, visually after the exit animation.
    setTimeout(() => layer.remove(), 170);
    if (typeof onClose === 'function') onClose(result);
    resolveDone(result);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismiss && layers[layers.length - 1] === api) { e.preventDefault(); sfx('cancel'); close(null); }
  };
  const tap = triggeringTap();
  layer.classList.add('is-entering');
  const guard = guardTaps(layer);
  let entered = false;
  const enter = () => { if (!entered) { entered = true; layer.classList.remove('is-entering'); guard.end(); } };
  const tryEnter = () => {
    if (entered) return;
    const left = tap != null ? tap + TAP_GUARD_MS - performance.now() : 0;
    // Waited out on a frame, so input that queued up meanwhile is dispatched (and dropped) first.
    if (left > 1) setTimeout(() => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(enter) : enter()), left);
    else enter();
  };
  const onAnim = (e) => { if (e.target === card) tryEnter(); };
  card.addEventListener('animationend', onAnim);
  card.addEventListener('animationcancel', onAnim);
  setTimeout(tryEnter, ENTER_MAX_MS);
  if (dismiss) {
    scrim.addEventListener('click', () => {
      if (!entered) return;
      sfx('cancel'); close(null);
    });
  }
  document.addEventListener('keydown', onKey);

  const api = { el: layer, card, content, close, done, setBody(node) { content.replaceChildren(node); } };
  layers.push(api);
  root.append(layer);
  return api;
}

export function closeAll() {
  for (const l of layers.slice()) l.close(null);
  const root = document.getElementById('sheetRoot');
  if (root) root.replaceChildren();
}

// Promise<boolean>. danger = the OK button is red.
export function confirmDialog({ title, text = '', ok = '확인', cancel = '취소', danger = false, cls = '' }) {
  const body = h('div.dlg');
  if (text) body.append(h('p.dlg__text', { text }));
  const row = h('div.dlg__row');
  let layer = null;
  row.append(
    btn(cancel, { cls: 'btn--ghost', sound: 'cancel', onClick: () => layer.close(false) }),
    btn(ok, { cls: danger ? 'btn--danger' : 'btn--gold', sound: 'ok', onClick: () => layer.close(true) }),
  );
  body.append(row);
  layer = openLayer({ kind: 'dialog', title, body, cls });
  return layer.done.then((v) => v === true);
}

// Promise<value|null>. options: [{label, value, cls, sub}]
export function chooseDialog({ title, text = '', options = [], cancel = '취소', cls = '' }) {
  const body = h('div.dlg');
  if (text) body.append(h('p.dlg__text', { text }));
  let layer = null;
  const list = h('div.dlg__list');
  for (const o of options) {
    list.append(btn(o.label, { cls: o.cls || 'btn--paper', sub: o.sub || '', sound: 'ok', onClick: () => layer.close({ v: o.value }) }));
  }
  if (cancel) list.append(btn(cancel, { cls: 'btn--ghost', sound: 'cancel', onClick: () => layer.close(null) }));
  body.append(list);
  layer = openLayer({ kind: 'dialog', title, body, cls });
  return layer.done.then((r) => (r && typeof r === 'object' && 'v' in r ? r.v : null));
}
