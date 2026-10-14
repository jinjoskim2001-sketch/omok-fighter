// js/chars/beonjjeok.js — 번쩍 Beonjjeok, the dynamo hamster (docs/SPEC.md §8.5, docs/research/characters.md §4.4)
// Art + rig only. Motion lives in css/chars/beonjjeok.css; js/fighter.js builds the stage around `svg` + `fx`.
//
// Parts (joint sandwiches, back to front): wheel (hub 60,67.5) · frizz (static afro, 60,66) · legL legR (hips 47,100 /
// 73,100) · ball (head+body in one, joint = bottom 60,104; holds the ears, cowlick (root 59,39), goggles and faces) ·
// pawL pawR (wrists 48,92 / 72,92: the little paws that hold the sunflower seed; pawL carries the seed) · armL armR
// (shoulders 31,80 / 89,80) › foreL foreR (elbows 28,90.5 / 92,90.5): stubby arms for the big poses, hidden at rest
// (the paws swap out for them mid-leap). Body parts also hold a hidden `.xr` x-ray layer for the lightning strike.
export default {
  id: 'beonjjeok', ko: '번쩍', en: 'Beonjjeok', tagline: '쳇바퀴 발전소',
  type: '햄스터',
  color: '#F2A54A', colorAlt: '#B6FF4D',
  bg: ['#1597C4', '#0B1F3D'],
  winMs: 2400, hitAt: 1.50, excerptFrom: 1.20,
  quote: { win: '찌릿찌릿! 100% 충전 완료!', winEn: 'Bzzt! 100% charged!', lose: '배터리… 방전…' },
  anchors: { head: [60, 22], center: [60, 66], feet: [60, 110], sky: [60, -15], rod: [65, -8], wheel: [60, 112] },
  cues: [
    { t: 0.20, sfx: 'POP' },                                   // the wheel pops in
    { t: 0.36, sfx: 'WHIRR' },                                 // running: the dynamo spins up…
    { t: 0.74, sfx: 'WHIRR' },                                 // …and up
    { t: 0.86, fx: 'bolts', at: 'wheel' },                     // sparks fly off the tread
    { t: 1.13, sfx: 'SWISH' },                                 // leaps out of the wheel
    { t: 1.30, sfx: 'ZAP', fx: 'sparkle', at: 'rod', shake: 90 },   // lightning hits the cowlick (x-ray!)
    { t: 1.50, fx: 'bolts', at: 'head', shake: 160 },          // HIT: lands, static afro POOF, "100%"
    { t: 1.80, sfx: 'CRACKLE' },                               // flex 1
    { t: 2.04, sfx: 'CRACKLE' },                               // flex 2
  ],
  turnSfx: 'CRACKLE',
  jingle: { at: 1.50, voices: [
    { wave: 'square', gain: 0.06, lowpass: 3600, notes: 'C6:45 E6:45 G6:45 C7~:260' },
    { wave: 'triangle', gain: 0.09, notes: 'C4:45 E4:45 G4:45 C5:260' },
  ] },
  portrait: '21 9 78 78',
  svg: `<svg class="ch ch-beonjjeok" viewBox="0 0 120 120" role="img" aria-label="번쩍">
<g transform="translate(60 67.5)"><g class="p wheel"><g transform="translate(-60 -67.5)">
<circle class="wh-disc" cx="60" cy="67.5" r="45.75"/>
<path class="wh-spoke-k" d="M66.06 71L96.89 88.8M60 74.5L60 110.1M53.94 71L23.11 88.8M53.94 64L23.11 46.2M60 60.5L60 24.9M66.06 64L96.89 46.2"/>
<path class="wh-spoke" d="M66.06 71L96.89 88.8M60 74.5L60 110.1M53.94 71L23.11 88.8M53.94 64L23.11 46.2M60 60.5L60 24.9M66.06 64L96.89 46.2"/>
<circle class="wh-band" cx="60" cy="67.5" r="45.75"/>
<path class="wh-rung" d="M103.23 73.19L107.49 73.75M94.59 94.04L98 96.66M76.68 107.78L78.33 111.75M54.31 110.73L53.75 114.99M33.46 102.09L30.84 105.5M19.72 84.18L15.75 85.83M16.77 61.81L12.51 61.25M25.41 40.96L22 38.34M43.32 27.22L41.67 23.25M65.69 24.27L66.25 20.01M86.54 32.91L89.16 29.5M100.28 50.82L104.25 49.17"/>
<circle class="wh-ring" cx="60" cy="67.5" r="48.5"/>
<circle class="wh-ring in" cx="60" cy="67.5" r="43"/>
<path class="wh-blur" d="M20.38 44.63A45.75 45.75 0 0 1 71.84 23.31M102.99 51.85A45.75 45.75 0 0 1 99.62 90.38M56.01 113.08A45.75 45.75 0 0 1 20.38 90.38"/>
</g></g></g>
<g transform="translate(60 66)"><g class="p frizz"><g transform="translate(-60 -66)">
<path class="o fur" d="M60 27A10.37 10.37 0 0 1 76.47 29A10.34 10.34 0 0 1 88.61 40.24A10.24 10.24 0 0 1 98.04 53.64A10.28 10.28 0 0 1 98.79 70.08A10.47 10.47 0 0 1 95.51 86.5A10.44 10.44 0 0 1 82.63 97.15A10.15 10.15 0 0 1 68.21 104.64A10.41 10.41 0 0 1 51.58 105.61A10.37 10.37 0 0 1 37.08 97.55A10.08 10.08 0 0 1 26.66 85.25A10.34 10.34 0 0 1 19.72 70.23A10.41 10.41 0 0 1 22.43 53.79A10.21 10.21 0 0 1 31.02 39.9A10.28 10.28 0 0 1 43.73 29.46A10.28 10.28 0 0 1 60 27Z"/>
<path class="fz-zap" d="M24.5 61l3.5 2.4-2.6 1.4 3.6 2.6M95.5 58l-3.4 2.6 2.7 1.2-3.4 2.8M33 35.5l2.6 3.2-2.8.6 2.4 3.4M87 33.5l-2.4 3.4 2.8.4-2.2 3.6"/>
</g></g></g>
<g transform="translate(47 100)"><g class="p legL"><g transform="translate(-47 -100)">
<ellipse class="o paw" cx="47" cy="106" rx="7.5" ry="4.6"/>
<path class="toe" d="M42.6 108.6v-2.2M46.2 109.3v-2.4"/>
<g class="xr"><ellipse class="o xr-d" cx="47" cy="106" rx="7.5" ry="4.6"/><path class="bone" d="M43 107.2h8M42.6 104.6l2 2.2M42.6 109.6l2-2.2"/></g>
</g></g></g>
<g transform="translate(73 100)"><g class="p legR"><g transform="translate(-73 -100)">
<ellipse class="o paw" cx="73" cy="106" rx="7.5" ry="4.6"/>
<path class="toe" d="M77.4 108.6v-2.2M73.8 109.3v-2.4"/>
<g class="xr"><ellipse class="o xr-d" cx="73" cy="106" rx="7.5" ry="4.6"/><path class="bone" d="M69 107.2h8M77.4 104.6l-2 2.2M77.4 109.6l-2-2.2"/></g>
</g></g></g>
<g transform="translate(60 104)"><g class="p ball"><g transform="translate(-60 -104)">
<circle class="o fur" cx="33" cy="43" r="8.5"/><circle class="ear-in" cx="33" cy="43" r="4.2"/>
<circle class="o fur" cx="87" cy="43" r="8.5"/><circle class="ear-in" cx="87" cy="43" r="4.2"/>
<ellipse class="o fur" cx="60" cy="70" rx="35" ry="34"/>
<path class="fur-sh" d="M79.16 43.46A33.4 32.4 0 0 1 93.07 74.51Q90.4 57.6 79.16 43.46Z"/>
<path class="cream" d="M30 78Q30 60 44 58Q52 64 60 64Q68 64 76 58Q90 60 90 78Q90 100.5 60 101.5Q30 100.5 30 78Z"/>
<g transform="translate(59 39)"><g class="p cowlick"><g transform="translate(-59 -39)">
<path class="o2 bolt" d="M55 40.5L60.6 26.5L54.6 28.2L64.8 10.5L63.4 23L69.8 21.2L62.8 40.5Z"/>
<path class="bolt-glow" d="M58.6 35.5L62.2 26.2M60.4 23.6L63 16.8"/>
<path class="o2 bolt-off" d="M55 40.5L60.6 26.5L54.6 28.2L64.8 10.5L63.4 23L69.8 21.2L62.8 40.5Z"/>
</g></g></g>
<path class="strap-k" d="M27 55Q60 39 93 55"/>
<path class="strap" d="M27 55Q60 39 93 55"/>
<circle class="o2 frame" cx="47" cy="49" r="7.6"/><circle class="o2 lens" cx="47" cy="49" r="5"/>
<circle class="o2 frame" cx="73" cy="49" r="7.6"/><circle class="o2 lens" cx="73" cy="49" r="5"/>
<path class="glint" d="M44.4 48Q45 45.6 47.4 45.3M70.4 48Q71 45.6 73.4 45.3"/>
<ellipse class="cheek" cx="37" cy="75" rx="5" ry="2.8"/><ellipse class="cheek" cx="83" cy="75" rx="5" ry="2.8"/>
<path class="whisk" d="M36.4 70.6L29 69M36.6 73.4L29.4 74.4M83.6 70.6L91 69M83.4 73.4L90.6 74.4"/>
<ellipse class="nose sc" cx="60" cy="70.6" rx="2.9" ry="2"/>
<g class="face-a">
<ellipse class="eye ink" cx="47" cy="65" rx="3.6" ry="4.2"/><ellipse class="eye ink" cx="73" cy="65" rx="3.6" ry="4.2"/>
<circle class="hl" cx="45.9" cy="63.4" r="1.3"/><circle class="hl" cx="71.9" cy="63.4" r="1.3"/>
<path class="ln thin" d="M55.6 73.2Q57.8 75.8 60 73.2Q62.2 75.8 64.4 73.2"/>
<path class="tooth" d="M57.6 74.6H62.4V78.2Q62.4 79 61.6 79H58.4Q57.6 79 57.6 78.2Z"/><path class="tooth-ln" d="M60 74.8V78.8"/>
</g>
<g class="face-run">
<path class="ln wide" d="M43.2 61.6L50 65.2L43.2 68.6M76.8 61.6L70 65.2L76.8 68.6"/>
<path class="o2 mouth" d="M55.2 73Q60 81.6 64.8 73Z"/>
<path class="tooth" d="M57.7 73.2H62.3V76Q62.3 76.7 61.6 76.7H58.4Q57.7 76.7 57.7 76Z"/><path class="tooth-ln" d="M60 73.4V76.5"/>
</g>
<path class="sweat" d="M87.4 58.6Q91 63.8 89.4 65.8Q87.2 67.8 85.4 65.6Q84.4 63.2 87.4 58.6Z"/>
<g class="face-b">
<path class="ln wide" d="M42.4 66.6Q47 60.6 51.6 66.6M68.4 66.6Q73 60.6 77.6 66.6"/>
<path class="o2 mouth" d="M51.8 72.6Q60 87.4 68.2 72.6Z"/>
<path class="tongue" d="M55.4 80.6Q60 84 64.6 80.6Q60 78.2 55.4 80.6Z"/>
<path class="tooth" d="M57.3 72.9H62.7V77Q62.7 77.8 61.9 77.8H58.1Q57.3 77.8 57.3 77Z"/><path class="tooth-ln" d="M60 73.1V77.6"/>
</g>
<g class="face-c">
<path class="ln spiral" d="M47.55 65L47.62 65.25L47.56 65.55L47.36 65.84L47.02 66.03L46.59 66.07L46.13 65.92L45.74 65.57L45.5 65.06L45.48 64.44L45.71 63.83L46.2 63.32L46.89 63.02L47.69 63.02L48.46 63.33L49.09 63.96L49.45 64.82L49.45 65.8L49.06 66.74L48.3 67.5L47.27 67.92L46.11 67.92L45 67.46L44.11 66.57L43.61 65.38L43.61 64.03L44.13 62.75L45.14 61.73L46.5 61.15L48.02 61.13L49.49 61.71L50.65 62.83L51.31 64.36L51.35 66.07L50.72 67.7M73.55 65L73.62 64.75L73.56 64.45L73.36 64.16L73.02 63.97L72.59 63.93L72.13 64.08L71.74 64.43L71.5 64.94L71.48 65.56L71.71 66.17L72.2 66.68L72.89 66.98L73.69 66.98L74.46 66.67L75.09 66.04L75.45 65.18L75.45 64.2L75.06 63.26L74.3 62.5L73.27 62.08L72.11 62.08L71 62.54L70.11 63.43L69.61 64.62L69.61 65.97L70.13 67.25L71.14 68.27L72.5 68.85L74.02 68.87L75.49 68.29L76.65 67.17L77.31 65.64L77.35 63.93L76.72 62.3"/>
<path class="tooth" d="M57.7 73.2H62.3V76.4Q62.3 77.2 61.5 77.2H58.5Q57.7 77.2 57.7 76.4Z"/><path class="tooth-ln" d="M60 73.4V77"/>
<path class="ln thin" d="M54.6 79.6q1.35-1.9 2.7 0t2.7 0 2.7 0 2.7 0"/>
</g>
<g class="xr">
<circle class="o xr-d" cx="33" cy="43" r="8.5"/><circle class="o xr-d" cx="87" cy="43" r="8.5"/>
<ellipse class="o xr-d" cx="60" cy="70" rx="35" ry="34"/>
<path class="bone-f" d="M45.5 58.5C45.5 47 52 42 60 42S74.5 47 74.5 58.5C74.5 64 71.5 67 68 68V71.5H52V68C48.5 67 45.5 64 45.5 58.5Z"/>
<ellipse class="xr-d" cx="53.6" cy="57" rx="4.2" ry="4.8"/><ellipse class="xr-d" cx="66.4" cy="57" rx="4.2" ry="4.8"/>
<path class="xr-d" d="M58.4 63.4H61.6L60 66.2Z"/>
<path class="bone-f" d="M57.3 71H62.7V76.2H57.3Z"/>
<path class="bone" d="M60 79V99M60 82Q51 81 46.5 86M60 82Q69 81 73.5 86M60 88Q52 87.5 48.5 91.5M60 88Q68 87.5 71.5 91.5M60 94Q54 94 51.5 97M60 94Q66 94 68.5 97"/>
</g>
</g></g></g>
<g transform="translate(48 92)"><g class="p pawL"><g transform="translate(-48 -92)">
<ellipse class="o2 seed" cx="60" cy="88.4" rx="4.3" ry="6"/><path class="seed-ln" d="M58.3 84.2Q57.4 88.4 58.4 92.6M61.7 84.2Q62.6 88.4 61.6 92.6"/>
<ellipse class="o2 paw" cx="52.8" cy="89.4" rx="4.6" ry="3.8"/><path class="toe" d="M55.8 88l1.6-.5M56 90.6l1.7.3"/>
</g></g></g>
<g transform="translate(72 92)"><g class="p pawR"><g transform="translate(-72 -92)">
<ellipse class="o2 paw" cx="67.2" cy="89.4" rx="4.6" ry="3.8"/><path class="toe" d="M64.2 88l-1.6-.5M64 90.6l-1.7.3"/>
</g></g></g>
<g transform="translate(31 80)"><g class="p armL"><g transform="translate(-31 -80)">
<ellipse class="o2 cream" cx="25.6" cy="85.2" rx="3.4" ry="4.4"/>
<path class="o2 cream" d="M26.96 78.85L23.96 89.35A4.2 4.2 0 0 0 32.04 91.65L35.04 81.15A4.2 4.2 0 0 0 26.96 78.85Z"/>
<g class="xr"><path class="o2 xr-d" d="M26.96 78.85L23.96 89.35A4.2 4.2 0 0 0 32.04 91.65L35.04 81.15A4.2 4.2 0 0 0 26.96 78.85Z"/><path class="bone" d="M30.4 81.8L28.6 88.6"/></g>
<g transform="translate(28 90.5)"><g class="p foreL"><g transform="translate(-28 -90.5)">
<path class="o2 cream" d="M24.02 90.08L23.02 99.58A4 4 0 0 0 30.98 100.42L31.98 90.92A4 4 0 0 0 24.02 90.08Z"/>
<ellipse class="o2 paw" cx="27" cy="100.6" rx="4.5" ry="4"/>
<g class="xr"><path class="o2 xr-d" d="M24.02 90.08L23.02 99.58A4 4 0 0 0 30.98 100.42L31.98 90.92A4 4 0 0 0 24.02 90.08Z"/><ellipse class="o2 xr-d" cx="27" cy="100.6" rx="4.5" ry="4"/><path class="bone" d="M27.8 92.4L27.2 99.2M25 102.2l-.6 1.8M27 102.8v2M29 102.2l.6 1.8"/></g>
</g></g></g>
</g></g></g>
<g transform="translate(89 80)"><g class="p armR"><g transform="translate(-89 -80)">
<ellipse class="o2 cream" cx="94.4" cy="85.2" rx="3.4" ry="4.4"/>
<path class="o2 cream" d="M84.96 81.15L87.96 91.65A4.2 4.2 0 0 0 96.04 89.35L93.04 78.85A4.2 4.2 0 0 0 84.96 81.15Z"/>
<g class="xr"><path class="o2 xr-d" d="M84.96 81.15L87.96 91.65A4.2 4.2 0 0 0 96.04 89.35L93.04 78.85A4.2 4.2 0 0 0 84.96 81.15Z"/><path class="bone" d="M89.6 81.8L91.4 88.6"/></g>
<g transform="translate(92 90.5)"><g class="p foreR"><g transform="translate(-92 -90.5)">
<path class="o2 cream" d="M88.02 90.92L89.02 100.42A4 4 0 0 0 96.98 99.58L95.98 90.08A4 4 0 0 0 88.02 90.92Z"/>
<ellipse class="o2 paw" cx="93" cy="100.6" rx="4.5" ry="4"/>
<g class="xr"><path class="o2 xr-d" d="M88.02 90.92L89.02 100.42A4 4 0 0 0 96.98 99.58L95.98 90.08A4 4 0 0 0 88.02 90.92Z"/><ellipse class="o2 xr-d" cx="93" cy="100.6" rx="4.5" ry="4"/><path class="bone" d="M92.2 92.4L92.8 99.2M95 102.2l.6 1.8M93 102.8v2M91 102.2l-.6 1.8"/></g>
</g></g></g>
</g></g></g>
</svg>`,
  fx: `<svg class="fx" viewBox="0 0 120 120" aria-hidden="true">
<g class="fx-tz">
<g class="tz1"><path class="zk" d="M47 13l4 3.2-3 1.4 4 3.6"/><path class="zc" d="M47 13l4 3.2-3 1.4 4 3.6"/></g>
<g class="tz2"><path class="zk" d="M78.5 4.5l-3.6 3.6 3 .9-3.4 4"/><path class="zc" d="M78.5 4.5l-3.6 3.6 3 .9-3.4 4"/></g>
<g class="tz3"><path class="zk" d="M80 22l-4.4 1.8 2.4 2.2-4.6 1.4"/><path class="zc" d="M80 22l-4.4 1.8 2.4 2.2-4.6 1.4"/></g>
</g>
<g class="fx-bolt">
<path class="lb-k" d="M53 -40L60.4 -27.6L52.6 -23.4L64.6 -10.6L57.8 -8.2L65.6 -1"/>
<path class="lb-c" d="M53 -40L60.4 -27.6L52.6 -23.4L64.6 -10.6L57.8 -8.2L65.6 -1"/>
<path class="lb-w" d="M53 -40L60.4 -27.6L52.6 -23.4L64.6 -10.6L57.8 -8.2L65.6 -1"/>
<path class="lb-sp" d="M58.6 -1.6L54.4 1.2M73 -5.4L77.4 -7.2M71.4 1L76 3.2M70.4 -11.6L74 -14.6"/>
</g>
<g transform="translate(60 110)"><g class="p fx-ring">
<ellipse class="ring-k" cx="0" cy="0" rx="34" ry="6.5"/><ellipse class="ring-c" cx="0" cy="0" rx="34" ry="6.5"/>
</g></g>
<g class="fx-crack">
<g class="ck1"><path class="zk" d="M11 44l5 2.6-3.4 2 5.2 3"/><path class="zc" d="M11 44l5 2.6-3.4 2 5.2 3"/></g>
<g class="ck2"><path class="zk" d="M110 36l-5 2.8 3.4 1.8-5 3.4"/><path class="zc" d="M110 36l-5 2.8 3.4 1.8-5 3.4"/></g>
<g class="ck3"><path class="zk" d="M107.5 86l-5.2-1.4 2.4 3-5.6-.4"/><path class="zc" d="M107.5 86l-5.2-1.4 2.4 3-5.6-.4"/></g>
<g class="ck4"><path class="zk" d="M12.5 86l5.2-1.4-2.4 3 5.6-.4"/><path class="zc" d="M12.5 86l5.2-1.4-2.4 3 5.6-.4"/></g>
</g>
<g transform="translate(100 13)"><g class="p fx-batt">
<rect class="bt-body" x="-12.5" y="-7.5" width="25" height="15" rx="3.6"/>
<rect class="bt-nub" x="12" y="-3.4" width="3.4" height="6.8" rx="1.2"/>
<g transform="translate(-9.8 0)"><g class="p bt-lvl"><rect class="bt-fill" x="0" y="-4.8" width="19.6" height="9.6" rx="1.6"/></g></g>
<path class="bt-seg" d="M-4.9 -4.8V4.8M0 -4.8V4.8M4.9 -4.8V4.8"/>
</g></g>
<g transform="translate(99 34)"><g class="p fx-full">
<rect class="full-bg" x="-16" y="-8" width="32" height="16" rx="8"/>
<text class="full-t" x="0" y="4.3" text-anchor="middle">100%</text>
</g></g>
<g transform="translate(88 20)"><g class="p fx-low">
<rect class="bt-body" x="-12.5" y="-7.5" width="25" height="15" rx="3.6"/>
<rect class="bt-nub" x="12" y="-3.4" width="3.4" height="6.8" rx="1.2"/>
<rect class="low-bar" x="-9.8" y="-4.8" width="4.6" height="9.6" rx="1.4"/>
</g></g>
<g transform="translate(64 13)"><g class="p fx-smoke">
<path class="smk" d="M0 0C-4 -3 4 -6 0 -9S-3 -15 1 -17"/><circle class="smk-c" cx="2.6" cy="-19.6" r="2.4"/><circle class="smk-c" cx="-2.2" cy="-13" r="1.7"/>
</g></g>
<g class="fx-dizzy" transform="translate(42 29)">
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
</g>
</svg>`,
};
