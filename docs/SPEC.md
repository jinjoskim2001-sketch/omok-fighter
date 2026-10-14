# 돌주먹 — 오목 파이터 · SPEC v1

> 정본 설계서. 모든 빌드 에이전트는 이 문서를 계약으로 삼는다. 근거 자료는 `docs/research/*.md`
> (rules · ai · pwa · ux · characters), 검증된 프로토타입은 `docs/ref/`.
> 이 문서와 research 문서가 충돌하면 **이 문서가 이긴다.**

## 0. 제품 한 줄

친구들끼리 아이폰 한 대로(또는 CPU와) 두는 **캐릭터 대전 오목**. 정적 웹앱(바닐라 HTML/CSS/ES 모듈,
빌드 단계·프레임워크·외부 스크립트 없음)을 GitHub Pages에 올리고, Safari "홈 화면에 추가"로 앱처럼 쓴다.

- 이름: **돌주먹** (부제 OMOK FIGHTER / 오목 파이터). 홈 화면 라벨 `돌주먹`.
- 주소: `https://jinjoskim2001-sketch.github.io/omok-fighter/` (항상 끝 `/`까지). 저장소 `jinjoskim2001-sketch/omok-fighter`, Pages = `main` 루트.
- 오너: 한국 비보이 크루 리더. 비상업, 지인용. UI 언어 한국어(연출 문구 일부 영어: ROUND/FIGHT!/K.O.).
- 같은 오리진에 오너의 다른 앱 `/pumal/`이 있다 → **모든 localStorage 키는 `omok.`, 캐시 이름은 `omok-` 접두사.**

## 1. 확정 규칙 (docs/research/rules.md)

| 항목 | 값 |
|---|---|
| 판 | 15×15, 흑 선공 |
| 3-3 (쌍삼) | **흑백 모두 금수.** 띈 3 포함, 4-3-3 금수, 거짓 3 재귀 판정 on(maxDepth 3) |
| 4-4 / 4-3 | 허용 |
| 장목(6목+) | 둘 수는 있으나 승리 아님. 설정 "6목 이상도 승리"(기본 끔) → `overlineWins` |
| 5목 + 3-3 동시 | 5목 승리 우선 |
| 무승부 | 판이 꽉 차거나, 둘 차례인 쪽이 둘 수 있는 칸이 하나도 없을 때 → DRAW, 핍 없음, 색 교대 |
| 판 정본 | `js/rules.js` (**FROZEN — 수정 금지**, 46 테스트 통과). API: `N, EMPTY, BLACK, WHITE, DIRS, DEFAULT_RULES, isFive, winningLine, analyzeMove, isForbidden, isDoubleThree, judgeMove` |

- 보드 = `Int8Array(225)`, idx = `y*15+x`, 0/1=흑/2=백. 이동 리스트는 idx 배열, 흑부터 번갈아.
- 금수 미리 표시: **기본 끔**(오너 "가이드 없이"). 금수 칸을 누르면 그때 빨간 X + 판 흔들림 + 버저 + 토스트 "쌍삼 금지!".
- 설정 "금수 자리 미리 표시"를 켜면 현재 둘 차례인 사람의 금수 칸에 작은 X.
- 장목을 두었을 때(승리 아님) 토스트 "6목은 승리가 아니에요".
- 좌표·수순 번호·힌트·위협 강조·형세 바: **넣지 않는다.**

## 2. 매치 구성

- 모드: `2p`(한 폰 번갈아) · `cpu`(쉬움/보통/어려움).
- 판 수: 단판(1) · 3판 2선승(3, **기본**) · 5판 3선승(5) · 7판 4선승(7). need = (bestOf+1)/2.
- 1라운드 흑: 2P = 동전 던지기 연출(랜덤). CPU = 설정 "내 돌" 흑(**기본**)/백/랜덤.
- 2라운드부터 흑: 설정 "선공 규칙" — **진 사람이 흑(기본)** / 번갈아. 무승부면 색 교대.
- "한 판 더!"(재대결): 직전 매치 패자가 1라운드 흑, 동전 생략.
- 시간제한(사람만, 수당): 없음(**기본**)/10/20/30초. 만료 시 장전된 돌이 있으면 그 수로 자동 착수, 없으면 TIME OVER = 그 라운드 패배. 연출·일시정지·숨김 중 정지.
- 무르기(라운드당): 2P 0/**1**/3/무제한 — 직전 내 수만(상대가 두기 전), **상대 승인** 필요("한 수만 물러줘~" [봐준다][안 돼]). CPU 0/**3**/무제한 — 내 수+CPU 응수 2수 함께. K.O. 후 불가.
- 기권(일시정지 메뉴): "이번 판 기권"(라운드 패) / "매치 포기"(매치 패, 전적 기록). 2P는 누가 기권하는지 선택 + 확인.
- 매치 포인트: 한 판만 더 이기면 되는 쪽 HUD에 "MATCH POINT". 둘 다면 라운드 문구 "FINAL ROUND".
- 진행 중 매치는 **매 수마다 동기 저장**(`omok.save.v1`) → 타이틀/메뉴에 "이어하기".

## 3. 화면 흐름

```
[설치 게이트] (iOS Safari 탭 → install / 인앱 브라우저 → escape; standalone·?play=1·체험이면 생략)
   ↓
타이틀: 로고 "돌주먹" 박힘 + 8캐릭터 라인업 + "화면을 터치하세요" (첫 탭 = 오디오 언락)
   ↓
메뉴: [이어하기*] [한 판 붙자 · 둘이서 한 폰으로] [CPU랑 붙기] [전적] [설정] [홈 화면에 추가*] [친구에게 공유]
   ↓ 2P / CPU
매치 설정 시트(마지막 값 기억): 판 수 · 시간제한 · 무르기 · 스테이지(5테마+랜덤) · (CPU: 난이도, 내 돌)  → [캐릭터 고르기]
   ↓
캐릭터 선택(3×3, 가운데 "?" 랜덤) → VS(1.6s) → [동전 던지기: 2P 1라운드만] → ROUND n → FIGHT!
   ↓
대국 ⇄ 일시정지(계속 / 무르기 / 이번 판 기권 / 매치 포기 / 소리 / 메뉴로)
   ↓
K.O. → 라운드 결과 → (반복) → 매치 결과(승자 고유 승리 모션) → [한 판 더!] [캐릭터 변경] [메뉴로]
```
`*` 조건부: 이어하기 = 저장된 매치 있음. 홈 화면에 추가 = standalone 아님(iOS) — 게이트를 inGame 모드로 다시 연다.

### 3.1 타이밍 (연출 속도 "보통" 기준; "빠르게" ×0.6 & VS 유지 0; "최소" = 흔들림·히트스톱·VS 없음, K.O. 400ms, 결과 1s)
- VS: 0–300 초상 슬라이드인, 300 "VS" 3배→1배 200ms + 흔들림 + 충돌음, 1600 끝. 400ms 이후 탭으로 넘김.
- 동전: 1.2s, 탭으로 넘김.
- ROUND n 700ms (+ 아래 "1P 흑 · 선공") → FIGHT! 500ms. 2라운드부터 총 900ms. 판 입력은 연출 종료 +150ms 후, 연출을 넘긴 탭의 pointerup은 무시.
- K.O.(t=0 다섯째 돌 확정): 0 돌 낙하 110ms · 110 히트스톱 140ms(`.hitstop` 애니메이션 정지) + 흰 섬광(0.35, 50ms) · 250 흔들림 320ms(8px→0) + K.O.음 · 250–650 승리 라인 · 500 "K.O." 2.6배→1배 140ms + 배경 30% 어둡게 · 1400 무대에서 승자 라운드 승리 발췌(excerpt) / 패자 lose · 2000 라운드 결과. 탭 넘김은 600ms 이후만.
- 라운드 결과: "1P WIN" + 핍 채움 300ms. 판을 어둡게 깔아 두고 눈 버튼 누르는 동안 판 보기. 3600ms 자동 진행, 1000ms 이후 탭 넘김.
- 매치 결과: 승자 큰 스테이지(≈ min(64vw, 260px))에서 **풀 승리 모션 2.4s** → 루프, 대사 타이핑(30ms/자), 패자 작게 lose. 점수 "2 : 1", 라운드 요약, "최단 K.O. n수", 배지 PERFECT(3판 이상 무실점)/역전승!. 버튼 900ms 후 등장. CPU전: YOU WIN / YOU LOSE (져도 CPU 캐릭터 승리 모션 재생).
- 섬광은 한 번에 1회, 초당 3회 이하. `data-motion="reduce"`면 흔들림·섬광 끄고 글자는 페이드.

## 4. 대국 화면

```
[safe-top]
HUD 64pt: [1P 초상52][이름·돌아이콘·핍 / 타이머바]   [R n]   [타이머바 / 핍·돌·이름][2P 초상52]
판: 정사각, 한 변 = min(화면폭−12, 남는높이) — 최대 560px
무대: 남는 높이(최소 88, 최대 200pt) — 두 캐릭터가 마주 서 있음 (P1 왼쪽 --dir:1, P2 오른쪽 --dir:-1)
하단 바 56pt: [무르기 (n)]  [차례: 1P ●흑]  [일시정지]
[safe-bottom]
```
- 차례 표시: 차례인 HUD 패널이 플레이어색 글로우 + 1.04배, 반대는 50%. 판 테두리 안쪽 2pt 글로우를 플레이어색으로. "1P/2P" 글자 상시(색약 대비).
- 착수 시: 둔 쪽 캐릭터 `attack`(280ms), 상대 `hit`(220ms). 내 차례가 되면 `turn`(0.6s 1회).
- CPU 생각 중: CPU 초상에 "생각 중…" 깜빡임. 표시 지연: max(실제 계산, 쉬움 500–900 / 보통 600–1100 / 어려움 700–1300ms, 강제수 ≈450ms).
- 375×667(SE)에서도 전부 들어가야 함. 가로(높이 ≤ 500px) = 불투명 "세로로 돌려 주세요" 오버레이 + 타이머 정지.

### 4.1 착수 입력 (docs/research/ux.md §1.2 그대로)
- 상태 IDLE / PRESSING / ARMED(p). 주 포인터만. 판 요소 `touch-action:none`.
- pointerdown: 최근접 교차점 target, 조준 표시. 150ms 이상 누르거나 8pt 이상 움직이면 **돋보기**(지름 112pt, 2.2배, 터치 96pt 위, 공간 없으면 옆; 테두리 = 현재 플레이어색, 스냅된 교차점 중심).
- pointermove: 0.6칸 히스테리시스로 target 변경, 변경 틱(40ms 1회 제한).
- pointerup: 끌지 않았고 ARMED 점에서 0.75칸 이내 → **착수 확정**. 그 외: 돌 있음 → "톡"; 금수 → 금수 피드백 + IDLE; 가능 → ARMED(반투명 45% 돌 + 모서리 괄호 조준, 틱). 끌다 뗀 경우는 장전만.
- 확정 후 250ms 입력 잠금. 차례 변경/무르기/라운드 종료/일시정지 시 장전 해제.
- 설정 "바로 착수"(한 번 탭): 끌지 않은 탭은 즉시 착수.
- 처음 3번의 장전에 한해 토스트 "한 번 더 탭하면 착수!" (prefs.seenArmHint 카운트).
- 마지막 수: 빨간 점(#FF3B30, 지름 0.24칸) + 착수 직후 링 1회(0.5→0.9칸, 1.2s).
- 승리 라인: 다섯 돌 중심 잇는 선(양끝 +0.3칸, 굵기 0.16칸, #FFD60A + #FFB000 글로우), 280ms 그리기 + 돌 60ms 간격 1→1.12→1 펄스.

## 5. 판 테마 (docs/research/ux.md §3) — `js/themes.js`
| id | 이름 | 핵심 |
|---|---|---|
| `mat` | 배틀 장판 (**기본**) | 비보이 배틀 골판지 매트: 크라프트 #C9A06A + 골판지 결, 마커 격자(고정 시드로 살짝 흔들림), 덕트테이프 모서리 |
| `neon` | 네온 아케이드 | #0E1030, 시안 #19E3FF 격자 글로우(미리 그려 캐시), 마젠타 테두리, 흑돌 시안 림 필수 |
| `dojo` | 수련 도장 | 다다미 #CDBF7E, 먹선, 남색·금 테두리 띠, 낙관 화점 |
| `pixel` | 8비트 오락실 | 게임보이 4색, 저해상도 후 pixelated 확대, 픽셀 돌 |
| `wood` | 클래식 원목 | 비자나무 그라디언트 + 결 |
화점 5개 (3,3)(11,3)(7,7)(3,11)(11,11). 격자 회전·원근 금지. 돌은 테마별로 미리 그린 오프스크린 스프라이트(ux.md §3.6 레시피). 각 테마는 대국 화면 페이지 배경(CSS)과 강조색도 제공.

## 6. 캐릭터 8 (docs/research/characters.md — 로스터·팔레트·타임라인의 정본)

| id | 이름 | 콘셉트 | 승리 모션 | 효과 |
|---|---|---|---|---|
| `bulttong` | 불똥 | 재채기가 불꽃놀이인 아기 용 | 에취! 불꽃놀이 | firework |
| `nyangja` | 냥자 | 닌자 고양이 | 연막 → 등장 → 인 포즈 | smoke, petals |
| `bigom` | 비곰 | 비보이 곰 (오너에 대한 리스펙트, 본인 묘사 금지) | 탑락 → 윈드밀 → 헤드스핀 → 프리즈("얼음!") → 킵업 | sparkle, dust |
| `beonjjeok` | 번쩍 | 쳇바퀴 발전 햄스터 | 쳇바퀴 → 낙뢰 → 정전기 아프로 | bolts |
| `jaepjaep` | 잽잽 | 복서 토끼 | 원투 → 어퍼컷 → 땡땡땡 → 챔피언 | confetti, sweat |
| `ppibik` | 삐빅 | 양철 로봇 | 팝핀 → 머리 스프링 → 하트 LED 축포 | confetti, hearts |
| `kkakkung` | 까꿍 | 청사초롱 든 장난꾸러기 유령 | 사라졌다… 까꿍! | wisps |
| `taenggeul` | 탱글 | 캐러멜 푸딩 씨름 선수 | 뒤집기 → 철퍼덕 → 탱글탱글 → 천하장사 | jelly, confetti |

선택 화면 3×3: 둘레 8칸 순서 = 위 표 순서(좌상단부터 시계방향 아님, 행 우선: [0][1][2] / [3][?][4] / [5][6][7]).
같은 캐릭터끼리(미러전) 허용: 2P 쪽은 `.alt` 팔레트.

## 7. 파일 구조와 소유권

```
index.html  manifest.webmanifest  sw.js  .nojekyll  .gitignore  README.md  package.json({"type":"module"})
css/ app.css · battle.css · fighters.css(공용 리그, 존재) · chars/<id>.css ×8 · gate.css
fonts/ bhs.woff2 (Black Han Sans 서브셋, OFL) · OFL.txt
icons/ apple-touch-icon-180.png icon-192.png icon-512.png icon-maskable-512.png favicon-32.png og-800x400.png
js/ main.js · rules.js(FROZEN) · match.js · ai/engine.js · ai/worker.js · ai-client.js
    characters.js · chars/<id>.js ×8 · fighter.js · particles.js(존재) · board.js · themes.js
    audio.js · haptics.js · install.js · storage.js · wake.js · debug.js · ui/*.js
tools/ (개발용, 캐시 제외) serve.py · shot.mjs · make_icons.mjs|py · make_font.py · selfplay.mjs · rules-fuzz.mjs · demo-*.html · src-fonts/
tests/ *.test.js (node --test) · index.js
docs/ SPEC.md · research/ · ref/
```

| 소유 에이전트 | 파일 |
|---|---|
| core-engine | `js/match.js`, `js/ai/engine.js`, `js/ai/worker.js`, `js/ai-client.js`, `tests/match.test.js`, `tests/ai.test.js`, `tools/selfplay.mjs` |
| board | `js/board.js`, `js/themes.js`, `tools/demo-board.html`, `tests/board.test.js` |
| audio | `js/audio.js`, `tools/demo-audio.html`, `tests/audio.test.js` |
| pwa-shell | `index.html`, `manifest.webmanifest`, `sw.js`, `js/install.js`, `js/haptics.js`, `js/storage.js`, `js/wake.js`, `css/gate.css`, `icons/*`, `fonts/*`, `tools/{serve.py,shot.mjs,make_icons.*,make_font.py,demo-gate.html}`, `tests/{install,sw,storage,integration}.test.js`, `tests/index.js`, `.nojekyll`, `.gitignore`, `README.md` |
| fighter-infra | `js/fighter.js`, `js/characters.js`, `js/particles.js`, `css/fighters.css`(확장만), `tools/demo-fighters.html`, `tests/characters.test.js` |
| char-<id> (×8) | `js/chars/<id>.js`, `css/chars/<id>.css` 만 |
| ui | `js/main.js`, `js/ui/*.js`, `js/debug.js`, `css/app.css`, `css/battle.css` |

**규칙**: 자기 파일만 만든다/고친다. 남의 파일에 문제가 있으면 고치지 말고 최종 보고에 적는다. git 상태를 바꾸는 명령(commit, checkout, stash, reset) 금지. `node --test`는 **자기 테스트 파일만** 지정해서 돌린다(다른 에이전트 파일은 작성 중일 수 있다). 출하 파일은 상대 URL만, 외부 네트워크 요청 금지(폰트도 자체 호스팅).

## 8. 모듈 계약 (정확한 시그니처)

### 8.1 `js/match.js` (순수, DOM 없음)
```js
export const FORMATS = { 1:{need:1,label:'단판 승부'}, 3:{need:2,label:'3판 2선승'}, 5:{need:3,label:'5판 3선승'}, 7:{need:4,label:'7판 4선승'} };
export function createMatch(cfg) // → state
// cfg = { mode:'2p'|'cpu', bestOf:1|3|5|7, p1:'<charId>', p2:'<charId>', cpuLevel?:'easy'|'normal'|'hard',
//         cpuPlayer?:2 (CPU는 항상 2P 슬롯), round1Black:1|2, firstRule:'loser'|'alternate',
//         overlineWins:boolean, timer:0|10|20|30, undoLimit:number(-1 = 무제한) }
// state = { v:1, cfg, round:1, score:[p1Wins,p2Wins], rounds:[{winner:1|2|0(draw), how:'five'|'timeout'|'resign'|'draw', moves:n, black:1|2}],
//           black:1|2, moves:number[], status:'playing'|'roundOver'|'matchOver', undoUsed:{1:0,2:0},
//           winner:null|1|2, forfeit:null|1|2, lastLine:null|[[x,y]...] }
export function rulesOf(state)            // → {...DEFAULT_RULES, overlineWins}
export function colorOf(state, player)    // → BLACK|WHITE
export function toMove(state)             // → 1|2 (player)
export function boardOf(state)            // → Int8Array (moves 재생)
export function canPlace(state, idx)      // → {ok:true}|{ok:false,reason:'occupied'|'33'|'44'|'over'}   (현재 둘 차례 기준, rules.judgeMove)
export function play(state, idx)          // 변경 + 반환 {ok, reason?, win?, line?, overline?, draw?, roundOver?, matchOver?}
export function undo(state, player)       // 2P: 그 player의 직전 수(상대가 두기 전) 1개 / CPU(player=1): 사람+CPU 2수(또는 CPU가 아직이면 1수). → {ok, removed:idx[] , reason?:'none'|'limit'|'notYours'}
export function undoLeft(state, player)   // → number | Infinity
export function resignRound(state, player), forfeitMatch(state, player), timeoutRound(state, player) // → 같은 결과 객체
export function nextRound(state)          // roundOver → playing. black 결정(loser/alternate, draw면 교대). moves=[]
export function rematch(state)            // matchOver → 새 state (같은 cfg, 직전 매치 패자가 1라운드 흑)
export function matchPoint(state, player) // → boolean
export function isFinalRound(state)       // → 둘 다 매치 포인트
export function legalMoves(state)         // → idx[] (draw 판정용; 금수 제외)
export function summary(state)            // → {mode, p1, p2, score, winner, rounds, fastestKO, level?, perfect, comeback}
export function serialize(state), deserialize(json) // 검증 실패 → null
```

### 8.2 AI — `js/ai-client.js` / `js/ai/engine.js` / `js/ai/worker.js`
```js
// ai-client.js (메인 스레드)
export function createAiClient({ overlineWins=false } = {})
// → { think({ moves, level:'easy'|'normal'|'hard', seed, timeMs? }) → Promise<{ move, reason, score, depth, nodes, ms }>,
//     cancel(), dispose() }
// 반환 move는 반드시 rules.judgeMove(...).ok === true 인 칸(둘 곳 없으면 move:-1, reason:'draw').
// 모듈 Worker(new URL('./ai/worker.js', import.meta.url), {type:'module'}) 우선, 실패 시 메인 스레드 폴백(예산 ≤500ms).
// visibilitychange hidden → 진행 중 탐색 취소; UI가 visible에서 다시 요청.
// engine.js: export function createEngine({overlineWins}) → { think(req), reset() } ; export function bench() (선택)
```
- 설계·수치·테스트 목록 = `docs/research/ai.md` (프로토타입 `docs/ref/board.js`, `docs/ref/ai.js`).
- **정확한 금수 일치**: 엔진의 빠른 표 기반 FORBID 플래그가 `rules.isForbidden`과 다를 수 있다(규칙 엔진은 거짓 3 재귀 포함). 엔진은 legal(i,c) 판정을 `rules.isForbidden`과 **정확히 동일**하게 만들 것(예: 표 FORBID가 rules 금수의 상위집합임을 퍼즈로 확인한 뒤, 표가 FORBID라 할 때만 rules.isForbidden으로 확정). 상대가 막아야 할 칸이 상대 금수라 못 막는 경우(“금수 함정”)도 rules 기준.
- 난이도: 쉬움(≈60ms, 4목 막기 90%, 열린3 막기 50%, softmax) · 보통(450ms) · 어려움(1300ms, 최대 1800).

### 8.3 `js/board.js` + `js/themes.js` (DOM; canvas 3장: board / stones / fx, + 돋보기 canvas)
```js
export function createBoard(host, opts) // host 안에 정사각 판을 채운다(ResizeObserver)
// opts = { theme:'mat', input:'double'|'single', canPlace(idx)→{ok}|{ok:false,reason}, onCommit(idx),
//          onArm?(idx), onReject?(idx, reason), sfx?(name) }
// → { el, setPosition(board:Int8Array, last:idx|-1), place(idx, color, {animate=true}={}), remove(idx),
//     setTurn(color:1|2, accent:'#hex'), setLocked(bool), armed()→idx|-1, clearArmed(), commitArmed()→idx|-1,
//     showWin(cells:[[x,y]...])→Promise, flashForbidden(idx), setForbiddenMarks(idx[]|null),
//     setTheme(id), setInput(mode), resize(), destroy() }
// sfx 이름: 'arm' | 'cursor' | 'occupied' — 착수음은 UI가 audio.play('place',{color,theme}) 로 낸다.
// 순수 헬퍼도 export (테스트용): geometry(size) → {cell,pad}, pointToIdx(px,py,geom), hysteresis(...)
export const THEMES; export const THEME_IDS = ['mat','neon','dojo','pixel','wood'];
// THEMES[id] = { id, name, accent, pageBg (CSS background 문자열), drawBoard(ctx, geom), stoneStyle, placeSound:'mat'|'neon'|'pixel'|'wood'|'dojo' }
```

### 8.4 `js/audio.js` (품알 audio.js의 언락/워치독/복구 사다리 유지, 소리 부분 교체)
```js
export const audio = { init(prefs), unlock(), play(name, opts?), jingle(spec, {delay=0}={}) → {stop()}, stopAll(),
                       setEnabled(bool), isEnabled(), setVolume(0..1), setIgnoreSilent(bool) };
export const SFX_NAMES = [...] ; export const CHAR_SFX = [...]
```
- UI 효과음(ux.md §4.2): `place`(opts {color:1|2, theme}), `arm`, `cursor`, `occupied`, `deny`, `menu`, `ok`, `cancel`, `pick1`, `pick2`, `vs`, `round`, `fight`, `ko`, `roundWin`, `matchWin`, `lose`, `tick`, `tickHi`, `timeover`, `undo`, `coin`, `draw`, `toast`.
- 캐릭터 큐 효과음(이 목록만 사용): `WHOOSH SWISH SCRATCH POP TING BOING PUNCH CLUNK ZAP BELL BLIP SNIFF COUGH GIGGLE HUP WHIRR SPLAT CRACKLE`.
- **징글 형식** (캐릭터 데이터가 이 형식으로 적는다):
```js
jingle: { at: 1.56,                      // 승리 타임라인 기준 초(재생 시작 시점)
  voices: [
    { wave:'square'|'triangle'|'sine'|'sawtooth'|'pulse25', gain:0.07, lowpass?:2400,
      notes:'C3:316 Eb3:158 F3:158 G3:316' },   // 음표 토큰 <음이름><옥타브>[수식]:<ms>, 쉼표 '-:<ms>'
    { drums:'K:158 -:158 S:158 -:79 K:79 K:158 S:316' }   // 드럼 토큰 K S H BELL 및 캐릭터 큐 효과음 이름
  ] }
// 음 수식: '~' 비브라토(6Hz ±15cent), '>X' 글라이드(예 'A4>C5:180'), '^' 보잉(4도 아래서 40ms 글라이드 업)
// 음이름: C C# Db D D# Eb E F F# Gb G G# Ab A A# Bb B, 옥타브 0–8. 총 길이 ≤ 1600ms.
```
- 기본 audioSession `ambient`(무음 스위치를 따름). 설정 "무음 모드에서도 소리" → `playback`(켤 때 경고: 듣던 음악이 멈춰요). `<audio>` 요소·speechSynthesis 금지.

### 8.5 캐릭터 — `js/chars/<id>.js` (기본 export), `css/chars/<id>.css`
```js
export default {
  id:'bigom', ko:'비곰', en:'Bigom', tagline:'판 위의 비보이',   // tagline ≤ 12자
  type:'곰',                           // 선택 화면 짧은 라벨 ≤ 4자 (종족). tagline = 역할
  color:'#2F6BFF', colorAlt:'#FF4F8B', // UI 강조색(선택 커서·결과 배경)
  bg:['#1B3A9E','#0D1A4F'],            // VS/결과 화면 배경 2색
  winMs:2400, hitAt:1.56, excerptFrom:1.26,   // excerpt = 라운드 승리 때 이 시점부터 재생(≈ hitAt−0.3)
  quote:{ win:'리스펙트! 근데 판은 내 거.', winEn:'Respect! But this floor is mine.', lose:'GG. 다음 배틀에서 보자.' }, // win ≤ 22자
  anchors:{ head:[60,10], center:[60,63], feet:[60,110], sky:[60,-15] },  // viewBox 좌표
  cues:[ {t:0.38,sfx:'WHOOSH'}, {t:1.50,sfx:'SCRATCH'}, {t:1.56,fx:'sparkle',at:'head',shake:120}, {t:2.33,fx:'dust',at:'feet'} ],
  //  cue 필드: t(초, 0–2.4 오름차순) · sfx(CHAR_SFX 이름) · fx(particles FX 이름) · at(anchors 키 또는 [vx,vy]) · shake(ms) · flash(true)
  turnSfx:'BLIP',                       // 선택: 내 차례 진입음(없으면 생략)
  jingle:{ at:1.56, voices:[…] },
  portrait:'24 6 72 72',                // 초상(머리) 크롭 viewBox 문자열
  svg:`<svg class="ch ch-bigom" viewBox="0 0 120 120" role="img" aria-label="비곰">…</svg>`,
  fx:`<svg class="fx" viewBox="0 0 120 120" aria-hidden="true">…</svg>`,
};
```
CSS 계약 (`css/chars/<id>.css`):
- 팔레트 변수는 `.ch-<id> { --fur:… }`, 2P 대체는 `.alt .ch-<id> { … }`. 색 클래스는 **반드시 범위 지정**: `.ch-<id> .fur { fill: var(--fur) }`.
- 모든 `@keyframes` 이름은 `<id>-` 접두사. 상태 셀렉터 `.stage[data-char="<id>"][data-state="…"]`.
- 필수 상태: `turn`(0.6s 1회 후 공용 breathe로), `win`(정확히 2.4s 타임라인 + 이후 무한 루프, 루프는 animation-delay 2.4s), `lose`(1.0s 1회 + 루프), `.fidget`(≤0.8s 1회).
- 배터리: 타임라인이 끝나면 `js/fighter.js`의 `settle()`이 끝난 타임라인 애니메이션을 정리해 `.rig` 루프만 합성 레이어로 남기고, SVG 파트 루프·어지러움 별은 몇 바퀴 뒤 0% 프레임에서 멈춘다(캐릭터 CSS는 그대로 두면 됨). 피젯은 페이지 전체에서 한 번에 1명. idle은 공용 breathe를 쓰거나 `[data-state="idle"]`로 자기 것(합성 레이어 .rig만 무한 반복).
- `[data-motion="reduce"]` 정지 포즈(승리 face-b + 상징 포즈 정적 transform) 제공.
- 같은 @keyframes 안의 모든 transform은 같은 함수 목록. `linear()` 금지, 개별 `rotate:/scale:/translate:` 속성 금지. SVG 안 `id=`, `<filter`, `<linearGradient`, `<radialGradient`, `<mask`, `<clipPath` 금지. 애니메이션되는 요소에 `transform=""` 속성 금지(관절 샌드위치 사용).
- 효과 레이어 요소는 `fx-` 클래스(기본 숨김, 상태 애니메이션이 opacity로 보여 줌). 패배 어지러움 별은 `<g class="fx-dizzy"><path class="star"…/>×3</g>`(공용 궤도 애니메이션).
- 품질 기준 = `docs/ref/bigom.html` (WebKit·Chromium 검증 완료). 초안 그림 = `docs/ref/lineup.html`.

### 8.6 `js/fighter.js` + `js/characters.js`
```js
// characters.js
export const CHARACTERS;      // 8개, §6 표 순서. import ./chars/<id>.js
export const CHARACTER_IDS;   export function getCharacter(id);
// fighter.js
export function createFighter(id, { alt=false, size=120, dir=1 } = {})
// → { el, id, set(state:'idle'|'turn'|'attack'|'hit'|'lose'), win({ excerpt=false, sound=true, onShake?, onHit? }={}) → Promise(타임라인 끝),
//     skip() /* 2.4s로 점프 */, destroy() }
//  - set('turn'|'attack'|'hit') 는 1회 후 자동으로 idle. 'lose'는 유지.
//  - 감독(director): rAF마다 .rig의 *-win 애니메이션 currentTime을 읽어 cue를 넘을 때 발사
//    (sfx → audio.play, fx → particles.burst(anchor(stage, …)), shake → onShake(ms), flash). 징글은 AudioContext 시계로 at에 맞춰 1회 예약.
//  - excerpt: 상태 적용 후 stage.getAnimations({subtree:true}) 모두 currentTime += excerptFrom*1000.
//  - fidget: idle 동안 5–9초 랜덤 간격으로 .fidget 클래스 0.8s.
//  - visibilitychange hidden → 진행 중 승리 연출 즉시 끝으로(파티클 clear).
export function portraitHTML(id, { alt=false } = {})  // 머리 크롭 정적 SVG 문자열(HUD·선택칸용; 애니메이션 없음)
export function figureHTML(id, { alt=false } = {})    // 전신 정적 SVG 문자열
```
(`audio`·`particles`는 fighter.js 내부에서 import. audio가 아직 없으면 테스트는 no-op 모의로.)

### 8.7 `js/storage.js` · `js/wake.js` · `js/haptics.js` · `js/install.js`
```js
// storage.js — 모든 접근 try/catch, 동기 쓰기
export const KEYS = { prefs:'omok.prefs.v1', setup:'omok.setup.v1', save:'omok.save.v1', stats:'omok.stats.v1' };
export const DEFAULT_PREFS = { sound:true, volume:0.8, ignoreSilent:false, haptics:true, fxSpeed:'normal', shake:true,
  motion:'auto', input:'double', showForbidden:false, overlineWins:false, firstRule:'loser', trial:false, seenArmHint:0 };
export const DEFAULT_SETUP = { '2p':{ bestOf:3, timer:0, undo:1, stage:'mat' },
  cpu:{ bestOf:3, timer:0, undo:3, stage:'mat', level:'normal', myColor:'black' }, chars:{ p1:'bigom', p2:'nyangja', cpuMe:'bigom' } };
export function loadPrefs(), savePrefs(p), loadSetup(), saveSetup(s), loadSave(), saveMatch(stateJsonString|object), clearSave(),
  loadStats(), recordMatch(summary), resetStats();
// stats = { matches, rounds, byChar:{id:{played,won}}, cpu:{easy:{w,l},normal:{w,l},hard:{w,l}}, cpuStreak, cpuBestStreak,
//           fastestKO:null|n, longestRound:0, recent:[{at, mode, p1, p2, score:[a,b], winner, level?}] (최대 20) }
// wake.js
export function keepAwake(on)   // navigator.wakeLock, visible 복귀 시 재요청, 모든 호출 try/catch
//   (홈 화면 앱에서 실제로 화면이 켜진 채 유지되는 건 iOS 18.4+. 그 이전 iOS는 자동 잠금될 수 있음 — 잠기면 매치가 저장·일시정지됨)
// haptics.js — 품알 그대로 (attachHaptic(el), setHapticsEnabled(on), hapticsKind())
// install.js — 품알 이식: CANONICAL_URL, detectEnv, gateMode, escapeLink, mountGate(root, mode, env, {onPlayHere, auto, inGame}),
//   shareApp(), registerSW({beforeReload, canReload}), isUpdatePending(), applyPendingUpdate(), (Android) canPromptInstall/promptInstall/onInstallAvailable/mountInstallPill
```

### 8.8 UI — `js/main.js`, `js/ui/*.js`, `js/debug.js`
- `export const VERSION = 'omok-v1'` in main.js (sw.js와 동일; 테스트가 확인).
- 부팅: loadPrefs → data-motion 적용 → audio.init → detectEnv → registerSW → gateMode → 게이트 또는 타이틀. standalone이면 `navigator.storage.persist()`.
- 라이프사이클: hidden/pagehide → 매치 동기 저장, 타이머 정지, AI 취소, 오디오 무음. visible → 재개, applyPendingUpdate 시도는 `canReload` 규칙대로(대국·연출 중엔 금지).
- 디버그(`js/debug.js`): `?play=1` 게이트 생략, `?gate=install|escape`, `?shot=<state>`로 고정 상태 렌더(title, menu, setup2p, setupCpu, select, vs, coin, battle, armed, forbidden, ko, roundResult, matchResult&char=<id>, pause, undoAsk, settings, records, draw, timeover, landscape), `?seed=`, `?bench`(AI 벤치). shot 상태는 애니메이션을 결정적으로 멈출 수 있어야 함(`&t=` 초).

## 8.9 입력 가드 (리뷰 후 추가)
- 화면 전환 직후 ~300ms(`router.js` `.is-guarded`), 레이어 등장 350ms(`sheet.js` `.is-entering`), 캐릭터 선택 단계 전환 350ms, 판은 일시정지/대화상자 닫힘·이어하기 후 250ms 잠금 — 더블탭이 다음 화면으로 새지 않게 한다.
- 2P 무르기 요청 대화상자는 스크림 탭으로 닫히지 않는다(봐준다/안 돼만).

## 9. 시각 정체성 (앱 크롬)

- 톤: **스트리트 아케이드 × 스티커.** 캐릭터와 같은 잉크 외곽선(#2A1E2F), 두꺼운 테두리 3px + 아래 4px 잉크 그림자(스티커/버튼 눌림), 비보이 배틀 포스터 감성. 촌스러운 그라디언트·글래스모피즘 금지.
- 토큰(`css/app.css` `:root`):
  `--bg:#17121F --bg2:#221A2E --bg3:#2E2440 --ink:#2A1E2F --line:#3B2F4F --paper:#FFF4DE --text:#FFF4DE --dim:#BBAFCF`
  `--p1:#FF4757 --p2:#2E9BFF --gold:#FFD23F --lime:#B6FF4D --mint:#3FE0B5 --danger:#FF3B30`
- 페이지 배경 `#17121F`(html/body, head 인라인 style로 첫 페인트부터; status bar 샘플링용). 게이트·전체 오버레이는 불투명.
- 글꼴: 디스플레이 = `'BHS'`(fonts/bhs.woff2, Black Han Sans 서브셋, font-display:swap) → 로고·버튼·연출 글자. 본문 = `-apple-system, 'Apple SD Gothic Neo', system-ui, sans-serif`.
- 버튼 최소 44×44pt. 본문 16px 이상. `word-break: keep-all`.
- 애니메이션 원칙: transform/opacity만. 큰 블러·필터 금지. reduce-motion 존중.

## 10. PWA (docs/research/pwa.md §3 체크리스트 그대로)

- head 태그·manifest(no `id`, `orientation:portrait`)·아이콘 6종·SW(품알 패턴: 프리캐시 전부, required/optional, cache:'reload', cache-first ignoreSearch, 오프라인 내비 폴백, `omok-` 캐시만 정리)·업데이트(VERSION 동기, 조용할 때 리로드)·뷰포트(100vh standalone / 100dvh 탭, safe-area, pinch/double-tap/long-press/선택/러버밴드 차단)·wake lock·가로 오버레이.
- 프리캐시 목록 = index.html이 닿는 모듈 그래프 + Worker 스크립트 + 모든 CSS + 폰트(통합 테스트가 일치 확인).
- 아이콘: 앱 배경 위에 광택 흑돌·백돌이 부딪히고 사이에 노란 코믹 임팩트 별, 흑돌엔 작은 빨간 복싱 글러브(“돌주먹”). 60px에서도 읽힐 것. 투명 없음, 각진 모서리. 마스커블은 중앙 60%.
- 게이트 문구는 게임용으로: 리드 "홈 화면에 추가하면 앱처럼 바로 한 판!", 체험 "설치 없이 해보기", 경고 "여기서 쌓은 전적은 설치한 앱으로 옮겨지지 않아요".

## 11. 테스트 · 검증

- `node --test tests/` 전부 통과(테스트 파일마다 독립). Playwright(Chromium `/opt/pw-browsers`, `createRequire('/opt/node22/lib/node_modules/')`로 로드) 스크린샷 검증: 375×667, 393×852, 440×956 + 가로 852×393. WebKit 26: `PLAYWRIGHT_BROWSERS_PATH=/tmp/claude-0/-home-user-skim-ai-os/164b20a1-3bf2-55a7-b177-d7513698c889/scratchpad/pwwk/browsers` 로 `webkit` 실행 가능(애니메이션·SVG 확인용).
- 콘솔 에러 0, 가로 넘침 0, 버튼 ≥44px.
- IP 가드: 출하 파일에 실제 프랜차이즈/캐릭터 이름(포켓몬, 피카츄, 스트리트 파이터, 류, 춘리 등) 없음.
- 로컬 실행: `python3 tools/serve.py` → `http://localhost:8791/?play=1`.
