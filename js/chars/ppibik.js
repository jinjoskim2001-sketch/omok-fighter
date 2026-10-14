// js/chars/ppibik.js — 삐빅 Ppibik, the tin-toy robot (docs/SPEC.md §8.5, docs/research/characters.md §4.6)
// Art + rig only. Motion lives in css/chars/ppibik.css; js/fighter.js builds the stage around `svg` + `fx`.
//
// Rig (joint sandwiches, joints in viewBox units), in draw order:
//   legL (51.5,96) · legR (68.5,96) · body (static; holds the chest-dial `needle` (53.5,83) and LEDs .led1-3)
//   · spring (60,70) — scaleY 0 until the head launches · head (60,70 = neck) > hspin (60,46.5 = helmet centre,
//   in-plane spin) > antenna (60,24) · armL (37,76) · armR (83,76) — arms are drawn last so raised claws read
//   in front of the wide helmet. Faces inside the visor: face-a (LED eyes; `.gaze` scans) · face-w (surprised
//   O O) · face-b (heart LEDs, `.ht` pulse) · face-c (red ✕✕; `.glitch` jitters).
// Victory "팝핀 → 머리 스프링 → 하트 LED 축포" (2.4 s, HIT 1.40):
//   0–0.20 boot blink "삐빅" · 0.25/0.45/0.65/0.85 popping hits (arm wave → disco points, chest LEDs fill up)
//   · 0.97–1.20 malfunction head spin + sparks · 1.20 BOING head launch on a spring · 1.40 HIT heart eyes,
//   arms V, confetti cannon from the antenna · bobble · 2.10 CLUNK head lands · claw-up finish → loop.
export default {
  id: 'ppibik', ko: '삐빅', en: 'Ppibik', tagline: '기쁘면 합선돼요',
  type: '로봇',
  color: '#B6FF4D', colorAlt: '#F2C14E',
  bg: ['#2B3A5C', '#0E1424'],
  winMs: 2400, hitAt: 1.40, excerptFrom: 1.10,
  quote: { win: '삐빅! 기쁨 수치 측정 불가!', winEn: 'Beep-boop! Joy level: off the charts!', lose: '삐…빅… 오류 발생.' },
  anchors: {
    head: [60, 46], center: [60, 70], feet: [60, 110], sky: [60, -15],
    tip: [60, -12],      // antenna bulb at the HIT (head launched 21 up)
    face: [60, 25],      // visor at the HIT
  },
  cues: [
    { t: 0.04, sfx: 'BLIP' },                                   // 삐
    { t: 0.15, sfx: 'BLIP' },                                   // 빅
    { t: 0.25, sfx: 'CLUNK' },                                  // popping hits
    { t: 0.45, sfx: 'CLUNK' },
    { t: 0.65, sfx: 'CLUNK' },
    { t: 0.85, sfx: 'CLUNK' },
    { t: 0.97, sfx: 'WHIRR' },                                  // malfunction spin
    { t: 1.04, sfx: 'CRACKLE', fx: 'bolts', at: 'head' },
    { t: 1.20, sfx: 'BOING' },                                  // head launches on the spring
    { t: 1.40, sfx: 'POP', fx: 'confetti', at: 'tip', shake: 120 },   // HIT: confetti cannon
    { t: 1.42, fx: 'hearts', at: 'face' },
    { t: 2.10, sfx: 'CLUNK', fx: 'dust', at: 'feet' },          // head lands back
  ],
  turnSfx: 'BLIP',
  jingle: { at: 1.40, voices: [
    { wave: 'pulse25', gain: 0.06, lowpass: 3600, notes: 'C5:70 G5:70 C6:70 E6:70 G6~:320 -:180 E6:60 -:40 G6:110' },
    { wave: 'triangle', gain: 0.08, notes: 'C3:140 G3:140 C4:320' },
    { drums: 'K:140 H:70 H:70 S:320' },
  ] },
  portrait: '25 3 70 70',
  svg: `<svg class="ch ch-ppibik" viewBox="0 0 120 120" role="img" aria-label="삐빅">
<g transform="translate(51.5 96)"><g class="p legL"><g transform="translate(-51.5 -96)">
<rect class="o metal" x="46.5" y="92" width="10" height="13" rx="3"/>
<path class="seam" d="M47.8 97.6h7.4M47.8 100.6h7.4"/>
<rect class="o metal-sh" x="42" y="102.5" width="17.5" height="8.5" rx="4"/>
<path class="shine sm" d="M45.2 105.4h5.6"/>
</g></g></g>
<g transform="translate(68.5 96)"><g class="p legR"><g transform="translate(-68.5 -96)">
<rect class="o metal" x="63.5" y="92" width="10" height="13" rx="3"/>
<path class="seam" d="M64.8 97.6h7.4M64.8 100.6h7.4"/>
<rect class="o metal-sh" x="60.5" y="102.5" width="17.5" height="8.5" rx="4"/>
<path class="shine sm" d="M63.7 105.4h5.6"/>
</g></g></g>
<g class="body">
<rect class="o2 metal-sh" x="51.5" y="65" width="17" height="7" rx="2.5"/>
<rect class="o metal" x="40" y="70" width="40" height="29" rx="9"/>
<path class="metal-sh" d="M41.6 89.4Q60 94.6 78.4 89.4Q78.2 97.4 70.4 97.4H49.6Q41.8 97.4 41.6 89.4Z"/>
<path class="shine" d="M43.6 81Q43.4 74 49.4 72.6"/>
<rect class="o2 metal-lt" x="46.5" y="75" width="27" height="16" rx="4"/>
<circle class="o2 bolt" cx="53.5" cy="83" r="4.9"/>
<circle class="dial" cx="53.5" cy="83" r="3.1"/>
<g transform="translate(53.5 83)"><g class="p needle"><g transform="translate(-53.5 -83)">
<path class="needle-ln" d="M53.5 83L51.5 80.6"/>
</g></g></g>
<circle class="ink" cx="53.5" cy="83" r="1"/>
<circle class="o2 led1" cx="62.5" cy="80" r="1.9"/>
<circle class="o2 led2" cx="66.8" cy="80" r="1.9"/>
<circle class="o2 led3" cx="71.1" cy="80" r="1.9"/>
<path class="grille" d="M61.2 85.2h11.2M61.2 88h11.2"/>
</g>
<g transform="translate(60 70)"><g class="p spring"><g transform="translate(-60 -70)">
<path class="coil-ink" d="M60 70L53.5 67.2L66.5 62.6L53.5 58L66.5 53.4L53.5 48.8L60 46.5"/>
<path class="coil" d="M60 70L53.5 67.2L66.5 62.6L53.5 58L66.5 53.4L53.5 48.8L60 46.5"/>
</g></g></g>
<g transform="translate(60 70)"><g class="p head"><g transform="translate(-60 -70)">
<g transform="translate(60 46.5)"><g class="p hspin"><g transform="translate(-60 -46.5)">
<g transform="translate(60 24)"><g class="p antenna"><g transform="translate(-60 -24)">
<g class="sig"><path class="sig-ink" d="M51.6 4.8Q49.2 9.5 51.6 14.2M68.4 4.8Q70.8 9.5 68.4 14.2M47.2 2Q43.6 9.5 47.2 17M72.8 2Q76.4 9.5 72.8 17"/><path class="sig-led" d="M51.6 4.8Q49.2 9.5 51.6 14.2M68.4 4.8Q70.8 9.5 68.4 14.2M47.2 2Q43.6 9.5 47.2 17M72.8 2Q76.4 9.5 72.8 17"/></g>
<path class="tube-ink" d="M60 25V14"/><path class="tube" d="M60 25V14"/>
<circle class="glow" cx="60" cy="9.5" r="8.6" fill-opacity=".45"/>
<circle class="o2 bulb" cx="60" cy="9.5" r="5.2"/>
<circle class="bulb-off" cx="60" cy="9.5" r="4.2"/>
<circle class="hl" cx="58.2" cy="7.7" r="1.5"/>
</g></g></g>
<rect class="o bolt" x="23" y="38.5" width="8.5" height="17" rx="3.2"/>
<path class="seam" d="M24.6 44h4.4M24.6 50h4.4"/>
<rect class="o bolt" x="88.5" y="38.5" width="8.5" height="17" rx="3.2"/>
<path class="seam" d="M91 44h4.4M91 50h4.4"/>
<rect class="o metal" x="29" y="23" width="62" height="47" rx="16"/>
<path class="metal-sh" d="M30.6 56.6Q60 63.6 89.4 56.6Q88.8 68.4 75 68.4H45Q31.2 68.4 30.6 56.6Z"/>
<path class="shine" d="M33.4 36Q34.6 27.8 43 26.2"/>
<rect class="o2 metal-sh" x="54" y="19.4" width="12" height="5.6" rx="2.6"/>
<circle class="rivet" cx="34.6" cy="63.6" r="1.5"/><circle class="rivet" cx="85.4" cy="63.6" r="1.5"/>
<rect class="o2 visor" x="36.5" y="32.5" width="47" height="27" rx="13.5"/>
<path class="glint" d="M41.4 39Q42.8 35.8 47.2 35.2"/>
<g class="face-a">
<g class="gaze">
<rect class="halo" x="44.6" y="38.6" width="9.3" height="13.8" rx="4.65"/>
<rect class="halo" x="66.1" y="38.6" width="9.3" height="13.8" rx="4.65"/>
<rect class="eye led" x="46" y="40" width="6.5" height="11" rx="3.25"/>
<rect class="eye led" x="67.5" y="40" width="6.5" height="11" rx="3.25"/>
</g>
<path class="led-ln" d="M55.6 53.6Q60 57 64.4 53.6"/>
<circle class="blush" cx="42.4" cy="53.4" r="1.9"/><circle class="blush" cx="77.6" cy="53.4" r="1.9"/>
</g>
<g class="face-w">
<circle class="led-ring" cx="49.25" cy="45.5" r="4.4"/><circle class="led-ring" cx="70.75" cy="45.5" r="4.4"/>
<circle class="led-ring sm" cx="60" cy="54.4" r="2"/>
</g>
<g class="face-b">
<g transform="translate(49.2 45.6)"><path class="sc ht halo" d="M0 6.6C-2 4.8-8.2 1-8.2-3C-8.2-6-6-7.8-3.8-7.8C-2.1-7.8-.8-6.9 0-5.5C.8-6.9 2.1-7.8 3.8-7.8C6-7.8 8.2-6 8.2-3C8.2 1 2 4.8 0 6.6Z"/></g>
<g transform="translate(70.8 45.6)"><path class="sc ht halo" d="M0 6.6C-2 4.8-8.2 1-8.2-3C-8.2-6-6-7.8-3.8-7.8C-2.1-7.8-.8-6.9 0-5.5C.8-6.9 2.1-7.8 3.8-7.8C6-7.8 8.2-6 8.2-3C8.2 1 2 4.8 0 6.6Z"/></g>
<g transform="translate(49.2 45.6)"><path class="sc ht heart" d="M0 5C-1.6 3.6-6.2.8-6.2-2.3C-6.2-4.5-4.6-5.9-2.9-5.9C-1.6-5.9-.6-5.2 0-4.2C.6-5.2 1.6-5.9 2.9-5.9C4.6-5.9 6.2-4.5 6.2-2.3C6.2.8 1.6 3.6 0 5Z"/></g>
<g transform="translate(70.8 45.6)"><path class="sc ht heart" d="M0 5C-1.6 3.6-6.2.8-6.2-2.3C-6.2-4.5-4.6-5.9-2.9-5.9C-1.6-5.9-.6-5.2 0-4.2C.6-5.2 1.6-5.9 2.9-5.9C4.6-5.9 6.2-4.5 6.2-2.3C6.2.8 1.6 3.6 0 5Z"/></g>
<path class="led" d="M54 52.6Q60 53.4 66 52.6Q65.2 58.2 60 58.2Q54.8 58.2 54 52.6Z"/>
<circle class="blush" cx="41.6" cy="53" r="2.4"/><circle class="blush" cx="78.4" cy="53" r="2.4"/>
</g>
<g class="face-c"><g class="glitch">
<path class="err-ln" d="M45.6 41.8l7.2 7.2M52.8 41.8l-7.2 7.2M67.2 41.8l7.2 7.2M74.4 41.8l-7.2 7.2"/>
<path class="err-ln sm" d="M53.4 55l2.2-2.2 2.2 2.2 2.2-2.2 2.2 2.2 2.2-2.2 2.2 2.2"/>
<path class="scan" d="M39.5 46.2h41M41 51.4h38"/>
</g></g>
</g></g></g>
</g></g></g>
<g transform="translate(37 76)"><g class="p armL"><g transform="translate(-37 -76)">
<rect class="o2 metal-lt" x="31.8" y="78.4" width="9.4" height="4.8" rx="2.4"/>
<rect class="o2 metal-lt" x="31.1" y="82.4" width="9.4" height="4.8" rx="2.4"/>
<rect class="o2 metal-lt" x="30.4" y="86.4" width="9.4" height="4.8" rx="2.4"/>
<path class="o2 metal-sh" d="M35.1 90.2Q29.2 91 30 97.8L32.8 97Q32.8 94.2 35.1 93.7Q37.4 94.2 37.4 97L40.2 97.8Q41 91 35.1 90.2Z"/>
<circle class="o2 bolt" cx="35.1" cy="91.4" r="1.7"/>
<circle class="o2 metal-sh" cx="38.2" cy="76.4" r="4.4"/>
<circle class="hl" cx="37" cy="75.2" r="1.1"/>
</g></g></g>
<g transform="translate(83 76)"><g class="p armR"><g transform="translate(-83 -76)">
<rect class="o2 metal-lt" x="78.8" y="78.4" width="9.4" height="4.8" rx="2.4"/>
<rect class="o2 metal-lt" x="79.5" y="82.4" width="9.4" height="4.8" rx="2.4"/>
<rect class="o2 metal-lt" x="80.2" y="86.4" width="9.4" height="4.8" rx="2.4"/>
<path class="o2 metal-sh" d="M84.9 90.2Q90.8 91 90 97.8L87.2 97Q87.2 94.2 84.9 93.7Q82.6 94.2 82.6 97L79.8 97.8Q79 91 84.9 90.2Z"/>
<circle class="o2 bolt" cx="84.9" cy="91.4" r="1.7"/>
<circle class="o2 metal-sh" cx="81.8" cy="76.4" r="4.4"/>
<circle class="hl" cx="80.6" cy="75.2" r="1.1"/>
</g></g></g>
</svg>`,
  fx: `<svg class="fx" viewBox="0 0 120 120" aria-hidden="true">
<g class="fx-zap">
<path class="zap" d="M19 29L12.5 39.5H17.5L13.5 49L23 36.5H18L21.5 29Z"/>
<path class="zap" d="M101 29L107.5 39.5H102.5L106.5 49L97 36.5H102L98.5 29Z"/>
<path class="zap" d="M83 9L79 16H82.5L80 22.5L86.5 14H83L85.5 9Z"/>
</g>
<g transform="translate(60 24)"><g class="p fx-burst"><g transform="translate(-60 -24)">
<path class="burst" d="M12 24H19M101 24H108M28 -6L33 -1M92 -6L87 -1M44 -16L46.5 -10.5M76 -16L73.5 -10.5"/>
</g></g></g>
<g transform="translate(20.5 89)"><g class="p fx-sticker">
<rect x="-20" y="-10.5" width="40" height="21" rx="10.5" class="stk"/>
<text x="-4.5" y="4.6" text-anchor="middle" font-size="12.5" font-weight="900" class="stk-t"
 font-family="system-ui,-apple-system,'Apple SD Gothic Neo',sans-serif">삐빅!</text>
<path class="stk-h" d="M13.2 4.6C12.2 3.8 8.6 1.6 8.6-1C8.6-2.6 9.8-3.6 11-3.6C12 -3.6 12.8-3 13.2-2.2C13.6-3 14.4-3.6 15.4-3.6C16.6-3.6 17.8-2.6 17.8-1C17.8 1.6 14.2 3.8 13.2 4.6Z"/>
</g></g>
<g class="fx-smoke">
<g transform="translate(20 57)"><path class="sc puff" d="M-4.6 2.6A2.7 2.7 0 0 1-4 -2.5A3.3 3.3 0 0 1 2.2 -3.3A3.3 3.3 0 0 1 4.8 2.6Z"/></g>
<g transform="translate(91 46)"><path class="sc puff" d="M-4.6 2.6A2.7 2.7 0 0 1-4 -2.5A3.3 3.3 0 0 1 2.2 -3.3A3.3 3.3 0 0 1 4.8 2.6Z"/></g>
<g transform="translate(18 55) scale(0.8)"><path class="sc puff" d="M-4.6 2.6A2.7 2.7 0 0 1-4 -2.5A3.3 3.3 0 0 1 2.2 -3.3A3.3 3.3 0 0 1 4.8 2.6Z"/></g>
<g transform="translate(93 44) scale(0.8)"><path class="sc puff" d="M-4.6 2.6A2.7 2.7 0 0 1-4 -2.5A3.3 3.3 0 0 1 2.2 -3.3A3.3 3.3 0 0 1 4.8 2.6Z"/></g>
</g>
<g class="fx-dizzy" transform="translate(60 12)" fill="#FFC83D" stroke="#2A1E2F" stroke-width="1.4" stroke-linejoin="round">
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
</g>
</svg>`,
};
