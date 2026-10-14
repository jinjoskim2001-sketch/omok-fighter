// js/chars/kkakkung.js — 까꿍 Kkakkung, the prankster ghost with a 청사초롱 lantern
// (docs/SPEC.md §8.5, docs/research/characters.md §4.7). Art + timeline data only; all motion lives in
// css/chars/kkakkung.css and js/fighter.js builds the stage around `svg` + `fx`.
//
// Victory "사라졌다… 까꿍!" (2.4 s): giggle › lets go of the lantern and fades away (the lantern is
// left hanging in mid-air: an identical copy in the fx layer takes over) › "…" › POP 1.10 › HIT 1.30
// "까꿍!" › settle › twirl with the lantern held high › float loop.

// The lantern on its stick. Drawn twice from this one source: in the ghost's hand (svg, part
// `lantern`) and as the abandoned copy in the effect layer (fx, part `fl-lan`). Stick tip = pendulum
// joint (109,50); the lantern hangs below it.
const lantern = (part, glows, stick = 'M93 70L109 50') => `<path class="stick-ink" d="${stick}"/>
<path class="stick" d="${stick}"/>
<g transform="translate(109 50)"><g class="p ${part}"><g transform="translate(-109 -50)">
<g transform="translate(109 67.5)"><g class="p ${glows}"><g transform="translate(-109 -67.5)">
<circle class="glow g1" cx="109" cy="67.5" r="18.5"/>
<circle class="glow g2" cx="109" cy="67.5" r="15"/>
<circle class="glow g3" cx="109" cy="67.5" r="11.5"/>
</g></g></g>
<path class="cord" d="M109 50V56"/>
<path class="lan-bot" d="M103 57.5H115Q118.2 62 118.2 67.5Q118.2 73 115 77.5H103Q99.8 73 99.8 67.5Q99.8 62 103 57.5Z"/>
<path class="lan-top" d="M103 57.5H115Q118.2 61.6 118.2 66.5H99.8Q99.8 61.6 103 57.5Z"/>
<path class="lan-lit-top" d="M106 58Q104.7 62 104.6 66.5H113.4Q113.3 62 112 58Z"/>
<path class="lan-lit-bot" d="M104.6 66.5Q104.7 72 106 77H112Q113.3 72 113.4 66.5Z"/>
<path class="lan-rib" d="M106 58Q104.2 67.5 106 77M112 58Q113.8 67.5 112 77"/>
<path class="lan-gloss" d="M102.6 61.6Q101.6 67.5 102.6 73.4"/>
<path class="lan-dim" d="M103 57.5H115Q118.2 62 118.2 67.5Q118.2 73 115 77.5H103Q99.8 73 99.8 67.5Q99.8 62 103 57.5Z"/>
<path class="o2 lan-edge" d="M103 57.5H115Q118.2 62 118.2 67.5Q118.2 73 115 77.5H103Q99.8 73 99.8 67.5Q99.8 62 103 57.5Z"/>
<path class="lan-seam" d="M100.6 66.5H117.4"/>
<rect class="o2 frame" x="102" y="55" width="14" height="3.6" rx="1.6"/>
<rect class="o2 frame" x="103" y="76.6" width="12" height="3.4" rx="1.5"/>
<path class="o2 tassel" d="M107 81.2H111L112.2 89.4Q109 91 105.8 89.4Z"/>
<circle class="o2 knot" cx="109" cy="81.6" r="1.9"/>
</g></g></g>`;

// HIT "surprise" lines around the burst-sized ghost (none straight up: the flame is there; none on the
// right at mid height: the lantern is there)
const BURST = 'M102.4 85.7L111.7 92.2M17.6 85.7L8.3 92.2M11.9 71.4L1.4 74.8M17.6 26.3L8.3 19.8M102.4 26.3L111.7 19.8M83.5 6.6L88.6 -4.3M36.5 6.6L31.4 -4.3';
const STAR = 'M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z';

export default {
  id: 'kkakkung', ko: '까꿍', en: 'Kkakkung', tagline: '청사초롱 장난꾸러기',
  type: '꼬마유령',
  color: '#B49BFF', colorAlt: '#2DB386',
  bg: ['#4A3590', '#160F33'],
  winMs: 2400, hitAt: 1.30, excerptFrom: 1.00,
  quote: { win: '까꿍~ 놀랐지? 내가 이겼지롱!', winEn: 'Peekaboo~ Surprised? I win!', lose: '히잉… 들켰다…' },
  // viewBox coords of the UNtransformed stage (particles.anchor). At HIT the ghost is scaled up around
  // (60,72), so the HIT bursts use explicit points where its body actually is at that moment.
  anchors: { head: [60, 20], center: [60, 58], feet: [60, 104], sky: [60, -15], lantern: [109, 68] },
  cues: [
    { t: 0.05, sfx: 'GIGGLE' },                              // 키득키득
    { t: 0.34, sfx: 'SWISH', fx: 'wisps', at: 'center' },   // lets go of the lantern and fades away
    { t: 0.78, sfx: 'CRACKLE' },                             // the abandoned lantern flickers in the dark
    { t: 1.10, sfx: 'POP' },                                 // "까…" — back, small and sneaky
    { t: 1.30, fx: 'wisps', at: [60, 56], shake: 120 },      // HIT "…꿍!": ring of ghost-fire
    { t: 1.30, fx: 'sparkle', at: [60, 4] },
    { t: 1.90, sfx: 'WHOOSH' },                              // twirl
    { t: 2.28, sfx: 'TING', fx: 'sparkle', at: [100, 22] },  // lantern held high
  ],
  turnSfx: 'POP',
  // A4 glides up to C5, a spooky tritone (Eb5 over the A pedal), then A5 with vibrato and three twinkles.
  jingle: { at: 1.30, voices: [
    { wave: 'sine', gain: 0.10, notes: 'A4>C5:180 Eb5:160 -:50 A5~:420' },
    { wave: 'triangle', gain: 0.05, notes: 'A3:180 A3:160 -:50 A3~:420' },
    { drums: '-:390 TING:140 TING:140 TING:140' },
  ] },
  portrait: '26 4 68 68',
  svg: `<svg class="ch ch-kkakkung" viewBox="0 0 120 120" role="img" aria-label="까꿍">
<g transform="translate(60 21)"><g class="p wisp"><g transform="translate(-60 -21)">
<path class="o2 flame" d="M60 24.4C53.4 24.4 50.2 18.8 52 13.4C53.4 9.4 57.4 7.6 56.4 1.8C62.4 3.6 65.8 8 66.4 12.4C67.6 11.2 68.2 9.6 68 7.8C70.8 10.6 71.4 15 70 18.6C68.6 22.2 64.8 24.4 60 24.4Z"/>
<path class="flame-in" d="M60.4 21.6C57.6 21.6 56.2 19.2 57 16.8C57.8 14.6 59.8 13.6 59.6 10.8C62.6 12.4 64.4 15 64.2 17.8C64 20.2 62.6 21.6 60.4 21.6Z"/>
</g></g></g>
<g transform="translate(60 88)"><g class="p hem"><g transform="translate(-60 -88)">
<path class="body" d="M29.2 81L28 88C28.3 96 39.5 100 41 92.8C42 100 52.5 100 53.5 92.8C54.5 101 65.5 101 66.5 92.8C67.5 100 78 100 79 92.8C80.5 100 91.7 96 92 88L90.8 81Z"/>
<path class="shade" d="M82.6 82H90.9L92 88C91.7 96 80.5 100 79 92.8C81.6 89.8 82.6 86.4 82.6 82Z"/>
<path class="edge" d="M29.2 81L28 88C28.3 96 39.5 100 41 92.8C42 100 52.5 100 53.5 92.8C54.5 101 65.5 101 66.5 92.8C67.5 100 78 100 79 92.8C80.5 100 91.7 96 92 88L90.8 81"/>
</g></g></g>
<g transform="translate(37 63)"><g class="p armL"><g transform="translate(-37 -63)">
<path class="o body" d="M38 59.6C33.6 58.6 26.4 61.8 23 66.4C20.6 69.8 21.4 73.8 25 74.4C29 75 34.8 72 38 68.6C40.6 65.8 40.8 60.4 38 59.6Z"/>
</g></g></g>
<g transform="translate(83 63)"><g class="p armR"><g transform="translate(-83 -63)">
<g class="held">
${lantern('lantern', 'glows')}
</g>
<path class="o body" d="M82 59.6C86.4 58.6 93.6 61.8 97 66.4C99.4 69.8 98.6 73.8 95 74.4C91 75 85.2 72 82 68.6C79.4 65.8 79.2 60.4 82 59.6Z"/>
</g></g></g>
<g class="torso">
<path class="body" d="M28 88C29.6 78 33 70 33 56C33 34 43.5 18.5 60 18.5C76.5 18.5 87 34 87 56C87 70 90.4 78 92 88Z"/>
<path class="shade" d="M74.5 24.6C83 31.6 87 42.6 87 56C87 70 90.4 78 92 88H82.6C85 73 84.8 50 74.5 24.6Z"/>
<path class="edge" d="M28 88C29.6 78 33 70 33 56C33 34 43.5 18.5 60 18.5C76.5 18.5 87 34 87 56C87 70 90.4 78 92 88"/>
<path class="shine" d="M40.6 38.4Q43 28.8 50.6 24.2"/>
<ellipse class="cheek" cx="42.2" cy="58.6" rx="4.6" ry="2.7"/>
<ellipse class="cheek" cx="77.8" cy="58.6" rx="4.6" ry="2.7"/>
<g class="face-a">
<g class="eye"><ellipse class="ink" cx="50" cy="49.5" rx="4.3" ry="5.4"/><circle class="hl" cx="48.5" cy="47.2" r="1.8"/><circle class="hl" cx="51.5" cy="52.3" r=".8"/></g>
<g class="eye"><ellipse class="ink" cx="70" cy="49.5" rx="4.3" ry="5.4"/><circle class="hl" cx="68.5" cy="47.2" r="1.8"/><circle class="hl" cx="71.5" cy="52.3" r=".8"/></g>
<ellipse class="o2 mouth" cx="60" cy="60" rx="2.9" ry="3.5"/>
</g>
<g class="face-g">
<path class="ink" d="M44.8 52.4Q50 42.6 55.2 52.4Q50 47.6 44.8 52.4Z"/>
<path class="ink" d="M64.8 52.4Q70 42.6 75.2 52.4Q70 47.6 64.8 52.4Z"/>
<path class="ln thin" d="M53.6 58.6Q56.8 62.6 60 59Q63.2 62.6 66.4 58.6"/>
</g>
<g class="face-b">
<path class="ln wide" d="M44.6 52Q50 44.2 55.4 52M64.6 52Q70 44.2 75.4 52"/>
<path class="o2 mouth" d="M51.4 56.4Q60 55.2 68.6 56.4Q68.2 70.4 60 70.4Q51.8 70.4 51.4 56.4Z"/>
<path class="tongue" d="M54.8 65.8Q60 61.8 65.2 65.8Q63.6 68.8 60 68.8Q56.4 68.8 54.8 65.8Z"/>
</g>
<g class="face-c">
<path class="ln" d="M44.4 46.4Q49 45.8 53.6 42.8M75.6 46.4Q71 45.8 66.4 42.8"/>
<path class="tear" d="M46.6 51.6H48.6L49.1 57.4Q47.6 60.1 46.1 57.4ZM51.4 51.6H53.4L53.9 56.0Q52.4 58.7 50.9 56.0ZM66.6 51.6H68.6L69.1 56.0Q67.6 58.7 66.1 56.0ZM71.4 51.6H73.4L73.9 57.4Q72.4 60.1 70.9 57.4Z"/>
<path class="ln" d="M44.8 51Q50 49.2 55.2 51M64.8 51Q70 49.2 75.2 51"/>
<path class="ln thin" d="M54.5 63q1.4-1.8 2.75 0t2.75 0 2.75 0 2.75 0"/>
</g>
</g>
</svg>`,
  fx: `<svg class="fx" viewBox="0 0 120 120" aria-hidden="true">
<g transform="translate(83 63)"><g class="p fx-lantern"><g transform="translate(-83 -63)">
${lantern('fl-lan', 'fl-glows', 'M97.6 64.3L109 50')}
</g></g></g>
<g class="fx-dots">
<circle class="dot sc" cx="50" cy="56" r="2.6"/><circle class="dot sc" cx="60" cy="56" r="2.6"/><circle class="dot sc" cx="70" cy="56" r="2.6"/>
</g>
<g transform="translate(60 56)"><g class="p fx-burst"><g transform="translate(-60 -56)">
<path class="burst-ink" d="${BURST}"/>
<path class="burst" d="${BURST}"/>
</g></g></g>
<g transform="translate(22 14)"><g class="p fx-sticker">
<rect class="stk-bg" x="-21" y="-10.5" width="42" height="21" rx="10.5"/>
<text class="stk-txt" x="0" y="5" text-anchor="middle">까꿍!</text>
</g></g>
<g class="fx-dizzy" transform="translate(57 35)">
<path class="star" d="${STAR}"/>
<path class="star" d="${STAR}"/>
<path class="star" d="${STAR}"/>
</g>
</svg>`,
};
