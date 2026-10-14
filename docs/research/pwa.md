# PWA research for omok-fighter: iPhone home-screen correctness, reusing pumal

Pumal's PWA layer is solid and matches 2026 behaviour almost everywhere. About 70% of it can be copied with only renames. The rest needs a re-skin (the install-screen art, the sound table) or replacement (`shot.sh`, which is hard-wired to Chrome on macOS). Research turned up five things pumal does not handle:
- a status-bar regression in iOS 26.x and the iOS 27 beta;
- Safari 26 ignoring `theme-color`;
- the screen wake lock now working for home-screen apps (iOS 18.4+), which pumal never used;
- iOS still has no splash screen generated from the manifest;
- **pumal and omok-fighter live on the same origin**, so every storage key and cache name must carry its own prefix.

---

## 1. Pumal file by file

All paths are under `/home/user/jinjoskim2001-sketch/pumal`. I ran `install.test.js`, `sw.test.js` and `integration.test.js` here on **Node v22.22.0**: 58 of 58 pass.

### `index.html`
- **Head tags:**
  - viewport `width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no`
  - `theme-color`, and `color-scheme` dark
  - manifest link and `apple-touch-icon` (180 px)
  - `favicon-32`
  - `apple-mobile-web-app-capable` and `mobile-web-app-capable`
  - `apple-mobile-web-app-status-bar-style=black-translucent`
  - `apple-mobile-web-app-title`
  - `format-detection telephone=no`
  - `og:*` tags with an absolute `og:image?v=1`
  - preconnect to jsDelivr (for the web font)
- **Boot script** (inline, at the top of body): `if (navigator.standalone === true) documentElement.setAttribute('data-display','standalone')`. This gives CSS a second standalone signal besides `@media (display-mode: standalone)`, so the installed app can never get the browser-tab layout.
- **Shell script** (inline, classic script):
  - key-press and glare code, pumal-only, drop it
  - **pinch guards to keep:** `preventDefault` on `gesturestart`/`gesturechange` ("Safari ignores user-scalable=no in a tab"), `contextmenu` blocked on `#stage`, and an empty passive `touchstart` listener (needed for `:active` styles on iOS)
- **Load watchdog** (inline, after `<script type=module src=js/main.js>`):
  - The `error` event on the module script means `main.js` or one of its imports failed. It shows a "불러오지 못했어요 / 다시 시도" notice in `#gateRoot`.
  - A 12 s timer shows "불러오는 중이에요" and is removed when `load` fires.
  - Reason given in the comments: "no way to reload in the installed app".
- **DOM roots:** `#sheetRoot`, `#gateRoot` and `#toastRoot` must be literally empty in the HTML, because the CSS hides them with `:empty`.

### `manifest.webmanifest`
- Fields: `name`, `short_name`, `description`, `lang: ko`, `display: standalone`, `start_url: ./`, `scope: ./`, `theme_color`, `background_color`.
- Three icons: 192 any, 512 any, 512 maskable.
- **No `id` on purpose.** Pumal's tests say "id resolves against the origin, which on a project site is outside our folder".
- No `orientation`.

### `sw.js`
| Rule | Detail |
|---|---|
| Version | `VERSION='pumal-v1'` must equal the constant in `main.js` (a test checks this). Never rename or remove `sw.js`: Safari unregisters a worker whose script returns 404. |
| Cache names | `PREFIX='pumal-'`. Cleanup only deletes caches with our own prefix, because the origin is shared with other project sites. |
| Precache | The shell `./` plus an explicit `PRECACHE` list of relative paths. Fetched with `cache:'reload'` because GitHub Pages serves `max-age=600`. |
| Required vs optional | A required file that answers non-OK fails the install, so the old worker and its complete cache stay in charge. Only icons, the manifest and `debug.js` are optional. A network error is retried once. |
| Install / activate | install: `skipWaiting()`. activate: delete our own old caches, then `clients.claim()`. |
| Fetch | GET only, same origin, inside our folder only. Cache-first with `ignoreSearch` (so `?play=1`, `?v=`, `?openExternalBrowser=1` all map to the same file). On a miss: network, then heal the cache (only `basic`, non-redirected responses). Offline navigation falls back to the cached shell. |
| Font | The jsDelivr font goes into its own runtime cache, best effort; the install does not wait for it. |

### `js/install.js`
Pure parts first (they import in Node), DOM parts afterwards.

| Export | Behaviour |
|---|---|
| `CANONICAL_URL` | The Pages URL, with its trailing slash. |
| `detectEnv(ua?, ctx?)` | Returns `{standalone, ios, android, safari, inApp}`. Standalone is checked first, because the installed app's user agent has no `Safari/` token, just like a webview. An iPad reporting itself as a Mac is caught by `platform==='MacIntel' && maxTouchPoints>1`. `inApp` is one of `kakaotalk\|line\|threads\|instagram\|facebook\|naver\|daum\|other`. Threads (`Barcelona`) is matched before the Meta catch-alls. An iOS user agent with no `Safari/` token counts as `other`. |
| `gateMode(env,{forcePlay,trial})` | Returns `'game'` when `?play=1`, standalone, not iOS, or a trial is running. Otherwise `'escape'` inside an in-app browser and `'install'` in Safari. |
| `escapeLink(inApp,{canonical,href})` | Returns `{href,target,sync}`. See the lessons list below. |
| `mountGate(root, mode, env, {onPlayHere, auto, inGame, ua})` | Draws the install or escape screen and returns `unmount`. |
| `shareApp()` | Returns `'shared'\|'copied'\|'failed'`. Tries `navigator.share`; a user-cancelled share sheet (AbortError) does **not** fall back to the clipboard. |
| Android install | `canPromptInstall()`, `promptInstall()`, `onInstallAvailable(cb)` and `mountInstallPill(root)` (an "앱으로 설치" pill). |
| Updates | `registerSW({beforeReload, canReload})`, `isUpdatePending()`, `applyPendingUpdate()`. |

**Update flow encoded in `registerSW`:**
- Skipped on localhost unless `?sw=1`.
- Registers with `updateViaCache:'none'` and calls `reg.update()` at launch and on every `visibilitychange` to visible. The reason given: "an installed iOS web app is one long-lived page, so navigation-triggered checks never come".
- The first worker to claim a page is not treated as an update. Only a `controllerchange` that replaces an existing controller sets `pending`.
- **Reload immediately** only if the page is visible, nothing has been touched yet (no pointerdown/keydown), and `canReload('now')===true`.
- **Otherwise reload on the next return to visible**, unless a sheet is open or `canReload('show')` says no.
- Never reloads while hidden ("iOS can suspend a reload that starts in the background half-way").
- Reloads are at least 30 s apart, guarded in sessionStorage.
- `beforeReload` saves the game first.
- Its `visibilitychange` listener is a *capture* listener registered before the app's own, so the reload wins. The `pagehide` of the page being unloaded is stopped so the app does not save twice.

### `js/haptics.js` (copy verbatim)
- API: `attachHaptic(el)`, `setHapticsEnabled(on)`, `hapticsKind()` returning `'switch'\|'vibrate'\|'none'`.
- On iOS: a transparent `<label>` is placed over the host and wraps a hidden `<input type=checkbox switch>`. The switch uses `visibility:hidden`, not `display:none`, and keeps its native appearance. The second click the label forwards to the switch is stopped, so the host sees exactly one click. A MutationObserver puts the label back if the host's content is rewritten.
- On Android: `navigator.vibrate(8)` on pointerdown, skipped until `userActivation.hasBeenActive`.
- **iOS lesson in the comments:** "since iOS 26.5 only for a trusted tap… a scripted `.click()` … stays silent". That means one tick per tap, at finger-up, and **never from a timer or event**. So there is no haptic for CPU moves or the win.

### `js/audio.js`
- API: `audio = {init, unlock, play(name), setEnabled, isEnabled}`, plus the `SOUNDS` and `PITCH` tables.
- **Lessons to keep:**
  - Web Audio only. An `<audio>` element would switch iOS to the playback session, which ignores the silent switch and pauses the owner's music.
  - It sets `navigator.audioSession.type='ambient'` (feature-detected).
  - Unlock listeners on `touchend`/`click`/`keydown` in capture phase, kept for good. Not `touchstart` and not a finger's pointerdown: those do not grant activation on iOS.
  - The `interrupted` state (calls, Siri, backgrounding) clears the "verified" flag.
  - A watchdog checks that `currentTime` actually moves (WebKit bugs 263627 and 291892: the context reports `running` while the clock is frozen).
  - Recovery ladder: `resume`, then `suspend`, 200 ms gap, `resume` (WebKit 281566), then close and rebuild, but only inside a real tap, at most 3 times.
  - Old contexts are closed, because Safari caps the number of live contexts.
  - `REPLAY_MS=300` replays the sound requested on pointerdown once the touchend unlock lands.
  - Everything is silenced when the page is hidden.
- **Pumal-only:** the 32768 Hz buzzer pitch table, the 800 Hz highpass filter, and the square-wave melody voice.

### `js/storage.js`
- **Pattern:** every localStorage access is wrapped in try/catch (private mode, quota). Writes are **synchronous**, because iOS gives no time for async work on `pagehide`.
- `loadPrefs()` merges stored values into `DEFAULT_PREFS`, but a known key must keep its type.
- `saveGame` keeps a backup copy every 10 minutes.
- `changedElsewhere()` stops a stale instance (a second tab) from overwriting newer data.
- Save codes (`PUMAL1.` + base64url) exist to carry a pet from the tab to the installed app.
- Keys: `pumal.save.v1`, `pumal.save.v1.bak`, `pumal.prefs.v1`.
- `DEFAULT_PREFS` includes `trial` and `seenGuide`.

### `js/main.js` (patterns to reuse)
- `const VERSION='pumal-v1'`, shown in 설정 → 정보.
- **Boot order:**
  1. `loadPrefs`
  2. `audio.init()`
  3. `detectEnv()`
  4. `registerSW(...)`, **before** the lifecycle listeners are wired
  5. `gateMode`, then either `startGame` or `mountGate`, whose `onPlayHere` sets `prefs.trial=true` and starts the game
- No save is created while the gate is showing.
- If standalone, it calls `navigator.storage.persist()`.
- **Lifecycle:** `onHide` (visibilitychange hidden or `pagehide`) saves synchronously. `onShow` first calls `applyPendingUpdate()`, which covers `pageshow` from the back/forward cache.
- `unscroll()` snaps back any scroll offset iOS leaves after an input focus or the keyboard closing.
- **Module retry:** a dynamic import that failed is retried as `import('./ui.js?r=N')`, because WebKit caches the failed entry in its module map. The service worker's `ignoreSearch` still serves it from the precache.

### CSS (`css/app.css`, `gate.css`)
- **Tokens:** `--sat/--sar/--sab/--sal: env(safe-area-inset-*, 0px)`.
- **Page height:** `--vh: 100vh` for the installed app. The comment says "100vh, not dvh or %: with the translucent status bar those leave a gap at the bottom on a cold start". A browser tab gets `--vh: 100dvh` via `@supports (height:100dvh){ @media not all and (display-mode: standalone){ :root:not([data-display='standalone']){--vh:100dvh} } }`.
- **`html, body`:** `position:fixed; inset:0; height:var(--vh); overflow:hidden; overflow:clip;` with a page background. The clip also blocks `scrollIntoView` shoves. The body background is also what iOS samples for the status-bar colour.
- **`#stage`:** padding of safe-area plus margin, `touch-action:none; user-select:none; -webkit-touch-callout:none; -webkit-tap-highlight-color:transparent; overscroll-behavior:none`, and `-webkit-text-size-adjust:100%`.
- **Landscape:** the comment says "Orientation cannot be locked on iOS". `@media (orientation: landscape) and (max-height: 520px)` shrinks the layout.
- **Gate:** `#gateRoot:not(:empty)` is fixed, opaque, `overflow-y:auto`, `overscroll-behavior:contain`, `touch-action:pan-y`, and uses `max(20px, env(safe-area-inset-*))` padding. It is opaque because iOS takes the bar tint from a fixed element touching the top edge. Every token has a literal fallback in case `app.css` fails to load.

### Tools
| File | What it does | Verdict |
|---|---|---|
| `tools/make_icons.py` | PIL, 4× supersampling. Writes opaque RGB with square corners (the platform applies the mask): `apple-touch-icon-180`, `icon-192`, `icon-512`, `icon-maskable-512` (art inside the central 60%), `favicon-32`, `og-800x400` (everything important in the centre square). | **Adapt.** New art. It hard-codes the macOS font `/System/Library/Fonts/AppleSDGothicNeo.ttc`; here use `/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc` (the only Hangul font installed) or draw text as shapes. |
| `tools/shot.sh` + `tools/frame.html` | Headless **macOS Chrome** at a fixed path, with an iframe hack for the 500 px minimum window width, cropped with PIL. | **Replace** with a Playwright script. Playwright's viewport emulation has no 500 px minimum, so `frame.html` is not needed. |
| `tools/serve.py` | No-cache dev server. | Copy as is. |
| `tools/demo-gate.html` | Harness: `?mode=install&safari=26\|27`, `?mode=escape&app=kakaotalk`, `&ingame=1`, `&audit=1`. | Copy pattern, re-skin. |

### Tests
- **`tests/install.test.js`:**
  - a table of real user agents (Safari 27, standalone, Chrome on iOS, KakaoTalk, Instagram, Threads, LINE, Naver, Daum, Facebook, Google app, plain webview, Android variants); note "iOS has frozen the OS token at 18_x since Safari 26"
  - tests for `detectEnv`, `gateMode`, `escapeLink`
  - manifest shape: relative URLs, no `id`, PNG signature check on every icon
  - Share step per Safari version (26, 27, unknown, other browser)
  - gate copy text
  - `registerSW` with a fake browser that delivers capture listeners first and honours `stopImmediatePropagation`, covering reload-timing, 30 s guard, localhost skip and first-controller cases
  - layout-height and `data-display` checks against the CSS and HTML
  - the load watchdog
- **`tests/sw.test.js`:** runs `sw.js` in `node:vm` with a fake CacheStorage and fetch: optional vs required precache, retry, only our own caches deleted, `ignoreSearch`, offline navigation fallback, cache healing, foreign requests ignored.
- **`tests/integration.test.js`:**
  - every relative import resolves and the named exports exist
  - **the precache list equals exactly the module graph `index.html` can reach**
  - `VERSION` is equal in `sw.js` and `main.js`
  - a forbidden-word scan, including binary files
  - no root-absolute URLs
  - the DOM contract
- **`tests/index.js`:** needed for `node --test tests/`.

### Install gate UX, as built
**Install screen** (iPhone Safari tab):
- Hero icon, then `<h1>품알</h1>`, then the lead "홈 화면에 추가하면 앱처럼 … 수 있어요."
- **① 공유 열기.** The text depends on the Safari version read from `Version/NN` in the user agent:
  - **Safari 26:** "주소창 옆 **···** → **공유**" (note: "주소창을 꾹 눌러도 돼요 / 공유 버튼이 보이면 바로 눌러요")
  - **Safari 27+:** "**주소창을 꾹** 누르고 → **공유**" (note: "주소창 왼쪽 메뉴 버튼으로도 열려요")
  - **Version unknown:** both ways
  - **Other iOS browser:** "브라우저 메뉴에서 공유를 눌러요"
- **② 홈 화면에 추가.** "목록을 내려서 찾아 눌러요" (note: "안 보이면 맨 아래 **동작 편집**")
- **③ 그대로 추가.** "**웹 앱으로 열기**는 켜 둔 채 **추가**를 눌러요"
- **Final line:** "홈 화면의 … 아이콘으로 다시 열어 주세요". Fallback note: "아이콘으로 열었는데도 이 화면이 보이면 아이콘을 지우고 웹 앱으로 열기를 켠 채 다시 추가해 주세요".
- **Trial option:** a quiet "설치 없이 해보기" button. It sets `prefs.trial=true`, starts the game, and the gate never appears again. The warning under it explains why trial data is at risk: the tab's storage is separate from the installed app's, and ITP deletes it after about 7 days without a visit.

**Escape screen** (in-app browser):
- Headline "Safari에서 열어야 설치할 수 있어요", lead "{앱이름} 안에서는 홈 화면에 추가할 수 없어요."
- Primary button "Safari로 열기" (the scheme link).
- "안 열리면 직접 열어요", with per-app directions:
  - 카카오톡 / 라인: 오른쪽 아래 공유 → Safari로 열기
  - 인스타 / 스레드 / 페북: 오른쪽 위 ··· → 외부 브라우저에서 열기
  - 네이버: 오른쪽 아래 ··· → 다른 브라우저로 열기
- A read-only URL field with a "주소 복사" button. Success: "복사했어요!" plus "Safari 주소창에 붙여 넣어 주세요". Failure: the address is selected and the hint reads "주소를 꾹 눌러 복사해 주세요".
- "그냥 여기서 해보기" as the trial option.

**Automatic hand-off** (only once per session, guarded in sessionStorage):
- KakaoTalk: `location.href=kakaotalk://web/openExternal?url=…` after 350 ms.
- LINE: `location.replace(…?openExternalBrowser=1)`.

**In-game re-open** (from 설정; `inGame:true`, `auto:false`): the footer becomes "닫고 계속 키우기" plus a note about the save code. The Escape key closes it.

**Android:** no gate; the install pill appears instead.

### Other iOS lessons in pumal's comments
- **Escape schemes:**
  - KakaoTalk: `kakaotalk://web/openExternal?url=` (sync)
  - Instagram: `instagram://extbrowser/?url=` (sync)
  - Threads: `barcelona://extbrowser/?url=` (sync)
  - LINE: `?openExternalBrowser=1` first, then the fallback below if still inside LINE
  - everything else: `x-safari-https://…` with `target=_blank`
- Meta's webviews only honour a scheme set synchronously inside the tap handler.
- The in-app browser is never closed from script, so the manual route is always still on screen.
- Clipboard: the async API is raced against a 700 ms timeout (some webviews never resolve it), then falls back to `execCommand('copy')` on a selected input.
- iOS reads the icon and app name **once, at install**. Finalize them before the first share. Bump the `og:image ?v=` when the preview picture changes. Share the URL with its trailing `/`.

### Copy plan
| File | Action | Renames / changes |
|---|---|---|
| `sw.js` | Nearly verbatim | `VERSION='omok-v1'`, `PREFIX='omok-'`, new `PRECACHE`. Font: self-host a subset `.woff2` (precached as optional) instead of jsDelivr, which removes the separate font cache. |
| `js/haptics.js` | Verbatim | none |
| `js/audio.js` | Keep the lifecycle and unlock half verbatim; replace the sound half | New `SOUNDS` (stone click, deny, round start, per-character win jingles). Consider a short noise burst for the "tak" of a stone. Keep the public API. |
| `js/install.js` | Keep detection, escape, `copyText`, share, pill and `registerSW` verbatim; adapt the markup | `CANONICAL_URL='https://jinjoskim2001-sketch.github.io/omok-fighter/'`; `SHARE_TITLE='오목 파이터'`; new `SHARE_TEXT`; guards `omok.gate.kakao`, `omok.gate.line`, `omok.sw.reloadAt`. Replace the mascot code (`FALLBACK_MASCOT`, `mascotSvg`, the `sprites.js` import) with `<img src="icons/apple-touch-icon-180.png">` or a stone-plus-character SVG. Rewrite the copy (`TRIAL_WARNING`, `IN_GAME_*`, lead, labels) for a game instead of a pet, and drop the save-code mention. |
| `js/storage.js` | Keep the pattern | Keys `omok.save.v1` (match in progress), `omok.prefs.v1`, `omok.stats.v1`. New `isSave`. Drop save codes. |
| `index.html` head + 3 inline scripts | Copy | Drop the key/glare code; keep the pinch guards, the `data-display` script and the watchdog. |
| `css/app.css` page section, `css/gate.css` | Copy the structure, re-skin | |
| `tests/install.test.js`, `sw.test.js`, `integration.test.js`, `index.js`, `audio.test.js` | Copy | New URL and manifest asserts. Swap the forbidden-word list for an IP-name list (see the checklist). |
| `tools/serve.py`, `.nojekyll`, `.gitignore` | Verbatim | |
| `tools/make_icons.py` | Adapt | New art, Linux font path. |
| `tools/shot.sh`, `tools/frame.html` | Replace | `tools/shot.mjs` (Playwright). |

---

## 2. 2026 state of iOS 26/27, checked against pumal

| Topic | Finding (2026) | Compared with pumal |
|---|---|---|
| **Add to Home Screen, iOS 26** | Every site added to the Home Screen now opens as a web app by default. The add sheet has an **"Open as Web App"** switch, on by default; switching it off makes a plain Safari bookmark. A manifest is no longer required, but its icons and fields are still used. Service workers are optional and unchanged. | Matches: pumal's step ③ and its re-add note. **Not verified:** I could not find a source confirming the Korean label "웹 앱으로 열기". Check it on a phone set to Korean. |
| **Where Share is** | iOS 26 compact layout: the ··· button beside the address bar opens a menu that contains Share. **iOS 27** (Cult of Mac, 22 Jun 2026): that bottom-right button is now Tabs. Share is reached from the Page menu at the left of the address bar, or by pressing and holding the address bar. Top and Bottom layouts can still be chosen in Settings → Apps → Safari. | Matches pumal's `shareKind` exactly. In those layouts Share may be visible directly, which pumal's "공유 버튼이 보이면 바로 눌러요" note covers. |
| **User agent** | The OS token is frozen; only `Version/NN` identifies Safari. Playwright's iPhone 15 Pro profile sends `… iPhone OS 17_5 … Version/26.0 … Safari/604.1`. | Matches. |
| **Status bar / safe area** | **WebKit 301994** (from 26.1): home-screen apps get a solid band behind the status bar and `env(safe-area-inset-top)` returns 0. Reported fixed in 26.2, but it reproduced again on 26.5.2 (Jul 2026) and on the **iOS 27 beta**, and WebKit reopened it on 4 Aug 2026. Same thread: the bottom bar colour is cached from the page background and only updates on relaunch. Separate report: a native safe-area-inset issue on iOS 26 (Apple forums thread 798014). | **Pumal does not mention this.** Its `env()` padding works whether content sits under the status bar or not, so the approach holds up. Rules: never hard-code a status-bar height; set the html/body background to the app colour from the very first paint (inline `<style>` in `<head>`); do not design art that must run under the status bar. **Uncertain:** whether iOS 27.0 shipped a fix. Test on a phone. |
| **theme-color** | Developer reports say Safari 26 no longer uses `<meta name=theme-color>` for the toolbar tint. It takes the html/body background, or a fixed element touching the top or bottom edge. | Pumal already relies on the body background and an opaque gate. Keep the meta tag for Android. Any full-screen overlay (for example the victory motion) must be opaque or the same colour as the page at the edges. |
| **Splash screen** | iOS still does **not** build a splash from `background_color`. `apple-touch-startup-image` remains the only way: one PNG per device size and orientation, and data/blob URLs have been broken since iOS 17.6.1 (WebKit 280262). **WebKit 311569** (Apr 2026, still NEW): a white flash on cold start in dark mode that inline backgrounds, `color-scheme` and the manifest do not fix. | Pumal ships no startup images. **Recommendation: skip them in v1.** The bug is not ours to fix. |
| **Manifest fields iOS uses** | `name`, `short_name`, `start_url`, `scope`, `display` (`standalone`, `browser`; `fullscreen` falls back to `standalone`), PNG `icons` (`apple-touch-icon` overrides them), `id` (16.4+). Safari 26 adds **SVG icons**. **Not honoured:** `orientation`, `background_color`, `shortcuts`. Each web app has its own scope; links outside it open in an in-app Safari view. | Matches. Keep "no `id`". `orientation: portrait` is harmless and Android uses it. |
| **Standalone detection** | `navigator.standalone` (deprecated but still present) and `@media (display-mode: standalone)`. | Pumal uses both. Keep. |
| **Web Audio unlock** | I found nothing new for 26/27. Activation still comes from `touchend`/`click`/`keydown`. `navigator.audioSession` exists in Safari only (MDN marks it experimental and of limited availability); I believe since 16.4/17, not verified. With `ambient`, the **silent switch mutes the game**. A WebKit maintainer suggests `playback` to sound through the silent switch, but that type is exclusive and **pauses the user's music**. | Pumal's audio module is current. **Product decision:** many Korean users keep the phone on silent or vibrate, so the game should read fine with no sound. Optionally add a setting "무음 모드에서도 소리" that switches the session to `playback`, with a warning that it stops other music. |
| **Haptics** | The `ios-haptics` library's own README (v3.2.0) independently arrived at pumal's approach: a transparent label over the element forwards the tap to the switch "as a trusted click". | Confirms pumal. Its 26.5 note stands. CPU moves and the win cannot tick on iOS. |
| **Screen Wake Lock** | `navigator.wakeLock.request('screen')` has worked in **home-screen apps since iOS 18.4** (WebKit 254545; a reported 26.1 regression was retracted). The spec rejects it while the page is hidden and the lock is released on hide, so request it again on visible. I found no gesture requirement. | **Pumal does not use it. omok should**, because a player thinking for longer than the auto-lock time (30 s in Low Power Mode) gets a dark screen. |
| **Web Share** | Supported on iOS, including standalone; needs a tap; cancelling throws AbortError. | `shareApp()` is correct. |
| **Storage** | A home-screen app has **separate cookies and storage from Safari** (WWDC23). Safari 17 storage policy: the same quotas as the browser; `persist()` granted by heuristics, including "opened as a Home Screen Web App"; least-recently-used eviction per origin under pressure. A home-screen app keeps its own "days of use" counter, so the 7-day script-storage deletion follows actual use of the app. | Pumal's trial warning and its `persist()` call when standalone are correct. **Believed, not verified:** deleting the icon deletes its data; add that to the reinstall note. |
| **Shared origin** | `jinjoskim2001-sketch.github.io` serves **both** `/pumal/` and `/omok-fighter/`. In Safari tabs they share localStorage, sessionStorage and CacheStorage. | **Prefix everything:** `omok.` keys and `omok-` caches. Pumal's prefix-scoped cache cleanup already avoids touching foreign caches. Service-worker scopes are separate by path. |
| **Orientation lock** | `screen.orientation.lock()` does not work on iPhone (WebKit 257695: it needs the Fullscreen API). The manifest `orientation` is ignored. | CSS fallback needed (see the checklist). |
| **In-app escape** | `kakaotalk://web/openExternal` is documented only by the community, not by Kakao. `x-safari-https://` reportedly works on iOS 15, 17 and 18 (not 16); unverified on 26/27. iOS 17 allows Add to Home Screen in Safari View Controller and "many in-app browsers". | Keep pumal's escape flow, which always keeps the manual route and copy button. Test KakaoTalk on a phone; friends will mostly share links there. |

---

## 3. PWA checklist for omok-fighter

### Repo and deploy
- Repo `jinjoskim2001-sketch/omok-fighter`, Pages served from `main` at the root, with `.nojekyll`.
- Canonical URL: `https://jinjoskim2001-sketch.github.io/omok-fighter/`, always shared with its trailing slash.
- Only relative URLs in shipped files (a test enforces this).

### `<head>`
```html
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no">
<title>오목 파이터</title>
<meta name="description" content="친구랑 한 폰으로, 캐릭터 골라 붙는 오목 한 판. 홈 화면에 추가하면 앱처럼!">
<meta name="theme-color" content="#14102A">          <!-- = html/body bg; Android only now -->
<meta name="color-scheme" content="dark">
<style>html,body{background:#14102A}</style>          <!-- first-paint colour; status/bottom bar sampling -->
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon-180.png">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="오목파이터">
<meta name="format-detection" content="telephone=no">
<meta property="og:type" content="website">
<meta property="og:url" content="https://jinjoskim2001-sketch.github.io/omok-fighter/">
<meta property="og:title" content="오목 파이터">
<meta property="og:description" content="링크 열고 홈 화면에 추가하면 끝!">
<meta property="og:image" content="https://jinjoskim2001-sketch.github.io/omok-fighter/icons/og-800x400.png?v=1">
<!-- no preconnect: font is self-hosted -->
```
- The home-screen label is "오목파이터" (5 syllables, no space) to lower the chance iOS truncates it. Truncation width not verified.
- `#14102A` is a placeholder; it must equal the page background chosen in the design spec.
- Body: the inline `data-display` script, the pinch-guard script, and the load-watchdog script, all copied from pumal.

### `manifest.webmanifest`
```json
{ "name": "오목 파이터", "short_name": "오목파이터", "description": "…", "lang": "ko",
  "display": "standalone", "orientation": "portrait", "start_url": "./", "scope": "./",
  "theme_color": "#14102A", "background_color": "#14102A",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" } ] }
```
- No `id`. No `apple-touch-startup-image` in v1.

### Icons (from `tools/make_icons.py`)
- **Files:**
  - `apple-touch-icon-180.png`
  - `icon-192.png`
  - `icon-512.png`
  - `icon-maskable-512.png` (art inside the central 60%)
  - `favicon-32.png`
  - `og-800x400.png` (key content in the centre 400×400, so a square crop still works)
- **Format:** opaque RGB, square corners, no text needed. Two stones in front of a character silhouette reads well at 60 px.
- **Freeze before first share:** iOS reads the icon only at install, so finalize it before anyone installs.

### Service worker
- Copy pumal's `sw.js`: precache everything at install, required vs optional files, `cache:'reload'`, cache-first with `ignoreSearch`, offline navigation fallback, cache healing, cleanup of `omok-` caches only, `skipWaiting` and `clients.claim`.
- Sounds are synthesized and characters drawn as SVG or canvas from JS, so there are no media files. Budget: about 1 MB precache.
- If the CPU's hard difficulty runs in a module Worker (`new Worker('js/ai-worker.js',{type:'module'})`, supported since Safari 15), **extend the integration test's import-graph parser to follow `new Worker(…)`**. Otherwise the "precache equals module graph" check misses the worker file.

### Update strategy
- Bump `VERSION` in `sw.js` and `js/main.js` on every deploy; a test keeps them equal. Show it in 설정 → 정보.
- `registerSW({beforeReload: saveMatch, canReload})`:
  - `canReload('now')` is true only on the title or menu screen with no match running.
  - `canReload('show')` is true unless a victory motion, round transition or sheet is on screen.
- **Save the match in progress synchronously after every move** (move list, series score, characters, mode, CPU level, whose turn). A reload, an iOS kill in the background, or an update then resumes with nothing lost, and the title screen offers "이어하기".

### Viewport and CSS
- **Page height:** `--vh: 100vh` in standalone and `100dvh` in a tab, detected through both `display-mode` and `[data-display]`.
- **Page box:** `html, body {position:fixed; inset:0; overflow:clip; overscroll-behavior:none}`.
- **Safe areas:** `--sat/--sar/--sab/--sal` through `env()`, applied as padding on the stage. The board is the square `min(100vw − insets − gutter, var(--vh) − insets − HUD)`. The top HUD uses `max(env(safe-area-inset-top), 8px)` so it is correct whether or not the band from WebKit 301994 appears.
- **Touch, zoom and selection:**
  - board: `touch-action:none`, handled by our own pointer events (prevents double-tap zoom while placing stones quickly)
  - buttons: `touch-action:manipulation`
  - scrolling sheets and the gate: `pan-y`
  - stage: `user-select:none; -webkit-touch-callout:none; -webkit-tap-highlight-color:transparent; -webkit-text-size-adjust:100%`
  - JS: `gesturestart`/`gesturechange` `preventDefault`, `contextmenu` blocked on the stage, empty `touchstart` listener; copy `unscroll()`
- **No text inputs in v1.** Players are identified by their character, which avoids keyboard and viewport problems. If an input is ever added: font-size at least 16 px, plus pumal's `--vvh` handling.
- **Mobile input concern (for the game spec):**
  - a 15×15 board on a 393-pt-wide screen gives cells of about 24 pt, well under the 44 pt minimum Apple recommends for touch targets
  - so stone placement needs a mis-tap safeguard: either show the stone above the finger while dragging, or tap once to preview and again to confirm
  - this is input precision, not a play hint, so it fits the "no guides" rule
- **Orientation:**
  - manifest `orientation: portrait` (Android only)
  - try `screen.orientation?.lock?.('portrait').catch(()=>{})` in standalone
  - **CSS fallback:** `@media (orientation: landscape) and (max-height: 500px)` shows an opaque "세로로 돌려 주세요" overlay and pauses timers and animations
  - iPads and large screens: centre the layout with a max-width
- **Wake lock** (new `js/wake.js`, about 15 lines):
  - call `keepAwake(true)` from the "start match" tap
  - call it again on `visibilitychange` to visible while a match is running
  - release on match end or exit
  - wrap every call in try/catch; show no UI if unsupported
- **Sound and haptics:**
  - put `attachHaptic` on the board element itself (the label overlay keeps `clientX`/`clientY` correct, so the cell can still be computed) and on every button
  - a forbidden 3-3 tap gets the deny sound plus a shake
  - victory feedback on iOS is visual and sound only
  - `audioSession` stays `ambient` by default
- **Storage:** prefix everything with `omok.`; call `navigator.storage.persist()` when standalone.

### Gate
- Same flow, same detection, same escape table as pumal. New copy, for example:
  - lead: "홈 화면에 추가하면 앱처럼 바로 한 판!"
  - trial button: "설치 없이 해보기"
  - warning: "여기서 쌓은 전적은 설치한 앱으로 옮겨지지 않아요"
- Debug parameters: `?play=1` skips the gate, `?gate=install|escape` forces one, `?shot=<state>` renders fixed states for screenshots.

### Test strategy
**`node --test`** (Node 22 is available here; pumal's suite passes on it):
- **Pure game modules:** five-in-a-row detection; overline handling; **3-3 detection**, covering open threes, the broken shape X.XX, edges and corners, and a move that makes five while also making 3-3 (decide the precedence); the match series (first to 1, 2, 3 or 4 wins); the CPU never plays an illegal or forbidden move and blocks an obvious four; storage round-trip and validation; character table integrity (8 entries, each with a unique victory-motion id).
- **Copied from pumal:** install, sw, integration and audio tests.
- **Integration additions:**
  - **IP guard:** fail if shipped files mention real franchise or character names (Pokémon, 포켓몬, Street Fighter, 스트리트 파이터, Pikachu, Ryu, …), with the words built from pieces as pumal does
  - every character has a sound and an art entry

**Playwright Chromium** (global `playwright@1.56.1`; browsers in `/opt/pw-browsers`, `chromium-1194`):
- **Loading it:** ESM `import` ignores `NODE_PATH`, so load it with `createRequire('/opt/node22/lib/node_modules/')`. I verified this works here.
- **Browser-tab context:** `devices['iPhone 15 Pro']` gives a 393×659 viewport with a Safari 26 user agent. It **shows the install gate** unless `?play=1`, which is handy for gate screenshots.
- **Standalone context:** `{viewport:{width:393,height:852}, deviceScaleFactor:3, isMobile:true, hasTouch:true}` plus `addInitScript(() => Object.defineProperty(Navigator.prototype,'standalone',{get:()=>true}))`. That flips `detectEnv` and `data-display`. CDP `Emulation.setEmulatedMedia` for `display-mode` **did not take effect** in my test, so test the standalone CSS through the attribute.
- **Sizes:** 375×667 (SE), 393×852, 440×956 (Pro Max), and 852×393 for the landscape overlay.
- **Shots:**
  - gate: Safari 26 and 27 user agents; Kakao escape
  - title, character select, mid-game board, 3-3 rejection
  - **all 8 victory motions**
- **Assertions:** no horizontal overflow, buttons at least 44 px, no console errors. Offline check: serve on localhost with `?sw=1`, wait for the worker, `context.setOffline(true)`, reload, and the board still renders.
- **Fonts:** Hangul renders in WenQuanYi here, so self-hosting the font makes screenshots representative.
- **`tools/shot.mjs` replaces `shot.sh` and `frame.html`.**

### Manual pass on a real iPhone
WebKit is not available here, so these need an iPhone on iOS 26.x **and** 27:
- Add to Home Screen from Safari: the Share path and the label "웹 앱으로 열기"
- KakaoTalk link, then the escape hand-off
- the status-bar band and safe areas
- silent switch on and off
- haptic tick on the board
- screen stays on past auto-lock during a match
- launch in airplane mode
- version bump, then the update applies at a quiet moment
- kill the app mid-match, then "이어하기"

---

Sources:
- [WebKit: News from WWDC25 (Safari 26 beta)](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)
- [heise: iOS 26 changed web app behaviour](https://heise.de/-10749652)
- [Cult of Mac: Safari in iOS 27](https://www.cultofmac.com/news/safari-features-ios-27)
- [MacStories: Safari for iOS 27, where's the Share button?](https://www.macstories.net/club/macstories-weekly-issue-517/safari-for-ios-27-wheres-the-share-button/)
- [WebKit bug 301994 (status bar / safe-area, reopened on the iOS 27 beta)](https://bugs.webkit.org/show_bug.cgi?id=301994)
- [Apple forums: safe area changes on iOS 26](https://developer.apple.com/forums/thread/798014)
- [Ben Frain: iOS 26 theme-color tinting](https://benfrain.com/ios26-safari-theme-color-tab-tinting-with-fixed-position-elements/)
- [Apple forums thread 801239](https://developer.apple.com/forums/thread/801239)
- [WebKit bug 311569 (white flash on cold start)](https://bugs.webkit.org/show_bug.cgi?id=311569)
- [WebKit bug 280262 (startup images)](https://bugs.webkit.org/show_bug.cgi?id=280262)
- [firt.dev iOS PWA compatibility](https://firt.dev/notes/pwa-ios/)
- [WebKit bug 254545 (Wake Lock in home-screen apps, iOS 18.4)](https://bugs.webkit.org/show_bug.cgi?id=254545)
- [WebKit: Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [WWDC23: What's new in web apps](https://developer.apple.com/videos/play/wwdc2023/10120/)
- [MDN: AudioSession.type](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type)
- [WebKit bug 261554 (audioSession / silent mode)](https://bugs.webkit.org/show_bug.cgi?id=261554)
- [ios-haptics README](https://unpkg.com/ios-haptics@3.2.0/README.md)
- [azukiazusa: iOS Safari web haptics](https://azukiazusa.dev/blog/ios-safari-web-haptics)
- [WebKit bug 257695 (orientation lock)](https://bugs.webkit.org/show_bug.cgi?id=257695)
- [Christian Tietze: Safari URL scheme](https://christiantietze.de/posts/2023/05/safari-for-mac-url-scheme/)
- [Kakao DevTalk thread](https://devtalk.kakao.com/t/topic/150815)