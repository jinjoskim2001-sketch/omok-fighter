// js/ui/ctx.js — the one shared app context. main.js fills it at boot; screens read it.
// Keeping it in a module of its own lets every screen import it without a cycle through main.js.

export const app = {
  version: '',
  env: { standalone: false, ios: false, android: false, safari: false, inApp: null },
  prefs: {},
  setup: null,
  frozen: false,        // ?shot= : animations are frozen, nothing is saved
  persist: true,        // false in ?shot= mode — a screenshot must never touch the player's data
  rng: Math.random,
  params: new URLSearchParams(''),

  // filled by main.js
  go: () => {},
  current: () => null,
  setPrefs: () => {},
  saveSetup: () => {},
  saveMatch: () => {},
  loadMatch: () => null,
  clearMatch: () => {},
  hasMatch: () => false,
  openInstallGuide: () => {},
  share: () => {},
  canInstall: () => false,
};

// fxSpeed helpers (SPEC §3.1): 'normal' | 'fast' (×0.6, VS hold 0) | 'min' (no shake/hit-stop/VS).
export const speed = () => (app.prefs && app.prefs.fxSpeed) || 'normal';
export const fxScale = () => (speed() === 'fast' ? 0.6 : speed() === 'min' ? 0.5 : 1);
export const ms = (n) => Math.round(n * fxScale());
export const motionReduced = () => document.documentElement.dataset.motion === 'reduce';
export const shakeOn = () => app.prefs.shake !== false && !motionReduced() && speed() !== 'min';
