// js/chars/bigom.js — 비곰 Bigom, the b-boy bear (docs/SPEC.md §8.5, docs/research/characters.md §4.3 & §8)
// Art + rig only. Motion lives in css/chars/bigom.css; js/fighter.js builds the stage around `svg` + `fx`.
export default {
  id: 'bigom', ko: '비곰', en: 'Bigom', tagline: '판 위의 비보이',
  type: '곰',
  color: '#2F6BFF', colorAlt: '#FF4F8B',
  bg: ['#1B3A9E', '#0D1A4F'],
  winMs: 2400, hitAt: 1.56, excerptFrom: 1.26,
  quote: { win: '리스펙트! 근데 판은 내 거.', winEn: 'Respect! But this floor is mine.', lose: 'GG. 다음 배틀에서 보자.' },
  anchors: { head: [60, 10], center: [60, 63], feet: [60, 110], sky: [60, -15] },
  cues: [
    { t: 0.38, sfx: 'WHOOSH' },                                // drop into the windmill
    { t: 0.92, sfx: 'WHIRR', fx: 'dust', at: [60, 110] },      // beanie hits the floor: headspin
    { t: 1.50, sfx: 'SCRATCH' },
    { t: 1.56, fx: 'sparkle', at: [60, 40], shake: 120 },      // HIT: freeze "얼음!"
    { t: 2.02, sfx: 'BELL' },                                  // "땡!" — unfreeze, kip-up
    { t: 2.33, fx: 'dust', at: 'feet' },                       // landing
  ],
  turnSfx: 'BLIP',
  jingle: { at: 1.56, voices: [
    { wave: 'square', gain: 0.07, lowpass: 1200, notes: 'C3:316 Eb3:158 F3:158 G3:316' },
    { drums: 'K:158 -:158 S:158 -:79 K:79 K:158 S:316' },
  ] },
  portrait: '24 6 72 72',
  svg: `<svg class="ch ch-bigom" viewBox="0 0 120 120" role="img" aria-label="비곰">
<g transform="translate(51 92)"><g class="p legL"><g transform="translate(-51 -92)">
<rect class="o suit" x="45" y="89" width="12" height="15" rx="6"/>
<rect class="o shoe" x="40.5" y="101" width="17.5" height="10" rx="5"/>
<path class="sole" d="M42.5 108.4H56"/>
</g></g></g>
<g transform="translate(69 92)"><g class="p legR"><g transform="translate(-69 -92)">
<rect class="o suit" x="63" y="89" width="12" height="15" rx="6"/>
<rect class="o shoe" x="62" y="101" width="17.5" height="10" rx="5"/>
<path class="sole" d="M64 108.4H77.5"/>
</g></g></g>
<g class="body">
<path class="o suit" d="M41 83Q41 69 60 69Q79 69 79 83V88Q79 100 60 100Q41 100 41 88Z"/>
<path class="suit-sh" d="M43 90.5Q60 96.5 77 90.5Q76 98.3 60 98.3Q44 98.3 43 90.5Z"/>
<path class="zip" d="M60 72.5V97"/>
<path class="chev" d="M50.5 79l4.5 3-4.5 3M69.5 79l-4.5 3 4.5 3"/>
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
<path class="shine" d="M40 27Q45 20.5 53 18.5"/>
<rect class="o hat-band" x="28.5" y="35" width="63" height="9.5" rx="4.75"/>
<path class="rib" d="M38 37v5M46 37v5M54 37v5M62 37v5M70 37v5M78 37v5M86 37v4"/>
<circle class="o fur" cx="37.5" cy="22.5" r="8.2"/><circle class="fur-in" cx="37.5" cy="22.5" r="3.8"/>
<circle class="o fur" cx="82.5" cy="22.5" r="8.2"/><circle class="fur-in" cx="82.5" cy="22.5" r="3.8"/>
</g></g></g>
<ellipse class="cheek" cx="40.5" cy="62" rx="4.4" ry="2.6"/>
<ellipse class="cheek" cx="79.5" cy="62" rx="4.4" ry="2.6"/>
<ellipse class="o2 muzzle" cx="60" cy="62.5" rx="12.5" ry="8.5"/>
<path class="ink" d="M55.5 58.4Q60 56 64.5 58.4Q63.2 62 60 62.6Q56.8 62 55.5 58.4Z"/>
<ellipse class="nose-hi" cx="58.3" cy="58.3" rx="1.4" ry=".8"/>
<g class="face-a">
<path class="ln" d="M43 48.6Q47.5 46.4 52 47.6M77 48.6Q72.5 46.4 68 47.6"/>
<ellipse class="eye ink" cx="48" cy="54" rx="3.4" ry="4.2"/>
<ellipse class="eye ink" cx="72" cy="54" rx="3.4" ry="4.2"/>
<circle class="hl" cx="46.9" cy="52.4" r="1.25"/><circle class="hl" cx="70.9" cy="52.4" r="1.25"/>
<path class="ln thin" d="M60 62.6V64.6M55.5 64Q57.8 66.8 60 64.6Q62.2 66.8 64.5 64"/>
</g>
<g class="face-b">
<path class="ln" d="M43 47.6Q47.5 45.4 52 46.6M77 48.6Q72.5 46.4 68 47.6"/>
<path class="ln wink" d="M44.4 55.2Q48 50.6 51.6 55.2"/>
<ellipse class="ink" cx="72" cy="54" rx="3.4" ry="4.2"/><circle class="hl" cx="70.9" cy="52.4" r="1.25"/>
<path class="o2 mouth" d="M54 64.2Q60 72.4 66 64.2Z"/>
<path class="tongue" d="M57.2 67.8Q60 70.2 62.8 67.8Q60 66.6 57.2 67.8Z"/>
</g>
<g class="face-c">
<path class="ln" d="M45 51l6 6M51 51l-6 6M69 51l6 6M75 51l-6 6"/>
<path class="ln thin" d="M54 66q1.5-2 3 0t3 0 3 0 3 0"/>
</g>
</g></g></g>
</svg>`,
  fx: `<svg class="fx" viewBox="0 0 120 120" aria-hidden="true">
<g transform="translate(60 63)"><g class="p fx-mill"><g transform="translate(-60 -63)">
<path class="mill-a" d="M105.9 66.4A46 46 0 0 1 86.8 100.4M80.4 104.2A46 46 0 0 1 41.5 105.1M21.9 37.3A46 46 0 0 1 55.2 17.3"/>
<path class="mill-b" d="M97.8 72.6A39 39 0 0 1 86.9 91.2M70.9 100.4A39 39 0 0 1 49.4 100.5M31.9 35.9A39 39 0 0 1 50.6 25.2"/>
</g></g></g>
<g class="fx-spin">
<ellipse cx="60" cy="72" rx="34" ry="7"/>
<ellipse class="spin-floor" cx="60" cy="96" rx="26" ry="5.5"/>
<ellipse class="spin-top" cx="60" cy="46" rx="24" ry="5"/>
</g>
<g transform="translate(60 63)"><g class="p fx-burst"><g transform="translate(-60 -63)">
<path d="M60 9V19M60 107V117M6 63H16M104 63H114M22 25l7 7M98 25l-7 7M22 101l7-7M98 101l-7-7"/>
</g></g></g>
<g transform="translate(100 20)"><g class="p fx-sticker">
<rect class="stk-bg" x="-19" y="-10" width="38" height="20" rx="10"/>
<text class="stk-txt" x="0" y="5" text-anchor="middle">얼음!</text>
</g></g>
<g transform="translate(21 24)"><g class="p fx-ttaeng">
<rect class="ttaeng-bg" x="-14" y="-10" width="28" height="20" rx="10"/>
<text class="ttaeng-txt" x="0" y="5" text-anchor="middle">땡!</text>
</g></g>
<g class="fx-dizzy" transform="translate(60 14)">
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
</g>
</svg>`,
};
