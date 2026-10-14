// The PWA shell (ported from 품알): environment detection, the install / escape gates, the
// manifest, service-worker registration and its reload timing, the inline scripts in
// index.html, the layout-height rules they pair with, and the screen wake lock (js/wake.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import {
  CANONICAL_URL,
  detectEnv,
  gateMode,
  escapeLink,
  mountGate,
  canPromptInstall,
  promptInstall,
  onInstallAvailable,
  mountInstallPill,
  shareApp,
  registerSW,
  applyPendingUpdate,
  isUpdatePending,
} from '../js/install.js';

// Real-looking user agents. iOS has frozen the OS token at 18_x since Safari 26.
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const UA = {
  iphoneSafari: `${IOS} Version/27.0 Mobile/15E148 Safari/604.1`,
  iphoneSafari26: `${IOS} Version/26.4 Mobile/15E148 Safari/604.1`,
  iphoneStandalone: `${IOS} Mobile/15E148`,
  iphoneChrome: `${IOS} CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1`,
  kakaoIos: `${IOS} Mobile/15E148 Safari/604.1 KAKAOTALK/25.8.2 (INAPP)`,
  instagramIos: `${IOS} Mobile/22H20 Instagram 398.0.0.28.84 (iPhone17,1; iOS 18_7; ko_KR; ko; scale=3.00; 1206x2622; 791234567) NW/3`,
  threadsIos: `${IOS} Mobile/22H20 Barcelona 398.0.0.25.80 (iPhone17,1; iOS 18_7; ko_KR; ko; scale=3.00; 1206x2622; 791234568)`,
  lineIos: `${IOS} Mobile/15E148 Safari Line/15.14.0`,
  naverIos: `${IOS} Mobile/15E148 NAVER(inapp; search; 2000; 12.15.2; 16PRO)`,
  daumIos: `${IOS} Mobile/15E148 Safari/604.1 DaumApps/9.9.1 DaumDevice/mobile`,
  facebookIos: `${IOS} Mobile/22H20 [FBAN/FBIOS;FBAV/531.0.0.42.70;FBBV/801234567;FBDV/iPhone17,1;FBMD/iPhone;FBSN/iOS;FBSV/18.7;FBSS/3;FBID/phone;FBLC/ko_KR;FBOP/5;FBRV/0]`,
  googleAppIos: `${IOS} GSA/389.0.812345678 Mobile/15E148 Safari/604.1`,
  plainWebviewIos: `${IOS} Mobile/15E148`,
  androidChrome: 'Mozilla/5.0 (Linux; Android 16; SM-S938N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  kakaoAndroid: 'Mozilla/5.0 (Linux; Android 16; SM-S938N Build/BP2A.250605.031; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.43 Mobile Safari/537.36;KAKAOTALK 2510820',
  desktopChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
};

// Every non-UA signal is pinned so the result does not depend on the machine running the test.
const PHONE = { platform: 'iPhone', maxTouchPoints: 5, standalone: false };
const MAC = { platform: 'MacIntel', maxTouchPoints: 0, standalone: false };
const IPAD_AS_MAC = { platform: 'MacIntel', maxTouchPoints: 5, standalone: false };
const ANDROID = { platform: 'Linux armv81', maxTouchPoints: 5, standalone: false };

test('iPhone Safari tab → install guide', () => {
  const env = detectEnv(UA.iphoneSafari, PHONE);
  assert.deepEqual(env, { standalone: false, ios: true, android: false, safari: true, inApp: null });
  assert.equal(gateMode(env, {}), 'install');
  assert.equal(gateMode(detectEnv(UA.iphoneSafari26, PHONE), {}), 'install');
});

test('installed iOS web app is the game, never a webview', () => {
  // The standalone UA has no Safari/ token, exactly like an in-app webview.
  const env = detectEnv(UA.iphoneStandalone, { ...PHONE, standalone: true });
  assert.equal(env.standalone, true);
  assert.equal(env.ios, true);
  assert.equal(env.inApp, null);
  assert.equal(gateMode(env, {}), 'game');
});

test('standalone wins even when the UA carries an in-app token', () => {
  const env = detectEnv(UA.kakaoIos, { ...PHONE, standalone: true });
  assert.equal(env.inApp, null);
  assert.equal(gateMode(env, {}), 'game');
});

test('iOS in-app browsers → escape screen with the right app', () => {
  const cases = {
    kakaoIos: 'kakaotalk',
    instagramIos: 'instagram',
    threadsIos: 'threads',
    lineIos: 'line',
    naverIos: 'naver',
    daumIos: 'daum',
    facebookIos: 'facebook',
    googleAppIos: 'other',
    plainWebviewIos: 'other',
  };
  for (const [key, app] of Object.entries(cases)) {
    const env = detectEnv(UA[key], PHONE);
    assert.equal(env.ios, true, key);
    assert.equal(env.inApp, app, key);
    assert.equal(env.safari, false, key);
    assert.equal(env.standalone, false, key);
    assert.equal(gateMode(env, {}), 'escape', key);
  }
});

test('iOS Chrome is a real browser: install guide, not escape', () => {
  const env = detectEnv(UA.iphoneChrome, PHONE);
  assert.deepEqual(env, { standalone: false, ios: true, android: false, safari: false, inApp: null });
  assert.equal(gateMode(env, {}), 'install');
});

test('Android Chrome → game', () => {
  const env = detectEnv(UA.androidChrome, ANDROID);
  assert.deepEqual(env, { standalone: false, ios: false, android: true, safari: false, inApp: null });
  assert.equal(gateMode(env, {}), 'game');
});

test('Android KakaoTalk is detected but still goes to the game', () => {
  const env = detectEnv(UA.kakaoAndroid, ANDROID);
  assert.equal(env.android, true);
  assert.equal(env.ios, false);
  assert.equal(env.inApp, 'kakaotalk');
  assert.equal(gateMode(env, {}), 'game');
});

test('desktop Chrome and desktop Safari → game', () => {
  const chrome = detectEnv(UA.desktopChrome, MAC);
  assert.deepEqual(chrome, { standalone: false, ios: false, android: false, safari: false, inApp: null });
  assert.equal(gateMode(chrome, {}), 'game');

  const safari = detectEnv(UA.macSafari, MAC);
  assert.deepEqual(safari, { standalone: false, ios: false, android: false, safari: true, inApp: null });
  assert.equal(gateMode(safari, {}), 'game');
});

test('iPad pretending to be a Mac is iOS', () => {
  const env = detectEnv(UA.macSafari, IPAD_AS_MAC);
  assert.deepEqual(env, { standalone: false, ios: true, android: false, safari: true, inApp: null });
  assert.equal(gateMode(env, {}), 'install');
});

test('iPad-as-Mac webview (no Safari/ token) → escape', () => {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
  const env = detectEnv(ua, IPAD_AS_MAC);
  assert.equal(env.ios, true);
  assert.equal(env.inApp, 'other');
  assert.equal(gateMode(env, {}), 'escape');
});

test('detectEnv with no arguments does not throw outside a browser', () => {
  const env = detectEnv();
  assert.equal(typeof env.standalone, 'boolean');
  assert.equal(env.ios, false);
  assert.equal(env.inApp, null);
});

test('gateMode: ?play=1 and the trial flag force the game', () => {
  const safari = detectEnv(UA.iphoneSafari, PHONE);
  const kakao = detectEnv(UA.kakaoIos, PHONE);
  assert.equal(gateMode(safari, { forcePlay: true }), 'game');
  assert.equal(gateMode(kakao, { forcePlay: true }), 'game');
  assert.equal(gateMode(safari, { trial: true }), 'game');
  assert.equal(gateMode(kakao, { trial: true }), 'game');
  assert.equal(gateMode(safari, { forcePlay: false, trial: false }), 'install');
  assert.equal(gateMode(kakao, { forcePlay: false, trial: false }), 'escape');
  // The options object is optional.
  assert.equal(gateMode(safari), 'install');
});

test('escapeLink: per-app way out', () => {
  const enc = encodeURIComponent(CANONICAL_URL);

  assert.deepEqual(escapeLink('kakaotalk'), {
    href: `kakaotalk://web/openExternal?url=${enc}`, target: null, sync: true,
  });
  assert.deepEqual(escapeLink('instagram'), {
    href: `instagram://extbrowser/?url=${enc}`, target: null, sync: true,
  });
  assert.deepEqual(escapeLink('threads'), {
    href: `barcelona://extbrowser/?url=${enc}`, target: null, sync: true,
  });

  const xSafari = { href: 'x-safari-https://jinjoskim2001-sketch.github.io/omok-fighter/', target: '_blank', sync: false };
  for (const app of ['facebook', 'naver', 'daum', 'other', null, undefined]) {
    assert.deepEqual(escapeLink(app), xSafari, String(app));
  }
});

test('escapeLink: LINE uses its official parameter first, then the Safari scheme', () => {
  const first = escapeLink('line', { href: CANONICAL_URL });
  assert.equal(first.href, `${CANONICAL_URL}?openExternalBrowser=1`);
  assert.equal(first.target, null);

  // Still inside LINE with the parameter already present: it did not work.
  const second = escapeLink('line', { href: `${CANONICAL_URL}?openExternalBrowser=1` });
  assert.equal(second.href, 'x-safari-https://jinjoskim2001-sketch.github.io/omok-fighter/');
  assert.equal(second.target, '_blank');
});

test('canonical URL is the trailing-slash Pages URL', () => {
  assert.equal(CANONICAL_URL, 'https://jinjoskim2001-sketch.github.io/omok-fighter/');
});

test('install prompt and share degrade quietly outside a browser', async () => {
  assert.equal(canPromptInstall(), false);
  assert.equal(await promptInstall(), 'unavailable');
  assert.equal(await shareApp(), 'failed');
  const seen = [];
  const off = onInstallAvailable((v) => seen.push(v));
  assert.deepEqual(seen, [], 'no prompt waiting, no call');
  off();
  assert.equal(typeof mountInstallPill(null), 'function');
});

test('shareApp: the share sheet carries the name, a line of copy and the canonical URL; cancelling copies nothing', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const calls = [];
  let reject = null;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { share: async (data) => { calls.push(data); if (reject) throw reject; } },
  });
  try {
    assert.equal(await shareApp(), 'shared');
    assert.equal(calls[0].url, CANONICAL_URL);
    assert.match(calls[0].title, /돌주먹/);
    assert.match(calls[0].text, /홈 화면에 추가/);
    reject = Object.assign(new Error('cancel'), { name: 'AbortError' });
    assert.equal(await shareApp(), 'failed', 'a closed share sheet is not a reason to write the clipboard');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved);
    else delete globalThis.navigator;
  }
});

test('manifest: names, relative URLs, no id, the app colour, portrait, the three icons', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.name, '돌주먹 — 오목 파이터');
  assert.equal(manifest.short_name, '돌주먹');
  assert.equal(manifest.lang, 'ko');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'portrait');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  // id resolves against the origin, which on a project site is outside our folder.
  assert.equal('id' in manifest, false);
  assert.equal(manifest.theme_color, '#17121F');
  assert.equal(manifest.background_color, '#17121F');
  assert.deepEqual(
    manifest.icons.map((i) => `${i.src} ${i.sizes} ${i.purpose}`),
    [
      'icons/icon-192.png 192x192 any',
      'icons/icon-512.png 512x512 any',
      'icons/icon-maskable-512.png 512x512 maskable',
    ],
  );
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith('/'), icon.src);
    // PNG signature: the file exists and is what it says it is.
    const head = readFileSync(new URL(`../${icon.src}`, import.meta.url)).subarray(0, 8);
    assert.deepEqual([...head], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], icon.src);
  }
});

// ---------------------------------------------------------------------------
// Gate markup
// ---------------------------------------------------------------------------

// mountGate only needs somewhere to put its markup; nothing here is clicked.
function fakeRoot() {
  return {
    innerHTML: '',
    dataset: {},
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    contains: () => false,
  };
}

function gateHtml(mode, env, opts) {
  const root = fakeRoot();
  mountGate(root, mode, env, { auto: false, ...opts });
  return root.innerHTML;
}

const SAFARI_ENV = { standalone: false, ios: true, android: false, safari: true, inApp: null };
const safariUA = (major) => `${IOS} Version/${major}.0 Mobile/15E148 Safari/604.1`;

test('install guide step 1: Safari 26 lights the ··· button beside the address bar', () => {
  const html = gateHtml('install', SAFARI_ENV, { ua: safariUA(26) });
  assert.ok(html.includes('주소창 옆 <b>···</b> →&nbsp;<b>공유</b>'));
  assert.ok(html.includes('gate-art__btn--hot'));
  assert.ok(!html.includes('gate-art__addr--hot'));
});

test('install guide step 1: Safari 27 and later lead with a press on the address bar', () => {
  // On iOS 27 the right-hand button opens Tabs, so pointing at it would send people the wrong way.
  for (const major of [27, 28]) {
    const html = gateHtml('install', SAFARI_ENV, { ua: safariUA(major) });
    assert.ok(html.includes('<b>주소창을 꾹</b> 누르고 →&nbsp;<b>공유</b>'), String(major));
    assert.ok(html.includes('주소창 왼쪽 메뉴 버튼으로도&nbsp;열려요'), String(major));
    assert.ok(html.includes('gate-art__addr--hot'), String(major));
    assert.ok(!html.includes('gate-art__btn--hot'), 'no side button is lit');
    assert.ok(!html.includes('주소창 옆'), 'the ··· path is not offered');
  }
});

test('install guide step 1: an unreadable Safari version shows both ways in', () => {
  const html = gateHtml('install', SAFARI_ENV, { ua: `${IOS} Mobile/15E148 Safari/604.1` });
  assert.ok(html.includes('주소창 옆 <b>···</b> →&nbsp;<b>공유</b>'));
  assert.ok(html.includes('또는 <b>주소창을 꾹</b> →&nbsp;<b>공유</b>'));
  assert.ok(html.includes('gate-art__btn--hot'));
  assert.ok(html.includes('gate-art__addr--hot'));
});

// iOS 16–18 Safari (phones that stop at 16.7 / 18.x): Share is a button in the bottom toolbar,
// and the Add sheet has no "웹 앱으로 열기" switch (new in iOS 26).
const OLD_SAFARI = {
  '16.6': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  '17.5': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  '18.6': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
};
for (const [v, ua] of Object.entries(OLD_SAFARI)) {
  test(`install guide on Safari ${v}: the toolbar Share button, and no web-app switch anywhere`, () => {
    const env = detectEnv(ua, PHONE);
    assert.equal(env.safari, true);
    assert.equal(gateMode(env, {}), 'install');
    const html = gateHtml('install', env, { ua });
    // ① the Share button itself, lit in the middle of the bottom toolbar
    assert.ok(html.includes('화면 아래 <b>공유&nbsp;버튼</b>을&nbsp;눌러요'));
    assert.ok(html.includes('gate-art--toolbar'));
    assert.ok(html.includes('gate-art__btn--hot'), 'the Share button is lit');
    assert.ok(!html.includes('gate-art__addr--hot'), 'no press on the address bar');
    assert.ok(!html.includes('···'), 'no ··· button on these versions');
    assert.ok(!html.includes('주소창을 꾹'));
    // ② unchanged
    assert.ok(html.includes('<b>동작&nbsp;편집</b>'));
    // ③ and the closing note: no switch to look for
    assert.ok(!html.includes('웹 앱으로 열기'), 'the switch is not mentioned or drawn');
    assert.ok(!html.includes('gate-art__switch'));
    assert.ok(html.includes('<p>이름은 그대로 두고</p><p><b>추가</b>를 눌러요</p>'));
    assert.ok(html.includes('gate-art--plain'));
    assert.ok(html.includes('아이콘으로 열었는데도 이 화면이 보이면<br>아이콘을 지우고 다시 추가해&nbsp;주세요'));
    for (const step of ['공유 열기', '홈 화면에 추가', '그대로 추가']) assert.ok(html.includes(step), step);
  });
}

test('install guide: Safari 26 / 27 keep their own Share steps and the switch', () => {
  const s26 = gateHtml('install', SAFARI_ENV, { ua: safariUA(26) });
  assert.ok(!s26.includes('gate-art--toolbar'));
  assert.ok(s26.includes('<b>웹 앱으로 열기</b>를 켠&nbsp;채'));
  const s27 = gateHtml('install', SAFARI_ENV, { ua: safariUA(27) });
  assert.ok(!s27.includes('gate-art--toolbar'));
  assert.ok(s27.includes('gate-art__switch'));
});

test('install guide: other iOS browsers on iOS 16 / 17 get the Add sheet without the switch', () => {
  // CriOS has no Version/, but the OS token is real below 18 (frozen at 18_x only from iOS 26).
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1';
  const html = gateHtml('install', detectEnv(ua, PHONE), { ua });
  assert.ok(html.includes('브라우저 메뉴에서 <b>공유</b>를 눌러요'));
  assert.ok(!html.includes('웹 앱으로 열기'));
  // 18_x could be iOS 18 or 26+: keep the switch, which is right for the current OS
  const html18 = gateHtml('install', detectEnv(UA.iphoneChrome, PHONE), { ua: UA.iphoneChrome });
  assert.ok(html18.includes('gate-art__switch'));
});

test('install guide step 1: other iOS browsers are sent to their own menu', () => {
  const env = detectEnv(UA.iphoneChrome, PHONE);
  const html = gateHtml('install', env, { ua: UA.iphoneChrome });
  assert.ok(html.includes('브라우저 메뉴에서 <b>공유</b>를 눌러요'));
  assert.ok(!html.includes('주소창을 꾹'));
});

test('install guide: game copy, the three steps and the home-screen icon as the picture', () => {
  const html = gateHtml('install', SAFARI_ENV, { ua: safariUA(27) });
  assert.ok(html.includes('id="gateTitle">돌주먹<'));
  assert.ok(html.includes('홈 화면에 추가하면<br>앱처럼 바로 한 판!'), 'SPEC §10 lead');
  for (const step of ['공유 열기', '홈 화면에 추가', '그대로 추가']) assert.ok(html.includes(step), step);
  assert.ok(html.includes('<b>웹 앱으로 열기</b>를 켠&nbsp;채</p><p><b>추가</b>를 눌러요'));
  assert.ok(html.includes('gate-art__row--switch'), 'Safari 26+: the switch is drawn on the Add sheet');
  assert.ok(html.includes('홈 화면의 돌주먹 아이콘으로<br>다시 열어&nbsp;주세요'));
  const icons = [...html.matchAll(/<img class="gate-icon__img" src="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(icons.length, 3, 'hero, the Add sheet drawing, the closing line');
  for (const src of icons) assert.match(src, /\/icons\/apple-touch-icon-180\.png$/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1, 'one heading for the screen');
});

test('first-run gates warn that tab 전적 do not move to the installed app', () => {
  const install = gateHtml('install', SAFARI_ENV, { ua: safariUA(27) });
  assert.ok(install.includes('data-gate-act="play">설치 없이 해보기<'));
  assert.ok(install.includes('여기서 쌓은 전적은 설치한 앱으로 옮겨지지 않아요'), 'SPEC §10 warning');
  // The icon added with "Open as Web App" switched off opens this same gate again.
  assert.ok(install.includes('아이콘으로 열었는데도 이 화면이 보이면'));
  assert.ok(install.includes('<b>웹 앱으로 열기</b>를 켠 채 다시 추가해&nbsp;주세요'));

  const escape = gateHtml('escape', detectEnv(UA.kakaoIos, PHONE));
  assert.ok(escape.includes('data-gate-act="play">그냥 여기서 해보기<'));
  assert.ok(escape.includes('여기서 쌓은 전적은 설치한 앱으로 옮겨지지 않아요'));
});

test('escape screen: names the app, opens Safari, keeps the manual route and the copy field', () => {
  const html = gateHtml('escape', detectEnv(UA.kakaoIos, PHONE));
  assert.ok(html.includes('카카오톡 안에서는<br>홈 화면에 추가할 수 없어요.'));
  assert.ok(html.includes(`href="kakaotalk://web/openExternal?url=${encodeURIComponent(CANONICAL_URL)}"`));
  assert.ok(html.includes('오른쪽 아래 <b>공유&nbsp;버튼</b>'));
  assert.ok(html.includes(`value="${CANONICAL_URL}"`));
  assert.ok(html.includes('data-gate-act="copy">주소 복사<'));
  const insta = gateHtml('escape', detectEnv(UA.instagramIos, PHONE));
  assert.ok(insta.includes('인스타그램 안에서는'));
  assert.ok(insta.includes('외부 브라우저에서 열기'));
  const other = gateHtml('escape', { ...SAFARI_ENV, safari: false, inApp: 'other' });
  assert.ok(other.includes('이 앱 안에서는'));
  assert.ok(other.includes('target="_blank"'), 'x-safari-https opens in a new context');
});

test('the guide opened from the menu closes back to the app and says what moves', () => {
  for (const [mode, env] of [['install', SAFARI_ENV], ['escape', detectEnv(UA.kakaoIos, PHONE)]]) {
    const html = gateHtml(mode, env, { inGame: true, ua: safariUA(27) });
    assert.ok(html.includes('data-gate-act="play">닫고 계속하기<'), mode);
    assert.ok(html.includes('설치한 앱은 전적이 새로 시작해요'), mode);
    assert.ok(!html.includes('옮겨지지 않'), mode);
    assert.ok(!html.includes('해보기<'), mode);
  }
});

test('mountGate: unknown modes draw nothing; unmount empties #gateRoot (its CSS hides it with :empty)', () => {
  const root = fakeRoot();
  assert.equal(typeof mountGate(root, 'game', SAFARI_ENV), 'function');
  assert.equal(root.innerHTML, '');
  const unmount = mountGate(root, 'install', SAFARI_ENV, { auto: false, ua: safariUA(26) });
  assert.equal(root.dataset.gate, 'install');
  assert.ok(root.innerHTML.length > 1000);
  unmount();
  assert.equal(root.innerHTML, '');
  assert.equal('gate' in root.dataset, false);
});

test('mountGate: every gate opens scrolled to the top, and closing leaves #gateRoot at the top', () => {
  // #gateRoot is the scroller and is reused: the first-run gate scrolled down to 설치 없이 해보기
  // must not make the in-game guide open part-way down (review finding 6).
  const root = fakeRoot();
  root.scrollTop = 0;
  const first = mountGate(root, 'install', SAFARI_ENV, { auto: false, ua: safariUA(26) });
  root.scrollTop = 88;                         // the user scrolled to the quiet link
  first();
  assert.equal(root.scrollTop, 0, 'reset on close');
  root.scrollTop = 88;                         // or something else left it scrolled
  const again = mountGate(root, 'install', SAFARI_ENV, { auto: false, inGame: true, ua: safariUA(26) });
  assert.equal(root.scrollTop, 0, 'reset on mount');
  again();
  const esc = mountGate(Object.assign(root, { scrollTop: 40 }), 'escape', detectEnv(UA.kakaoIos, PHONE), { auto: false });
  assert.equal(root.scrollTop, 0, 'the escape screen too');
  esc();
});

// ---------------------------------------------------------------------------
// registerSW: when a new worker takes over, the reload waits for a moment that costs nothing
// ---------------------------------------------------------------------------

const RELOAD_GUARD = 'omok.sw.reloadAt';

// Just enough of a browser for registerSW. Events are delivered the way the DOM does it:
// capture listeners first, and stopImmediatePropagation() ends the delivery.
function fakeBrowser({ controller = {}, hostname = 'example.github.io', search = '', visibility = 'visible' } = {}) {
  const log = { reloads: 0, saves: 0, updates: 0, registered: [], order: [] };
  const swListeners = {};
  const docListeners = [];
  let winListeners = [];
  const session = new Map();
  const sheetRoot = { childElementCount: 0 };

  const fake = {
    navigator: {
      userAgent: '',
      serviceWorker: {
        controller,
        addEventListener(type, fn) { swListeners[type] = fn; },
        async register(url, opts) {
          log.registered.push([url, opts]);
          return { async update() { log.updates += 1; } };
        },
      },
    },
    location: { hostname, search, href: `https://${hostname}/omok-fighter/`, reload() { log.reloads += 1; log.order.push('reload'); } },
    document: {
      visibilityState: visibility,
      addEventListener(type, fn, capture) { docListeners.push({ type, fn, capture: capture === true }); },
      getElementById: (id) => (id === 'sheetRoot' ? sheetRoot : null),
    },
    window: {
      addEventListener(type, fn, capture) { winListeners.push({ type, fn, capture: capture === true }); },
      removeEventListener(type, fn) { winListeners = winListeners.filter((l) => l.type !== type || l.fn !== fn); },
    },
    sessionStorage: {
      getItem: (k) => (session.has(k) ? session.get(k) : null),
      setItem: (k, v) => { session.set(k, String(v)); },
    },
  };

  function deliver(listeners, type) {
    let stopped = false;
    const event = { type, stopImmediatePropagation() { stopped = true; } };
    const ordered = [...listeners.filter((l) => l.capture), ...listeners.filter((l) => !l.capture)];
    for (const l of ordered) {
      if (stopped) break;
      if (l.type === type) l.fn(event);
    }
  }

  const saved = {};
  for (const [name, value] of Object.entries(fake)) {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  return {
    log,
    session,
    sheetRoot,
    restore() {
      for (const [name, desc] of Object.entries(saved)) {
        if (desc) Object.defineProperty(globalThis, name, desc);
        else delete globalThis[name];
      }
    },
    newWorkerTakesOver() { swListeners.controllerchange(); },
    input(type = 'pointerdown') {
      for (const l of [...winListeners]) if (l.type === type) l.fn({ type });
    },
    setVisibility(state) {
      fake.document.visibilityState = state;
      deliver(docListeners, 'visibilitychange');
    },
    pagehide() { deliver(winListeners, 'pagehide'); },
    // Stand-ins for the app's own handlers: resuming the match on show, saving on hide.
    onAppVisible(fn) {
      fake.document.addEventListener('visibilitychange', () => {
        if (fake.document.visibilityState === 'visible') fn();
      });
    },
    onAppHide(fn) {
      fake.document.addEventListener('visibilitychange', () => {
        if (fake.document.visibilityState === 'hidden') fn();
      });
      fake.window.addEventListener('pagehide', fn);
    },
  };
}

async function withBrowser(opts, run) {
  const b = fakeBrowser(opts);
  try {
    await run(b);
  } finally {
    b.restore();
  }
}

test('registerSW: registers, and checks for an update on launch and on every return', async () => {
  await withBrowser({}, async (b) => {
    const reg = await registerSW({});
    assert.ok(reg);
    assert.deepEqual(b.log.registered, [['sw.js', { updateViaCache: 'none' }]]);
    assert.equal(b.log.updates, 1);
    b.setVisibility('hidden');
    assert.equal(b.log.updates, 1);
    b.setVisibility('visible');
    assert.equal(b.log.updates, 2);
  });
});

test('registerSW: localhost is skipped unless ?sw=1', async () => {
  await withBrowser({ hostname: 'localhost' }, async (b) => {
    assert.equal(await registerSW({}), null);
    assert.equal(b.log.registered.length, 0);
  });
  await withBrowser({ hostname: '127.0.0.1', search: '?play=1&sw=1' }, async (b) => {
    assert.ok(await registerSW({}));
    assert.equal(b.log.registered.length, 1);
  });
});

test('registerSW: the first worker claiming a fresh page is not an update', async () => {
  await withBrowser({ controller: null }, async (b) => {
    await registerSW({ canReload: () => true });
    b.newWorkerTakesOver();
    assert.equal(isUpdatePending(), false);
    assert.equal(b.log.reloads, 0);
    // The one after that replaces a controller: that is a new version.
    b.newWorkerTakesOver();
    assert.equal(b.log.reloads, 1);
  });
});

test('registerSW: a new worker never reloads a match in progress; it waits for the next return', async () => {
  await withBrowser({}, async (b) => {
    let resumes = 0;
    await registerSW({ beforeReload: () => { b.log.saves += 1; b.log.order.push('save'); } });
    b.onAppVisible(() => { resumes += 1; });

    // Seconds into the session, with a match or a victory motion on screen.
    b.newWorkerTakesOver();
    assert.equal(b.log.reloads, 0, 'nothing on screen is interrupted');
    assert.equal(isUpdatePending(), true);

    b.setVisibility('hidden');
    assert.equal(b.log.reloads, 0, 'never from the background');

    b.setVisibility('visible');
    assert.deepEqual(b.log.order, ['save', 'reload'], 'saved, then reloaded');
    assert.equal(resumes, 0, 'the old page did not resume the match before the reload');

    // Anything that asks again while the reload is under way is told to stand down.
    assert.equal(applyPendingUpdate(), true);
    assert.equal(b.log.reloads, 1);
  });
});

test('registerSW: the page that is being reloaded does not save again on its way out', async () => {
  // A reload fires "hidden" and pagehide on the old page. The app saves on both; beforeReload
  // already has.
  await withBrowser({}, async (b) => {
    let hides = 0;
    await registerSW({});
    b.onAppHide(() => { hides += 1; });

    b.setVisibility('hidden');
    b.pagehide();
    assert.equal(hides, 2, 'ordinary hides reach the app');

    b.newWorkerTakesOver();
    b.setVisibility('visible');
    assert.equal(b.log.reloads, 1);
    b.setVisibility('hidden');
    b.pagehide();
    assert.equal(hides, 2, 'the unload of the reload does not');
  });
});

test('registerSW: reloads at once only when the page says the screen is idle and nothing was touched', async () => {
  await withBrowser({}, async (b) => {
    const asked = [];
    await registerSW({ beforeReload: () => { b.log.saves += 1; }, canReload: (when) => { asked.push(when); return true; } });
    b.newWorkerTakesOver();
    assert.deepEqual(asked, ['now']);
    assert.equal(b.log.saves, 1);
    assert.equal(b.log.reloads, 1);
  });

  await withBrowser({}, async (b) => {
    await registerSW({ canReload: () => false });
    b.newWorkerTakesOver();
    assert.equal(b.log.reloads, 0, 'a busy screen (match, K.O., sheet) is left alone');
    assert.equal(isUpdatePending(), true);
  });

  await withBrowser({}, async (b) => {
    await registerSW({ canReload: () => true });
    b.input('pointerdown');
    b.newWorkerTakesOver();
    assert.equal(b.log.reloads, 0, 'the player is already using the app');
    assert.equal(isUpdatePending(), true);
  });

  await withBrowser({}, async (b) => {
    await registerSW({ canReload: () => true });
    b.input('keydown');
    b.newWorkerTakesOver();
    assert.equal(b.log.reloads, 0);
  });

  await withBrowser({ visibility: 'hidden' }, async (b) => {
    await registerSW({ canReload: () => true });
    b.newWorkerTakesOver();
    assert.equal(b.log.reloads, 0, 'not while hidden');
    b.setVisibility('visible');
    assert.equal(b.log.reloads, 1);
  });
});

test('registerSW: on a return, an open sheet or a veto from the page postpones the reload', async () => {
  await withBrowser({}, async (b) => {
    let resumes = 0;
    await registerSW({});
    b.onAppVisible(() => { resumes += 1; });
    b.newWorkerTakesOver();

    b.sheetRoot.childElementCount = 1;       // the pause menu open, then a trip to another app
    b.setVisibility('hidden');
    b.setVisibility('visible');
    assert.equal(b.log.reloads, 0);
    assert.equal(resumes, 1, 'the page carries on as usual');

    b.sheetRoot.childElementCount = 0;
    b.setVisibility('hidden');
    b.setVisibility('visible');
    assert.equal(b.log.reloads, 1);
    assert.equal(resumes, 1);
  });

  await withBrowser({}, async (b) => {
    const asked = [];
    let allow = false;
    await registerSW({ canReload: (when) => { asked.push(when); return allow; } });
    b.newWorkerTakesOver();
    b.setVisibility('hidden');
    b.setVisibility('visible');
    assert.deepEqual(asked, ['now', 'show']);
    assert.equal(b.log.reloads, 0);
    allow = true;
    assert.equal(applyPendingUpdate(), true, 'the page can also apply it itself');
    assert.equal(b.log.reloads, 1);
  });

  await withBrowser({}, async (b) => {
    await registerSW({ canReload: () => { throw new Error('boom'); } });
    b.newWorkerTakesOver();
    b.setVisibility('hidden');
    b.setVisibility('visible');
    assert.equal(b.log.reloads, 0, 'a failing check counts as no');
  });
});

test('registerSW: two reloads are never closer than 30 s', async () => {
  await withBrowser({}, async (b) => {
    let resumes = 0;
    await registerSW({});
    b.onAppVisible(() => { resumes += 1; });
    b.session.set(RELOAD_GUARD, String(Date.now() - 5000));
    b.newWorkerTakesOver();
    b.setVisibility('hidden');
    b.setVisibility('visible');
    assert.equal(b.log.reloads, 0);
    assert.equal(resumes, 1);
    assert.equal(isUpdatePending(), true, 'still waiting');

    b.session.set(RELOAD_GUARD, String(Date.now() - 31000));
    b.setVisibility('hidden');
    b.setVisibility('visible');
    assert.equal(b.log.reloads, 1);
    assert.ok(Date.now() - Number(b.session.get(RELOAD_GUARD)) < 2000, 'the guard is re-armed');
  });
});

test('applyPendingUpdate: nothing pending, nothing happens', async () => {
  await withBrowser({}, async (b) => {
    await registerSW({});
    assert.equal(isUpdatePending(), false);
    assert.equal(applyPendingUpdate(), false);
    b.setVisibility('hidden');
    b.setVisibility('visible');
    assert.equal(b.log.reloads, 0);
  });
});

// ---------------------------------------------------------------------------
// Page shell: index.html inline scripts and the layout rules in the CSS that depend on how the
// page is displayed (installed app or browser tab)
// ---------------------------------------------------------------------------

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const APP_CSS = stripComments(readFileSync(new URL('../css/app.css', import.meta.url), 'utf8'));
const GATE_CSS = stripComments(readFileSync(new URL('../css/gate.css', import.meta.url), 'utf8'));
const inlineScripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

test('layout height: 100vh for the installed app, the dynamic viewport in a browser tab', () => {
  // One token carries the page height (pwa.md §1 CSS): 100vh in the installed app (dvh or %
  // leave a gap under the translucent status bar on a cold start), 100dvh in a Safari tab.
  assert.equal((APP_CSS.match(/100vh/g) || []).length, 1, 'only the --vh token itself says 100vh');
  assert.match(APP_CSS, /:root\s*\{[^}]*--vh:\s*100vh;/);
  assert.match(
    APP_CSS,
    /@supports \(height: 100dvh\)\s*\{\s*@media not all and \(display-mode: standalone\)\s*\{\s*:root:not\(\[data-display='standalone'\]\)\s*\{\s*--vh:\s*100dvh;/,
  );
  assert.match(APP_CSS, /html,\s*body\s*\{[^}]*height:\s*var\(--vh\);/);
  assert.ok(!/100d?vh/.test(GATE_CSS), 'the gate fills #gateRoot (position:fixed; inset:0) instead');
});

test('the gate layer is opaque, scrolls on its own and respects the safe areas', () => {
  const rule = /#gateRoot:not\(:empty\)\s*\{([^}]*)\}/.exec(GATE_CSS);
  assert.ok(rule);
  assert.match(rule[1], /position:\s*fixed;/);
  assert.match(rule[1], /inset:\s*0;/);
  assert.match(rule[1], /background-color:\s*var\(--gate-bg\);/);
  assert.match(rule[1], /overflow-y:\s*auto;/);
  assert.match(rule[1], /touch-action:\s*pan-y;/);
  assert.match(GATE_CSS, /--gate-bg:\s*var\(--bg,\s*#17121F\);/, 'a literal fallback if app.css is missing');
  assert.match(GATE_CSS, /#gateRoot:empty\s*\{\s*display:\s*none;/);
  for (const side of ['top', 'right', 'bottom', 'left']) assert.match(GATE_CSS, new RegExp(`env\\(safe-area-inset-${side}, 0px\\)`));
  assert.match(GATE_CSS, /@font-face\s*\{[^}]*font-family:\s*'BHS';[^}]*url\('\.\.\/fonts\/bhs\.woff2'\)[^}]*font-display:\s*swap;/);
});

test('index.html marks the installed iOS app so it never gets the tab layout', () => {
  const script = inlineScripts.find((code) => code.includes('data-display'));
  assert.ok(script, 'the marker script is in the page');
  assert.ok(HTML.indexOf('data-display') < HTML.indexOf('<div id="app">'), 'it runs before the app is laid out');
  const run = (standalone) => {
    const attrs = {};
    vm.runInNewContext(script, {
      navigator: { standalone },
      document: { documentElement: { setAttribute(k, v) { attrs[k] = v; } } },
    });
    return attrs;
  };
  assert.deepEqual(run(true), { 'data-display': 'standalone' });
  assert.deepEqual(run(false), {});
  assert.deepEqual(run(undefined), {});
});

test('index.html stops pinch zoom and the long-press callout before the modules load', () => {
  const script = inlineScripts.find((code) => code.includes('gesturestart'));
  assert.ok(script, 'the guard script is in the page');
  assert.ok(HTML.indexOf('gesturestart') < HTML.indexOf('<script type="module" src="js/main.js">'), 'before the module script');
  const docL = [];
  const appL = [];
  vm.runInNewContext(script, {
    document: {
      addEventListener: (type, fn, opts) => docL.push({ type, fn, opts }),
      getElementById: (id) => (id === 'app' ? { addEventListener: (type, fn) => appL.push({ type, fn }) } : null),
    },
  });
  for (const type of ['gesturestart', 'gesturechange']) {
    const l = docL.find((x) => x.type === type);
    assert.ok(l, type);
    assert.equal(l.opts.passive, false, `${type} must be able to preventDefault`);
    let prevented = false;
    l.fn({ preventDefault() { prevented = true; } });
    assert.ok(prevented, type);
  }
  assert.ok(appL.find((x) => x.type === 'contextmenu'), 'no callout on the app');
  const touch = docL.find((x) => x.type === 'touchstart');
  assert.ok(touch && touch.opts.passive === true, 'passive touchstart for :active styles');
});

// Runs the load watchdog from index.html against a minimal fake page.
function runWatchdog() {
  const script = inlineScripts.find((code) => code.includes('Load watchdog'));
  assert.ok(script, 'the watchdog script is in the page');
  assert.ok(
    HTML.indexOf('Load watchdog') > HTML.indexOf('<script type="module" src="js/main.js"></script>'),
    'it comes right after the module script, so it runs before load or error can fire',
  );
  const handlers = {};
  const timers = [];
  const page = { reloads: 0 };
  const makeEl = () => {
    const el = {
      children: [],
      parentNode: null,
      attrs: {},
      listeners: {},
      innerHTML: '',
      setAttribute(k, v) { el.attrs[k] = v; },
      addEventListener(type, fn) { el.listeners[type] = fn; },
      appendChild(child) { child.parentNode = el; el.children.push(child); },
      removeChild(child) { el.children = el.children.filter((c) => c !== child); child.parentNode = null; },
      querySelector() { return el.button || (el.button = makeEl()); },
    };
    return el;
  };
  const root = makeEl();
  vm.runInNewContext(script, {
    document: {
      querySelector: (sel) => (sel === 'script[type="module"][src="js/main.js"]'
        ? { addEventListener(type, fn) { handlers[type] = fn; } } : null),
      getElementById: (id) => (id === 'gateRoot' ? root : null),
      createElement: () => makeEl(),
    },
    location: { reload() { page.reloads += 1; } },
    setTimeout(fn, ms) { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cleared = true; },
  });
  return { page, root, handlers, timers };
}

test('load watchdog: a module that cannot be fetched shows a notice with a retry', () => {
  const { page, root, handlers, timers } = runWatchdog();
  assert.equal(root.children.length, 0, 'nothing is shown while loading');
  handlers.error();
  assert.equal(root.children.length, 1);
  const notice = root.children[0];
  assert.equal(notice.className, 'gate gate--notice', 'styled by css/gate.css, which has its own fallbacks');
  assert.equal(notice.attrs.role, 'alert');
  assert.match(notice.innerHTML, /불러오지 못했어요/);
  assert.match(notice.innerHTML, /다시 시도/);
  assert.ok(timers[0].cleared, 'the slow-load timer is cancelled');
  notice.button.listeners.click();
  assert.equal(page.reloads, 1);
});

test('load watchdog: a slow load gets a notice that steps aside when the game arrives', () => {
  const { root, handlers, timers } = runWatchdog();
  assert.equal(timers.length, 1);
  assert.ok(timers[0].ms >= 10000, 'generous: sixty files on a weak connection take a while');
  timers[0].fn();
  assert.equal(root.children.length, 1);
  assert.match(root.children[0].innerHTML, /불러오는 중이에요/);
  handlers.load();
  assert.equal(root.children.length, 0, '#gateRoot is empty again, so it no longer covers the app');
});

test('load watchdog: a normal load shows nothing', () => {
  const { root, handlers, timers } = runWatchdog();
  handlers.load();
  assert.ok(timers[0].cleared);
  assert.equal(root.children.length, 0);
});

// ---------------------------------------------------------------------------
// js/wake.js: the screen stays on during a match
// ---------------------------------------------------------------------------

// A fresh copy of the module per test (it keeps the wish and the lock in module state).
let wakeCopy = 0;
const freshWake = () => import(`../js/wake.js?copy=${(wakeCopy += 1)}`);

function fakeWakeBrowser({ supported = true, deny = false } = {}) {
  const log = { requests: 0, releases: 0 };
  const docL = {};
  const winL = {};
  const doc = {
    visibilityState: 'visible',
    addEventListener(type, fn) { (docL[type] ||= []).push(fn); },
  };
  const makeLock = () => {
    const lock = {
      released: false,
      listeners: [],
      addEventListener(type, fn) { if (type === 'release') lock.listeners.push(fn); },
      async release() { if (!lock.released) { lock.released = true; log.releases += 1; lock.listeners.forEach((f) => f()); } },
    };
    return lock;
  };
  let current = null;
  const nav = supported ? {
    wakeLock: {
      async request(type) {
        assert.equal(type, 'screen');
        log.requests += 1;
        if (deny || doc.visibilityState !== 'visible') throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
        current = makeLock();
        return current;
      },
    },
  } : {};
  const saved = {};
  for (const [name, value] of Object.entries({ navigator: nav, document: doc, window: { addEventListener(type, fn) { (winL[type] ||= []).push(fn); } } })) {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  return {
    log,
    lock: () => current,
    // The system drops the lock when the page is hidden, then the page comes back.
    hide() { doc.visibilityState = 'hidden'; if (current) current.release(); (docL.visibilitychange || []).forEach((f) => f()); },
    show() { doc.visibilityState = 'visible'; (docL.visibilitychange || []).forEach((f) => f()); },
    restore() {
      for (const [name, desc] of Object.entries(saved)) {
        if (desc) Object.defineProperty(globalThis, name, desc);
        else delete globalThis[name];
      }
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('wake lock: held during a match, asked again after the app comes back, released at the end', async () => {
  const b = fakeWakeBrowser();
  try {
    const { keepAwake } = await freshWake();
    keepAwake(true);
    await tick();
    assert.equal(b.log.requests, 1);
    keepAwake(true);
    await tick();
    assert.equal(b.log.requests, 1, 'a held lock is not requested twice');

    b.hide();
    await tick();
    assert.equal(b.lock().released, true, 'the system dropped it');
    b.show();
    await tick();
    assert.equal(b.log.requests, 2, 're-requested on visible');
    assert.equal(b.lock().released, false);

    keepAwake(false);
    await tick();
    assert.equal(b.lock().released, true);
    b.hide();
    b.show();
    await tick();
    assert.equal(b.log.requests, 2, 'no wish, no lock');
  } finally {
    b.restore();
  }
});

test('wake lock: unsupported or denied is silent', async () => {
  for (const opts of [{ supported: false }, { deny: true }]) {
    const b = fakeWakeBrowser(opts);
    try {
      const { keepAwake } = await freshWake();
      assert.doesNotThrow(() => keepAwake(true));
      await tick();
      assert.doesNotThrow(() => keepAwake(false));
      await tick();
    } finally {
      b.restore();
    }
  }
});

test('wake lock: a stop that arrives while the request is in flight wins', async () => {
  const b = fakeWakeBrowser();
  try {
    const { keepAwake } = await freshWake();
    keepAwake(true);
    keepAwake(false);
    await tick();
    await tick();
    assert.equal(b.log.requests, 1);
    assert.equal(b.lock().released, true, 'the late lock is let go at once');
  } finally {
    b.restore();
  }
});
