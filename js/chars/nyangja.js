// js/chars/nyangja.js — 냥자 Nyangja, the ninja cat (docs/SPEC.md §8.5, docs/research/characters.md §4.2).
// Art + timeline data only. All motion lives in css/chars/nyangja.css; js/fighter.js builds the stage
// around `svg` + `fx`.
//
// Victory "연막 → 등장 → 인(印) 포즈" (2.4 s): shows a smoke bomb, slams it down › POOF 0.24 (the cat
// vanishes in the cloud) › two yellow eyes peek out of the smoke and throw two shuriken (0.50, 0.70) ›
// the smoke clears: nobody there › drops out of the sky with a spin (0.90) › lands 1.12 › rises into
// the hand sign, eyes shut in concentration › HIT 1.60: eyes snap open (wink + eye glint TING), a full
// moon pops up behind it, petal flurry › smug nod › loop: breathes in the pose, ribbons flutter.
//
// Parts (joint sandwiches, ≤ 14): moon (60,52) · tail (74,98) · scarf tail (46,74) · legL legR
// (51,100)/(69,100) · armL (45,77) · head (60,72) › earL (44,30) earR (76,30) ribbon (86,35) glint
// (75.5,45.5) · armR (75,77) › shuri (78,91.5). Z-order: armL tucks under the scarf wrap; armR is drawn
// over the head and the scarf (the hand sign sits in front of the chest), and a copy of the scarf's
// right end (.scarf-end) is redrawn on top so both shoulders still read as tucked under the scarf.

const STAR4 = 'M0-7.5L1.7-1.7L7.5 0L1.7 1.7L0 7.5L-1.7 1.7L-7.5 0L-1.7-1.7Z';      // eye glint
const SHURI = 'M0-9.5L2.6-2.6L9.5 0L2.6 2.6L0 9.5L-2.6 2.6L-9.5 0L-2.6-2.6Z';      // ninja star
const DIZZY = 'M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z';
// smoke-bomb cloud: [cx, cy, r] puffs, drawn twice (ink underlay, then fill) so only the outer edge is inked
const PUFFS = [[60, 65, 21], [40, 75, 17], [80, 75, 17], [30, 90, 13], [90, 90, 13], [47, 95, 15],
  [73, 95, 15], [60, 97, 14], [48, 56, 13], [72, 56, 13], [60, 47, 12]];
const puffs = cls => PUFFS.map(([x, y, r]) => `<circle class="${cls}" cx="${x}" cy="${y}" r="${r}"/>`).join('');

export default {
  id: 'nyangja', ko: '냥자', en: 'Nyangja', tagline: '그림자 닌자',
  type: '고양이',
  color: '#5EE39B', colorAlt: '#FF5C8A',
  bg: ['#2A7F7A', '#0D2B30'],
  winMs: 2400, hitAt: 1.60, excerptFrom: 1.00,
  quote: { win: '그림자처럼, 다섯 수 만에 끝이다냥.', winEn: "Like a shadow — five moves and it's over, meow.", lose: '…수련이 부족했다냥.' },
  // viewBox coords of the untransformed stage (particles.anchor)
  anchors: { head: [60, 10], center: [60, 64], feet: [60, 108], sky: [60, -15] },
  cues: [
    { t: 0.24, sfx: 'POP', fx: 'smoke', at: [60, 92], shake: 90 },   // smoke bomb: POOF
    { t: 0.50, sfx: 'SWISH' },                                        // shuriken 1, out of the smoke
    { t: 0.70, sfx: 'SWISH' },                                        // shuriken 2
    { t: 0.90, sfx: 'WHOOSH' },                                       // drops out of the sky
    { t: 1.12, sfx: 'PUNCH', fx: 'dust', at: 'feet', shake: 70 },     // lands
    { t: 1.60, sfx: 'TING', fx: 'petals', at: [112, 16], shake: 110 }, // HIT: moon + eye glint, petal flurry
    { t: 1.70, fx: 'petals', at: [118, 52] },
    { t: 1.84, fx: 'petals', at: [104, -8] },
  ],
  turnSfx: 'SWISH',
  jingle: { at: 1.60, voices: [
    { wave: 'triangle', gain: 0.09, notes: 'A5:70 E5:70 D6:70 -:70 A6~:320' },
    { wave: 'pulse25', gain: 0.045, lowpass: 1400, notes: 'A3:140 -:70 E3:70 A3~:320' },
    { drums: 'K:140 -:70 K:70 S:320' },
  ] },
  portrait: '24 6 72 72',
  svg: `<svg class="ch ch-nyangja" viewBox="0 0 120 120" role="img" aria-label="냥자">
<g transform="translate(60 52)"><g class="p moon"><g transform="translate(-60 -52)">
<circle class="o2 moon-disc" cx="60" cy="52" r="45"/>
<circle class="moon-sh" cx="24" cy="58" r="5"/><circle class="moon-sh" cx="30" cy="40" r="2.6"/>
<circle class="moon-sh" cx="97" cy="66" r="3.4"/><circle class="moon-sh" cx="88" cy="23" r="2.4"/>
</g></g></g>
<g transform="translate(74 98)"><g class="p tail"><g transform="translate(-74 -98)">
<path class="tube-ink" d="M68 99Q95 101 93 80Q91.5 70 100 62"/>
<path class="tube fur-s" d="M68 99Q95 101 93 80Q91.5 70 100 62"/>
<path class="tube light-s" d="M97.4 65.6L100 62"/>
</g></g></g>
<g transform="translate(46 74)"><g class="p scarf"><g transform="translate(-46 -74)">
<path class="o scarf-c" d="M48 73Q34 70 18 77Q27 80 23 88Q37 81 48 80Z"/>
<path class="scarf-sh" d="M47 78Q37 79.5 25.5 86Q29 81.5 26 79.5Q37 77.5 47 76Z"/>
</g></g></g>
<g transform="translate(51 100)"><g class="p legL"><g transform="translate(-51 -100)">
<path class="tube-ink" d="M51 97V103"/><path class="tube fur-s" d="M51 97V103"/>
<ellipse class="o light" cx="50.5" cy="106" rx="7" ry="5"/>
<path class="toe" d="M47.6 108.8v-2.4M51.2 109.2v-2.6"/>
</g></g></g>
<g transform="translate(69 100)"><g class="p legR"><g transform="translate(-69 -100)">
<path class="tube-ink" d="M69 97V103"/><path class="tube fur-s" d="M69 97V103"/>
<ellipse class="o light" cx="69.5" cy="106" rx="7" ry="5"/>
<path class="toe" d="M68.8 109.2v-2.6M72.4 108.8v-2.4"/>
</g></g></g>
<g class="body">
<path class="o fur" d="M45 85Q45 72 60 72Q75 72 75 85V92Q75 102 60 102Q45 102 45 92Z"/>
<path class="fur-sh" d="M70 77Q73.5 80 73.5 86V92Q73.5 100.5 62 100.5Q70.5 97.5 70.5 90V84Q70.5 80 70 77Z"/>
<ellipse class="light" cx="60" cy="93" rx="7.5" ry="6.5"/>
</g>
<g transform="translate(45 77)"><g class="p armL"><g transform="translate(-45 -77)">
<path class="tube-ink arm" d="M45 78L42.5 89"/><path class="tube arm fur-s" d="M45 78L42.5 89"/>
<circle class="o2 light" cx="42" cy="91.5" r="4.6"/>
</g></g></g>
<g transform="translate(60 72)"><g class="p head"><g transform="translate(-60 -72)">
<g transform="translate(44 30)"><g class="p earL"><g transform="translate(-44 -30)">
<path class="o fur" d="M32.5 37L36.5 8.5L56 26.5Z"/>
<path class="ear-in" d="M38.4 29L40 15.6L49.6 25.6Z"/>
</g></g></g>
<g transform="translate(76 30)"><g class="p earR"><g transform="translate(-76 -30)">
<path class="o fur" d="M87.5 37L83.5 8.5L64 26.5Z"/>
<path class="ear-in" d="M81.6 29L80 15.6L70.4 25.6Z"/>
</g></g></g>
<path class="o fur" d="M34 49L26 56L33 58L27.5 63.5L37 64.5Z"/>
<path class="o fur" d="M86 49L94 56L87 58L92.5 63.5L83 64.5Z"/>
<ellipse class="o fur" cx="60" cy="48" rx="29" ry="24"/>
<path class="fur-sh" d="M84 38Q89 46 87.5 54Q85 64 74 69.5Q70 71 66 71.6Q79 64 82.5 54Q85 46 84 38Z"/>
<g transform="translate(86 35)"><g class="p ribbon"><g transform="translate(-86 -35)">
<path class="o2 scarf-c" d="M86 33.5Q98 23 110 26Q102.5 30.5 105 36.5Q96.5 32.5 87 37Z"/>
<path class="o2 scarf-c" d="M86 37Q96.5 37.5 104 46Q96.5 45 94.5 50.5Q91.5 42.5 85 39.5Z"/>
</g></g></g>
<path class="o2 scarf-c" d="M32.4 33.6Q60 22.2 87.6 33.6Q89.2 37 88.2 40.6Q60 30.2 31.8 40.6Q30.8 37 32.4 33.6Z"/>
<path class="band-sh" d="M33 39.4Q60 29.6 87 39.4Q87.6 38.2 87.6 37Q60 27.4 32.4 37Q32.4 38.2 33 39.4Z"/>
<circle class="o2 scarf-sh" cx="86.2" cy="35.6" r="3.8"/>
<ellipse class="muzzle" cx="60" cy="61.5" rx="8.5" ry="5.8"/>
<path class="nose" d="M57.4 58.1H62.6L60 60.9Z"/>
<g class="face-a">
<g class="eye">
<ellipse class="o2 iris" cx="48" cy="50" rx="6" ry="6.3"/>
<ellipse class="ink" cx="48.6" cy="51.2" rx="1.8" ry="4.3"/>
<circle class="hl" cx="46.2" cy="50.4" r="1.3"/>
<path class="fur" d="M40.4 40.6H55.8V48.8Q48 45.6 40.4 47.4Z"/>
<path class="ln lid" d="M41.2 47.3Q48 45.5 55 48.7"/>
</g>
<g class="eye">
<ellipse class="o2 iris" cx="72" cy="50" rx="6" ry="6.3"/>
<ellipse class="ink" cx="71.4" cy="51.2" rx="1.8" ry="4.3"/>
<circle class="hl" cx="70.2" cy="50.4" r="1.3"/>
<path class="fur" d="M79.6 40.6H64.2V48.8Q72 45.6 79.6 47.4Z"/>
<path class="ln lid" d="M78.8 47.3Q72 45.5 65 48.7"/>
</g>
<path class="ln thin" d="M56 62.6Q58 65 60 62.6Q62 65 64 62.6"/>
</g>
<g class="face-b">
<path class="ln wink" d="M42.6 51.4Q48 46 53.4 51.4"/>
<ellipse class="o2 iris" cx="72" cy="50" rx="6" ry="6.3"/>
<ellipse class="ink" cx="71.2" cy="50.6" rx="2" ry="4.8"/>
<circle class="hl" cx="69.9" cy="47.9" r="1.7"/>
<path class="fur" d="M79.4 41.5H64.4V46.4Q72 43.4 79.4 45.6Z"/>
<path class="ln lid" d="M78.6 45.7Q72 43.2 65.2 46.4"/>
<ellipse class="blush" cx="41" cy="59.4" rx="4.6" ry="2.6"/><ellipse class="blush" cx="79" cy="59.4" rx="4.6" ry="2.6"/>
<path class="o2 mouth" d="M55.4 62.4Q57.8 65.4 60 62.8Q62.6 65.6 65.4 61.6Q64.4 67.8 60.4 68Q56.6 67.8 55.4 62.4Z"/>
<path class="fang" d="M61.6 64.4L62.4 66.6L63.6 64.2Z"/>
</g>
<g class="face-c">
<path class="ln" d="M43.4 46.4L50.8 50.4L43.4 54.4M76.6 46.4L69.2 50.4L76.6 54.4"/>
<path class="ln thin" d="M55.2 64.6q1.2-1.8 2.4 0t2.4 0 2.4 0 2.4 0"/>
</g>
<path class="whisker" d="M42.5 58.5L30 56.2M42.5 62L30.5 63.4M77.5 58.5L90 56.2M77.5 62L89.5 63.4"/>
<g transform="translate(75.5 45.5)"><g class="p glint">
<path class="glint-s" d="${STAR4}"/>
</g></g>
</g></g></g>
<g class="scarf-wrap">
<path class="o scarf-c" d="M41 71Q60 80 79 71Q81 78 77 80.5Q60 88 43 80.5Q39 78 41 71Z"/>
<path class="scarf-sh" d="M43.6 80.2Q60 87.4 76.4 80.2Q78.2 78.8 78.6 76.6Q60 85.4 41.4 76.6Q41.8 78.8 43.6 80.2Z"/>
<path class="o2 scarf-sh" d="M42.4 74.2Q47.2 72.4 50 76Q49 81 44.2 81.8Q40.6 78.6 42.4 74.2Z"/>
</g>
<g transform="translate(75 77)"><g class="p armR"><g transform="translate(-75 -77)">
<path class="tube-ink arm" d="M75 78L77.5 89"/><path class="tube arm fur-s" d="M75 78L77.5 89"/>
<g class="bomb">
<path class="fuse" d="M81.6 101.4Q83.6 104.6 87 104"/>
<circle class="o2 bomb-b" cx="78" cy="97.4" r="6.2"/>
<path class="bomb-band" d="M72.4 95.6Q78 98.6 83.6 95.6"/>
<circle class="bomb-hl" cx="75.4" cy="99.6" r="1.5"/>
<path class="spark" d="M87.4 100.6L88.2 102.9L90.6 103.2L88.6 104.5L89.2 106.9L87.3 105.4L85.2 106.6L85.9 104.3L84 102.8L86.5 102.8Z"/>
</g>
<g class="sign">
<path class="tube-ink fing" d="M76.1 88.1L71 84.1M74.2 90.5L69.1 86.5"/>
<path class="tube fing light-s" d="M76.1 88.1L71 84.1M74.2 90.5L69.1 86.5"/>
</g>
<circle class="o2 light" cx="78" cy="91.5" r="4.6"/>
<g transform="translate(78 91.5)"><g class="p shuri">
<path class="o2 shu" d="${SHURI}"/><circle class="shu-hole" r="1.7"/>
</g></g>
</g></g></g>
<g class="scarf-end">
<path class="scarf-c" d="M68 74.7Q73.5 73.6 79 71Q81 78 77 80.5Q72.5 82.5 68 83.4Z"/>
<path class="scarf-sh" d="M68 82.9Q72.2 82 76.4 80.2Q78.2 78.8 78.6 76.6Q73.3 79.1 68 80.2Z"/>
<path class="edge" d="M68 74.7Q73.5 73.6 79 71Q81 78 77 80.5Q72.5 82.5 68 83.4"/>
</g>
</svg>`,
  fx: `<svg class="fx" viewBox="0 0 120 120" aria-hidden="true">
<g transform="translate(60 106)"><g class="p fx-smoke"><g transform="translate(-60 -106)">
${puffs('puff-ink')}
${puffs('puff')}
<circle class="puff-sh" cx="47" cy="99" r="9"/><circle class="puff-sh" cx="74" cy="99" r="9"/>
<circle class="puff-sh" cx="31" cy="94" r="7"/><circle class="puff-sh" cx="89" cy="94" r="7"/>
</g></g></g>
<g transform="translate(60 70)"><g class="p fx-peek"><g transform="translate(-60 -70)">
<ellipse class="peek-eye" cx="51" cy="70" rx="6" ry="6.4"/>
<ellipse class="peek-eye" cx="69" cy="70" rx="6" ry="6.4"/>
<g transform="translate(60 70)"><g class="p fx-pupils"><g transform="translate(-60 -70)">
<ellipse class="peek-pupil" cx="51" cy="70.8" rx="1.8" ry="4.6"/>
<ellipse class="peek-pupil" cx="69" cy="70.8" rx="1.8" ry="4.6"/>
</g></g></g>
<path class="peek-lid" d="M44.4 66.2Q51 63.6 57.6 67M75.6 66.2Q69 63.6 62.4 67"/>
</g></g></g>
<g transform="translate(68 60)"><g class="p fx-shu1">
<path class="shu-trail" d="M-10-2.2L-28 1.6M-9 4.2L-21 6.8"/>
<g transform="translate(0 0)"><g class="p spin"><path class="shu" d="${SHURI}"/><circle class="shu-hole" r="1.8"/></g></g>
</g></g>
<g transform="translate(52 56)"><g class="p fx-shu2">
<path class="shu-trail" d="M10-2.2L28 0.4M9 4.2L21 5.9"/>
<g transform="translate(0 0)"><g class="p spin"><path class="shu" d="${SHURI}"/><circle class="shu-hole" r="1.8"/></g></g>
</g></g>
<g transform="translate(66 104)"><g class="p fx-fizzle"><g transform="translate(-66 -104)">
<circle class="puff-ink" cx="62" cy="103" r="5"/><circle class="puff-ink" cx="70" cy="101" r="4"/><circle class="puff-ink" cx="66" cy="96" r="3.4"/>
<circle class="puff" cx="62" cy="103" r="5"/><circle class="puff" cx="70" cy="101" r="4"/><circle class="puff" cx="66" cy="96" r="3.4"/>
</g></g></g>
<g class="fx-dizzy" transform="translate(60 14)">
<path class="star" d="${DIZZY}"/>
<path class="star" d="${DIZZY}"/>
<path class="star" d="${DIZZY}"/>
</g>
</svg>`,
};
