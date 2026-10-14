// js/chars/bulttong.js — 불똥 Bulttong, the fire baby dragon whose sneezes are fireworks
// (docs/SPEC.md §8.5, docs/research/characters.md §4.1). Art + rig only: motion lives in
// css/chars/bulttong.css; js/fighter.js builds the stage around `svg` + `fx` and fires `cues`
// from the .rig's `bulttong-win` clock.
//
// Rig (joint sandwiches; art drawn in absolute viewBox coords):
//   tail (76,96) · wingL (46,78) · wingR (74,78) · legL (49,100) · legR (71,100) · body (static)
//   · armL (41,82) · armR (79,82) · head (neck 60,72) ⊃ flame (60,59) · snort (60,59) · cough (60,66)
// Faces (opacity-switched, all inside head): face-a fighting grin · face-in "아…" inhale · face-sq "> <"
//   · face-ach "에취!" · face-up watching the rocket · face-joy HIT ^^ · face-b smug victory · face-c lose (swirl eyes)
// Positive rotate swings a hanging limb toward screen-left; wingL + / wingR − lifts a wing.
export default {
  id: 'bulttong', ko: '불똥', en: 'Bulttong', tagline: '재채기가 불꽃놀이',
  type: '아기 용',
  color: '#F0483E', colorAlt: '#3BB273',
  bg: ['#9E2420', '#2B080B'],
  winMs: 2400, hitAt: 1.45, excerptFrom: 1.15,
  quote: { win: '에취! 불붙었다, 다 덤벼!', winEn: "Achoo! I'm fired up — bring it!", lose: '콜록… 불씨가 꺼졌어…' },
  anchors: { head: [60, 12], center: [60, 70], feet: [60, 110], sky: [60, -10], left: [15, 29], right: [105, 25] },
  cues: [
    { t: 0.42, sfx: 'SNIFF' },                                       // "아…"
    { t: 0.68, sfx: 'SNIFF' },                                       // "아아…"
    { t: 0.85, sfx: 'WHOOSH', fx: 'dust', at: 'feet', shake: 90 },   // 에취! the fireball launches
    { t: 1.45, fx: 'firework', at: 'sky', shake: 140 },              // HIT: it bursts overhead
    { t: 1.47, fx: 'sparkle', at: 'sky' },
    { t: 1.70, sfx: 'CRACKLE', fx: 'firework', at: 'left' },
    { t: 1.92, sfx: 'CRACKLE', fx: 'firework', at: 'right' },
    { t: 2.10, sfx: 'SNIFF' },                                       // smug "흥"
  ],
  turnSfx: 'POP',
  jingle: { at: 1.45, voices: [
    { wave: 'sawtooth', gain: 0.14, lowpass: 2400, notes: 'G4:80 C5:80 E5:80 G5~:420' },
    { wave: 'triangle', gain: 0.04, notes: 'E4:80 G4:80 C5:80 E5~:420' },
    { drums: 'K:240 -:420' },
  ] },
  portrait: '25 6 70 70',
  svg: `<svg class="ch ch-bulttong" viewBox="0 0 120 120" role="img" aria-label="불똥">
<g transform="translate(76 96)"><g class="p tail"><g transform="translate(-76 -96)">
<path class="o2 crest" d="M85.5 93L90 84L94.5 93.5Z"/>
<path class="o2 crest" d="M96 87.5L101.5 79.5L103 89.5Z"/>
<path class="o body" d="M70 92Q90 101 99 88Q103 83 106 78Q107.5 90 100 97Q90 106 68 100Z"/>
</g></g></g>
<g transform="translate(46 78)"><g class="p wingL"><g transform="translate(-46 -78)">
<path class="o wing" d="M47 77Q30 54 19 66Q25 67 25 73Q31 72 33 78Q39 77 44 84Z"/>
<path class="rib" d="M44.5 78.5L26.5 68.6M44 80.5L32.6 76.2"/>
</g></g></g>
<g transform="translate(74 78)"><g class="p wingR"><g transform="translate(-74 -78)">
<path class="o wing" d="M73 77Q90 54 101 66Q95 67 95 73Q89 72 87 78Q81 77 76 84Z"/>
<path class="rib" d="M75.5 78.5L93.5 68.6M76 80.5L87.4 76.2"/>
</g></g></g>
<g transform="translate(49 100)"><g class="p legL"><g transform="translate(-49 -100)">
<ellipse class="o body" cx="49" cy="105" rx="8" ry="5.5"/>
<path class="toe" d="M44.5 108.6v-2.4M48.5 109.2v-2.8"/>
</g></g></g>
<g transform="translate(71 100)"><g class="p legR"><g transform="translate(-71 -100)">
<ellipse class="o body" cx="71" cy="105" rx="8" ry="5.5"/>
<path class="toe" d="M71.5 109.2v-2.8M75.5 108.6v-2.4"/>
</g></g></g>
<g class="torso">
<ellipse class="o body" cx="60" cy="88" rx="22" ry="17"/>
<path class="body-sh" d="M40.5 94Q60 107 79.5 94Q77 103.5 60 103.6Q43 103.5 40.5 94Z"/>
<ellipse class="belly" cx="60" cy="90" rx="13.5" ry="12"/>
<path class="plate" d="M50 86Q60 89 70 86M49.5 93Q60 96 70.5 93"/>
</g>
<g transform="translate(41 82)"><g class="p armL"><g transform="translate(-41 -82)">
<g transform="rotate(28 41 82)"><rect class="o body" x="36" y="79" width="10" height="15" rx="5"/>
<path class="toe" d="M39.2 92.6v-2.2M42.8 92.6v-2.2"/></g>
</g></g></g>
<g transform="translate(79 82)"><g class="p armR"><g transform="translate(-79 -82)">
<g transform="rotate(-28 79 82)"><rect class="o body" x="74" y="79" width="10" height="15" rx="5"/>
<path class="toe" d="M77.2 92.6v-2.2M80.8 92.6v-2.2"/></g>
</g></g></g>
<g transform="translate(60 72)"><g class="p head"><g transform="translate(-60 -72)">
<path class="o horn" d="M41.5 32.5Q32.4 29.4 31.4 18Q31.4 15.2 33.8 16.4Q39 22.4 47.8 25.8Z"/>
<path class="o horn" d="M78.5 32.5Q87.6 29.4 88.6 18Q88.6 15.2 86.2 16.4Q81 22.4 72.2 25.8Z"/>
<path class="horn-rib" d="M33.2 24.6Q36.2 24.6 37.8 22.4M37.4 29.2Q40.6 28.8 42.2 26.4M86.8 24.6Q83.8 24.6 82.2 22.4M82.6 29.2Q79.4 28.8 77.8 26.4"/>
<path class="o2 crest" d="M47 28.5L50.8 15.4L55.6 22.8L60 8.6L64.4 22.8L69.2 15.4L73 28.5Z"/>
<ellipse class="o body" cx="60" cy="48" rx="28" ry="25"/>
<path class="shine" d="M38.2 38.4Q41.6 31.2 49.8 27.8"/>
<ellipse class="cheek" cx="38.8" cy="57.4" rx="4.4" ry="2.5"/>
<ellipse class="cheek" cx="81.2" cy="57.4" rx="4.4" ry="2.5"/>
<ellipse class="o2 muzzle" cx="60" cy="63.6" rx="13" ry="7.8"/>
<ellipse class="ink" cx="55.8" cy="59.3" rx="1.6" ry="1.15"/>
<ellipse class="ink" cx="64.2" cy="59.3" rx="1.6" ry="1.15"/>
<g class="face-a">
<path class="ln" d="M41.5 39.8Q46 38.2 50.5 40.6M78.5 39.8Q74 38.2 69.5 40.6"/>
<g class="eye"><ellipse class="ink" cx="47" cy="48" rx="4.8" ry="5.8"/><circle class="hl" cx="45.3" cy="45.6" r="1.9"/><circle class="hl" cx="48.7" cy="50.7" r=".9"/></g>
<g class="eye"><ellipse class="ink" cx="73" cy="48" rx="4.8" ry="5.8"/><circle class="hl" cx="71.3" cy="45.6" r="1.9"/><circle class="hl" cx="74.7" cy="50.7" r=".9"/></g>
<path class="o2 mouth" d="M52.5 62.5Q60 71 67.5 62.5Z"/>
<path class="tongue" d="M56.6 66.1Q60 68.2 63.4 66.1Q60 64.7 56.6 66.1Z"/>
<path class="fang" d="M54.6 63.2l1.5 2.6 1.5-2.6ZM62.4 63.2l1.5 2.6 1.5-2.6Z"/>
</g>
<g class="face-in">
<path class="ln" d="M40.8 36Q45.2 31.4 50.6 33.2M79.2 36Q74.8 31.4 69.4 33.2"/>
<ellipse class="o2 sclera" cx="47" cy="47.6" rx="5.3" ry="6.1"/><ellipse class="o2 sclera" cx="73" cy="47.6" rx="5.3" ry="6.1"/>
<circle class="ink" cx="49.4" cy="50" r="2.7"/><circle class="ink" cx="70.6" cy="50" r="2.7"/>
<circle class="hl" cx="48.6" cy="49.1" r=".9"/><circle class="hl" cx="69.8" cy="49.1" r=".9"/>
<path class="ln thin" d="M50.2 57.8l-2.6-.8M50.6 61l-2.6.4M69.8 57.8l2.6-.8M69.4 61l2.6.4"/>
<ellipse class="ink" cx="55.6" cy="59.2" rx="2.4" ry="1.8"/><ellipse class="ink" cx="64.4" cy="59.2" rx="2.4" ry="1.8"/>
<ellipse class="o2 mouth" cx="60" cy="66.2" rx="3.8" ry="3.2"/>
</g>
<g class="face-sq">
<path class="ln squint" d="M42.6 44l7 4-7 4M77.4 44l-7 4 7 4"/>
<path class="ln thin" d="M55 55.4Q60 53.6 65 55.4"/>
<ellipse class="ink" cx="55.4" cy="59.2" rx="2.7" ry="2"/><ellipse class="ink" cx="64.6" cy="59.2" rx="2.7" ry="2"/>
<ellipse class="o2 mouth" cx="60" cy="66.4" rx="4.6" ry="3.6"/>
</g>
<g class="face-ach">
<path class="ln" d="M41.5 38.2L50.5 41.4M78.5 38.2L69.5 41.4"/>
<path class="ln squint" d="M42.6 45l7.4 3.4-7.4 3.4M77.4 45l-7.4 3.4 7.4 3.4"/>
<path class="o2 mouth" d="M48.5 61.8Q60 58.6 71.5 61.8Q71.5 77.5 60 78Q48.5 77.5 48.5 61.8Z"/>
<path class="tongue" d="M53.2 73.6Q60 69.4 66.8 73.6Q63.4 77 60 77Q56.6 77 53.2 73.6Z"/>
<path class="fang" d="M50.6 61.6l1.8 3.2 1.8-3.4ZM65.8 61.4l1.8 3.4 1.8-3.2Z"/>
</g>
<g class="face-up">
<path class="ln" d="M41 37.4Q45.5 34.8 50 36.6M79 37.4Q74.5 34.8 70 36.6"/>
<ellipse class="ink" cx="47" cy="46.4" rx="4.8" ry="5.8"/><ellipse class="ink" cx="73" cy="46.4" rx="4.8" ry="5.8"/>
<circle class="glint" cx="46.6" cy="43.2" r="2.1"/><circle class="glint" cx="72.6" cy="43.2" r="2.1"/>
<circle class="hl" cx="48.4" cy="49.4" r=".9"/><circle class="hl" cx="74.4" cy="49.4" r=".9"/>
<ellipse class="o2 mouth" cx="60" cy="66.4" rx="2.6" ry="2.9"/>
</g>
<g class="face-joy">
<path class="ln" d="M41.5 38.6Q46 36.6 50.5 38.2M78.5 38.6Q74 36.6 69.5 38.2"/>
<path class="ln happy" d="M42 50Q47 42.6 52 50M68 50Q73 42.6 78 50"/>
<path class="o2 mouth" d="M51 62Q60 75 69 62Z"/>
<path class="tongue" d="M55.6 67.6Q60 70.6 64.4 67.6Q60 65.4 55.6 67.6Z"/>
<path class="fang" d="M53.4 62.6l1.6 2.9 1.6-2.9ZM63.4 62.6l1.6 2.9 1.6-2.9Z"/>
</g>
<g class="face-b">
<path class="ln" d="M41 37.4Q45.6 33.8 50.6 36.2M79 39.6Q74.4 38.2 69.4 40.2"/>
<path class="ink" d="M42.2 47.8A4.8 5.4 0 0 0 51.8 47.8Z"/><path class="ink" d="M68.2 47.8A4.8 5.4 0 0 0 77.8 47.8Z"/>
<circle class="hl" cx="45" cy="49.8" r="1.3"/><circle class="hl" cx="71" cy="49.8" r="1.3"/>
<path class="ln lid" d="M41.2 47.6H52.8M67.2 47.6H78.8"/>
<path class="o2 fang" d="M62.4 65.2l1.6 3 1.6-3.4Z"/>
<path class="ln" d="M52.6 64.2Q59 68.4 67 63"/>
</g>
<g class="face-c">
<path class="ln swirl" d="M47.6 48.4L47.7 48.6L47.7 48.7L47.6 48.9L47.5 49.1L47.4 49.3L47.2 49.4L46.9 49.5L46.6 49.6L46.3 49.5L46.0 49.4L45.8 49.2L45.6 48.9L45.4 48.5L45.3 48.1L45.4 47.7L45.5 47.3L45.8 47.0L46.1 46.6L46.5 46.4L47.0 46.3L47.5 46.3L48.0 46.4L48.5 46.6L49.0 47.0L49.3 47.4L49.6 48.0L49.7 48.6L49.6 49.2L49.4 49.9L49.1 50.5L48.6 50.9L47.9 51.3L47.2 51.5L46.5 51.6L45.7 51.4L45.0 51.1L44.4 50.6L43.9 50.0L43.5 49.2L43.3 48.4L43.4 47.5L43.6 46.7L44.0 45.9L44.7 45.2L45.5 44.7L46.4 44.3L47.3 44.2L48.3 44.3L49.3 44.7L50.1 45.3L50.8 46.0L51.4 47.0L51.6 48.0L51.7 49.1L51.5 50.2L51.0 51.3L50.2 52.2L49.3 52.9L48.2 53.4L47.0 53.6M72.4 48.4L72.3 48.6L72.3 48.7L72.4 48.9L72.5 49.1L72.6 49.3L72.8 49.4L73.1 49.5L73.4 49.6L73.7 49.5L74.0 49.4L74.2 49.2L74.4 48.9L74.6 48.5L74.7 48.1L74.6 47.7L74.5 47.3L74.2 47.0L73.9 46.6L73.5 46.4L73.0 46.3L72.5 46.3L72.0 46.4L71.5 46.6L71.0 47.0L70.7 47.4L70.4 48.0L70.3 48.6L70.4 49.2L70.6 49.9L70.9 50.5L71.4 50.9L72.1 51.3L72.8 51.5L73.5 51.6L74.3 51.4L75.0 51.1L75.6 50.6L76.1 50.0L76.5 49.2L76.7 48.4L76.6 47.5L76.4 46.7L76.0 45.9L75.3 45.2L74.5 44.7L73.6 44.3L72.7 44.2L71.7 44.3L70.7 44.7L69.9 45.3L69.2 46.0L68.6 47.0L68.4 48.0L68.3 49.1L68.5 50.2L69.0 51.3L69.8 52.2L70.7 52.9L71.8 53.4L73.0 53.6"/>
<path class="soot" d="M53 69.5Q60 72.5 67 69.5Q66 71.6 60 71.8Q54 71.6 53 69.5Z"/>
<path class="ln thin" d="M53.5 65.8q1.6-2 3.25 0t3.25 0 3.25 0 3.25 0"/>
</g>
<g transform="translate(60 59)"><g class="p flame"><g transform="translate(-60 -59)">
<path class="o2 fire" d="M55.6 47.6Q59.2 52.6 58.6 56.2Q58 59 55.6 59Q53.2 59 52.6 56.2Q52 52.6 55.6 47.6Z"/>
<path class="o2 fire" d="M64.4 47.6Q68 52.6 67.4 56.2Q66.8 59 64.4 59Q62 59 61.4 56.2Q60.8 52.6 64.4 47.6Z"/>
<path class="fire-in" d="M55.6 51.8Q57.4 54.6 57 56.4Q56.6 57.6 55.6 57.6Q54.6 57.6 54.2 56.4Q53.8 54.6 55.6 51.8ZM64.4 51.8Q66.2 54.6 65.8 56.4Q65.4 57.6 64.4 57.6Q63.4 57.6 63 56.4Q62.6 54.6 64.4 51.8Z"/>
</g></g></g>
<g transform="translate(60 59)"><g class="p snort"><g transform="translate(-60 -59)">
<path class="jet" d="M52.4 59.6L47.4 60.4M67.6 59.6L72.6 60.4"/>
<path class="puff" d="M45.4 62.5a2.73 2.73 0 0 0 -0.42 -4.62a3.36 3.36 0 0 0 -6.09 -1.26a2.94 2.94 0 0 0 -3.57 4.41a2.52 2.52 0 0 0 2.73 3.78a3.15 3.15 0 0 0 7.35 -2.31Z"/>
<path class="puff" d="M74.6 62.5a2.73 2.73 0 0 1 0.42 -4.62a3.36 3.36 0 0 1 6.09 -1.26a2.94 2.94 0 0 1 3.57 4.41a2.52 2.52 0 0 1 -2.73 3.78a3.15 3.15 0 0 1 -7.35 -2.31Z"/>
</g></g></g>
<g transform="translate(60 66)"><g class="p cough"><g transform="translate(-60 -66)">
<path class="puff-grey" d="M53.4 68.6a3.5 3.5 0 0 1 0.5 -6a4.4 4.4 0 0 1 7.9 -1.6a3.8 3.8 0 0 1 4.6 5.7a3.3 3.3 0 0 1 -3.5 4.9a4.2 4.2 0 0 1 -9.5 -3Z"/>
</g></g></g>
</g></g></g>
</svg>`,
  fx: `<svg class="fx" viewBox="0 0 120 120" aria-hidden="true">
<g transform="translate(62 77)"><g class="p fx-blast">
<path d="M-19 1.3a3.4 3.4 0 0 1 0.5 -5.7a4.2 4.2 0 0 1 7.5 -1.6a3.6 3.6 0 0 1 4.4 5.5a3.1 3.1 0 0 1 -3.4 4.7a3.9 3.9 0 0 1 -9.1 -2.9Z"/>
<path d="M19 1.3a3.4 3.4 0 0 0 -0.5 -5.7a4.2 4.2 0 0 0 -7.5 -1.6a3.6 3.6 0 0 0 -4.4 5.5a3.1 3.1 0 0 0 3.4 4.7a3.9 3.9 0 0 0 9.1 -2.9Z"/>
<path d="M-12.6 9.8a2.6 2.6 0 0 1 0.4 -4.4a3.2 3.2 0 0 1 5.8 -1.2a2.8 2.8 0 0 1 3.4 4.2a2.4 2.4 0 0 1 -2.6 3.6a3 3 0 0 1 -7 -2.2Z"/>
<path d="M12.6 9.8a2.6 2.6 0 0 0 -0.4 -4.4a3.2 3.2 0 0 0 -5.8 -1.2a2.8 2.8 0 0 0 -3.4 4.2a2.4 2.4 0 0 0 2.6 3.6a3 3 0 0 0 7 -2.2Z"/>
<path d="M-22.4 -6.7a2 2 0 0 1 0.3 -3.3a2.4 2.4 0 0 1 4.3 -0.9a2.1 2.1 0 0 1 2.5 3.2a1.8 1.8 0 0 1 -2 2.7a2.2 2.2 0 0 1 -5.2 -1.7Z"/>
<path d="M22.4 -6.7a2 2 0 0 0 -0.3 -3.3a2.4 2.4 0 0 0 -4.3 -0.9a2.1 2.1 0 0 0 -2.5 3.2a1.8 1.8 0 0 0 2 2.7a2.2 2.2 0 0 0 5.2 -1.7Z"/>
</g></g>
<g transform="translate(62 74)"><g class="p fx-ball">
<circle class="ember" cx="0" cy="23.5" r="1.7"/><circle class="ember" cx="-1.6" cy="28.5" r="1.25"/><circle class="ember" cx="1.2" cy="33" r=".9"/>
<path class="ball" d="M0 -8.5C5.2 -8.5 8.5 -5 8.5 0C8.5 3.6 7 5.8 5.6 7.4L7.6 13.2L2.8 10.4L0 18.5L-2.8 10.4L-7.6 13.2L-5.6 7.4C-7 5.8 -8.5 3.6 -8.5 0C-8.5 -5 -5.2 -8.5 0 -8.5Z"/>
<path class="ball-in" d="M0 -5.5C3.4 -5.5 5.6 -3.2 5.6 0C5.6 3 4 5 3 6.5L3.6 9.5L1.2 8L0 12.5L-1.2 8L-3.6 9.5L-3 6.5C-4 5 -5.6 3 -5.6 0C-5.6 -3.2 -3.4 -5.5 0 -5.5Z"/>
<ellipse class="ball-core" cx="-1.4" cy="-1.8" rx="2.6" ry="2.3"/>
</g></g>
<g transform="translate(98 33)"><g class="p fx-ach">
<path class="ach-bg" d="M0 -13.5L3.7 -9.7L9.1 -12.2L10.3 -7.8L16.4 -8.4L14.9 -4.3L20.5 -3L16.5 0L20.5 3L14.9 4.3L16.4 8.4L10.3 7.8L9.1 12.2L3.7 9.7L0 13.5L-3.7 9.7L-9.1 12.2L-10.3 7.8L-16.4 8.4L-14.9 4.3L-20.5 3L-16.5 0L-20.5 -3L-14.9 -4.3L-16.4 -8.4L-10.3 -7.8L-9.1 -12.2L-3.7 -9.7Z"/>
<text class="ach-txt" x="0" y="4.4" text-anchor="middle">에취!</text>
</g></g>
<g transform="translate(60 -10)"><g class="p fx-fw1">
<path class="fw-ink" d="M0 -6.5L0 -13.5M3.8 -5.3L7.9 -10.9M6.2 -2L12.8 -4.2M6.2 2L12.8 4.2M3.8 5.3L7.3 10.1M-3.8 5.3L-7.3 10.1M-6.2 2L-12.8 4.2M-6.2 -2L-12.8 -4.2M-3.8 -5.3L-7.9 -10.9"/>
<path class="fw-a" d="M0 -6.5L0 -13.5M3.8 -5.3L7.9 -10.9M6.2 -2L12.8 -4.2M6.2 2L12.8 4.2M3.8 5.3L7.3 10.1M-3.8 5.3L-7.3 10.1M-6.2 2L-12.8 4.2M-6.2 -2L-12.8 -4.2M-3.8 -5.3L-7.9 -10.9"/>
<circle class="fw-dot-a" cx="5.3" cy="-16.2" r="1.3"/><circle class="fw-dot-a" cx="17" cy="0" r="1.3"/><circle class="fw-dot-a" cx="-13.8" cy="10" r="1.3"/><circle class="fw-dot-a" cx="-13.8" cy="-10" r="1.3"/>
<circle class="fw-core" cx="0" cy="0" r="2.6"/>
</g></g>
<g transform="translate(15 29)"><g class="p fx-fw2">
<path class="fw-ink" d="M0 -4.5L0 -10M3.2 -3.2L7.1 -7.1M4.5 0L10 0M3.2 3.2L7.1 7.1M0 4.5L0 10M-3.2 3.2L-7.1 7.1M-4.5 0L-10 0M-3.2 -3.2L-7.1 -7.1"/>
<path class="fw-b" d="M0 -4.5L0 -10M3.2 -3.2L7.1 -7.1M4.5 0L10 0M3.2 3.2L7.1 7.1M0 4.5L0 10M-3.2 3.2L-7.1 7.1M-4.5 0L-10 0M-3.2 -3.2L-7.1 -7.1"/>
<circle class="fw-core" cx="0" cy="0" r="2"/>
</g></g>
<g transform="translate(105 25)"><g class="p fx-fw3">
<path class="fw-ink" d="M0 -4.5L0 -10M3.2 -3.2L7.1 -7.1M4.5 0L10 0M3.2 3.2L7.1 7.1M0 4.5L0 10M-3.2 3.2L-7.1 7.1M-4.5 0L-10 0M-3.2 -3.2L-7.1 -7.1"/>
<path class="fw-c" d="M0 -4.5L0 -10M3.2 -3.2L7.1 -7.1M4.5 0L10 0M3.2 3.2L7.1 7.1M0 4.5L0 10M-3.2 3.2L-7.1 7.1M-4.5 0L-10 0M-3.2 -3.2L-7.1 -7.1"/>
<circle class="fw-core" cx="0" cy="0" r="2"/>
</g></g>
<g class="fx-dizzy" transform="translate(60 12)">
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
</g>
</svg>`,
};
