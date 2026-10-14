// Environment detection, the two gate screens (install guide / in-app escape), sharing and
// service-worker registration (SPEC §8.7, §10; ported from the owner's 품알, docs/research/pwa.md §1).
//
// Nothing here touches the DOM at module top level (only typeof-guarded listeners), so the
// pure parts (detectEnv, gateMode, escapeLink) import cleanly in node for tests.

export const CANONICAL_URL = 'https://jinjoskim2001-sketch.github.io/omok-fighter/';

const APP_NAME = '돌주먹';
const SHARE_TITLE = '돌주먹 — 오목 파이터';
const SHARE_TEXT = '친구랑 한 폰으로 붙는 캐릭터 오목, 돌주먹! 링크 열고 홈 화면에 추가하면 바로 한 판이에요.';

// The gate's picture is the home-screen icon itself, so people recognise it on the Add sheet
// and on their home screen. Resolved from this module, so the demo harness under tools/ finds
// it too; the service worker serves it from the precache (ignoreSearch, same folder).
const ICON_URL = new URL('../icons/apple-touch-icon-180.png', import.meta.url).href;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

// Order matters: Threads identifies as "Barcelona" and must win over the Meta catch-alls.
const IN_APP_RULES = [
  ['kakaotalk', /kakaotalk/i],
  ['line', /\bLine\//i],
  ['threads', /\bBarcelona/i],
  ['instagram', /\bInstagram/i],
  ['facebook', /\bFB[\w_]+\/|FBAN|FBAV|FB_IAB/i],
  ['naver', /NAVER\(inapp/i],
  ['daum', /DaumApps/i],
  // No dedicated escape exists for these; they share the generic instructions.
  ['other', /musical_ly|Bytedance|\bTwitter|MicroMessenger\/|\bGSA\//i],
];

// Real browsers on iOS that carry "Safari/" in the UA but are not Safari.
const NOT_SAFARI = /Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|OPiOS|OPR\/|OPT\/|Android|DuckDuckGo|Whale|SamsungBrowser|YaBrowser/i;

function defaultUA() {
  return (typeof navigator !== 'undefined' && navigator.userAgent) || '';
}

function isStandaloneDisplay() {
  if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
  if (typeof matchMedia === 'function') {
    try {
      return matchMedia('(display-mode: standalone)').matches;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * @param {string} [ua]
 * @param {{ platform?: string, maxTouchPoints?: number, standalone?: boolean }} [ctx]
 *   Overrides for the non-UA signals. Only tests pass this; the app calls detectEnv().
 * @returns {{ standalone: boolean, ios: boolean, android: boolean, safari: boolean,
 *   inApp: null | 'kakaotalk' | 'line' | 'instagram' | 'threads' | 'facebook' | 'naver' | 'daum' | 'other' }}
 */
export function detectEnv(ua = defaultUA(), ctx = {}) {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const platform = ctx.platform ?? nav.platform ?? '';
  const touchPoints = ctx.maxTouchPoints ?? nav.maxTouchPoints ?? 0;
  const standalone = ctx.standalone ?? isStandaloneDisplay();

  const iDevice = /iPhone|iPad|iPod/.test(ua);
  // iPadOS asks for desktop sites by default and then claims to be a Mac; the touch points
  // are the only tell.
  const iPadAsMac = !iDevice && /Macintosh/.test(ua) && platform === 'MacIntel' && touchPoints > 1;
  const ios = iDevice || iPadAsMac;
  const android = /Android/i.test(ua);

  let inApp = null;
  // Standalone goes first: an installed iOS web app has no "Safari/" token either, and it
  // must never be mistaken for a webview.
  if (!standalone) {
    for (const [name, re] of IN_APP_RULES) {
      if (re.test(ua)) {
        inApp = name;
        break;
      }
    }
    if (!inApp && ios && !/Safari\//.test(ua)) inApp = 'other';
  }

  const safari = !standalone && !inApp && /Safari\//.test(ua) && !NOT_SAFARI.test(ua);

  return { standalone, ios, android, safari, inApp };
}

// Safari's own major version ("Version/27.0"): where Safari keeps its Share button and whether
// its Add sheet has the "웹 앱으로 열기" switch (26+). The OS token is frozen at 18_x since iOS 26,
// so it only counts below 18, where Safari's version is the OS's. null when nothing says
// (other browsers, webviews, the installed app, an 18_x token without Version/).
function safariMajor(ua) {
  const m = /\bVersion\/(\d+)/.exec(ua || '');
  if (m) return Number(m[1]);
  const os = /\bOS (\d+)_\d+/.exec(ua || '');
  return os && Number(os[1]) < 18 ? Number(os[1]) : null;
}

/**
 * @returns {'game' | 'install' | 'escape'}
 */
export function gateMode(env, { forcePlay = false, trial = false } = {}) {
  if (forcePlay || env.standalone) return 'game';
  if (!env.ios) return 'game';
  if (trial) return 'game';
  return env.inApp ? 'escape' : 'install';
}

// ---------------------------------------------------------------------------
// Escape links (pure)
// ---------------------------------------------------------------------------

function withParam(url, key, value) {
  const hashAt = url.indexOf('#');
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  return `${base}${base.includes('?') ? '&' : '?'}${key}=${value}${hash}`;
}

/**
 * The best "leave this in-app browser" link for an app.
 * `sync` means the scheme only works when set synchronously inside a real tap handler.
 * `href` is the current page URL; LINE needs it to know whether its official parameter
 * has already been tried.
 * @returns {{ href: string, target: string | null, sync: boolean }}
 */
export function escapeLink(inApp, { canonical = CANONICAL_URL, href = '' } = {}) {
  const enc = encodeURIComponent(canonical);
  switch (inApp) {
    case 'kakaotalk':
      return { href: `kakaotalk://web/openExternal?url=${enc}`, target: null, sync: true };
    case 'instagram':
      return { href: `instagram://extbrowser/?url=${enc}`, target: null, sync: true };
    case 'threads':
      return { href: `barcelona://extbrowser/?url=${enc}`, target: null, sync: true };
    case 'line':
      // openExternalBrowser=1 is LINE's documented switch. If it is already in the URL and
      // we are still inside LINE, it did not work, so fall through to the Safari scheme.
      if (!/[?&]openExternalBrowser=1\b/.test(href)) {
        return { href: withParam(canonical, 'openExternalBrowser', '1'), target: null, sync: false };
      }
      break;
    default:
      break;
  }
  return { href: canonical.replace(/^https:\/\//, 'x-safari-https://'), target: '_blank', sync: false };
}

// ---------------------------------------------------------------------------
// Small DOM helpers (only called from functions)
// ---------------------------------------------------------------------------

function sessionGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Private mode: the guard is lost, the worst case is one extra redirect attempt.
  }
}

async function copyText(text, input) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      // Raced against a short timer: some embedded browsers leave this promise pending
      // forever, and the selection path below only works while the tap is still fresh.
      const done = await Promise.race([
        navigator.clipboard.writeText(text).then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 700)),
      ]);
      if (done) return true;
    }
  } catch {
    // Webviews often deny the async clipboard; fall through to the selection path.
  }
  let field = input;
  let temp = null;
  try {
    if (!field) {
      temp = document.createElement('input');
      temp.value = text;
      temp.readOnly = true;
      temp.style.cssText = 'position:fixed;left:0;top:0;opacity:0;font-size:16px;';
      document.body.appendChild(temp);
      field = temp;
    }
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    if (temp) temp.remove();
  }
}

// ---------------------------------------------------------------------------
// The app icon (hero, the Add sheet drawing, the closing line)
// ---------------------------------------------------------------------------

function appIconHtml(extraClass = '') {
  // Decorative: the name is always written next to it.
  return (
    `<span class="gate-icon ${extraClass}" aria-hidden="true">` +
    `<img class="gate-icon__img" src="${ICON_URL}" alt="" width="180" height="180" decoding="async" draggable="false">` +
    `</span>`
  );
}

// ---------------------------------------------------------------------------
// Illustration glyphs — generic line icons drawn here, no platform artwork.
// ---------------------------------------------------------------------------

const G_ATTR = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
const GLYPH = {
  share: `<svg class="gate-g" ${G_ATTR}><path d="M12 14.5V3.5M7.8 7.2 12 3l4.2 4.2M8.5 10.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2h-1.5"/></svg>`,
  dots: `<svg class="gate-g" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="2.1"/><circle cx="12" cy="12" r="2.1"/><circle cx="19" cy="12" r="2.1"/></svg>`,
  plus: `<svg class="gate-g" ${G_ATTR}><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M12 8.2v7.6M8.2 12h7.6"/></svg>`,
  back: `<svg class="gate-g" ${G_ATTR}><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>`,
  fwd: `<svg class="gate-g" ${G_ATTR}><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg>`,
  book: `<svg class="gate-g" ${G_ATTR}><path d="M12 6.5c-2-1.6-4.6-2-7.5-1.6v13c2.9-.4 5.5 0 7.5 1.6 2-1.6 4.6-2 7.5-1.6v-13c-2.9-.4-5.5 0-7.5 1.6Zm0 0v13"/></svg>`,
  tabs: `<svg class="gate-g" ${G_ATTR}><rect x="8" y="8" width="12.5" height="12.5" rx="3"/><path d="M16 4.5H7.5a3 3 0 0 0-3 3V16"/></svg>`,
  out: `<svg class="gate-g" ${G_ATTR}><path d="M13 4.5h6.5V11M19 5 10.5 13.5M10 6.5H6.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V14"/></svg>`,
};

// Step ①: a compact browser toolbar and the Share row it leads to. What is lit depends on
// where that Safari keeps Share (docs/research/pwa.md §2 "Where Share is"):
//   'toolbar' — Safari 16–18 (iOS 16–18): the Share button itself, middle of the bottom toolbar
//   'dots' — Safari 26 and other browsers: the ··· button beside the address bar
//   'hold' — Safari 27+: that button became Tabs; press and hold the address bar instead
//   'both' — version unknown: light both ways in
function artShare(kind) {
  if (kind === 'toolbar') {
    // Address bar over the five-button toolbar (the Tab Bar layout; Single Tab keeps the same
    // toolbar at the bottom). Share opens the sheet directly: no menu row to show.
    return (
      `<div class="gate-art gate-art--share gate-art--toolbar">` +
      `<div class="gate-art__bar"><span class="gate-art__addr"><i></i></span></div>` +
      `<div class="gate-art__tools">` +
      `<span class="gate-art__tool">${GLYPH.back}</span>` +
      `<span class="gate-art__tool">${GLYPH.fwd}</span>` +
      `<span class="gate-art__btn gate-art__btn--hot">${GLYPH.share}</span>` +
      `<span class="gate-art__tool">${GLYPH.book}</span>` +
      `<span class="gate-art__tool">${GLYPH.tabs}</span>` +
      `</div></div>`
    );
  }
  const hold = kind !== 'dots';
  const dots = kind !== 'hold';
  return (
    `<div class="gate-art gate-art--share${kind === 'hold' ? ' gate-art--hold' : ''}">` +
    `<div class="gate-art__pop"><span>공유</span>${GLYPH.share}</div>` +
    `<div class="gate-art__bar">` +
    `<span class="gate-art__btn">${GLYPH.back}</span>` +
    `<span class="gate-art__addr${hold ? ' gate-art__addr--hot' : ''}"><i></i></span>` +
    `<span class="gate-art__btn${dots ? ' gate-art__btn--hot' : ''}">${dots ? GLYPH.dots : GLYPH.tabs}</span>` +
    `</div></div>`
  );
}

// Step ②: the action list with the row to pick.
const ART_ADD =
  `<div class="gate-art gate-art--list">` +
  `<div class="gate-art__row"><i></i><b></b></div>` +
  `<div class="gate-art__row gate-art__row--hot"><span>홈 화면에 추가</span>${GLYPH.plus}</div>` +
  `<div class="gate-art__row"><i class="gate-art__short"></i><b></b></div>` +
  `</div>`;

// Step ③: the confirm sheet — switch left on (Safari 26+), then the add button. Before 26 the
// sheet has no switch: the name, the address, and 추가.
function artConfirm(webAppSwitch = true) {
  return (
    `<div class="gate-art gate-art--confirm${webAppSwitch ? '' : ' gate-art--plain'}">` +
    `<div class="gate-art__top"><span class="gate-art__cancel"></span><span class="gate-art__add">추가</span></div>` +
    `<div class="gate-art__app">${appIconHtml('gate-icon--tiny')}<span>${APP_NAME}</span></div>` +
    (webAppSwitch
      ? `<div class="gate-art__row gate-art__row--switch"><span>웹 앱으로 열기</span><span class="gate-art__switch"></span></div>`
      : `<div class="gate-art__row gate-art__row--url"><i></i></div>`) +
    `</div>`
  );
}

// Escape: where the button to tap sits in the in-app browser, and the row it leads to.
function artInApp({ corner, glyph, row }) {
  const bar =
    `<div class="gate-art__bar gate-art__bar--${corner}">` +
    `<span class="gate-art__btn">${GLYPH.back}</span>` +
    `<span class="gate-art__addr"><i></i></span>` +
    `<span class="gate-art__btn gate-art__btn--hot">${GLYPH[glyph]}</span>` +
    `</div>`;
  const pop = `<div class="gate-art__pop"><span>${row}</span>${GLYPH.out}</div>`;
  return (
    `<div class="gate-art gate-art--inapp gate-art--${corner}">` +
    (corner === 'top' ? bar + pop : pop + bar) +
    `</div>`
  );
}

// Manual route out of each in-app browser (iPhone), from 품알's field notes. KakaoTalk is where
// friends will mostly share the link.
const IN_APP_INFO = {
  kakaotalk: {
    label: '카카오톡',
    where: '오른쪽 아래 <b>공유&nbsp;버튼</b>',
    pick: 'Safari로 열기',
    art: { corner: 'bottom', glyph: 'share', row: 'Safari로 열기' },
  },
  line: {
    label: '라인',
    where: '오른쪽 아래 <b>공유&nbsp;버튼</b>',
    pick: 'Safari로 열기',
    art: { corner: 'bottom', glyph: 'share', row: 'Safari로 열기' },
  },
  instagram: {
    label: '인스타그램',
    where: '오른쪽 위 <b>···</b> 버튼',
    pick: '외부 브라우저에서 열기',
    art: { corner: 'top', glyph: 'dots', row: '외부 브라우저' },
  },
  threads: {
    label: '스레드',
    where: '오른쪽 위 <b>···</b> 버튼',
    pick: '외부 브라우저에서 열기',
    art: { corner: 'top', glyph: 'dots', row: '외부 브라우저' },
  },
  facebook: {
    label: '페이스북',
    where: '오른쪽 위 <b>···</b> 버튼',
    pick: '외부 브라우저에서 열기',
    art: { corner: 'top', glyph: 'dots', row: '외부 브라우저' },
  },
  naver: {
    label: '네이버 앱',
    where: '오른쪽 아래 <b>···</b> 버튼',
    pick: '다른 브라우저로 열기',
    art: { corner: 'bottom', glyph: 'dots', row: '다른 브라우저' },
  },
  daum: {
    label: '다음 앱',
    where: '<b>···</b> 또는 <b>공유&nbsp;버튼</b>',
    pick: 'Safari로 열기',
    art: { corner: 'bottom', glyph: 'dots', row: 'Safari로 열기' },
  },
  other: {
    label: '이 앱',
    where: '<b>···</b> 또는 <b>공유&nbsp;버튼</b>',
    pick: 'Safari로 열기',
    art: { corner: 'bottom', glyph: 'dots', row: 'Safari로 열기' },
  },
};

// ---------------------------------------------------------------------------
// Gate markup
// ---------------------------------------------------------------------------

// First run: a tab is not the installed app. Storage is separate (WWDC23), and Safari deletes
// a site's storage after about a week of browser use without a visit (ITP); only the
// installed app is exempt. Matches in progress and 전적 live in that storage.
const TRIAL_WARNING = '여기서 쌓은 전적은 설치한 앱으로 옮겨지지 않아요<br>오래 안 열면 사라질 수도 있어요';
// Opened from the menu ("홈 화면에 추가") by someone already playing in the tab.
const IN_GAME_LABEL = '닫고 계속하기';
const IN_GAME_NOTE = '설치한 앱은 전적이 새로 시작해요<br>지금 하던 판은 여기서 마저 할 수 있어요';

function headHtml() {
  return (
    `<header class="gate__head">` +
    `<div class="gate__plate">${appIconHtml('gate-icon--hero')}</div>` +
    `<h1 class="gate__word" id="gateTitle">${APP_NAME}</h1>` +
    `<p class="gate__tape" lang="en">OMOK FIGHTER</p>`
  );
}

function footHtml(label, inGame) {
  return (
    `<footer class="gate__foot">` +
    `<button type="button" class="gate__quiet" data-gate-act="play">${inGame ? IN_GAME_LABEL : label}</button>` +
    `<p class="gate__warn">${inGame ? IN_GAME_NOTE : TRIAL_WARNING}</p>` +
    `</footer>`
  );
}

function stepTitle(n, title) {
  return `<h2><span class="gate-step__num" aria-hidden="true">${n}</span>${title}</h2>`;
}

// Which way into Share to show first (see artShare).
function shareKind(env, ua) {
  if (!env || !env.safari) return 'dots';
  const major = safariMajor(ua);
  if (major === null) return 'both';
  if (major < 26) return 'toolbar';
  return major >= 27 ? 'hold' : 'dots';
}

function shareStepHtml(env, kind) {
  // Non-Safari iOS browsers keep their share button in their own menu; the rest is the same sheet.
  // &nbsp; glues the last two words of a line ("→ 공유", "바로 눌러요", ...): text-wrap is
  // ignored before Safari 17.5 / 26, and keep-all would leave the last word alone on a line.
  if (env && env.ios && !env.safari) return `<p>브라우저 메뉴에서 <b>공유</b>를 눌러요</p>`;
  if (kind === 'toolbar') {
    return (
      `<p>화면 아래 <b>공유&nbsp;버튼</b>을&nbsp;눌러요</p>` +
      `<p class="gate-step__note">${GLYPH.share.replace('class="gate-g"', 'class="gate-g gate-g--inline"')} 모양이에요<br>` +
      `안 보이면 화면 맨&nbsp;아래를&nbsp;톡</p>`
    );
  }
  if (kind === 'hold') {
    return (
      `<p><b>주소창을 꾹</b> 누르고 →&nbsp;<b>공유</b></p>` +
      `<p class="gate-step__note">주소창 왼쪽 메뉴 버튼으로도&nbsp;열려요<br>공유 버튼이 보이면 바로&nbsp;눌러요</p>`
    );
  }
  if (kind === 'both') {
    return (
      `<p>주소창 옆 <b>···</b> →&nbsp;<b>공유</b></p>` +
      `<p>또는 <b>주소창을 꾹</b> →&nbsp;<b>공유</b></p>` +
      `<p class="gate-step__note">공유 버튼이 보이면 바로&nbsp;눌러요</p>`
    );
  }
  return (
    `<p>주소창 옆 <b>···</b> →&nbsp;<b>공유</b></p>` +
    `<p class="gate-step__note">주소창을 꾹 눌러도&nbsp;돼요<br>공유 버튼이 보이면 바로&nbsp;눌러요</p>`
  );
}

function installScreenHtml(env, { ua = '', inGame = false } = {}) {
  const kind = shareKind(env, ua);
  // The Add sheet before iOS 26 has no "웹 앱으로 열기" switch (every icon opens as the app).
  // Other iOS browsers carry no Version/, but their OS token is still real below 18.
  const major = safariMajor(ua);
  const webAppSwitch = !(major !== null && major < 26);
  return (
    `<section class="gate gate--install" aria-labelledby="gateTitle"><div class="gate__inner">` +
    headHtml() +
    `<p class="gate__lead">홈 화면에 추가하면<br>앱처럼 바로 한 판!</p>` +
    `</header>` +
    `<ol class="gate__steps">` +
    `<li class="gate-step"><div class="gate-step__text">${stepTitle(1, '공유 열기')}${shareStepHtml(env, kind)}</div>${artShare(kind)}</li>` +
    `<li class="gate-step"><div class="gate-step__text">${stepTitle(2, '홈 화면에 추가')}` +
    `<p>목록을 내려서 찾아&nbsp;눌러요</p>` +
    `<p class="gate-step__note">안 보이면 맨 아래 <b>동작&nbsp;편집</b></p></div>${ART_ADD}</li>` +
    `<li class="gate-step"><div class="gate-step__text">${stepTitle(3, '그대로 추가')}` +
    (webAppSwitch
      ? `<p><b>웹 앱으로 열기</b>를 켠&nbsp;채</p><p><b>추가</b>를 눌러요</p>`
      : `<p>이름은 그대로 두고</p><p><b>추가</b>를 눌러요</p>`) +
    `</div>${artConfirm(webAppSwitch)}</li>` +
    `</ol>` +
    `<div class="gate__final"><p class="gate__final-line">${appIconHtml('gate-icon--mini')}` +
    `<span>홈 화면의 ${APP_NAME} 아이콘으로<br>다시 열어&nbsp;주세요</span></p>` +
    // Safari 26+: the icon was added with "Open as Web App" switched off and opens this tab again.
    `<p class="gate__final-note">아이콘으로 열었는데도 이 화면이 보이면<br>` +
    (webAppSwitch
      ? `아이콘을 지우고 <b>웹 앱으로 열기</b>를 켠 채 다시 추가해&nbsp;주세요</p></div>`
      : `아이콘을 지우고 다시 추가해&nbsp;주세요</p></div>`) +
    footHtml('설치 없이 해보기', inGame) +
    `</div></section>`
  );
}

function escapeScreenHtml(env, link, { inGame = false } = {}) {
  const info = IN_APP_INFO[env && env.inApp] || IN_APP_INFO.other;
  const targetAttr = link.target ? ` target="${link.target}" rel="noopener"` : '';
  return (
    `<section class="gate gate--escape" aria-labelledby="gateHeadline"><div class="gate__inner">` +
    headHtml() +
    `<p class="gate__headline" id="gateHeadline">Safari에서 열어야 <br>설치할 수 있어요</p>` +
    `<p class="gate__lead gate__lead--sub">${info.label} 안에서는<br>홈 화면에 추가할 수 없어요.</p>` +
    `</header>` +
    `<a class="gate-btn gate-btn--primary" data-gate-act="open" href="${link.href}"${targetAttr}><span>Safari로 열기</span>${GLYPH.out}</a>` +
    `<div class="gate-step gate-step--manual">` +
    `<div class="gate-step__text"><h2>안 열리면 직접 열어요</h2>` +
    `<p>${info.where}</p><p>→ <b>${info.pick}</b></p></div>` +
    artInApp(info.art) +
    `</div>` +
    `<div class="gate-copy">` +
    `<input class="gate-copy__url" type="text" readonly inputmode="none" aria-label="${APP_NAME} 주소" value="${CANONICAL_URL}">` +
    `<button type="button" class="gate-btn gate-btn--ghost" data-gate-act="copy">주소 복사</button>` +
    `</div>` +
    `<p class="gate-copy__hint" role="status" aria-live="polite"></p>` +
    footHtml('그냥 여기서 해보기', inGame) +
    `</div></section>`
  );
}

// ---------------------------------------------------------------------------
// mountGate
// ---------------------------------------------------------------------------

// sessionStorage, shared with /pumal/ in a Safari tab: prefixed like every other key.
const KAKAO_GUARD = 'omok.gate.kakao';
const LINE_GUARD = 'omok.gate.line';

/**
 * Renders a gate into `root` (#gateRoot). Returns unmount().
 * @param {HTMLElement} root
 * @param {'install' | 'escape'} mode
 * @param {ReturnType<typeof detectEnv>} env
 * @param {{ onPlayHere?: () => void, auto?: boolean, inGame?: boolean, ua?: string }} [opts]
 *   auto=false disables the automatic KakaoTalk / LINE hand-off (demo harness, debug).
 *   inGame=true is the guide opened from the menu over a running app: the quiet link closes
 *   it (so does Escape) and the footer explains what moves to the installed app instead of
 *   the trial warning.
 *   ua overrides the user agent that picks the Share step (tests, demo harness).
 */
export function mountGate(root, mode, env, { onPlayHere, auto = true, inGame = false, ua = defaultUA() } = {}) {
  if (!root || (mode !== 'install' && mode !== 'escape')) return () => {};

  let alive = true;
  let autoTimer = 0;
  let copyTimer = 0;
  const link = escapeLink(env && env.inApp, { href: typeof location !== 'undefined' ? location.href : '' });

  // #gateRoot is the scroller and outlives every gate: a guide scrolled down to its quiet
  // link (the first-run gate on an SE) would otherwise open the next one part-way down, with
  // the icon and the title cut off.
  const toTop = () => {
    try { root.scrollTop = 0; } catch { /* not a scroller */ }
  };

  const render = () => {
    toTop();
    root.innerHTML = mode === 'install'
      ? installScreenHtml(env, { ua, inGame })
      : escapeScreenHtml(env, link, { inGame });
    root.dataset.gate = mode;
    toTop();
  };

  const unmount = () => {
    if (!alive) return;
    alive = false;
    clearTimeout(autoTimer);
    clearTimeout(copyTimer);
    root.removeEventListener('click', onClick);
    if (inGame && typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    toTop();                 // while it still has a box: an emptied root is display:none
    root.innerHTML = '';
    delete root.dataset.gate;
  };

  async function onCopy() {
    const input = root.querySelector('.gate-copy__url');
    const btn = root.querySelector('[data-gate-act="copy"]');
    const hint = root.querySelector('.gate-copy__hint');
    const ok = await copyText(CANONICAL_URL, input);
    if (!alive || !btn) return;
    if (ok) {
      btn.textContent = '복사했어요!';
      if (hint) hint.textContent = 'Safari 주소창에 붙여 넣어\u00a0주세요';
      if (input) input.blur();
    } else {
      // Leave the address selected so a long press can still copy it.
      if (input) {
        input.focus({ preventScroll: true });
        input.select();
      }
      if (hint) hint.textContent = '주소를 꾹 눌러 복사해\u00a0주세요';
    }
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      if (alive && btn.isConnected) btn.textContent = '주소 복사';
    }, 2200);
  }

  function playHere() {
    unmount();
    if (typeof onPlayHere === 'function') onPlayHere();
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !alive) return;
    event.preventDefault();
    playHere();
  }

  function onClick(event) {
    const target = event.target instanceof Element ? event.target.closest('[data-gate-act]') : null;
    if (!target || !root.contains(target)) return;
    const act = target.getAttribute('data-gate-act');
    if (act === 'play') {
      playHere();
    } else if (act === 'copy') {
      onCopy();
    } else if (act === 'open' && link.sync) {
      // Meta's webviews only honour the scheme when it is set synchronously in the tap.
      event.preventDefault();
      location.href = link.href;
    }
  }

  render();
  root.addEventListener('click', onClick);
  if (inGame && typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);

  if (mode === 'escape' && auto && env && env.ios) {
    if (env.inApp === 'kakaotalk' && !sessionGet(KAKAO_GUARD)) {
      sessionSet(KAKAO_GUARD, '1');
      // After a beat, so the manual instructions are on screen before the app switch.
      // The in-app browser is never closed from here: if the hand-off fails the user must
      // still have this page.
      autoTimer = setTimeout(() => {
        try {
          location.href = link.href;
        } catch {
          // An unhandled scheme must not take the gate down.
        }
      }, 350);
    } else if (env.inApp === 'line' && !sessionGet(LINE_GUARD) && !/[?&]openExternalBrowser=1\b/.test(location.href)) {
      sessionSet(LINE_GUARD, '1');
      location.replace(withParam(location.href, 'openExternalBrowser', '1'));
    }
  }

  return unmount;
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

/**
 * Must be called from a tap (iOS needs the gesture for the share sheet).
 * @returns {Promise<'shared' | 'copied' | 'failed'>}
 */
export async function shareApp() {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: CANONICAL_URL });
      return 'shared';
    } catch (err) {
      // Closing the share sheet is not an error worth a clipboard write behind the user's back.
      if (err && err.name === 'AbortError') return 'failed';
    }
  }
  if (typeof document === 'undefined') return 'failed';
  return (await copyText(CANONICAL_URL)) ? 'copied' : 'failed';
}

// ---------------------------------------------------------------------------
// Android install prompt
// ---------------------------------------------------------------------------

let deferredPrompt = null;
const installListeners = new Set();

// The event fires once, early; it has to be caught as soon as this module evaluates.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installListeners.forEach((cb) => cb(true));
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installListeners.forEach((cb) => cb(false));
  });
}

export function canPromptInstall() {
  return deferredPrompt !== null;
}

/**
 * Must be called from a tap. Resolves 'accepted' | 'dismissed' | 'unavailable'.
 */
export async function promptInstall() {
  const event = deferredPrompt;
  if (!event) return 'unavailable';
  deferredPrompt = null; // a prompt event can be used only once
  installListeners.forEach((cb) => cb(false));
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'unavailable';
  }
}

/**
 * cb(available: boolean) is called now if a prompt is already waiting, and on every change.
 * Returns an unsubscribe function.
 */
export function onInstallAvailable(cb) {
  installListeners.add(cb);
  if (deferredPrompt) cb(true);
  return () => installListeners.delete(cb);
}

/**
 * Optional Android helper: a small "앱으로 설치" pill that shows itself only while an install
 * prompt is available. Returns unmount().
 */
export function mountInstallPill(root) {
  if (typeof document === 'undefined') return () => {};
  const host = root || document.body;
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'gate-pill';
  pill.hidden = true;
  pill.textContent = '앱으로 설치';
  pill.addEventListener('click', () => {
    promptInstall();
  });
  host.appendChild(pill);
  const off = onInstallAvailable((available) => {
    pill.hidden = !available;
  });
  return () => {
    off();
    pill.remove();
  };
}

// ---------------------------------------------------------------------------
// Service worker registration
// ---------------------------------------------------------------------------

const RELOAD_GUARD = 'omok.sw.reloadAt';
const RELOAD_GUARD_MS = 30000;

// The update state of the registration made by registerSW(). One page registers once.
let swUpdate = null;

/** True while a new worker has taken over but this page still runs the previous version. */
export function isUpdatePending() {
  return Boolean(swUpdate && swUpdate.pending);
}

/**
 * Reloads into a pending update if there is one and nothing forbids it right now.
 * Call it on a return to visible (visibilitychange → visible, pageshow) BEFORE anything
 * resumes the match, and stop there when it returns true: the reloaded page restores the
 * saved match itself ("이어하기").
 * @returns {boolean} true when a reload has been started
 */
export function applyPendingUpdate() {
  return swUpdate ? swUpdate.apply('show') : false;
}

// SPEC §7: #sheetRoot is empty whenever no sheet is open (pause menu, undo request, confirms).
// A reload would close the sheet under the player's finger.
function sheetOpen() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return false;
  const root = document.getElementById('sheetRoot');
  return Boolean(root && root.childElementCount > 0);
}

/**
 * Registers sw.js and checks for an update on launch and on every return to visible (an
 * installed iOS web app is one long-lived page, so navigation-triggered checks never come).
 *
 * A new worker takes over as soon as it has installed (skipWaiting + clients.claim), which
 * is seconds into a session. Reloading right then would wipe what the player is looking at:
 * a match, a K.O. or victory motion, an open sheet. So the update is only remembered, and the
 * page reloads at a moment that costs nothing:
 *   - at once, if the page is visible, has had no input yet and `canReload('now')` says the
 *     screen is idle (no canReload: never at once);
 *   - otherwise on the next return to visible, before the app resumes anything, unless a
 *     sheet is open or `canReload('show')` says no. Then it waits for the return after that.
 * If the page is closed first, the next launch is already served by the new worker.
 * `beforeReload` (saves the match) runs just before every reload. Two reloads are never
 * closer than 30 s.
 *
 * @param {{ beforeReload?: () => void, canReload?: (when: 'now' | 'show') => boolean }} [opts]
 * @returns {Promise<ServiceWorkerRegistration | null>}
 */
export function registerSW({ beforeReload, canReload } = {}) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(null);
  const host = location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  // Development: a cache-first worker on localhost hides every edit. Opt in with ?sw=1.
  if (isLocal && new URLSearchParams(location.search).get('sw') !== '1') return Promise.resolve(null);

  const sw = navigator.serviceWorker;
  const visible = () => document.visibilityState === 'visible';
  let sawInput = false;

  function reloadNow() {
    // Time-based instead of a permanent flag: it stops a reload loop but still lets a
    // second deploy reach a page that stays alive for days.
    const last = Number(sessionGet(RELOAD_GUARD)) || 0;
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionSet(RELOAD_GUARD, String(Date.now()));
    update.reloading = true;
    try {
      if (typeof beforeReload === 'function') beforeReload();
    } catch {
      // Saving failed; reloading anyway is still better than running two versions.
    }
    location.reload();
    return true;
  }

  const update = {
    pending: false,
    reloading: false,
    apply(when) {
      if (update.reloading) return true;
      if (!update.pending) return false;
      let ok = false;
      try {
        // Never while hidden: iOS can suspend a reload that starts in the background half-way.
        ok = visible() && !sheetOpen() &&
          (typeof canReload === 'function' ? canReload(when) === true : when === 'show');
      } catch {
        ok = false;
      }
      return ok ? reloadNow() : false;
    },
  };
  swUpdate = update;

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const mark = () => {
      sawInput = true;
      window.removeEventListener('pointerdown', mark, true);
      window.removeEventListener('keydown', mark, true);
    };
    window.addEventListener('pointerdown', mark, true);
    window.addEventListener('keydown', mark, true);
  }

  // The very first worker claiming an uncontrolled page serves the same files the page
  // already has; only a replacement of an existing controller means "new version".
  let hadController = Boolean(sw.controller);
  sw.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    update.pending = true;
    if (!sawInput) update.apply('now');
  });

  // Capture, and registered before anything else in the app listens: when the page comes
  // back with an update waiting, the reload must win over every other "visible" handler
  // (resuming the timer, the CPU, the music). For the same reason the page that is on its
  // way out is kept away from the app's own save: its "hidden" and "pagehide" handlers (both
  // fire during the reload) would save again after beforeReload already did.
  document.addEventListener('visibilitychange', (event) => {
    if (update.reloading || (visible() && update.apply('show'))) event.stopImmediatePropagation();
  }, true);
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', (event) => {
      if (update.reloading) event.stopImmediatePropagation();
    }, true);
  }

  return sw
    .register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      const check = () => {
        reg.update().catch(() => {});
      };
      check();
      document.addEventListener('visibilitychange', () => {
        if (visible()) check();
      });
      return reg;
    })
    .catch(() => null);
}
