// js/ui/toast.js — short status pills in #toastRoot (kept empty when nothing shows).

import { sfx } from './widgets.js';

const MAX = 2;

export function toast(text, { ms = 2000, kind = '', sound = false } = {}) {
  const root = document.getElementById('toastRoot');
  if (!root || !text) return;
  if (sound) sfx('toast');
  // The newest message wins; an identical one already on screen is just refreshed.
  for (const old of Array.from(root.children)) {
    if (old.textContent === String(text)) old.remove();
  }
  while (root.children.length >= MAX) root.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ` toast--${kind}` : '');
  el.setAttribute('role', 'status');
  el.textContent = String(text);
  root.append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 180);
  }, ms);
}

export function clearToasts() {
  const root = document.getElementById('toastRoot');
  if (root) root.replaceChildren();
}
