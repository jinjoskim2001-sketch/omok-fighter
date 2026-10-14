// js/chars/taenggeul.js — 탱글 Taenggeul, the caramel-pudding 씨름 wrestler (docs/SPEC.md §8.5, characters.md §4.8)
// Art + rig only. Motion lives in css/chars/taenggeul.css; js/fighter.js builds the stage around `svg` + `fx`.
//
// Parts (joint sandwiches, art in absolute viewBox coords): legL legR (hips 46,99 / 74,99) · armL armR
// (shoulders 33,68 / 87,68; arms rest 28° outward via a static inner rotate) · cherry (its centre 60,30) ·
// drips (caramel drips, cap edge 60,51) · puddle (melt puddle, lose only, 60,108).
// The body has no separate head: the face sits on the flan. Squash/stretch/skew is on the composited .rig.
// Victory "뒤집기 → 철퍼덕 → 탱글탱글 → 천하장사": stomp + grip · heave · backflip · SPLAT (cherry pops off)
// · jelly rebound · cherry plops back · HIT 1.60 s: star-jump 만세 + a red '천하장사' seal stamp.
// Faces: face-a (default) · face-b (victory) · face-c (lose, ㅠㅠ) + face-s ('> <' squish: splat, jiggle, turn stomp).
export default {
  id: 'taenggeul', ko: '탱글', en: 'Taenggeul', tagline: '천하장사 꿈나무',
  type: '푸딩',
  color: '#FFD45E', colorAlt: '#B98AF5',
  bg: ['#C2571F', '#3D1708'],
  winMs: 2400, hitAt: 1.60, excerptFrom: 1.30,
  quote: { win: '흔들려도 안 넘어가! 천하장사 탱글!', winEn: 'I wobble, but I never go down!', lose: '조금… 녹았어…' },
  anchors: { head: [60, 22], center: [60, 72], feet: [60, 110], sky: [60, -15], apex: [57, 40], seal: [94, 14] },
  cues: [
    { t: 0.13, sfx: 'PUNCH', fx: 'dust', at: 'feet' },             // stomp into the 씨름 crouch
    { t: 0.33, sfx: 'HUP' },                                       // heave
    { t: 0.60, sfx: 'WHOOSH' },                                    // 뒤집기 backflip
    { t: 0.80, fx: 'jelly', at: 'apex' },                          // caramel flings off at the top of the flip
    { t: 1.00, sfx: 'SPLAT', fx: 'jelly', at: [60, 106], shake: 110 },   // 철퍼덕!
    { t: 1.12, sfx: 'BOING' },                                     // 탱글탱글 rebound (cherry pops off)
    { t: 1.49, sfx: 'POP' },                                       // cherry plops back on top
    { t: 1.60, fx: 'confetti', at: [60, -4], shake: 140 },         // HIT: 천하장사!
    { t: 1.63, fx: 'sparkle', at: 'seal' },
    { t: 1.92, fx: 'dust', at: 'feet' },                           // lands from the star jump
  ],
  turnSfx: 'BOING',
  jingle: { at: 1.60, voices: [
    { wave: 'sine', gain: 0.10, notes: 'C5^:110 E5^:110 G5^:110 C6~:380' },
    { wave: 'triangle', gain: 0.07, notes: 'C3:220 G3:110 C4~:380' },
    { drums: 'K:110 -:110 K:110 S:380' },
  ] },
  portrait: '27 18 66 66',
  svg: `<svg class="ch ch-taenggeul" viewBox="0 0 120 120" role="img" aria-label="탱글">
<g transform="translate(60 108)"><g class="p puddle"><g transform="translate(-60 -108)">
<path class="o2 custard" d="M22.5 108.4Q22 104.4 30.5 104.2Q37.5 101.6 45.5 103.4H74.5Q82.5 101.6 89.5 104.2Q98 104.4 97.5 108.4Q97 112.4 86 112.2H34Q23 112.4 22.5 108.4Z"/>
<path class="puddle-hi" d="M31 107.4Q36 106 41 106.6M80 106.6Q85 106 89 107.4"/>
</g></g></g>
<g transform="translate(46 99)"><g class="p legL"><g transform="translate(-46 -99)">
<rect class="o custard" x="40.8" y="93" width="10.4" height="13" rx="5.2"/>
<ellipse class="o custard" cx="44.6" cy="106.6" rx="8.4" ry="4.6"/>
<path class="toe" d="M39.6 105.2Q40.6 103.8 42.2 103.6"/>
</g></g></g>
<g transform="translate(74 99)"><g class="p legR"><g transform="translate(-74 -99)">
<rect class="o custard" x="68.8" y="93" width="10.4" height="13" rx="5.2"/>
<ellipse class="o custard" cx="75.4" cy="106.6" rx="8.4" ry="4.6"/>
<path class="toe" d="M80.4 105.2Q79.4 103.8 77.8 103.6"/>
</g></g></g>
<g class="body">
<path class="custard" d="M41 43.5Q42 38.5 47.5 38.5H72.5Q78 38.5 79 43.5Q87.7 68.3 90.6 94.5Q91.4 101 85 101H35Q28.6 101 29.4 94.5Q32.3 68.3 41 43.5Z"/>
<path class="shade" d="M78.4 46Q86.3 69 88.9 94.6Q89.3 99.4 84.6 99.4H81.6Q86.6 72 78.4 46Z"/>
<path class="gloss" d="M41 55Q39.6 59.6 38.8 63.8"/>
<circle class="gloss-dot" cx="81.4" cy="58.2" r="1.4"/>
<path class="o line" d="M41 43.5Q42 38.5 47.5 38.5H72.5Q78 38.5 79 43.5Q87.7 68.3 90.6 94.5Q91.4 101 85 101H35Q28.6 101 29.4 94.5Q32.3 68.3 41 43.5Z"/>
<path class="o caramel" d="M38.4 49.6L40.2 43.2Q41.4 37.2 47.6 36.9Q60 35.9 72.4 36.9Q78.6 37.2 79.8 43.2L81.6 49.6Q82 52.6 78.6 52.2Q72 51.1 66 52.6Q60 54 54 52.5Q48 51.1 41.5 52.2Q38 52.6 38.4 49.6Z"/>
<path class="caramel-hi" d="M45.5 41.2Q50 39.2 56 39.1"/>
</g>
<g transform="translate(60 51)"><g class="p drips"><g transform="translate(-60 -51)">
<path class="caramel" d="M41.9 47V54.2Q41.9 57.6 45 57.6Q48.1 57.6 48.1 54.2V47Z"/>
<path class="caramel" d="M56.4 48V56.4Q56.4 60.2 59.8 60.2Q63.2 60.2 63.2 56.4V48Z"/>
<path class="caramel" d="M70.8 47V53.4Q70.8 56.4 73.6 56.4Q76.4 56.4 76.4 53.4V47Z"/>
<path class="ln drip-ln" d="M41.9 51.9V54.2Q41.9 57.6 45 57.6Q48.1 57.6 48.1 54.2V51.6M56.4 53.3V56.4Q56.4 60.2 59.8 60.2Q63.2 60.2 63.2 56.4V53.4M70.8 51.5V53.4Q70.8 56.4 73.6 56.4Q76.4 56.4 76.4 53.4V52"/>
</g></g></g>
<path class="satba o2" d="M30.5 85.6Q60 89.4 89.5 85.6L90.6 93.1Q60 97.4 29.4 93.1Z"/>
<path class="satba-sh" d="M30.9 89.6Q60 93.6 89.1 89.6L89.8 92.2Q60 96.2 30.2 92.2Z"/>
<path class="o2 knot" d="M56.2 95.2L52.6 101.4L57.8 102L59.4 96.2ZM63.8 95.2L67.4 101.4L62.2 102L60.6 96.2Z"/>
<rect class="o2 knot" x="54.6" y="84.4" width="10.8" height="12.4" rx="3"/>
<path class="knot-ln" d="M56.6 87.4Q60.6 89.4 63.4 93.8"/>
<ellipse class="cheek" cx="42.6" cy="75.6" rx="4.4" ry="2.6"/>
<ellipse class="cheek" cx="77.4" cy="75.6" rx="4.4" ry="2.6"/>
<g class="face-a">
<path class="ln brow" d="M45.6 60.4L54.4 62M74.4 60.4L65.6 62"/>
<ellipse class="eye ink" cx="50.4" cy="67.6" rx="3.5" ry="4.4"/>
<ellipse class="eye ink" cx="69.6" cy="67.6" rx="3.5" ry="4.4"/>
<circle class="hl" cx="49.2" cy="65.9" r="1.35"/><circle class="hl" cx="68.4" cy="65.9" r="1.35"/>
<path class="o2 mouth" d="M54.8 73.4Q60 80.6 65.2 73.4Z"/>
<path class="tongue" d="M57.4 77.1Q60 79 62.6 77.1Q60 75.9 57.4 77.1Z"/>
</g>
<g class="face-s">
<path class="ln squint" d="M46.6 64.4L53.4 67.8L46.6 71.2M73.4 64.4L66.6 67.8L73.4 71.2"/>
<ellipse class="o2 mouth" cx="60" cy="76.2" rx="2.8" ry="3.2"/>
</g>
<g class="face-b">
<path class="ln brow" d="M45.4 59.8Q50 57.6 54.4 59.4M74.6 59.8Q70 57.6 65.6 59.4"/>
<path class="ln happy" d="M46.6 69.4Q50.4 63.4 54.2 69.4M65.8 69.4Q69.6 63.4 73.4 69.4"/>
<path class="o2 mouth" d="M52.6 72.8Q60 86 67.4 72.8Z"/>
<path class="tongue" d="M55.8 79.2Q60 83.2 64.2 79.2Q60 77.2 55.8 79.2Z"/>
</g>
<g class="face-c">
<path class="ln brow" d="M45.8 62.6L54 60.4M74.2 62.6L66 60.4"/>
<path class="ln" d="M45.6 66.2H55.2M64.8 66.2H74.4"/>
<path class="tear" d="M48.2 67.6V73.6M52.6 67.6V72.2M67.4 67.6V72.2M71.8 67.6V73.6"/>
<path class="ln thin" d="M54.6 78.6q1.35-1.8 2.7 0t2.7 0 2.7 0 2.7 0"/>
</g>
<g transform="translate(60 30)"><g class="p cherry"><g transform="translate(-60 -30)">
<path class="ln stem" d="M60.4 23.8Q60.4 17.4 65.2 13"/>
<path class="stem-c" d="M60.4 23.8Q60.4 17.4 65.2 13"/>
<path class="o2 leaf" d="M64.8 13.2Q70.4 7.4 75.4 10.6Q70.6 16.2 64.8 13.2Z"/>
<path class="leaf-ln" d="M66.4 12.8Q70.2 11.4 73.2 11"/>
<circle class="o2 cherry-c" cx="60" cy="30" r="6.8"/>
<ellipse class="hl" cx="57.6" cy="27.4" rx="1.9" ry="1.5"/>
</g></g></g>
<g transform="translate(33 68)"><g class="p armL"><g transform="translate(-33 -68)">
<g transform="rotate(28 33 68)">
<rect class="o custard" x="27.8" y="62.8" width="10.4" height="19.6" rx="5.2"/>
<circle class="o custard" cx="33" cy="83.2" r="5.6"/>
<path class="fist-ln" d="M30.2 83.6Q33 85.6 35.8 83.6"/>
</g>
</g></g></g>
<g transform="translate(87 68)"><g class="p armR"><g transform="translate(-87 -68)">
<g transform="rotate(-28 87 68)">
<rect class="o custard" x="81.8" y="62.8" width="10.4" height="19.6" rx="5.2"/>
<circle class="o custard" cx="87" cy="83.2" r="5.6"/>
<path class="fist-ln" d="M84.2 83.6Q87 85.6 89.8 83.6"/>
</g>
</g></g></g>
</svg>`,
  fx: `<svg class="fx" viewBox="0 0 120 120" aria-hidden="true">
<g class="fx-dust">
<g transform="translate(40 108)"><g class="p dustL">
<path class="puff" d="M-9.6 2.4A3.3 3.3 0 0 1-7.4-3.2A4.6 4.6 0 0 1 1.4-4.6A3.6 3.6 0 0 1 6.6 0.6Q7.2 2.4 5.4 2.4Z"/><path class="puff-ln" d="M-5.6-1.2Q-4.6-2.6-3-2.8"/>
</g></g>
<g transform="translate(80 108)"><g class="p dustR">
<path class="puff" d="M9.6 2.4A3.3 3.3 0 0 0 7.4-3.2A4.6 4.6 0 0 0-1.4-4.6A3.6 3.6 0 0 0-6.6 0.6Q-7.2 2.4-5.4 2.4Z"/><path class="puff-ln" d="M5.6-1.2Q4.6-2.6 3-2.8"/>
</g></g>
</g>
<g transform="translate(60 42)"><g class="p fx-flip">
<path class="flip-a" d="M-44 8A45 45 0 0 1 -14 -42.8M44 -8A45 45 0 0 1 14 42.8"/>
<path class="flip-b" d="M-36.6 -12A38.6 38.6 0 0 1 -6 -38.1M36.6 12A38.6 38.6 0 0 1 6 38.1"/>
</g></g>
<g transform="translate(60 110)"><g class="p fx-ring">
<ellipse class="ring-a" cx="0" cy="0" rx="34" ry="6.4"/>
<ellipse class="ring-b" cx="0" cy="0" rx="34" ry="6.4"/>
</g></g>
<g transform="translate(60 60)"><g class="p fx-burst">
<path class="burst-a" d="M-27.0 -32.2L-34.1 -40.6M27.0 -32.2L34.1 -40.6M-41.4 7.3L-52.2 9.2M41.4 7.3L52.2 9.2"/>
<path class="burst-b" d="M-41.3 -15.0L-48.9 -17.8M41.3 -15.0L48.9 -17.8M-33.7 28.3L-39.8 33.4M33.7 28.3L39.8 33.4"/>
</g></g>
<g transform="translate(60 30)"><g class="p fx-cherry">
<path class="fxc-stem" d="M0.4-6.2Q0.4-12.6 5.2-17"/>
<path class="fxc-stem-c" d="M0.4-6.2Q0.4-12.6 5.2-17"/>
<path class="fxc-leaf" d="M4.8-16.8Q10.4-22.6 15.4-19.4Q10.6-13.8 4.8-16.8Z"/>
<circle class="fxc-cherry" cx="0" cy="0" r="6.8"/>
<ellipse class="fxc-hl" cx="-2.4" cy="-2.6" rx="1.9" ry="1.5"/>
</g></g>
<g transform="translate(95 15)"><g class="p fx-sticker">
<rect class="seal-bg" x="-14.5" y="-14.5" width="29" height="29" rx="4"/>
<rect class="seal-ln" x="-11.6" y="-11.6" width="23.2" height="23.2" rx="2"/>
<text class="seal-txt" x="0" y="-1.4" text-anchor="middle">천하</text>
<text class="seal-txt" x="0" y="9.4" text-anchor="middle">장사</text>
</g></g>
<g class="fx-dizzy" transform="translate(60 54)">
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
<path class="star" d="M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z"/>
</g>
</svg>`,
};
