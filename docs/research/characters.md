# 오목 파이터: 8 original fighters and their animations (research brief for the SPEC)

I built the whole rig for one character (비곰, the b-boy bear) and checked it in Playwright **WebKit 26.0** and **Chromium 141**. Frames frozen at 15 timestamps came out the same in both engines. All 8 characters also have static drafts, and they stay distinct at 48px on light and dark backgrounds. The particle module was tested in both engines too. Files are listed in section 9.

---

## 0. Decisions

- **Roster (ids, Korean name, romanization):** `bulttong` 불똥, `nyangja` 냥자, `bigom` 비곰, `beonjjeok` 번쩍, `jaepjaep` 잽잽, `ppibik` 삐빅, `kkakkung` 까꿍, `taenggeul` 탱글.
- **Main colour of each character** (all different hues): red, navy with mint, brown/blue/yellow, golden orange, pink, steel grey with lime, pale lavender, custard yellow.
- **Rendering:** inline SVG with `viewBox="0 0 120 120"`, flat fills, a shared ink outline, no gradients, no filters, no `id`s.
- **Two motion layers:**
  - The HTML wrapper `.rig` moves the whole body. It is composited.
  - SVG `<g>` parts move the limbs. Each part sits inside a "joint" wrapper (the joint sandwich, section 3).
  - Effects live in a sibling `svg.fx` that does not rotate with the body.
  - Particles go on one canvas for the whole screen.
- **States:** `data-state = idle | turn | win | lose`.
  - **win:** a 2.4 s timeline with a peak moment ("HIT") at about 1.3–1.7 s, then a loop of about 1.2 s.
  - **turn:** a 0.6 s one-shot.
  - **lose:** a 1.0 s one-shot, then a loop.
- **Round win vs match win:** a round win plays a short excerpt of the same keyframes, started with a negative `animation-delay` (`--skip`). A match win plays the full 2.4 s, the quote and confetti.
- **2P mirror match:** if both players pick the same character, P2 gets an alt palette through CSS custom properties. Where it fits, the alt palette uses the sport's own colours: boxing red/blue corners for 잽잽, 씨름 청/홍 샅바 for 탱글.
- **Reduced motion:** one source of truth, `html[data-motion]`, set from the OS media query plus an in-app toggle. It shows a static victory pose, no particles, and the jingle still plays.

---

## 1. Style bible (applies to all 8)

| Rule | Value |
|---|---|
| Canvas | `viewBox 0 0 120 120`, ground line y = 111, the character is about 100 units tall, 2-head chibi (head ≈ 45–50% of height) |
| Ink | `--ink:#2A1E2F`. Outer shapes `stroke-width:3`, inner detail 2, feature lines 2.4, round joins and caps |
| Shading | Flat fill plus at most one darker cel shape per mass. No `<linearGradient>`, no `filter`, no `mask`/`clipPath` |
| Eyes | Ink ellipse plus a white highlight up-left. Every character has three faces: `face-a` (default), `face-b` (victory), `face-c` (lose), switched with opacity `step-end` |
| Colour | Every fill goes through a CSS var class (`.fur{fill:var(--fur)}`), so `.alt` swaps the palette |
| 48px test | It must still read by silhouette and main colour at 48px on both light and dark. All 8 pass (see `lineup.png`) |
| Shadow | An HTML div with a radial-gradient background. It is not an SVG filter |
| Fonts in SVG | `system-ui,-apple-system,'Apple SD Gothic Neo'`. Quote bubbles are HTML with `word-break:keep-all` |

---

## 2. Roster overview

| # | Name | Concept | Main colour at 48px | Silhouette hook | Effect family |
|---|---|---|---|---|---|
| 1 | **불똥** Bulttong | Fire baby dragon whose sneezes are fireworks | Red | Wings, gold crest, cream horns, spiked tail | Fire, embers, fireworks, smoke |
| 2 | **냥자** Nyangja | Ninja cat | Navy and mint | Pointed ears, mint headband ribbons and scarf, tall tail | Smoke bomb, shuriken, petals |
| 3 | **비곰** Bigom | B-boy bear | Brown, blue suit, yellow beanie | Beanie with ears poking through, tracksuit, sneakers | Spin lines, sparkles, "얼음!" |
| 4 | **번쩍** Beonjjeok | Dynamo hamster (powered by its wheel) | Golden orange with cyan | Round ball, cyan bolt cowlick, goggles | Lightning, sparks, static afro |
| 5 | **잽잽** Jaepjaep | Boxer bunny | Pink with red gloves | Tall ears (one bent, with a band-aid), two big gloves | Impact stars, POW, bell, sweat |
| 6 | **삐빅** Ppibik | Tin-toy robot | Steel grey with lime LEDs | Helmet head, antenna bulb, accordion arms | Confetti cannon, LED hearts, sparks |
| 7 | **까꿍** Kkakkung | Prankster ghost with a 청사초롱 lantern | Pale lavender | Bell shape with scalloped hem, spirit-flame cowlick, lantern on a stick | Ghost-fire wisps, fade-pop |
| 8 | **탱글** Taenggeul | Caramel pudding 씨름 wrestler | Custard yellow and caramel | Flan trapezoid, cherry, blue 샅바 | Jelly drops, shock ring, gold confetti |

**Name checks:** quick web searches for 불똥, 냥자, 비곰, 번쩍, 삐빅, 까꿍 and 탱글 (and 깡토, an earlier draft name for the bunny) found no existing character. This is not trademark clearance. **잽잽 has not been searched.**

We also stay clear of Korean Pokémon names: 파이리, 푸린 (Jigglypuff), 찌리리공 (Voltorb), 파치리스.

**Respectful nod to the owner:** 비곰 references b-boy culture only: a beanie for headspins, a freeze to finish, "리스펙트". It never uses his name, likeness or crew marks.

---

## 3. Shared rig, verified in WebKit and Chromium

### HTML structure

```html
<div class="stage" data-char="bigom" data-state="idle" style="--size:220px">
  <div class="shadow"></div><div class="flash"></div>
  <div class="rig"><svg class="ch ch-bigom" viewBox="0 0 120 120">…parts…</svg></div>   <!-- composited whole-body -->
  <svg class="fx" viewBox="0 0 120 120">…effects that must NOT spin with the body…</svg>
</div>
```

### Joint sandwich (the core pattern)

```html
<g transform="translate(44 77)"><g class="p armL"><g transform="translate(-44 -77)">
   …art drawn in ABSOLUTE viewBox coords…
</g></g></g>
```

```css
.ch .p { transform-box: view-box; transform-origin: 0 0; }
```

- The local `0,0` of the animated `<g>` is the joint, so `rotate()` pivots at the shoulder, hip or neck. Nothing depends on the bounding box.
- The artist still draws in absolute coordinates.
- **Never** put a CSS animation on an element that has a `transform=""` attribute. The CSS property overrides the attribute and the part jumps to 0,0.

### Self-centred bits

Use `transform-box: fill-box; transform-origin: 50% 50%` only for things that pivot on their own centre: eye blinks and sparkles.

### Sign convention

A positive `rotate()` swings a hanging limb toward screen-left. For outward motion, left limbs use + and right limbs use −.

### Restarting and excerpts

- **Restart the same state:** `stage.dataset.state='idle'; void stage.offsetWidth; stage.dataset.state='win'`.
- **Round-win excerpt:** set `--skip` per character, around HIT − 0.3 s, and apply `animation-delay: var(--skip)` to every win animation.

### Director (keeps cues in sync)

- Each animation frame, read `currentTime` of the `.rig` animation whose `animationName` ends in `-win`.
- When a cue time is crossed, fire it: `burst`, `sfx`, `shake`.
- Schedule the jingle once on the `AudioContext` clock, offset to land on HIT. This stays in sync even at 30 fps in Low Power Mode, and with skips.
- Tapping the overlay after 0.8 s jumps to 2.4 s: `getAnimations({subtree:true}).forEach(a => a.currentTime = 2400)`.

### Character data shape (`js/characters.js`)

```js
{ id:'bigom', ko:'비곰', en:'Bigom', tagline:'판 위의 비보이',
  palette:{fur:'#8B5A3C',…}, alt:{…}, pivotWin:'50% 52.5%', skip:-1.45,
  quote:{win:'리스펙트! 근데 판은 내 거.', en:'Respect! But this floor is mine.', lose:'GG. 다음 배틀에서 보자.'},
  anchors:{head:[60,108], center:[60,63]},
  cues:[{t:.38,sfx:'WHOOSH'},{t:1.50,sfx:'SCRATCH'},{t:1.56,jingle:true,fx:'sparkle',at:'head',shake:120},{t:2.33,fx:'dust',at:[60,112]}],
  jingle:{…}, svg:`…` }
```

### Idle policy (battery)

- The infinite loop runs on the HTML `.rig` only, so it is composited.
- SVG-part "fidgets" are one-shots of 0.8 s or less. JS adds a `.fidget` class at random every 5–9 s.
- No infinite SVG-part animations in the game HUD.

---

## 4. The 8 characters

Notation:
- **rig** = the HTML wrapper; % values are relative to the stage.
- Part rotations are in degrees; part translations are in viewBox user units (px).
- Each timeline row gives the time span, then the body (`.rig`), the SVG parts, and the effects or sounds.

Coordinates come from the drafts in `lineup.html` and `bigom.html`.

### 4.1 불똥 Bulttong: fire baby dragon

- **Concept:** a baby dragon that can't control its fire; when it gets excited it sneezes fireworks.
- **Personality:** hot-headed, competitive, a big show-off with a soft heart.
- **Palette P1:**
  - body `#F0483E`, belly and horns `#FFE0A3`
  - wing `#B8262E`, wing rib `#7E1820`
  - crest and tail spikes `#FFC24A`, cheek `#FF9F7A`, mouth `#7A2335`
- **Palette alt:** body `#3BB273`, wing `#1E7A4C`, crest `#FFC24A`.
- **Silhouette:** round egg body, small bat wings at the shoulders, a three-point gold crest, cream rounded horns, and a tapered tail with two spikes.
  - Avoid reading as Charmander: no flame on the tail tip.
  - Avoid reading as a devil: no arrow or heart tail tip, no dark pointed horns.
- **SVG plan:**

| Part | Joint | Shape |
|---|---|---|
| `tail` | (76,96) | Behind everything |
| `wingL`, `wingR` | (46,78), (74,78) | Behind the body |
| `legL`, `legR` | hips (49,100), (71,100) | Feet: ellipses at (49,105) and (71,105), 8×5.5 |
| `body` | – | Ellipse (60,88) 22×17, belly ellipse, two plate lines |
| `armL`, `armR` | (41,82), (79,82) | – |
| `head` | (60,72) | Ellipse (60,48) 28×25; horns and crest go inside the head group |
| `snout` | – | Cream ellipse (60,64) 12×6.5 |

  Anchors: mouth (60,65), nostrils (56.5,56) and (63.5,56), sky (60,−15).
- **Idle:** breathe. Fidget: a nostril smoke puff, or wings flutter ±10° twice.
- **My turn:** hop −6%, wings flap twice, a tiny orange flame flicks from the nostrils (fx path, opacity 0.25 s).
- **Victory — "에취! 불꽃놀이"** (rig pivot 50% 75%, `--skip:-1.15s`):

| Time (s) | Body (rig) | Parts | Effects / sound |
|---|---|---|---|
| 0–0.30 | Hop to −10% at 0.15; land squash (1.08, .92) | Wings flap ±25° three times | – |
| 0.30–0.70 | Inhale: scale (1.10, 1.08), rotate −4° | Head −12° (looks up) | Smoke puffs at the nostrils at 0.40 |
| 0.70–0.85 | Tremble: translateX ±1% three times | Head ±3°; face changes to squeezed "> <" | Two sniffs (noise, 30 ms) |
| 0.85 | ACHOO recoil: +3%, scale (1.12, .88) | Head +10°; open mouth | Fireball (HTML div, radial-gradient) travels from the mouth to (60,−15) by 1.40, scaling .6→1.2; WHOOSH |
| 1.45 **HIT** | Hop −4% | Arms up ±140°; wings spread ±35° | `firework` burst at the sky anchor plus 12 sparkles; orange flash at 10%; jingle |
| 1.45–2.00 | Sway ±2° | Tail wags ±15° twice | Second small firework at (30,0) at 1.70 |
| 2.00–2.40 | Settle | Arms akimbo (armL +25°, armR −25°); smug `face-b` | Nostril smoke "흥" at 2.10 |

- **Loop (1.2 s):** tail ±12°, wings ±6°, one nostril puff per iteration (on `animationiteration`).
- **Lose:** tries to breathe fire and only sputters three grey puffs (cough sound); wings fold inward 20°; swirl eyes; body shrinks to 0.94. Loop: a cough puff and dizzy stars.
- **Quote:** "에취! 불붙었다, 다 덤벼!" / "Achoo! I'm fired up — bring it!"
  - Lose line: "콜록… 불씨가 꺼졌어…"
- **Jingle** (at 1.45): sawtooth through a 2.4 kHz lowpass, gain .06: `G4:80 C5:80 E5:80 G5~:420` (3 sixteenths then a held note with vibrato). WHOOSH at 0.85.

### 4.2 냥자 Nyangja: ninja cat

- **Concept:** a shadow cat; you blink and it's already standing behind you.
- **Personality:** cool, short on words, a little smug; slips into "~냥" when happy.
- **Palette P1:**
  - fur `#2D2B52`, light `#F1EEFF`
  - scarf and band `#5EE39B`, shade `#3CC47D`
  - eye `#FFE45E` with a slit pupil, inner ear `#FF9FB8`
- **Palette alt:** fur `#F1EEFF` (white cat), muzzle `#FFFFFF`, scarf `#FF5C8A`, eye `#5AC8FF`.
- **Silhouette:** triangle ears, a mint headband with ribbon tails trailing right, a scarf tail trailing left, white socks, and a tall tail.
  - The tail is a "double-stroke tube": an ink stroke 10.5 wide with a fur stroke 5 wide on top, so it is cheap and can bend.
  - Avoid Naruto: no orange, no leaf or swirl emblem.
  - Avoid Microsoft Ninjacat: no full black mask.
- **SVG plan:**

| Part | Joint | Shape |
|---|---|---|
| `tail` | (74,98) | Behind |
| `scarfTail` | (46,74) | – |
| `legL`, `legR` | (51,100), (69,100) | – |
| `body` | – | – |
| `armL`, `armR` | (45,77), (75,77) | – |
| `head` | (60,72) | Ellipse (60,48) 29×24; ears inside the head group |
| `ribbon` | (88,34) | Inside the head group |

  Anchors: paw (78,92), eye glint (72,50), feet (60,104).
- **Idle:** breathe. Fidget: tail swish ±12°, or one ear twitches.
- **My turn:** ears perk (scaleY 1.08) and a shuriken twirls in the paw (fx star, rotate 360°).
- **Victory — "연막 → 등장 → 인(印) 포즈"** (pivot 50% 80%, `--skip:-0.95s`):

| Time (s) | Body (rig) | Parts | Effects / sound |
|---|---|---|---|
| 0–0.25 | Crouch (1.1, .85) | Ears flatten (head scaleY .96); tail −20° | – |
| 0.25–0.40 | Opacity 1→0, scale .9 | – | Smoke cloud (HTML div, scale 0→1.3) plus `smoke` burst; POP + SWISH |
| 0.45–0.95 | Hidden | – | Two shuriken fly across the stage (x −70 to 190, rotate 1080°) at 0.50 and 0.72; SWISH each |
| 0.95–1.15 | Drops in: Y −70% → 0, opacity → 1; land squash at 1.15 | Ribbons +25° | Dust at the feet |
| 1.15–1.60 | Rotate −6° | armR −150° (paw at the chin: hand sign); armL +40°; tail +15° | – |
| 1.60 **HIT** | Snap to scale 1.04 | `face-b` with an eye glint | Star pop at the eye; `petals` burst from (110,20); TING + jingle |
| 1.60–2.40 | Hold | Ribbons flutter ±10°, fading | Petals drift |

- **Loop:** ribbons ±8°, tail ±10°.
- **Lose:** the smoke bomb fizzles, it sneezes, ears go flat, the scarf droops +30°, "> <" eyes, dizzy stars.
- **Quote:** "그림자처럼, 다섯 수면 끝이다냥." / "Like a shadow — five moves and it's over, meow."
  - Lose line: "…수련이 부족했다냥."
- **Jingle:** triangle, gain .09: `A5:70 E5:70 D6:70 -:70 A6:320`, plus TING (sine A7, 60 ms) at the glint.

### 4.3 비곰 Bigom: b-boy bear (fully implemented, see section 8)

- **Concept:** the crew's bear: chill, and always on beat.
- **Personality:** laid-back, respectful, but on the floor he's a killer; he nods to the beat when he's happy.
- **Palette P1:**
  - fur `#8B5A3C`, muzzle `#F3D9B1`, inner ear `#E9B48A`
  - suit `#2F6BFF`, suit shade `#2350C8`
  - beanie `#FFC83D`, beanie band `#F5A524`
  - shoes `#FFF` with sole `#FF4D4D`, cheek `#FF8FA3`
- **Palette alt:** fur `#5E3B28`, suit `#FF4F8B`, beanie `#3FD9A8`.
- **Silhouette:** a beanie with the ears poking through holes, a tracksuit with a zip and chevrons, chunky sneakers.
  - Never 3 stripes (that is the adidas trademark) and no shoe logos.
- **SVG plan:**

| Part | Joint |
|---|---|
| `legL`, `legR` | hips (51,92), (69,92) |
| `body` | static |
| `armL`, `armR` | (44,77), (76,77); armR drawn last so crossed arms overlap correctly |
| `head` | neck (60,70) |
| `beanie` (holds the ears) | (60,40) |
| `face-a`, `face-b`, `face-c` | – |

  Effects: `fx-spin`, `fx-burst`, `fx-sticker` ("얼음!", the Korean playground word for "freeze"), `fx-dizzy`.
- **Idle:** breathe. Fidget: a blink plus two head nods.
- **My turn:** a toprock step (implemented).
- **Victory — toprock → windmill → headspin → freeze → kip-up** (implemented; pivot 50% 52.5%, which puts the beanie top exactly on the ground when the bear is upside down; `--skip:-1.45s`):

| Time (s) | What happens |
|---|---|
| 0–0.38 | Toprock: two steps, arm swings, head bobs; drop to a squash at 0.38 (WHOOSH) |
| 0.38–0.91 | Windmill: in-plane rotate 0→540° (1.5 turns, ending upside down), body low on the floor, legs in a V ±52°, arms out ±105° |
| 0.91–1.56 | Headspin: rotateY 0→1080°, accelerating; spin lines visible; arms out ±85° |
| 1.56 **HIT** | Locks into the freeze: tilt to 560°/555°, squash, arms crossed ±55°, legs at 72° and −128°, wink-grin `face-b`, flash + burst + "얼음!" sticker; `sparkle` burst at the head; jingle starts; SCRATCH at 1.50 |
| 1.56–2.00 | Hold the freeze |
| 2.00–2.40 | Kip-up arc to 720°; landing squash at 2.33 (`dust` burst); arms end crossed |

- **Loop:** 1.26 s, which is 2 beats at 95 BPM. The body bounces on the beat and the head nods ±4°. Arms stay crossed (held by `fill-mode`).
- **Lose:** the beanie slips over the eyes (+11 user units, −8°), X eyes, slump and sway, dizzy stars.
- **Quote:** "리스펙트! 근데 판은 내 거." / "Respect! But this floor is mine."
  - Lose line: "GG. 다음 배틀에서 보자."
- **Jingle** (at 1.56), boom-bap: drums `K:158 -:158 S:158 -:79 K:79 K:158 S:316` plus bass on square, gain .07: `C3:316 Eb3:158 F3:158 G3:316`. SCRATCH (180 ms) at 1.50.

### 4.4 번쩍 Beonjjeok: dynamo hamster

- **Concept:** charges itself by running in its wheel, then goes ZAP.
- **Personality:** hyperactive, talks fast, eats when nervous.
- **Palette P1:**
  - fur `#F2A54A`, cream `#FFF1DC`, paws and feet `#FFB3C1`
  - bolt `#3CE0FF`, goggle strap `#5B3FD9`, lens `#A6F4FF`
  - nose `#FF7FA0`, seed `#4A3B2C`
- **Palette alt:** fur `#B9B2C8`, bolt `#B6FF4D`, strap `#FF6B3D`.
- **Silhouette:** almost a perfect ball, a cyan lightning-bolt cowlick, goggles pushed up on the forehead, buck teeth, holding a sunflower seed.
  - **Pikaclone trap** (Bulbapedia counts 13 electric-rodent Pokémon): no yellow body, no red cheek circles, no black ear tips, no bolt-shaped tail. Also unlike Pachirisu (white and blue) and Morpeko (yellow and black).
- **SVG plan:**

| Part | Joint | Shape |
|---|---|---|
| `body` (head and body in one) | – | Ellipse (60,70) 35×34 with a cream face/belly path |
| ears | – | (33,43), (87,43), r 8.5 |
| `cowlick` | (60,40) | – |
| goggles | – | Double-stroke strap `M27 55Q60 39 93 55`; lenses (47,49), (73,49), r 7 |
| `legL`, `legR` | (47,102), (73,102) | – |
| `pawL`, `pawR` | (52,82), (68,82) | – |
| `frizz` (static afro) | – | Hidden scalloped circle r 44 behind the ball |

  Effects: `wheel` (ring r 46 with 6 spokes, behind the rig), `bolt` (polyline from (60,−40) to (60,30)).
- **Idle:** fast breathe (1.6 s). Fidget: nose twitch (nose scaleX), or nibbles the seed (paws ±3 px, three times).
- **My turn:** cowlick flickers (opacity steps) plus 3 small sparks; paws rub.
- **Victory — "쳇바퀴 → 낙뢰 → 정전기 아프로"** (pivot 50% 70%, `--skip:-1.15s`):

| Time (s) | Body (rig) | Parts | Effects / sound |
|---|---|---|---|
| 0–0.20 | – | Paws rub ±15°, four times | – |
| 0.20–0.35 | – | – | Wheel scales 0→1 with overshoot; POP |
| 0.35–1.15 | Bob Y ±2% at 10 Hz | Legs run ±35°, alternating; cowlick flickers | Wheel spokes rotate 0→1440°, accelerating; spark mini-bursts at 0.6, 0.8, 1.0; rising whirr (square, 80→200 Hz) |
| 1.15 | Jump to −22% | Legs tuck | Wheel scales to 0 |
| 1.30 | Hang at the top | Wide eyes | Lightning bolt flickers on/off/on until 1.50; cyan flash; ZAP |
| 1.50 **HIT** | Land squash (1.15, .85) | Frizz scales 0→1.1→1 | `bolts` (20) + `sparkle` (12); jingle |
| 1.50–2.40 | Bounce | Flexes: arms ±150°, bicep pump twice | Crackles at 1.8 and 2.1 |

- **Loop:** frizz jitter ±0.6 px using `steps(2)`, plus one spark per iteration.
- **Lose:** the cowlick turns grey and droops; a red one-bar battery icon pops up; it rolls onto its back (−100°) with its feet paddling; dizzy stars.
- **Quote:** "찌릿찌릿! 100% 충전 완료!" / "Bzzt! 100% charged!"
  - Lose line: "배터리… 방전…"
- **Jingle:** square, gain .06: `C6:45 E6:45 G6:45 C7~:260`. ZAP at 1.30.

### 4.5 잽잽 Jaepjaep: boxer bunny

- **Concept:** a small but gritty rabbit boxer who never stays down.
- **Personality:** an energetic underdog who cheers itself on mid-fight.
- **Palette P1:**
  - fur `#FFC9DA`, inner ear `#FF7FA8`
  - gloves `#E8283C`, trunks `#2D5BFF`, waistband and cuffs `#FFF`
  - band-aid `#F2CB8F`
- **Palette alt:** white fur `#FFFFFF`, gloves and trunks swapped: blue gloves, red trunks (the other boxing corner).
- **Silhouette:** two tall ears (the right one bent 32° with a band-aid) and two large gloves held in guard at the cheeks.
  - Not Muzi, Cony, My Melody or Bugs Bunny.
- **SVG plan:**

| Part | Joint | Shape |
|---|---|---|
| `earL`, `earR` | (50,32), (70,32) | Behind the head |
| `legL`, `legR` | (49,102), (71,102) | – |
| `body` + trunks | – | – |
| `head` | (60,74) | Ellipse (60,52) 25×23 |
| `armL`, `armR` | shoulders (48,78), (72,78) | Each holds a nested `gloveL`/`gloveR` group with its joint at the glove centre (40,64) / (80,64), r 10.5 |

  A jab in a front view is the glove scaling up to 1.45 and moving 8 px toward the centre (toward the camera).
- **Idle:** a constant toe bounce (−2%, 0.8 s, composited). Fidget: the gloves tap together.
- **My turn:** a one-two shadow jab.
- **Victory — "원투 → 어퍼컷 → 땡땡땡 → 챔피언"** (pivot 50% 90%, `--skip:-1.05s`):

| Time (s) | Body (rig) | Parts | Effects / sound |
|---|---|---|---|
| 0–0.30 | Toe bounce twice | Guard | – |
| 0.30–0.45 | Lean +3° | JAB with the left glove | Impact star at (52,58); PUNCH |
| 0.45–0.60 | Lean −3° | CROSS with the right glove | Impact star at (68,58) |
| 0.60–0.80 | – | Quick jab-jab (scale 1.3) | Two small impacts |
| 0.80–1.10 | Wind-up crouch (1.1, .85), +6° | armR +30° | – |
| 1.10–1.35 | UPPERCUT leap to −28%, −8° | armR −170° (straight up); ears trail | Comic POW burst with "KO!" at (60,8); BELL ×3 from 1.20 |
| 1.35–1.70 | Land squash | Bent ear springs ±20°, damped | `sweat` and `dust` bursts |
| 1.70 **HIT** | Hop | Both gloves up in a V (±150°); grin with buck tooth | Red/blue/gold `confetti`; jingle |

- **Loop:** gloves pump alternately (±10°) with a toe bounce.
- **Lose:** falls backward (−80° from a feet pivot), gloves flop, a white towel (fx) drops onto the belly at 0.8 s, X eyes.
- **Quote:** "원, 투, 오목! 케이오!" / "One, two, OMOK! K.O.!"
  - Lose line: "아직 안 끝났어! 다음 라운드!"
- **Jingle:** three BELL strikes 160 ms apart at 1.20. At 1.70, square gain .07: `C5:100 -:20 C5:100 G5~:380`.

### 4.6 삐빅 Ppibik: tin-toy robot

- **Concept:** a logical robot whose circuits short out when it feels happy.
- **Personality:** polite and precise, but very emotional, so it keeps hitting "errors".
- **Palette P1:**
  - body `#A9B8CC`, shade `#7F8EA6`, light `#D8E1EC`
  - visor `#1F2A44`, LED `#B6FF4D`
  - antenna bulb `#FF4FA3`, bolts and dial `#FF8A3D`
- **Palette alt:** a gold robot: body `#F2C14E`, shade `#C9962B`, LED `#3CE0FF`.
- **Silhouette:** a rounded helmet head with a dark visor and LED pill eyes, an antenna with a bulb, accordion arms ending in pincer claws, foot blocks.
  - **Avoid BMO:** no teal console body with a screen face and buttons. Also not Wall-E, Baymax, Astro Boy, Doraemon, R2-D2 or BB-8.
- **SVG plan:**

| Part | Joint | Shape |
|---|---|---|
| `legL`, `legR` | (51,96), (68,96) | – |
| `body` | – | Rect 40,70 40×29 rx 9, with a chest panel, dial (54,83.5) and LEDs |
| `armL`, `armR` | (37,76), (83,76) | – |
| `head` | (60,70) | Rect 29,23 62×47 rx 16; visor 36.5,33 47×27 |
| `antenna` | (60,24) | Bulb (60,9.5) r 5 |
| `eyes-led`, `eyes-heart`, `eyes-x` | – | Three LED faces |
| `spring` | (60,70) | fx zigzag |

  Anchors: antenna tip (60,4), ear bolts (28,47) and (92,47).
- **Idle:** no breathing (robots don't breathe); a hover hum instead, ±0.5% over 2 s. Fidget: the antenna blinks; the LED eyes glance left and right using `steps()`.
- **My turn:** the LED eyes scan ±3 px with `steps(3)`; a "삐빅" blip sound.
- **Victory — "팝핀 → 머리 스프링 → 하트 LED 축포"** (pivot 50% 85%, `--skip:-1.15s`):

| Time (s) | Body (rig) | Parts | Effects / sound |
|---|---|---|---|
| 0–0.20 | – | LEDs blink twice (steps) | "삐빅" blips |
| 0.20–1.00 | Hits: scale 1.03 pops on beats .25/.45/.65/.85, using `steps(1)` | Popping arm wave (arms ±90° hits); head ticks ±15° on the beat; every part uses `steps()` | Tick sound per hit (square 2 kHz, 20 ms) |
| 1.00–1.20 | – | Head spins 360° in-plane ("malfunction") | `bolts` (6) at the ear bolts |
| 1.20–1.40 | – | Head launches −22 px; spring scaleY 0→1 | BOING |
| 1.40 **HIT** | – | Eyes become hearts; bulb flashes | `confetti` (60) plus `hearts` (10) from the antenna tip, aimed upward; jingle |
| 1.40–2.00 | – | Head bobbles on the spring: −22→−14→−19→−16, ±8°, damped | – |
| 2.00–2.40 | Clunk squash at 2.10 | Spring retracts; armR thumbs-up (−130°) | CLUNK |

- **Loop:** chest LEDs cycle in sequence; heart eyes pulse between scale 1 and 1.12.
- **Lose:** the visor shows ✕✕ and glitches (±1 px, `steps`); smoke from the ear bolts; the antenna droops 60°; the body sinks to scaleY .92.
- **Quote:** "삐빅! 기쁨 수치 측정 불가!" / "Beep-boop! Joy level: off the charts!"
  - Lose line: "삐…빅… 오류 발생."
- **Jingle:** at 0 s, the name call `E6:60 -:40 G6:70`. At 1.40, a 25% pulse wave (PeriodicWave), gain .06: `C5:70 G5:70 C6:70 E6:70 G6~:260`.

### 4.7 까꿍 Kkakkung: lantern ghost

- **Concept:** a little ghost that wanders at night with a 청사초롱 lantern and loves pranks.
- **Personality:** playful, giggly, impossible to stay angry at.
- **Palette P1:**
  - body `#F1ECFF`, shade `#CDBFF7`, cheek `#FFB3C8`, mouth `#5A3A7A`
  - spirit flame `#9EE8FF`
  - lantern `#2F5BD3` (top) and `#E5394F` (bottom), frame `#3A2A1E`, glow `#FFE9A3`
- **Palette alt:** a mint ghost: body `#DDF7EA`, shade `#A8E3C8`, flame `#FFB3C8`.
- **Silhouette:** a bell shape with a scalloped hem, floating with a gap above its small shadow; a spirit-flame cowlick; the lantern on a stick held out to the right.
  - Avoid Boo (shy, covers its face, tongue out), Casper, Gengar (purple, spiky, big grin) and Pac-Man ghosts.
- **SVG plan:**
  - Split the body into `bodyTop` and `hem` (joint (60,88)) so the hem can wiggle with `skewX`. **No path morphing:** the CSS `d` property is still not shipped in stable Safari.
  - `armL`, `armR`: joints (34,64), (86,64). The lantern lives inside armR (stick from (88,64) to (101,48), lantern centre (101,68)).
  - The glow is an HTML div behind the lantern.
  - `wisp` joint: (60,18).
- **Idle:** float ±3% over 2.4 s (composited). Fidget: the lantern sways ±10°.
- **My turn:** blinks out and back (opacity 1→.2→1) with a peek (scale 1.1).
- **Victory — "사라졌다… 까꿍!"** (pivot 50% 60%, `--skip:-0.95s`):

| Time (s) | Body (rig) | Parts | Effects / sound |
|---|---|---|---|
| 0–0.30 | Giggle wobble ±6° twice | Lantern swings | Giggle chirps |
| 0.30–0.70 | Fade: opacity →0, scale .85, −4% | – | `wisps` (14) rising |
| 0.70–1.10 | Hidden | – | The glow div flickers and dims (suspense) |
| 1.10 | POP: opacity 1, scale .6→1.35, −8% (close to the camera) | Arms ±120°; `face-b` (^^ eyes, big open mouth) | "까꿍!" sticker; POP; screen shake 100 ms |
| 1.30 **HIT** | – | – | Ring of ghost-fire `wisps` plus 12 sparkles; jingle |
| 1.30–1.90 | Settle 1.35→.95→1.03→1 | – | – |
| 1.90–2.40 | Twirl 360° | armR lifts the lantern high (−150°) | Glow pulses |

- **Loop:** float, hem skewX ±4°, glow pulse.
- **Lose:** goes pale (opacity .5) and melts into a puddle (scale 1.3, .4 from the bottom); the lantern goes out (glow 0); a tear drop.
- **Quote:** "까꿍~ 놀랐지? 내가 이겼지롱!" / "Peekaboo~ Surprised? I win!"
  - Lose line: "히잉… 들켰다…"
- **Jingle:** sine with vibrato (6 Hz, ±15 cents), gain .10: `A4>C5:180 Eb5:160 -:50 A5~:420`. POP (sine 900→300 Hz in 50 ms) at 1.10.

### 4.8 탱글 Taenggeul: caramel pudding 씨름 wrestler

- **Concept:** a pudding that wobbles but never topples; dreams of becoming 천하장사.
- **Personality:** cheerful, steady, and very strong; never gets flustered.
- **Palette P1:**
  - custard `#FFD45E`, shade `#F0B53A`
  - caramel `#9C4A1A`, caramel highlight `#C9773A`
  - cherry `#E8304B`, leaf `#5CC15F`
  - 샅바 `#2D6BFF`, knot `#5B8CFF`, cheek `#FF9F7A`
- **Palette alt:** an ube pudding: custard `#C99BFF`, shade `#A774E8`, and a **red 샅바** `#E8304B` (씨름's 청/홍 belts).
- **Silhouette:** a flan trapezoid with a dripping caramel cap, a cherry on a stem, a 샅바 band with a front knot, stubby arms and legs.
  - Not Pompompurin, Jigglypuff, the Dragon Quest slime or Gudetama.
- **SVG plan:**
  - `body` is the whole trapezoid, and the face sits on it (there is no separate head).
  - `cherry`: joint at the stem base (60,23).
  - `armL`, `armR`: (33,68), (87,68). `legL`, `legR`: (46,102), (74,102).
  - Most squash, stretch and skew happens on the rig (composited).
- **Idle:** jelly wobble, skewX ±1.5° over 2 s (composited). Fidget: the cherry wobbles.
- **My turn:** a 씨름 ready stomp (squash) with a dust puff.
- **Victory — "뒤집기 → 철퍼덕 → 탱글탱글 → 천하장사"** (pivot 50% 70%, `--skip:-0.95s`):

| Time (s) | Body (rig) | Parts | Effects / sound |
|---|---|---|---|
| 0–0.30 | Stance (1.12, .88) | Arms reach forward to grip ±40° | Stomp dust |
| 0.30–0.60 | Heave: −15°, skewX ±6° | Cherry lags +15° | "hup" (sine, 120 Hz) |
| 0.60–1.00 | 뒤집기 backflip: 0→−360°, arc −35% at 0.80 | Arms tucked | `jelly` caramel flings at 0.80 |
| 1.00 | SPLAT (1.4, .6) | Cherry squashes | Shock ring at (60,110); BOING |
| 1.00–1.60 | Jelly rebound: (.85,1.2) @1.12 → (1.1,.92) @1.25 → (.96,1.05) @1.38 → (1.02,.98) @1.50 → 1 | Cherry ±20°, damped | – |
| 1.60 **HIT** | Hop | Arms up ±150°; `face-b` | "천하장사!" sticker plus gold/blue confetti; jingle |

- **Loop:** skewX ±3° with scale 1.02/.98; cherry wobble.
- **Lose:** melts (scaleY .55 from the bottom, scaleX 1.25); the cherry rolls off (+30 px, 360°, falls); the caramel drips lengthen.
- **Quote:** "흔들려도 안 넘어가! 천하장사 탱글!" / "I wobble, but I never go down!"
  - Lose line: "조금… 녹았어…"
- **Jingle:** sine "boing" notes; `^` means each note starts a fourth below and glides up in 40 ms. Gain .10: `C5^:110 E5^:110 G5^:110 C6~:380`.

---

## 5. iOS Safari guidance for animating inline SVG

1. **Split the work by engine path.**
   - Whole-body moves (translate, rotate, rotateY, scale, skew, opacity) go on the HTML `.rig` div. That path is composited.
   - SVG child transforms are **repainted in software** in WebKit's legacy SVG engine. The layer-based engine (LBSE) had landed in WebKit but **was still not on by default as of July 2026**, according to Igalia.
   - So keep the SVG at its final display size (≤ 240 CSS px), with 12 or fewer animated parts. With one stage animating at a time, the repaint cost is small.
2. **Joint sandwich + `transform-box: view-box; transform-origin: 0 0`** for limbs, and fill-box only for self-centred bits. **Always set `transform-box` explicitly:** WebKit had a long-running initial-value mismatch (bugs 180392, 211755/211927), and zoom used to break fill-box origins (194903).
3. **Same transform function list in every keyframe**, for example `translate() rotate() rotateY() scale()`. Rotations then interpolate per function, so 540° and 1080° really spin. If the lists differ, the browser falls back to matrix interpolation and multi-turn spins collapse.
   - Use the `transform` shorthand, not the individual `rotate:`/`translate:`/`scale:` properties. Safari 26.5 only just fixed a regression with implicit values for those properties, and friends may be on older iOS versions.
   - Inside SVG, use px (user units). Percentages are fine only on the HTML wrapper.
4. **Do not use the `linear()` easing function.** WebKit says it cannot accelerate animations that use it, and they drop to a low frame rate in Low Power Mode (bug 281429). The `linear` keyword, `cubic-bezier()` and `steps()` are fine. Use per-keyframe `animation-timing-function` for anticipation and overshoot.
5. **Effects to avoid on anything that animates:**
   - No SVG filters (`feGaussianBlur`, `feDropShadow`) and no CSS `filter: blur()/drop-shadow()`.
   - No `mask` or `clip-path`, no `mix-blend-mode`.
   - Fake glows and shadows with static radial-gradient backgrounds on HTML divs, and animate only their `opacity` and `transform`.
   - No `<linearGradient>` either. It also avoids duplicate-ID breakage when both players show the same character.
6. **`will-change: transform, opacity`** only on HTML layers (`.rig`, `.flash`, `.shadow`) and only during win or lose. Never on SVG children: it does nothing in the legacy engine and would create layers under LBSE. Keep it to about 10 promoted layers in total.
7. **Low Power Mode caps `requestAnimationFrame` at 30 fps** (WebKit bug 215745, by design). CSS keyframes stay time-correct regardless. Particles must be time-based with a clamped `dt`. The director syncs from `animation.currentTime`, not by counting frames.
8. **No CSS `d` path morphing.** It is still not shipped in stable Safari. Use `skewX`/`scale` on a split-out group, or crossfade between alternate shapes.
9. **Don't scale up a small rendering.** Render the victory stage at its real CSS size; don't upscale a 48px HUD avatar with `scale()`. A composited layer scaled past about 1.1× can rasterize soft (moderate confidence).
10. **Reduced motion:**
    - JS sets `html[data-motion]` to `reduce` when the in-app setting is "줄이기", or when it is "자동" and `matchMedia('(prefers-reduced-motion: reduce)')` matches. It listens for `change`.
    - CSS keys only off `[data-motion="reduce"]`: `animation:none !important` on the stage subtree, the final pose set as static transforms, `face-b` shown, a 0.4 s opacity fade for the sticker or quote. `burst()` does nothing, and there is no flash or shake. The jingle still plays.
    - Verified render: `bigom.html?rm`.
11. Set `pointer-events:none` on the stage, the fx layer and the canvas.
12. **No haptics on victory.** iOS only gives haptics for trusted taps through the switch-input trick, as pumal's `haptics.js` documents. Only the "다음 판" button tap can tick.

---

## 6. Particle burst layer (tested in WebKit 26.0 and Chromium 141)

The file is `particles.js`, about 120 lines. Key decisions:

- **One canvas**, created lazily, `position:fixed`, `aria-hidden`.
- **DPR capped at 2.** An iPhone is DPR 3; capping at 2 means about 2.25× fewer pixels. A 430×932 screen at 2× is 1.6 megapixels, far under iOS's 4096×4096 (16.7 megapixel) area cap.
- **`release()` on overlay close** sets `width=height=0` to give the backing store back, because of iOS's canvas memory budget.
- **Sprite cache.** Each `(kind, colour)` is drawn once into a 64×64 canvas. Per frame there is only `setTransform` plus `drawImage`. No `shadowBlur`, no path building per frame. The composite mode `'lighter'` is used only for fire and lightning.
- **Pool of at most 180**, with swap-remove. `dt` is clamped to 1/30 s. The rAF loop runs only while particles are alive. Everything clears on `visibilitychange`.
- **Anchors** are mapped from the **untransformed `.stage` rect**: `anchor(stage, vx, vy)`. Never use the rotating SVG's own rect, and don't trust `getScreenCTM()` with CSS transforms on ancestors.

```js
// Angles in degrees, y-down (270 = up). Spread into burst({ x, y, ...FX.sparkle }).
export const FX = {
  sparkle:  { kind:'star', colors:['#FFD84D','#FFFFFF'], n:24, speed:[120,260], gravity:300, life:[.6,1.1], size:[10,18] },
  firework: { kind:'glow', colors:['#FFB020','#FF5A36','#FFE97A'], n:40, speed:[140,300], gravity:160, drag:1.8, life:[.7,1.2], size:[12,22], blend:'lighter' },
  smoke:    { kind:'glow', colors:['#D9D3E2','#B9B0C6'], n:10, speed:[20,70], angle:[200,340], gravity:-60, life:[.6,1], size:[26,40], shrink:false },
  petals:   { kind:'drop', colors:['#FFB7CF','#FFD6E4'], n:18, speed:[60,140], angle:[150,210], gravity:40, drag:.6, life:[1.2,1.8], size:[8,12], spin:[-3,3] },
  bolts:    { kind:'bolt', colors:['#3CE0FF','#FFFFFF'], n:16, speed:[160,280], gravity:0, life:[.25,.5], size:[18,28], blend:'lighter' },
  confetti: { kind:'confetti', colors:['#FF4FA3','#B6FF4D','#3CE0FF','#FFD84D'], n:60, speed:[220,380], angle:[220,320], gravity:520, drag:1.2, life:[1,1.6], size:[8,12], spin:[-10,10], shrink:false },
  hearts:   { kind:'heart', colors:['#FF4FA3','#FF8FB0'], n:14, speed:[60,160], angle:[230,310], gravity:-60, life:[.8,1.2], size:[12,18] },
  wisps:    { kind:'glow', colors:['#9EE8FF','#CDBFF7'], n:16, speed:[60,120], gravity:-90, life:[.8,1.3], size:[14,22], blend:'lighter' },
  jelly:    { kind:'drop', colors:['#FFD45E','#9C4A1A'], n:16, speed:[120,240], angle:[200,340], gravity:600, life:[.5,.9], size:[7,12] },
  dust:     { kind:'glow', colors:['#CBBFA8'], n:8, speed:[40,90], angle:[180,360], gravity:-20, life:[.4,.6], size:[16,24], shrink:false },
  sweat:    { kind:'drop', colors:['#9FE3FF'], n:6, speed:[80,140], angle:[210,330], gravity:400, life:[.4,.6], size:[6,9] },
};
```

Sprite kinds already in `particles.js`: `glow`, `star`, `confetti`, `bolt` (raise its `lineWidth` from 3 to 4), `heart`, `drop`.

---

## 7. Jingles and sound effects (Web Audio)

- **Reuse pumal's `audio.js` shell:** ambient session with no `<audio>` element, the unlock / watchdog / rebuild ladder, a single melody voice, and ticks layered on top.
- **Swap the pitch source:** replace the piezo divider palette with equal temperament (Hz = 440·2^((midi−69)/12)).
- **Add a wave type per sound:** `sine | triangle | square | sawtooth | pulse25` (pulse25 via `PeriodicWave`).
- **Pattern tokens**, keeping pumal's `"pitch:ms"` and `-` rests:
  - `C5>G5:200` is a glide, `C5~:300` is vibrato, `C5^:110` is a boing that glides up from a fourth below.
  - Percussion and sound-effect tokens are listed in the table below.
- **Levels and length:** gain 0.05–0.10; each jingle under 1.6 s; scheduled on the `AudioContext` clock so it lands on HIT.

| Token | Synthesis |
|---|---|
| `K` (kick) | Sine 150→45 Hz exponential over 120 ms, gain 0.9→0 over 180 ms |
| `S` (snare) | Noise through a 1.2 kHz highpass for 140 ms, plus triangle 190 Hz for 60 ms |
| `H` (hat) | Noise through a 7 kHz highpass, 40 ms |
| `BELL` | Sines at f = 880, 2.76f, 5.40f, gains .5/.25/.12, exponential decay 0.9 s |
| `ZAP` | Square 1800→120 Hz exponential over 140 ms, plus a 60 ms noise burst through a 3 kHz highpass |
| `WHOOSH` | Noise through a bandpass (Q 1.2) sweeping 300→2400 Hz over 250 ms, gain up then down |
| `SCRATCH` | Sawtooth at 500 Hz with a 14 Hz LFO (±250 Hz), through a 1 kHz bandpass, 180 ms |
| `POP` | Sine 900→300 Hz in 50 ms |
| `TING` | Sine A7, 60 ms |
| `BOING` | Sine glide f/1.33 → f in 40 ms, then vibrato |
| `PUNCH` | Noise through a 600 Hz lowpass, 50 ms |
| `CLUNK` | Triangle 140 Hz, 40 ms, plus a noise click |

Generate the noise buffer once (1 s). Per-character jingles are in section 4.

---

## 8. Quality bar: 비곰, complete SVG and CSS (verified)

This is the shipping-quality reference. Every other character should follow the same file layout.

### CSS: `css/fighters.css` (shared rig) plus the 비곰 block

```css
:root { --ink: #2A1E2F; }
.stage { position: relative; width: var(--size, 200px); aspect-ratio: 1; perspective: calc(var(--size, 200px) * 3); }
.stage > * { position: absolute; inset: 0; }
.stage .rig { transform-origin: 50% 52.5%; }     /* (60,63) in viewBox units */
.stage svg { width: 100%; height: 100%; overflow: visible; display: block; }
.stage .shadow { inset: auto; left: 28%; width: 44%; top: 91%; height: 5%; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(42,30,47,.30), rgba(42,30,47,0)); }
.stage .flash { border-radius: 50%; opacity: 0;
  background: radial-gradient(closest-side, rgba(255,255,255,.95), rgba(255,246,200,.55) 45%, rgba(255,255,255,0)); }

.ch .o  { stroke: var(--ink); stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }
.ch .o2 { stroke: var(--ink); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.ch .ln { fill: none; stroke: var(--ink); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
/* every animated part sits inside <g transform="translate(joint)">, so its local 0,0 IS the joint */
.ch .p, .fx .p { transform-box: view-box; transform-origin: 0 0; }
.ch .eye { transform-box: fill-box; transform-origin: 50% 50%; }
.face-b, .face-c, .fx-spin, .fx-burst, .fx-sticker, .fx-dizzy { opacity: 0; }
.stage, .stage * { pointer-events: none; }
.stage:is([data-state="win"], [data-state="lose"]) :is(.rig, .flash, .shadow) { will-change: transform, opacity; }

/* palette P1 + alt (P2 mirror match) */
.ch-bigom { --fur:#8B5A3C; --fur-in:#E9B48A; --muzzle:#F3D9B1; --suit:#2F6BFF; --suit-sh:#2350C8; --cuff:#FFFFFF;
  --hat:#FFC83D; --hat-band:#F5A524; --shoe:#FFFFFF; --sole:#FF4D4D; --cheek:#FF8FA3; --mouth:#6B2335; --tongue:#FF7A8A; }
.alt .ch-bigom { --fur:#5E3B28; --suit:#FF4F8B; --suit-sh:#D93A72; --hat:#3FD9A8; --hat-band:#22B386; }
.fur{fill:var(--fur)} .fur-in{fill:var(--fur-in)} .muzzle{fill:var(--muzzle)} .suit{fill:var(--suit)} .suit-sh{fill:var(--suit-sh)}
.cuff{fill:var(--cuff)} .hat{fill:var(--hat)} .hat-band{fill:var(--hat-band)} .shoe{fill:var(--shoe)} .ink{fill:var(--ink)} .cheek{fill:var(--cheek);opacity:.6}

/* idle: composited breathing; JS adds .fidget every 5-9 s for one short part flourish */
.stage[data-state="idle"] .rig { transform-origin: 50% 93%; animation: breathe 2.6s ease-in-out infinite; }
@keyframes breathe { 0%,100% { transform: scale(1, 1); } 50% { transform: scale(1.018, .982); } }
.stage.fidget .eye { animation: blink .35s ease-in-out 1; }
@keyframes blink { 0%,100% { transform: scaleY(1); } 45% { transform: scaleY(.12); } }
.stage[data-char="bigom"].fidget .head { animation: bigom-nod .63s ease-in-out 2; }

/* my turn: toprock step */
.stage[data-char="bigom"][data-state="turn"] .rig { transform-origin: 50% 93%;
  animation: bigom-turn .6s cubic-bezier(.3,1.5,.6,1) both, breathe 2.6s .6s ease-in-out infinite; }
.stage[data-char="bigom"][data-state="turn"] .armL { animation: bigom-turn-armL .6s ease-out both; }
.stage[data-char="bigom"][data-state="turn"] .armR { animation: bigom-turn-armR .6s ease-out both; }
@keyframes bigom-turn {
  0%   { transform: translate(0%, 0%) rotate(0deg) scale(1, 1); }
  25%  { transform: translate(-3%, -5%) rotate(-5deg) scale(1, 1); }
  50%  { transform: translate(0%, 0%) rotate(0deg) scale(1.05, .95); }
  75%  { transform: translate(3%, -5%) rotate(5deg) scale(1, 1); }
  100% { transform: translate(0%, 0%) rotate(0deg) scale(1, 1); } }
@keyframes bigom-turn-armL { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(-35deg); } 75% { transform: rotate(25deg); } }
@keyframes bigom-turn-armR { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(-25deg); } 75% { transform: rotate(35deg); } }

/* WIN: toprock > windmill > headspin > freeze > kip-up (2.4 s) + nod loop */
.stage[data-char="bigom"][data-state="win"] .rig    { animation: bigom-win 2.4s linear both, bigom-loop 1.26s 2.4s ease-in-out infinite; }
.stage[data-char="bigom"][data-state="win"] .legL   { animation: bigom-legL 2.4s ease-in-out both; }
.stage[data-char="bigom"][data-state="win"] .legR   { animation: bigom-legR 2.4s ease-in-out both; }
.stage[data-char="bigom"][data-state="win"] .armL   { animation: bigom-armL 2.4s ease-in-out both; }
.stage[data-char="bigom"][data-state="win"] .armR   { animation: bigom-armR 2.4s ease-in-out both; }
.stage[data-char="bigom"][data-state="win"] .head   { animation: bigom-head 2.4s ease-in-out both, bigom-nod 1.26s 2.4s ease-in-out infinite; }
.stage[data-char="bigom"][data-state="win"] .face-a { animation: show-until-65 2.4s step-end both; }
.stage[data-char="bigom"][data-state="win"] .face-b { animation: show-from-65 2.4s step-end both; }
.stage[data-char="bigom"][data-state="win"] .fx-spin    { animation: bigom-fx-spin 2.4s linear both; }
.stage[data-char="bigom"][data-state="win"] .fx-burst   { animation: bigom-fx-burst 2.4s ease-out both; }
.stage[data-char="bigom"][data-state="win"] .fx-sticker { animation: bigom-fx-sticker 2.4s ease-out both; }
.stage[data-char="bigom"][data-state="win"] .flash      { animation: bigom-flash 2.4s ease-out both; }
.stage[data-char="bigom"][data-state="win"] .shadow     { animation: bigom-shadow 2.4s ease-in-out both; }

@keyframes bigom-win {   /* same function list in EVERY keyframe so 540deg/1080deg really spin */
  0%     { transform: translate(0%, 0%)   rotate(0deg)   rotateY(0deg)    scale(1, 1); animation-timing-function: ease-out; }
  4.17%  { transform: translate(-3%, -4%) rotate(-6deg)  rotateY(0deg)    scale(1, 1); animation-timing-function: ease-in-out; }
  8%     { transform: translate(0%, 0%)   rotate(0deg)   rotateY(0deg)    scale(1.04, .96); }
  12%    { transform: translate(3%, -4%)  rotate(6deg)   rotateY(0deg)    scale(1, 1); animation-timing-function: ease-in; }
  16%    { transform: translate(0%, 8%)   rotate(0deg)   rotateY(0deg)    scale(1.1, .86); animation-timing-function: linear; }
  19.67% { transform: translate(0%, 14%)  rotate(90deg)  rotateY(0deg)    scale(1, 1); animation-timing-function: linear; }
  23.33% { transform: translate(0%, 0%)   rotate(180deg) rotateY(0deg)    scale(1, 1); animation-timing-function: linear; }
  27%    { transform: translate(0%, 14%)  rotate(270deg) rotateY(0deg)    scale(1, 1); animation-timing-function: linear; }
  30.67% { transform: translate(0%, 8%)   rotate(360deg) rotateY(0deg)    scale(1.04, .9); animation-timing-function: linear; }
  34.33% { transform: translate(0%, 14%)  rotate(450deg) rotateY(0deg)    scale(1, 1); animation-timing-function: ease-out; }
  38%    { transform: translate(0%, 0%)   rotate(540deg) rotateY(0deg)    scale(1, 1); animation-timing-function: cubic-bezier(.5,0,1,1); }
  65%    { transform: translate(0%, 0%)   rotate(540deg) rotateY(1080deg) scale(1, 1); animation-timing-function: ease-out; }
  66.5%  { transform: translate(0%, 1%)   rotate(560deg) rotateY(1080deg) scale(1.06, .94); animation-timing-function: ease-in-out; }
  69%    { transform: translate(0%, 0%)   rotate(555deg) rotateY(1080deg) scale(1, 1); }
  83%    { transform: translate(0%, 0%)   rotate(555deg) rotateY(1080deg) scale(1, 1); animation-timing-function: ease-out; }
  88%    { transform: translate(0%, -16%) rotate(640deg) rotateY(1080deg) scale(1, 1); animation-timing-function: ease-in; }
  93.5%  { transform: translate(0%, -3%)  rotate(720deg) rotateY(1080deg) scale(.95, 1.06); animation-timing-function: ease-out; }
  97%    { transform: translate(0%, 1.5%) rotate(720deg) rotateY(1080deg) scale(1.08, .92); animation-timing-function: ease-out; }
  100%   { transform: translate(0%, 0%)   rotate(720deg) rotateY(1080deg) scale(1, 1); } }
@keyframes bigom-loop {
  0%, 50%, 100% { transform: translate(0%, 0%) rotate(0deg) rotateY(0deg) scale(1, 1); }
  12%, 62%      { transform: translate(0%, 1.6%) rotate(0deg) rotateY(0deg) scale(1.025, .97); } }
@keyframes bigom-nod {
  0%, 50%, 100% { transform: translate(0px, 0px) rotate(0deg); }
  12% { transform: translate(0px, 1.5px) rotate(4deg); }
  62% { transform: translate(0px, 1.5px) rotate(-4deg); } }
/* positive rotate swings a hanging limb toward screen-left */
@keyframes bigom-legL { 0%, 8%, 100% { transform: rotate(0deg); } 4.17% { transform: rotate(-18deg); } 12% { transform: rotate(14deg); }
  16% { transform: rotate(8deg); } 19.67%, 65% { transform: rotate(52deg); } 66.5%, 83% { transform: rotate(72deg); }
  88% { transform: rotate(-12deg); } 93.5% { transform: rotate(0deg); } }
@keyframes bigom-legR { 0%, 8%, 100% { transform: rotate(0deg); } 4.17% { transform: rotate(-10deg); } 12% { transform: rotate(18deg); }
  16% { transform: rotate(-8deg); } 19.67%, 65% { transform: rotate(-52deg); } 66.5%, 83% { transform: rotate(-128deg); }
  88% { transform: rotate(12deg); } 93.5% { transform: rotate(0deg); } }
@keyframes bigom-armL { 0% { transform: rotate(0deg); } 4.17% { transform: rotate(-35deg); } 8% { transform: rotate(15deg); }
  12% { transform: rotate(-35deg); } 16% { transform: rotate(30deg); } 19.67%, 38% { transform: rotate(105deg); }
  40%, 65% { transform: rotate(85deg); } 66.5%, 83% { transform: rotate(-55deg); } 88% { transform: rotate(75deg); }
  93.5% { transform: rotate(40deg); } 97%, 100% { transform: rotate(-55deg); } }
@keyframes bigom-armR { 0% { transform: rotate(0deg); } 4.17% { transform: rotate(35deg); } 8% { transform: rotate(-15deg); }
  12% { transform: rotate(35deg); } 16% { transform: rotate(-30deg); } 19.67%, 38% { transform: rotate(-105deg); }
  40%, 65% { transform: rotate(-85deg); } 66.5%, 83% { transform: rotate(55deg); } 88% { transform: rotate(-75deg); }
  93.5% { transform: rotate(-40deg); } 97%, 100% { transform: rotate(55deg); } }
@keyframes bigom-head { 0%, 8%, 16%, 100% { transform: translate(0px, 0px) rotate(0deg); }
  4.17% { transform: translate(0px, 0px) rotate(-7deg); } 12% { transform: translate(0px, 0px) rotate(7deg); }
  66.5% { transform: translate(0px, 0px) rotate(-6deg); } 69%, 83% { transform: translate(0px, 0px) rotate(-3deg); } }
@keyframes show-until-65 { 0% { opacity: 1; } 65%, 100% { opacity: 0; } }
@keyframes show-from-65  { 0% { opacity: 0; } 65%, 100% { opacity: 1; } }
@keyframes bigom-fx-spin { 0%, 38% { opacity: 0; stroke-dashoffset: 0; } 40% { opacity: 1; } 64% { opacity: 1; }
  65%, 100% { opacity: 0; stroke-dashoffset: -420; } }
@keyframes bigom-fx-burst { 0%, 64.9% { opacity: 0; transform: scale(.55); } 65% { opacity: 1; transform: scale(.7); }
  74%, 100% { opacity: 0; transform: scale(1.25); } }
@keyframes bigom-fx-sticker { 0%, 64.9% { opacity: 0; transform: scale(0) rotate(-24deg); }
  67.5% { opacity: 1; transform: scale(1.25) rotate(-6deg); animation-timing-function: ease-in-out; }
  70%, 82% { opacity: 1; transform: scale(1) rotate(-10deg); } 86%, 100% { opacity: 0; transform: scale(.4) rotate(-10deg); } }
@keyframes bigom-flash { 0%, 64.9% { opacity: 0; transform: scale(.4); } 65.5% { opacity: .95; transform: scale(.9); }
  72%, 100% { opacity: 0; transform: scale(1.3); } }
@keyframes bigom-shadow { 0%, 100% { transform: scale(1, 1); opacity: 1; } 16% { transform: scale(1.15, 1); opacity: 1; }
  19.67%, 34.33% { transform: scale(1.45, 1.1); opacity: .9; } 38%, 65% { transform: scale(.75, .9); opacity: 1; }
  88% { transform: scale(.55, .7); opacity: .5; } 97% { transform: scale(1.15, 1); opacity: 1; } }

/* LOSE */
.stage[data-char="bigom"][data-state="lose"] .rig { transform-origin: 50% 93%; animation: bigom-lose 1s ease-out both, sway 2.4s 1s ease-in-out infinite; }
.stage[data-char="bigom"][data-state="lose"] .beanie { animation: bigom-hat-slip .5s .25s cubic-bezier(.5,1.6,.6,1) both; }
.stage[data-char="bigom"][data-state="lose"] .armL { animation: droop-L .6s ease-out both; }
.stage[data-char="bigom"][data-state="lose"] .armR { animation: droop-R .6s ease-out both; }
.stage[data-char="bigom"][data-state="lose"] .face-a { opacity: 0; }
.stage[data-char="bigom"][data-state="lose"] .face-c { opacity: 1; }
.stage[data-state="lose"] .fx-dizzy { opacity: 1; }
.stage[data-state="lose"] .fx-dizzy .star { animation: orbit 1.2s linear infinite; }
.stage[data-state="lose"] .fx-dizzy .star:nth-child(2) { animation-delay: -.4s; }
.stage[data-state="lose"] .fx-dizzy .star:nth-child(3) { animation-delay: -.8s; }
@keyframes bigom-lose { 0% { transform: translate(0%, 0%) rotate(0deg) scale(1, 1); } 20% { transform: translate(0%, -3%) rotate(0deg) scale(.96, 1.05); }
  55% { transform: translate(0%, 2%) rotate(-4deg) scale(1.06, .9); } 100% { transform: translate(0%, 1%) rotate(-3deg) scale(1.03, .95); } }
@keyframes sway { 0%, 100% { transform: translate(0%, 1%) rotate(-3deg) scale(1.03, .95); } 50% { transform: translate(0%, 1%) rotate(3deg) scale(1.03, .95); } }
@keyframes bigom-hat-slip { from { transform: translate(0px, 0px) rotate(0deg); } to { transform: translate(-2px, 11px) rotate(-8deg); } }
@keyframes droop-L { to { transform: rotate(-12deg); } }
@keyframes droop-R { to { transform: rotate(12deg); } }
@keyframes orbit {   /* ellipse traced with translate only: stars never squash */
  0% { transform: translate(0px, 6px) scale(1); } 12.5% { transform: translate(-15px, 4px) scale(.95); }
  25% { transform: translate(-21px, 0px) scale(.85); } 37.5% { transform: translate(-15px, -4px) scale(.7); }
  50% { transform: translate(0px, -6px) scale(.6); } 62.5% { transform: translate(15px, -4px) scale(.7); }
  75% { transform: translate(21px, 0px) scale(.85); } 87.5% { transform: translate(15px, 4px) scale(.95); }
  100% { transform: translate(0px, 6px) scale(1); } }

/* REDUCED MOTION: one source of truth on <html data-motion> */
[data-motion="reduce"] .stage *, [data-motion="reduce"] .stage { animation: none !important; }
[data-motion="reduce"] .stage[data-state="win"] .face-a { opacity: 0; }
[data-motion="reduce"] .stage[data-state="win"] .face-b { opacity: 1; }
[data-motion="reduce"] .stage[data-char="bigom"][data-state="win"] .armL { transform: rotate(-55deg); }
[data-motion="reduce"] .stage[data-char="bigom"][data-state="win"] .armR { transform: rotate(55deg); }
[data-motion="reduce"] .stage[data-state="win"] .fx-sticker { opacity: 1; transform: rotate(-10deg); animation: rm-fade .4s ease-out both !important; }
[data-motion="reduce"] .stage[data-state="lose"] .fx-dizzy { opacity: 0; }
[data-motion="reduce"] .stage[data-char="bigom"][data-state="lose"] .beanie { transform: translate(-2px, 11px) rotate(-8deg); }
@keyframes rm-fade { from { opacity: 0; } to { opacity: 1; } }
```

### Markup (the `svg` string in `characters.js`, wrapped by the stage)

```html
<div class="stage" data-char="bigom" data-state="idle">
  <div class="shadow"></div>
  <div class="flash"></div>
  <div class="rig">
    <svg class="ch ch-bigom" viewBox="0 0 120 120" role="img" aria-label="비곰">
      <g transform="translate(51 92)"><g class="p legL"><g transform="translate(-51 -92)">
        <rect class="o suit" x="45" y="89" width="12" height="15" rx="6"/>
        <rect class="o shoe" x="40.5" y="101" width="17.5" height="10" rx="5"/>
        <path d="M42.5 108.4H56" stroke="var(--sole)" stroke-width="2" stroke-linecap="round"/>
      </g></g></g>
      <g transform="translate(69 92)"><g class="p legR"><g transform="translate(-69 -92)">
        <rect class="o suit" x="63" y="89" width="12" height="15" rx="6"/>
        <rect class="o shoe" x="62" y="101" width="17.5" height="10" rx="5"/>
        <path d="M64 108.4H77.5" stroke="var(--sole)" stroke-width="2" stroke-linecap="round"/>
      </g></g></g>
      <g class="body">
        <path class="o suit" d="M41 83Q41 69 60 69Q79 69 79 83V88Q79 100 60 100Q41 100 41 88Z"/>
        <path class="suit-sh" d="M43 90.5Q60 96.5 77 90.5Q76 98.3 60 98.3Q44 98.3 43 90.5Z"/>
        <path d="M60 72.5V97" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".9"/>
        <path d="M50.5 79l4.5 3-4.5 3M69.5 79l-4.5 3 4.5 3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <g transform="translate(44 77)"><g class="p armL"><g transform="translate(-44 -77)">
        <rect class="o suit" x="38.5" y="73.5" width="11" height="17" rx="5.5"/>
        <rect class="cuff" x="40" y="86" width="8" height="3.2" rx="1"/>
        <circle class="o fur" cx="44" cy="93.5" r="5.5"/>
      </g></g></g>
      <g transform="translate(76 77)"><g class="p armR"><g transform="translate(-76 -77)">
        <rect class="o suit" x="70.5" y="73.5" width="11" height="17" rx="5.5"/>
        <rect class="cuff" x="72" y="86" width="8" height="3.2" rx="1"/>
        <circle class="o fur" cx="76" cy="93.5" r="5.5"/>
      </g></g></g>
      <g transform="translate(60 70)"><g class="p head"><g transform="translate(-60 -70)">
        <ellipse class="o fur" cx="60" cy="46" rx="30" ry="25"/>
        <g transform="translate(60 40)"><g class="p beanie"><g transform="translate(-60 -40)">
          <path class="o hat" d="M30.5 41C30.5 22 44 13.5 60 13.5S89.5 22 89.5 41Z"/>
          <path d="M40 27Q45 20.5 53 18.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".55"/>
          <rect class="o hat-band" x="28.5" y="35" width="63" height="9.5" rx="4.75"/>
          <path d="M38 37v5M46 37v5M54 37v5M62 37v5M70 37v5M78 37v5M86 37v4" stroke="var(--ink)" stroke-width="1.3" stroke-linecap="round" opacity=".22"/>
          <circle class="o fur" cx="37.5" cy="22.5" r="8.2"/><circle class="fur-in" cx="37.5" cy="22.5" r="3.8"/>
          <circle class="o fur" cx="82.5" cy="22.5" r="8.2"/><circle class="fur-in" cx="82.5" cy="22.5" r="3.8"/>
        </g></g></g>
        <ellipse class="cheek" cx="40.5" cy="62" rx="4.4" ry="2.6"/>
        <ellipse class="cheek" cx="79.5" cy="62" rx="4.4" ry="2.6"/>
        <ellipse class="o2 muzzle" cx="60" cy="62.5" rx="12.5" ry="8.5"/>
        <path class="ink" d="M55.5 58.4Q60 56 64.5 58.4Q63.2 62 60 62.6Q56.8 62 55.5 58.4Z"/>
        <ellipse cx="58.3" cy="58.3" rx="1.4" ry=".8" fill="#fff" opacity=".7"/>
        <g class="face-a">
          <path class="ln" d="M43 48.6Q47.5 46.4 52 47.6M77 48.6Q72.5 46.4 68 47.6"/>
          <ellipse class="eye ink" cx="48" cy="54" rx="3.4" ry="4.2"/>
          <ellipse class="eye ink" cx="72" cy="54" rx="3.4" ry="4.2"/>
          <circle cx="46.9" cy="52.4" r="1.25" fill="#fff"/><circle cx="70.9" cy="52.4" r="1.25" fill="#fff"/>
          <path class="ln" d="M60 62.6V64.6M55.5 64Q57.8 66.8 60 64.6Q62.2 66.8 64.5 64" stroke-width="2"/>
        </g>
        <g class="face-b">
          <path class="ln" d="M43 47.6Q47.5 45.4 52 46.6M77 48.6Q72.5 46.4 68 47.6"/>
          <path class="ln" d="M44.4 55.2Q48 50.6 51.6 55.2" stroke-width="2.8"/>
          <ellipse class="ink" cx="72" cy="54" rx="3.4" ry="4.2"/><circle cx="70.9" cy="52.4" r="1.25" fill="#fff"/>
          <path d="M54 64.2Q60 72.4 66 64.2Z" fill="var(--mouth)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
          <path d="M57.2 67.8Q60 70.2 62.8 67.8Q60 66.6 57.2 67.8Z" fill="var(--tongue)"/>
        </g>
        <g class="face-c">
          <path class="ln" d="M45 51l6 6M51 51l-6 6M69 51l6 6M75 51l-6 6"/>
          <path class="ln" d="M54 66q1.5-2 3 0t3 0 3 0 3 0" stroke-width="2"/>
        </g>
      </g></g></g>
    </svg>
  </div>
  <svg class="fx" viewBox="0 0 120 120" aria-hidden="true">
    <g class="fx-spin" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="14 10">
      <ellipse cx="60" cy="72" rx="34" ry="7"/>
      <ellipse cx="60" cy="96" rx="26" ry="5.5" stroke="var(--ink)" stroke-width="2" opacity=".35"/>
      <ellipse cx="60" cy="46" rx="24" ry="5" stroke-dasharray="8 12"/>
    </g>
    <g transform="translate(60 63)"><g class="p fx-burst"><g transform="translate(-60 -63)" stroke="#FFC83D" stroke-width="3.2" stroke-linecap="round">
      <path d="M60 9V19M60 107V117M6 63H16M104 63H114M22 25l7 7M98 25l-7 7M22 101l7-7M98 101l-7-7"/>
    </g></g></g>
    <g transform="translate(94 22)"><g class="p fx-sticker">
      <rect x="-19" y="-10" width="38" height="20" rx="10" fill="#fff" stroke="var(--ink)" stroke-width="2.4"/>
      <text x="0" y="5" text-anchor="middle" font-size="13" font-weight="900" fill="#2F6BFF"
            font-family="system-ui,-apple-system,'Apple SD Gothic Neo',sans-serif">얼음!</text>
    </g></g>
    <g class="fx-dizzy" transform="translate(60 14)" fill="#FFC83D" stroke="var(--ink)" stroke-width="1.4" stroke-linejoin="round">
      <path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
      <path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
      <path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
    </g>
  </svg>
</div>
```

Cue table for this character: SCRATCH at 1.50; at 1.56 the `sparkle` burst at (60,104), the jingle and a 120 ms stage shake; `dust` at (60,112) at 2.33.

---

## 9. Verification and suggested tests

**Verified so far:**
- Frame-frozen contact sheets of 비곰 (paused via `getAnimations({subtree:true})` with `currentTime` set). Idle, every win phase, lose, alt palette, reduced motion, and 48px all render correctly. WebKit 26.0 and Chromium 141 output is identical, so the joint-sandwich pivots behave the same in both.
- Lineup: all 8 characters are distinct at 48px on light and dark.
- Particles: all 6 sprite kinds work in both engines.

**Tooling note:** Playwright WebKit now runs in this container. Its browsers are installed under `scratchpad/pwwk/browsers` (set `PLAYWRIGHT_BROWSERS_PATH` to it), and the system dependencies were installed through apt. This is closer to iOS Safari than pumal's macOS-Chrome `shot.sh`. I recommend `tools/shot.mjs` with WebKit and a `?shot=win&t=1.6` freeze hook.

**Suggested `node --test` tests:**
- `characters.test.js`:
  - 8 entries with unique ids.
  - Names are 2–3 Hangul syllables.
  - P1 and alt palettes are valid hex values.
  - Win quotes are 22 characters or fewer.
  - Jingles have 3–5 melodic notes and are 1600 ms or shorter.
  - Cues are sorted and within 0–2.4 s.
- `rig.test.js` (string parse of each SVG):
  - The required `.p` parts are present.
  - Every `.p` sits inside a parent `<g transform="translate(x y)">` and has no `transform` attribute itself.
  - No `id=`, `<filter`, `<linearGradient`, `<mask` or `<clipPath`.
- `css.test.js`:
  - Within each `@keyframes`, every `transform` uses an identical function-name sequence.
  - No `linear(`.
  - No individual `rotate:`/`scale:`/`translate:` properties.
  - Every `[data-state="win"]` main animation is 2.4 s.

**Still to check on a real iPhone:**
- rotateY rendering at full speed.
- Frame rate under Low Power Mode.
- Font rendering of "얼음!" with Apple SD Gothic Neo.

## Files (scratchpad: `/tmp/claude-0/-home-user-skim-ai-os/164b20a1-3bf2-55a7-b177-d7513698c889/scratchpad/chars/`)

- **`bigom.html`**: the complete quality-bar rig with its test harness. Query options: `?t=1.5,1.6` picks frames, `?alt` uses the 2P palette, `?rm` turns on reduced motion.
- **`bigom-sheet.png`**: the WebKit contact sheet.
- **`lineup.html` / `lineup.png`**: static drafts of all 8 characters at 150px and 48px. 불똥 and 냥자 already use joint wrappers for the tail, wings and scarf. The others need their parts wrapped.
- **`particles.js`**: the tested particle module. `ptest.html`, `p-wk.png` and `p-chr.png` are its test page and renders.
- **`shot.mjs`**: the Playwright screenshot script (pass `webkit` or `chromium`).
- **WebKit browser:** `/tmp/claude-0/-home-user-skim-ai-os/164b20a1-3bf2-55a7-b177-d7513698c889/scratchpad/pwwk/browsers`.

## Uncertainties (flagged)

- **LBSE in Safari 27:** Igalia said in July 2026 that it was still not the default. A secondary report (Technobezz, not confirmed against WebKit's own notes) says Safari 27 has 66 SVG fixes, but whether LBSE is on is unconfirmed. The design works either way.
- **Low Power Mode and composited CSS:** only the `linear()` throttling is confirmed. Whether composited CSS animations are also throttled is unverified.
- **Softness when scaling a composited layer up:** moderate confidence.
- **Name checks:** quick web searches only, not legal clearance. 잽잽 has not been searched.

## Sources

- [WebKit bug 211755 (transform-box / Safari initial value)](https://bugs.webkit.org/show_bug.cgi?id=211755) · [bug 180392](https://bugs.webkit.org/show_bug.cgi?id=180392) · [bug 194903 (fill-box + zoom)](https://bugs.webkit.org/show_bug.cgi?id=194903) · [bug 201854 (transform-origin vs transform attribute)](https://webkit.org/b/201854) · [Dockyard: An Animated Tale of SVG Transforms](https://dockyard.com/blog/2019/11/29/an-animated-tale-of-svg-transforms)
- [Igalia: LBSE conditional layers, July 2026](https://blogs.igalia.com/nzimmermann/posts/2026-07-14-lbse-conditional-layers/) · [Igalia: implementing compositing in LBSE](https://blogs.igalia.com/nzimmermann/posts/) · [Igalia WebKit WIP 69](https://blogs.igalia.com/webkit/blog/2026/wip-69/) · [WIP 70](https://blogs.igalia.com/webkit/blog/2026/wip-70/)
- [Safari 26.5 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-26_5-release-notes.md) · [Safari 26 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes.md) · [Safari 27 release notes (beta)](https://developer.apple.com/tutorials/data/documentation/safari-release-notes/safari-27-release-notes.md) · [Technobezz on Safari 27](https://www.technobezz.com/news/safari-27-safari-mcp-844-fixes)
- [WebKit bug 215745 (rAF 30 fps in Low Power Mode)](https://bugs.webkit.org/show_bug.cgi?id=215745) · [WebKit bug 281429 (`linear()` not accelerated)](https://www2.webkit.org/show_bug.cgi?id=281429) · [Popmotion: iOS rAF throttling](https://popmotion.io/blog/20180104-when-ios-throttles-requestanimationframe) · [motion.dev: when browsers throttle rAF](https://motion.dev/magazine/when-browsers-throttle-requestanimationframe)
- [web.dev: high-performance CSS animations](https://web.dev/articles/animations-guide) · [jakub.kr: will-change](https://jakub.kr/components/will-change-in-css)
- [PQINA: canvas area limit](https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/) · [WebKit HTMLCanvasElement.cpp (iOS max area)](https://webkit.googlesource.com/WebKit/+/e5c24a279cffc70faf3d66033bcb3aa729619194/Source/WebCore/html/HTMLCanvasElement.cpp) · [Adobe thread: DPR and canvas size](https://community.adobe.com/t5/animate-discussions/canvas-dimensions-grow-with-higher-screen-density-gt-error/m-p/13664929) · [CanvasJS forum: total canvas memory](https://canvasjs.com/?p=24245)
- [W3C SVG issue: CSS `d` property in Safari, 2025](https://lists.w3.org/Archives/Public/public-svg-issues/2025Mar/0003.html) · [WebKit bug 275842](https://www2.webkit.org/show_bug.cgi?id=275842) · [caniuse: CSS Motion Path](https://caniuse.com/css-motion-paths)
- [Bulbapedia: electric rodents ("Pikaclone")](https://m.bulbapedia.bulbagarden.net/wiki/Pikaclone) · [Kakao Friends (Wikipedia)](https://en.wikipedia.org/wiki/Kakao_Friends) · [Emojipedia: ninja cat](https://emojipedia.org/ko/ninja-cat)