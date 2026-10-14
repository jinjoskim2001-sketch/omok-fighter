# 오목 파이터: 오목 규칙과 3-3 금수 판정 (SPEC 작성용 조사 결과)

**Status:** 규칙 엔진은 만들어서 검증까지 마쳤습니다. 테스트 46개가 모두 통과합니다. 따로 짠 무차별 대입 구현과 랜덤 보드 300개, 규칙 변형 5개로 비교한 529,130번에서 결과 불일치가 0건입니다. 아래 결정 사항은 한국 온라인 오목 서비스 규칙(엠게임)과 RIF 렌주 정의를 근거로 합니다. 나무위키 원문은 403으로 막혀 검색 결과 요약으로만 확인했고, 어느 출처인지는 각 항목에 적었습니다.

## 0. 결정 사항 요약
| 항목 | 기본값 | 옵션으로 노출? |
|---|---|---|
| 판 크기 | **15×15** | 아니요 |
| 3-3 | **흑백 모두 금수**. 떨어진(띈) 3 포함, 한쪽이 막힌 3은 3이 아님 | 아니요 (오너 요구). 코드에는 `doubleThree:'both'|'black'|'off'` 값을 남겨 둠 |
| 4-4 | **허용** (한 줄 위 4-4인 X.XXX.X 포함) | 아니요. 코드에 `doubleFour` 값만 남김 |
| 4-3 | **허용** | 아니요 |
| 4-3-3 | **금수** (3-3을 포함하니까) | 아니요 |
| 장목(6목 이상) | **둘 수는 있지만 승리가 아님** (국룰) | **예**: "6목 이상도 승리" 토글, 기본 꺼짐 |
| 5목과 3-3이 동시에 생길 때 | **5목 승리가 우선** | 아니요 |
| 6목과 3-3이 동시에 생길 때 (장목 미인정) | **금수**. 6목은 5목이 아니라서 3-3 판정이 그대로 적용됨 | 장목 토글을 켜면 승리 |
| 거짓 금수(가짜 3) 재귀 판정 | **켬**, `maxDepth 3` | 아니요 (내부 값) |
| 선공 | 흑이 먼저. 1판은 랜덤(동전 연출), 이후 **판마다 흑백 교대** | **예**: "교대" 또는 "진 사람이 흑" |
| 무승부(판이 꽉 참) | 그 판은 무효로 하고 다시 둠 | 아니요 |
| 판수 | 단판 / 3판 2선승 / 5판 3선승 / 7판 4선승 | 예 (대국 전에 선택) |
| 오프닝 제한 (오프닝 렌주, swap) | 없음 | 아니요 |

## 1. 한국 일반 규칙("국룰"/일반룰) 조사

**엠게임 오목 공식 규칙 페이지** (EUC-KR 원문을 직접 받아 디코딩, 원문 그대로):
- A. 일반룰: "오목 게임의 가장 일반적으로 통용되는 규칙으로써, 19\*19 바둑판 규격이나, 15\*15 오목판 규격 모두 사용합니다. - 흑, 백 모두 3\*3 금수 처리함. - 4\*4는 흑, 백 모두 둘 수 있는 형태임. - 장목(6목이상) 흑, 백 모두 둘 수는 있되, 승패에 영향은 없음."
- 비교표 기준 일반룰은 3-3 흑백 불가, 4-4 허용, 장목은 "허용(승패에 영향없음)", 4-3 허용(승)입니다.
- 금수 정의: "三參 (3,3)금수 : 돌을 놓았을 때, **3 또는 틈3**이 동시에 2개가 만들어지는 것". 그래서 띈 3도 포함합니다.
- "十禁(3,3,4) 금수 : 3-3금수 형태에 4 또는 틈4를 포함하고 잇는 것". 그래서 4-3-3은 금수입니다.
- 렌주룰: 흑만 3-3, 4-4, 장연(6목 이상)이 금수이고 백은 제한이 없습니다.

**다른 출처**
- 오목+ 블로그(2012): 일반룰 설명이 위와 같습니다. 이 서비스는 "떨어진 3-3 허용" 옵션도 두었습니다. 띈 3을 세는지는 서비스마다 다를 수 있다는 근거입니다.
- 나무위키 '오목/룰의 종류'(검색 결과 요약 기준): "일반룰은 흑백 모두 3-3만을 금수로 하는 룰", "6목 이상(장목)이 금수는 아니나 승리 조건도 아니다", "한국 사람들끼리 가볍게 대전할 때 가장 많이 쓰이는 룰".
- 페미위키 '오목': 오목룰에서는 "틈이 있는 삼은 삼삼에 포함되지 않음"이라고 해서 다른 출처와 **충돌**합니다. 그래도 띈 3은 포함하는 쪽을 권장합니다. 엠게임, 렌주, 나무위키가 모두 포함하고, 판정은 앱이 하므로 플레이어가 외울 필요가 없기 때문입니다.
- 현재 포털 서비스는 렌주 쪽입니다. 한게임 오목 모바일(2022 재출시) 설명은 "오목 공식 렌주룰", 즉 흑만 제한합니다. 그러니 오너가 원하는 "3-3은 아예 없음"은 포털 규칙이 아니라 일반룰(국룰)에 해당합니다.
- RIF 렌주 규칙 9.2: 같은 수로 5목이 생기면 금수가 아닙니다. 5목 우선의 근거입니다.

**판 크기 15×15를 고른 이유:** 렌주 표준이고, 아이폰 화면 폭(약 390pt)에서 여백을 빼면 칸 간격이 약 24pt입니다. 19×19는 약 18pt라 터치 오차가 커집니다.

**흑백 교대:** 흑백 모두 3-3을 금지해도 선공 흑은 여전히 유리합니다. 15×15 자유오목은 흑 필승이 증명되어 있습니다(Allis 1994). 그래서 여러 판으로 겨룰 때는 교대가 공정합니다. "진 사람이 흑"이 한국 관습인지는 **확인하지 못했고**, 그래서 옵션으로 두었습니다.

## 2. 정의와 알고리즘 (흑백 공통)

**정의** (RIF 문구를 흑백 모두에 적용하도록 일반화):
- **5목:** 방금 둔 돌을 지나는 연속 정확히 5개. `overlineWins`를 켜면 5개 이상.
- **4:** 그 줄에 돌 1개를 더 두면 5목이 되는 상태.
- **열린 4(straight four):** 끊김 없는 정확히 4개이고, 양 끝 빈칸 두 곳이 각각 5목이 되는 상태. 장목 미인정이면 정확히 5개여야 합니다.
- **3:** 그 줄의 빈칸 q에 돌을 두면 p와 q를 함께 포함하는 열린 4가 되는 상태. 거짓 금수 판정을 켜면 q 자체가 그 색의 금수가 아니어야 합니다.
- **3-3:** 5목을 만들지 않는 수가 서로 다른 줄에 3을 2개 이상 만드는 것.

**알고리즘** (`analyzeMove`): 
1. p에 두면 5목이 되는지 먼저 봅니다. 5목이면 바로 승리이고 금수 판정은 하지 않습니다.
2. p에 임시로 돌을 놓습니다.
3. 네 방향마다 한 번씩만 분류합니다. 우선순위는 5목 > 4 > 3입니다.
   - **4 판정:** p에서 양쪽으로 자기 돌을 따라가다 처음 만나는 빈칸 e를 찾습니다. 상대 돌이나 판 끝을 만나면 그쪽은 없는 것으로 봅니다. e에 두면 그 방향에서 5목이 되는지 확인합니다.
     - 승리점이 2개이고 p가 속한 연속 돌이 4개면 열린 4로 보고 **4 한 개**로 셉니다.
     - 승리점이 2개인데 연속 돌이 4개가 아니면(X.XXX.X) **4 두 개**로 셉니다.
   - **3 판정:** 그 줄에 4가 없을 때만 합니다. 양쪽에서 처음 만나는 빈칸 q에 임시로 두고 그 줄이 열린 4가 되는지 봅니다. 그렇고, 동시에 거짓 금수 판정이 꺼져 있거나 깊이 제한에 걸렸거나 q가 금수가 아니면 3입니다.
     - q의 금수 여부는 p를 놓은 채로 재귀 판정합니다.
     - p와 q를 모두 포함하는 열린 4는 연속이어야 하므로, q가 첫 빈칸이라는 것만으로 충분합니다.
4. 돌을 원래대로 돌려놓습니다.
5. 금수는 `threes ≥ 2`일 때입니다. 옵션을 켜면 `fours ≥ 2`도 금수입니다.

**판 끝:** 판 밖은 상대 돌처럼 막힌 곳으로 취급합니다(`nextEmpty`가 -1 반환). 끝에 딱 붙은 3은 3이 아니고(C08, C36), 끝에서 한 칸 떨어진 3은 3입니다(C09, C35).

**같은 줄의 3 두 개:** 줄마다 한 번만 판정하므로 한 번으로 셉니다(C21).

**재귀를 켜 둔 이유:**
- 일반룰에서 거짓 3이 생기는 경우는 q가 4-3-3 자리일 때뿐입니다. 4-4와 장목은 허용이라 다른 원인은 없습니다. 그래서 드뭅니다.
- 측정: 랜덤 보드 104만 칸 중 금수 판정 5,189건에서, 재귀를 켜고 끄는 것으로 결과가 바뀐 경우가 91건(1.8%)이었습니다.
- 깊이 3과 깊이 10의 결과 차이는 0건입니다.
- 비용이 거의 없고, 켜면 억울한 금수가 줄어드는 방향으로만 바뀝니다.

**성능 (Node 22):**
- 프리필터 없이 전체 분석: 칸당 약 0.7µs
- 실제 게임 같은 보드에서 `isForbidden`: 칸당 약 0.5~0.8µs
- 그래서 AI 탐색 노드마다 호출해도 부담이 없습니다.

**UI와 AI 연동 메모:**
- 금수 자리를 미리 표시하지 않습니다(오너: 가이드 없이). 금수 자리를 누르면 `judgeMove`가 `{ok:false, reason:'33'}`을 돌려주고, 흔들림 효과, 햅틱, "삼삼은 둘 수 없어요" 토스트를 보여 줍니다.
- `overline:true`가 오면 "6목은 승리가 아니에요" 토스트를 띄웁니다.
- 막아야 할 자리가 내 금수이면 막을 수 없어 질 수 있습니다. 규칙상 정상이니 토스트로 이유를 알려 줍니다.
- AI는 자기 수에도 `isForbidden`을 써야 합니다. 상대의 금수 자리는 위협이 아니라는 점을 반영하고, 상대가 막아야 할 자리를 금수로 만드는 수도 노려야 합니다.
- 둘 수 있는 칸이 하나도 없으면 무승부로 처리합니다.
- 함수들은 보드에 돌을 임시로 썼다가 되돌립니다. 같은 배열을 동시에 쓰는 Worker가 있으면 복사본을 넘겨야 합니다.

## 3. 참조 코드
전체 파일: `/tmp/claude-0/-home-user-skim-ai-os/164b20a1-3bf2-55a7-b177-d7513698c889/scratchpad/omok/js/rules.js` (193줄, ES module, DOM 없음). 품알 구조 그대로 `js/rules.js`로 복사하면 됩니다.

공개 API:
- `isFive(b,x,y,c,overlineWins)`
- `winningLine(...)`
- `analyzeMove(b,x,y,c,rules) → {five,fours,threes}`
- `isDoubleThree(b,x,y,c,rules)`
- `isForbidden(b,x,y,c,rules)`
- `judgeMove(b,x,y,c,rules)`
  - `{ok:false, reason:'occupied'|'33'|'44'}` 또는 `{ok:true, win, line, overline}`

보드 형식: `Int8Array(225)`, 인덱스 `y*15+x`, 값 0=빈칸 / 1=흑 / 2=백.

핵심 부분:
```js
export const DEFAULT_RULES = Object.freeze({
  overlineWins: false, doubleThree: 'both', doubleFour: 'off', fakeThreeCheck: true, maxDepth: 3 });

function nextEmpty(b, x, y, sx, sy, c) {            // first empty past own stones; -1 if O/edge
  let i = x + sx, j = y + sy;
  while (inb(i, j)) { const v = b[j*N+i]; if (v === c) { i += sx; j += sy; continue; }
    return v === EMPTY ? j*N+i : -1; }
  return -1;
}
function foursInDir(b, x, y, c, dx, dy, ow) {        // c already on (x,y)
  let wins = 0;
  for (const s of [1, -1]) { const e = nextEmpty(b, x, y, s*dx, s*dy, c);
    if (e >= 0 && fiveInDir(b, e%N, (e/N)|0, c, dx, dy, ow)) wins++; }
  if (wins === 2 && runLen(b, x, y, dx, dy, c) === 4) return 1;   // straight four = one four
  return wins;                                                     // X.XXX.X = 2
}
function isStraightFour(b, x, y, c, dx, dy, ow) {
  if (runLen(b, x, y, dx, dy, c) !== 4) return false;
  for (const s of [1, -1]) { const e = nextEmpty(b, x, y, s*dx, s*dy, c);
    if (e < 0 || !fiveInDir(b, e%N, (e/N)|0, c, dx, dy, ow)) return false; }
  return true;
}
function threeInDir(b, x, y, c, dx, dy, rules, depth) {
  for (const s of [1, -1]) {
    const q = nextEmpty(b, x, y, s*dx, s*dy, c); if (q < 0) continue;
    const qx = q % N, qy = (q / N) | 0;
    b[q] = c; const straight = isStraightFour(b, qx, qy, c, dx, dy, rules.overlineWins); b[q] = EMPTY;
    if (!straight) continue;
    if (rules.fakeThreeCheck && depth < rules.maxDepth && forbiddenAt(b, qx, qy, c, rules, depth + 1)) continue;
    return true;
  }
  return false;
}
export function analyzeMove(b, x, y, c, rules = DEFAULT_RULES, depth = 0) {
  if (isFive(b, x, y, c, rules.overlineWins)) return { five: true, fours: 0, threes: 0 };
  const idx = y*N+x; b[idx] = c; let fours = 0, threes = 0;
  for (const [dx, dy] of DIRS) {
    const f = foursInDir(b, x, y, c, dx, dy, rules.overlineWins);
    if (f) { fours += f; continue; }                       // a four line is never also a three
    if (threeInDir(b, x, y, c, dx, dy, rules, depth)) threes++;
  }
  b[idx] = EMPTY; return { five: false, fours, threes };
}
function forbiddenAt(b, x, y, c, rules, depth) {          // (x,y) empty
  const t33 = applies(rules.doubleThree, c), t44 = applies(rules.doubleFour, c);
  if (!t33 && !t44) return false;
  if (!mayBeForbidden(b, x, y, c, t33, t44)) return false;  // conservative prefilter
  const { five, fours, threes } = analyzeMove(b, x, y, c, rules, depth);
  if (five) return false;                                    // 5목 우선
  return (t33 && threes >= 2) || (t44 && fours >= 2);
}
```

## 4. 테스트 국면 (41개, 변형 포함 46개 테스트, 모두 통과)

파일: `.../scratchpad/omok/tests/rules.test.js` (`node --test tests/rules.test.js`). 테스트마다 흑백을 바꿔서도 같은 결과가 나오는지 확인합니다.

표기:
- `X` = 둘 차례인 쪽의 돌, `O` = 상대 돌, `*` = 둘 자리, `.` = 빈칸
- `#` = 판 끝. `#`이 없는 쪽은 판이 빈칸으로 이어집니다.
- 표시가 없으면 기본 규칙입니다.

```
C01 FORBIDDEN  solid open three x2 (H+V)          C02 FORBIDDEN  split X.XX + solid
  .....                                              ......
  ...X.                                              ....X.
  ...X.                                              ....X.
  .XX*.                                              .X.X*.
C03 FORBIDDEN  * fills two split threes (H XX.X, diag X.XX)
  .X.....
  .......
  ..X*.X.
  ....X..
C04 FORBIDDEN  diagonal + anti-diagonal            C40 FORBIDDEN  anti-diag split + H split
  .X...X.                                            ......X.
  ..X.X..                                            ........
  ...*...                                            .XX.*...
                                                     ...X....
C05 ALLOWED  V blocked directly (OXX*)             C06 ALLOWED  V "O.XXX.O" is NOT a three
  ...O.                                              ...O.
  ...X.                                              .....
  ...X.                                              ...X.
  .XX*.                                              ...X.
                                                     .XX*.
C07 FORBIDDEN  V "O.XXX.." (O only one side, dist 2) .....
  ...O.  .....  ...X.  ...X.  .XX*.                  ...O.
C08 ALLOWED  |XX* flush to edge                    C09 FORBIDDEN  |.XX*. one-cell margin = three
  #..X.                                              #...X.
  #..X.                                              #...X.
  #XX*.                                              #.XX*.
C10 ALLOWED  |X.X* edge split                      C11 ALLOWED  corner diag not three; H three only
  #...X.                                             #######
  #...X.                                             #X.....
  #X.X*.                                             #.X....
                                                     #..*XX.
C12 ALLOWED (default) / C13 FORBIDDEN (overlineWins=true)   both straight-fours would be 6목
  ......X....
  ......X....
  .X..XX*..X.
C14 FORBIDDEN  X..XX*... flanked one side only → still three
  ......X.
  ......X.
  .X..XX*.
C15 ALLOWED  4-3 (closed four + open three)        C16 ALLOWED / C16b FORBIDDEN(doubleFour:'both')  4-4 two lines
  .....X.                                            ....X.
  .....X.                                            ....X.
  .OXXX*.                                            ....X.
                                                     .XXX*.
C17 ALLOWED / C17b FORBIDDEN(doubleFour:'both')  one-line 4-4 X.XXX.X (counts 2)
  .X.X*X.X.
C18 FORBIDDEN  4-3-3                               C19 WIN  five + 3-3 → five wins
  ...X.X.                                            ...X.X.
  ....XX.                                            ....XX.
  .OXXX*.                                            .XXXX*.
C20 FORBIDDEN (default: 6목+3-3) / C20b WIN (overlineWins=true)
  ..X.X...
  ...XX...
  .XXX*XX.
C21 ALLOWED (overlineWins=true)  two threes on ONE line count once
  .XX.*.XX.
C22 ALLOWED (default) / C23 FORBIDDEN (fakeThreeCheck=false)   fake three:
  .....XX.X.     H "O.XX*" straightens only at the cell right of *, which (with * placed)
  .....XXX..     is a 4-3-3 → forbidden → H three is fake → only V three is real
  .O.XX*....
C24 FORBIDDEN  same without O → second legal straightening point → real 3-3
  ...XX.X.
  ...XXX..
  .XX*....
C25 ALLOWED  .X.X*O                                C26 ALLOWED  OX.X*.
  ....X..                                            .....X.
  ....X..                                            .....X.
  .X.X*O.                                            .OX.X*.
C27 ALLOWED  X..X* two-gap is not a three          C33 ALLOWED  unrelated .XXX. on same line
  .....X.                                            ......X.
  .....X.                                            ......X.
  .X..X*.                                            .XXX..*.
C28 FORBIDDEN  bottom-right, diag+H with 1 inner margin   C29 ALLOWED  corner: nothing is a three
  .X...#                                             .X.X#
  ..X..#                                             ..XX#
  .XX*.#                                             ...*#
  .....#                                             #####
  ######
C30 ALLOWED  doubleThree:'black', WHITE to move, C01 shape
C31 ALLOWED  opponent's 3-3 point (OO* / O / O) is free for me
C32 ALLOWED  single open three .XX*.
C34 ALLOWED  .XXX.* is a broken four → 4-3        C41 ALLOWED  X.XX* is a four (X.XXX) → 4-3
  .....X.                                            .....X.
  .....X.                                            .....X.
  .XXX.*.                                            .X.XX*.
C35 FORBIDDEN  top edge, V with one empty row      C36 ALLOWED  top edge, V flush
  #####                                              #####
  .....                                              ...X.
  ...X.                                              ...X.
  ...X.                                              .XX*.
  .XX*.
C37 ALLOWED  4-4-3 (one three only)                C38 WIN  exact five H, V would be 6
  .....X.                                            .....X. ×3 rows above *
  ...X.X.                                            .XXXX*.
  ....XX.                                            .....X. ×2 rows below *
  .OXXX*.
C39 ALLOWED, judgeMove.overline=true   .XXX*XX.  (6목: legal, not a win)
```

## 5. 오픈소스 구현에서 본 함정
- **selfboot/ai_gallery `move.js`:** 5~6칸 고정 패턴으로 판정합니다. 비슷하게 포팅한 `tests/naive.mjs`가 **C06, C12, C41, C22를 금수로 오판**했습니다.
  - 정의상 거리 2의 막힘(O.XXX.O)을 못 봅니다.
  - 장목으로만 펴지는 3을 구분하지 못합니다.
  - 4인 줄을 3으로 셉니다.
  - 재귀가 없습니다.
- **kldp Java 예제:** 착수점 ±5칸 문자열에서 "01110", "010110", "011010"을 부분 문자열로 찾습니다.
  - 패턴이 방금 둔 돌을 포함하는지 확인하지 않아서 C33에서 오판합니다.
  - 막힘과 판 끝 처리가 없습니다.
  - `new String[4]` 때문에 문자열이 "null"로 시작합니다.
- **saroro1/omoklib:** `isDoubleThree`가 장목이면 바로 false를 반환합니다. 렌주에서는 맞지만, 일반룰에 그대로 쓰면 6목+3-3이 통과합니다(C20). 거짓 3 재귀에 깊이 제한도 없습니다.
- **Skywalker144/SkyZeroWeb `ForbiddenPointFinder`** (고전 C++ FPF 포팅):
  - 구조는 맞습니다. 첫 빈칸 탐색, 열린 4 판정, 재귀가 다 있습니다.
  - 다만 흑 전용이고 백은 5개 이상이면 승리라 우리 규칙과 다릅니다.
  - 재귀 깊이 제한이 없습니다.
  - 5×5 근접 돌 수로 거르는 프리필터 아이디어는 참고할 만합니다.
- **needitem/omok-ai:** README에서 "Nested false-three cases use an approximation"이라고 스스로 밝힙니다.
- **공통 함정:**
  - 판 밖을 빈칸처럼 취급하는 것 (판 끝은 막힘이어야 함)
  - 한 줄에서 3을 두 번 세는 것
  - 4인 줄을 3으로도 세는 것
  - 5목 확인을 금수 확인보다 늦게 하는 것
  - 금수를 한 색에만 적용하는 것
  - 임시로 놓은 돌을 되돌리지 않는 것

## 파일 (전부 `/tmp/claude-0/-home-user-skim-ai-os/164b20a1-3bf2-55a7-b177-d7513698c889/scratchpad/omok/` 아래)
- `js/rules.js`: 참조 엔진
- `tests/rules.test.js`: 46개 테스트. `CASES`와 `parse`를 export합니다.
- `tests/fuzz.mjs`: 무차별 대입 구현과 비교하고 시간을 잽니다. `node tests/fuzz.mjs 300` 결과: 300개 보드에서 529,130번 판정, 금수 3,003건, 불일치 0건.
- `tests/naive.mjs`: 단순 패턴 매칭이 틀리는 경우를 보여 줍니다.
- `tests/render.mjs`: 위 ASCII 그림을 만듭니다.

## 출처
- [엠게임 오목 규칙](https://omok.mgame.com/help/rule.htm): 원문을 직접 받아 디코딩하고 그대로 인용
- [오목+ 일반룰과 렌주룰 (블로그)](http://min8839.blogspot.com/2012/09/blog-post_29.html)
- [나무위키 오목/룰의 종류](https://namu.wiki/w/%EC%98%A4%EB%AA%A9/%EB%A3%B0%EC%9D%98%20%EC%A2%85%EB%A5%98), [나무위키 렌주](https://namu.wiki/w/%EB%A0%8C%EC%A3%BC): 직접 접근 403, 검색 결과 요약으로만 확인
- [페미위키 오목](https://femiwiki.com/w/%EC%98%A4%EB%AA%A9): 띈 3 관련 주장이 다른 출처와 충돌
- [RIF 렌주 규칙](https://www.renju.net/rifrules/)
- [한게임 오목 App Store](https://apps.apple.com/kr/app/%ED%95%9C%EA%B2%8C%EC%9E%84-%EC%98%A4%EB%AA%A9-%EB%B0%94%EB%91%91/id1626424869)
- [게임메카: 오목의 달인](https://www.gamemeca.com/view.php?gid=977813)
- [메이플스토리 클래식 오목](https://meowdb.com/msclassic/ko/omok)
- [kldp 오목 예제](https://kldp.org/node/164050)
- [selfboot/ai_gallery](https://github.com/selfboot/ai_gallery), [saroro1/omoklib](https://github.com/saroro1/omoklib), [Skywalker144/SkyZeroWeb](https://github.com/Skywalker144/SkyZeroWeb), [needitem/omok-ai](https://github.com/needitem/omok-ai)