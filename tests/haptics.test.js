// js/haptics.js: the iOS label overlay must never outlive the screen it was attached to.
// Screens are rebuilt on every navigation, so a module-level registry of labels (or hosts)
// would keep every detached screen alive (review findings 10 / 18: ~1 MB per match on iOS).
// It must also never escape its host: every control is built detached, WebKit reports ''
// as the computed position of a detached element, and a label whose containing block is the
// screen covers the whole screen (iOS audit finding 1: 설정 stuck, setup options dead).
// A tiny fake DOM stands in for the page; reachability is checked with WeakRef + a real GC.

import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';

import { attachHaptic, setHapticsEnabled, hapticsKind } from '../js/haptics.js';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1';

// ---- just enough DOM ------------------------------------------------------------------------
class FakeStyle {
  setProperty(k, v) { this[k] = v; }
}
class FakeNode {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.cssPosition = 'static';  // what the page's stylesheets say (see getComputedStyle)
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.style = new FakeStyle();
    this.listeners = [];
    this.observers = [];          // like a browser: the node holds its observers, not the reverse
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  addEventListener(type, fn) { this.listeners.push([type, fn]); }
  removeEventListener() {}
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    // Custom element reactions: connectedCallback for every node of the tree that just
    // entered the document, before the DOM call returns.
    if (child.isConnected) {
      for (const n of [child, ...child.walk()]) if (typeof n.connectedCallback === 'function') n.connectedCallback();
    }
    for (const o of this.observers) o.notify();
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    for (const o of this.observers) o.notify();
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === this.ownerDocument.documentElement;
  }
  *walk() {
    for (const c of this.childNodes) { yield c; yield* c.walk(); }
  }
}
// customElements: false models an engine without them (the timed fallback in haptics.js).
function fakeDocument({ customElements = true } = {}) {
  const registry = new Map();
  let making = 'x-unknown';
  const doc = {
    createElement(tag) {
      const C = registry.get(tag);
      if (!C) return new FakeNode(doc, tag);
      making = tag;
      return new C();
    },
    // The one selector haptics.js asks for.
    querySelectorAll(sel) {
      assert.equal(sel, 'label[data-haptic-trigger]');
      return [...doc.documentElement.walk()].filter((n) => n.tagName === 'LABEL' && n.hasAttribute('data-haptic-trigger'));
    },
  };
  doc.documentElement = new FakeNode(doc, 'html');
  doc.body = doc.documentElement.appendChild(new FakeNode(doc, 'body'));
  class FakeHTMLElement extends FakeNode {
    constructor() { super(doc, making); }
  }
  doc.defaultView = {
    // Like WebKit: a detached element has no computed position at all (''), not 'static'.
    // In the page, the inline style wins over the stylesheet.
    getComputedStyle: (n) => ({ position: n.isConnected ? (n.style.position || n.cssPosition) : '' }),
    MutationObserver: class {
      constructor(cb) { this.cb = cb; }
      observe(node) { node.observers.push(this); }
      notify() { this.cb([], this); }
    },
    HTMLElement: FakeHTMLElement,
    customElements: customElements
      ? { define: (name, C) => { registry.set(name, C); }, get: (name) => registry.get(name) }
      : undefined,
    requestAnimationFrame: (fn) => setTimeout(fn, 16),
  };
  return doc;
}

// The box an absolutely positioned label takes: its nearest positioned ancestor.
function containingBlock(doc, node) {
  for (let p = node.parentNode; p; p = p.parentNode) {
    if (p === doc.documentElement) return p;
    const pos = doc.defaultView.getComputedStyle(p).position;
    if (pos && pos !== 'static') return p;
  }
  return null;
}
const labelOf = (el) => el.childNodes.find((n) => n.tagName === 'LABEL');

const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
// iOS 17.4+ has <input type=checkbox switch>; `sw: false` is iOS 16 – 17.3.
class InputWithSwitch {}
InputWithSwitch.prototype.switch = false;
class InputWithoutSwitch {}
async function withUA(ua, fn, { sw = true } = {}) {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua, platform: 'iPhone', maxTouchPoints: 5 }, configurable: true, writable: true });
  globalThis.HTMLInputElement = sw ? InputWithSwitch : InputWithoutSwitch;
  try { return await fn(); } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved); else delete globalThis.navigator;
    delete globalThis.HTMLInputElement;
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const microtask = () => new Promise((r) => queueMicrotask(r));

// A "screen" with a few buttons, attached, given haptics, then removed like router.go() does.
function screenRoundTrip(doc) {
  const screen = doc.createElement('section');
  const buttons = [];
  for (let i = 0; i < 5; i++) {
    const b = screen.appendChild(doc.createElement('button'));
    b.payload = new Array(1000).fill(i);       // something big a leak would keep
    attachHaptic(b);
    buttons.push(b);
  }
  doc.body.appendChild(screen);
  const label = buttons[0].childNodes.find((n) => n.tagName === 'LABEL');
  assert.ok(label, 'iOS: the button got its <label> overlay');
  assert.equal(label.getAttribute('data-haptic-trigger'), '');
  screen.remove();
  return { screen: new WeakRef(screen), button: new WeakRef(buttons[0]), label: new WeakRef(label) };
}

test('iOS: a removed screen is garbage-collected, overlay labels and all', async () => {
  const doc = fakeDocument();
  globalThis.document = doc;
  try {
    const refs = await withUA(IPHONE_UA, () => {
      assert.equal(hapticsKind(), 'switch');
      return screenRoundTrip(doc);
    });
    // Toggling after the screen is gone must not resurrect or need it.
    setHapticsEnabled(false);
    setHapticsEnabled(true);
    await tick();
    gc(); gc();
    assert.equal(refs.label.deref(), undefined, 'label released');
    assert.equal(refs.button.deref(), undefined, 'host button released');
    assert.equal(refs.screen.deref(), undefined, 'detached screen released');
  } finally {
    delete globalThis.document;
  }
});

test('iOS: setHapticsEnabled switches the labels in the page; new labels follow the setting', async () => {
  const doc = fakeDocument();
  globalThis.document = doc;
  try {
    await withUA(IPHONE_UA, async () => {
      const a = doc.body.appendChild(doc.createElement('button'));
      attachHaptic(a);
      attachHaptic(a);                          // twice is harmless
      const labelsOf = (el) => el.childNodes.filter((n) => n.tagName === 'LABEL');
      assert.equal(labelsOf(a).length, 1);
      await microtask();
      assert.equal(a.style.position, 'relative', 'a static host becomes the overlay\'s containing block');

      setHapticsEnabled(false);
      assert.equal(labelsOf(a)[0].style.pointerEvents, 'none', 'off: the finger lands on the host, no tick');
      const b = doc.body.appendChild(doc.createElement('button'));
      attachHaptic(b);
      assert.equal(labelsOf(b)[0].style.pointerEvents, 'none', 'created while off');

      setHapticsEnabled(true);
      assert.equal(labelsOf(a)[0].style.pointerEvents, '');
      assert.equal(labelsOf(b)[0].style.pointerEvents, '');
      const c = doc.body.appendChild(doc.createElement('button'));
      attachHaptic(c);
      assert.equal(labelsOf(c)[0].style.pointerEvents ?? '', '', 'created while on');

      // Rewriting the host's content takes the overlay with it; the observer puts it back on top.
      a.removeChild(labelsOf(a)[0]);
      assert.equal(labelsOf(a).length, 1, 'overlay re-attached');
      assert.equal(a.childNodes[a.childNodes.length - 1].tagName, 'LABEL', 'and last, so it stays on top');
    });
  } finally {
    setHapticsEnabled(true);
    delete globalThis.document;
  }
});

test('not iOS: no overlay at all', async () => {
  const doc = fakeDocument();
  globalThis.document = doc;
  try {
    await withUA('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', () => {
      const b = doc.body.appendChild(doc.createElement('button'));
      attachHaptic(b);
      assert.equal(b.childNodes.length, 0);
      setHapticsEnabled(false);
      setHapticsEnabled(true);
    });
  } finally {
    delete globalThis.document;
  }
});

// The controls of every screen are built detached (js/ui/widgets.js) and attached later, so at
// attachHaptic time the host's position is unknown (''), never 'static'.
for (const customElements of [true, false]) {
  const how = customElements ? 'connectedCallback' : 'timed fallback';
  test(`iOS (${how}): a label made on a detached host ends up inside that host`, async () => {
    const doc = fakeDocument({ customElements });
    globalThis.document = doc;
    try {
      await withUA(IPHONE_UA, async () => {
        // A screen that is itself positioned (.scr / .sheet): the box an escaped label would take.
        const screen = doc.createElement('section');
        screen.cssPosition = 'relative';
        const plain = screen.appendChild(doc.createElement('button'));     // .seg__opt: no CSS position
        const placed = screen.appendChild(doc.createElement('button'));    // .bt__board: position:absolute
        placed.cssPosition = 'absolute';
        attachHaptic(plain);
        attachHaptic(placed);
        assert.equal(plain.style.position ?? '', '', 'nothing is decided while detached');
        assert.equal(placed.style.position ?? '', '');

        // The screen is attached a little later (after an await, like a sheet).
        await tick();
        doc.body.appendChild(screen);
        await microtask();
        if (!customElements) await new Promise((r) => setTimeout(r, 40));
        assert.equal(plain.style.position, 'relative', 'pinned once it is in the page');
        assert.equal(containingBlock(doc, labelOf(plain)), plain, 'the label covers its host, not the screen');
        assert.equal(placed.style.position ?? '', '', 'a host placed by its own CSS is left alone');
        assert.equal(containingBlock(doc, labelOf(placed)), placed);
        assert.equal(labelOf(plain).childNodes[0].tagName, 'INPUT', 'the switch stays the label\'s first child');
      });
    } finally {
      delete globalThis.document;
    }
  });
}

test('iOS: a host that is already in the page is pinned too, and again after a move', async () => {
  const doc = fakeDocument();
  globalThis.document = doc;
  try {
    await withUA(IPHONE_UA, async () => {
      const b = doc.body.appendChild(doc.createElement('button'));
      attachHaptic(b);
      await microtask();
      assert.equal(containingBlock(doc, labelOf(b)), b);
      // Moved into another screen, whose CSS no longer places it: still its own label's box.
      b.remove();
      b.style.position = '';
      const other = doc.body.appendChild(doc.createElement('div'));
      other.appendChild(b);
      await microtask();
      assert.equal(containingBlock(doc, labelOf(b)), b);
    });
  } finally {
    delete globalThis.document;
  }
});

test('iOS before 17.4 (no switch control): no overlay, and nothing to offer in settings', async () => {
  const doc = fakeDocument();
  globalThis.document = doc;
  try {
    await withUA('Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1', async () => {
      assert.equal(hapticsKind(), 'none');
      const b = doc.body.appendChild(doc.createElement('button'));
      attachHaptic(b);
      await microtask();
      assert.equal(b.childNodes.length, 0, 'no label, no hidden checkbox, no observer');
      assert.equal(b.style.position ?? '', '');
      setHapticsEnabled(false);
      setHapticsEnabled(true);
    }, { sw: false });
  } finally {
    delete globalThis.document;
  }
});
