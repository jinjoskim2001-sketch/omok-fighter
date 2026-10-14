// js/chars/jaepjaep.js — 잽잽 Jaepjaep, the boxer bunny (docs/SPEC.md §8.5, docs/research/characters.md §4.5)
// Art + rig + timeline data only. All motion lives in css/chars/jaepjaep.css; js/fighter.js builds the
// stage around `svg` + `fx` and fires `cues` from the .rig's `jaepjaep-win` clock.
//
// Rig notes
// - Every animated part is a "joint sandwich": <g transform="translate(jx jy)"><g class="p name"> … so the
//   part's local 0,0 is its joint (shoulder, hip, neck, ear root, ear fold, glove centre).
// - Arms are rubber-hose: armL/armR rotate at the shoulder; inside, a static rest rotation (±30°) makes the
//   arm point along local −Y, so foreL/foreR can stretch with scale(1,k) and gloveL/gloveR slide out along
//   the arm with translate(0, −17(k−1)). Guard = k 1, champion V / uppercut = k ≈ 2.8.
// - The right ear is folded: earR (root) carries a nested earTip (fold joint) that springs.
// - Strings are built once at import; the result is plain static markup (no ids, no filters, no gradients).

const J = (x, y, cls, inner) =>
  `<g transform="translate(${x} ${y})"><g class="p ${cls}"><g transform="translate(${-x} ${-y})">${inner}</g></g></g>`;

// n-point comic starburst around (cx,cy) as a closed path
function star(cx, cy, R, r, n, rot = 0) {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a = (rot + (i * 180) / n - 90) * Math.PI / 180;
    const k = i % 2 ? r : R;
    d += (i ? 'L' : 'M') + (cx + Math.cos(a) * k).toFixed(1) + ' ' + (cy + Math.sin(a) * k).toFixed(1);
  }
  return d + 'Z';
}

const ARM = 19;   // shoulder → glove centre at rest

// one arm, drawn in front of the head. side 'L' | 'R'
function arm(side) {
  const L = side === 'L';
  const sx = L ? 49 : 71, sy = 82, rest = L ? -30 : 30;
  const g = -ARM;                       // glove centre on local Y
  const thumb = L                       // thumb crease on the inner side (toward the body centre)
    ? `M4.6 ${g + 6.4}Q8.6 ${g + 2.2} 7.4 ${g - 3.4}`
    : `M-4.6 ${g + 6.4}Q-8.6 ${g + 2.2} -7.4 ${g - 3.4}`;
  const shine = L                       // highlight on the upper-outer side
    ? `M-6.8 ${g - 2.6}Q-5.2 ${g - 7.4} -0.6 ${g - 8.4}`
    : `M6.8 ${g - 2.6}Q5.2 ${g - 7.4} 0.6 ${g - 8.4}`;
  const shade = L
    ? `M-8.6 ${g + 4.4}Q-4 ${g + 10.2} 4.2 ${g + 8.6}Q-2.6 ${g + 7.6} -8.6 ${g + 4.4}Z`
    : `M8.6 ${g + 4.4}Q4 ${g + 10.2} -4.2 ${g + 8.6}Q2.6 ${g + 7.6} 8.6 ${g + 4.4}Z`;
  const glove =
    `<path class="fx-hit${side} hit" d="${star(0, g, 17.5, 11.8, 10, L ? 8 : -8)}"/>` +
    `<rect class="o2 cuff" x="-5.6" y="${g + 7.4}" width="11.2" height="6.2" rx="2"/>` +
    `<circle class="o glove" cx="0" cy="${g}" r="10.5"/>` +
    `<path class="glove-sh" d="${shade}"/>` +
    `<path class="crease" d="${thumb}"/>` +
    `<path class="shine" d="${shine}"/>`;
  return `<g transform="translate(${sx} ${sy})"><g class="p arm${side}"><g transform="rotate(${rest})">` +
    `<circle class="ink" cx="0" cy="0" r="5.8"/>` +
    `<g transform="translate(0 0)"><g class="p fore${side}">` +
      `<path class="tube-ink" d="M0 0V${g}"/><path class="tube-fur" d="M0 0V${g}"/>` +
    `</g></g>` +
    `<circle class="fur" cx="0" cy="0" r="2.8"/>` +
    `<g transform="translate(0 ${g})"><g class="p glove${side}"><g transform="translate(0 ${-g})">${glove}</g></g></g>` +
  `</g></g></g>`;
}

const EAR_L =
  `<path class="o fur" d="M44 34Q37.6 4.5 49.6 2Q59.2 3.6 56.2 34Z"/>` +
  `<path class="ear-in" d="M47.6 29.5Q43.8 10.5 49.8 7Q54.6 10 53.2 29.5Z"/>`;

// folded right ear: root (with band-aid on the fold) + springy tip
const EAR_TIP =
  `<g transform="rotate(116)"><path class="o fur-sh" d="M-5.6 2Q-7 -12.6 0 -16.4Q7 -12.6 5.6 2Z"/>` +
  `<path class="fold" d="M-3.4 -2.6Q0 -0.8 3.4 -2.6"/></g>`;
const EAR_R =
  `<path class="o fur" d="M64 34Q62.4 18.4 66 14.4Q70 12 74 14.4Q77.6 18.4 76 34Z"/>` +
  `<path class="ear-in" d="M67.2 30Q66.3 21 68.3 17.8Q70 16.8 71.7 17.8Q73.7 21 72.8 30Z"/>` +
  `<g transform="translate(70 15.6)"><g class="p earTip">${EAR_TIP}</g></g>` +
  `<g transform="rotate(-14 70 18.6)"><rect class="aid" x="62.6" y="15.9" width="14.8" height="5.4" rx="2"/>` +
  `<rect class="aid-pad" x="67.4" y="16.9" width="5.2" height="3.4" rx=".8"/>` +
  `<path class="aid-dot" d="M64.6 17.7v.1M64.6 19.5v.1M75.4 17.7v.1M75.4 19.5v.1"/></g>`;

const FACE_A =
  `<g class="face-a">` +
  `<path class="ln" d="M43.8 44.4L54.2 47.4M76.2 44.4L65.8 47.4"/>` +
  `<ellipse class="eye ink" cx="50" cy="53.2" rx="3.4" ry="4.3"/><ellipse class="eye ink" cx="70" cy="53.2" rx="3.4" ry="4.3"/>` +
  `<circle class="hl" cx="48.9" cy="51.6" r="1.3"/><circle class="hl" cx="68.9" cy="51.6" r="1.3"/>` +
  `<path class="ln" d="M55.6 61.6Q57.8 64.2 60 61.8Q62.2 64.2 64.4 61.6" stroke-width="2"/>` +
  `<rect class="tooth" x="57.5" y="62.2" width="5" height="3.8" rx=".9"/><path class="tooth-ln" d="M60 62.4V65.8"/>` +
  `</g>`;
const FACE_B =   // victory: ^^ eyes, big open grin with the buck teeth
  `<g class="face-b">` +
  `<path class="ln" d="M43.6 43.2Q48.6 39.6 54 42.4M76.4 43.2Q71.4 39.6 66 42.4"/>` +
  `<path class="ln" d="M45.4 55Q50 48.6 54.6 55M65.4 55Q70 48.6 74.6 55" stroke-width="2.8"/>` +
  `<path class="mouth" d="M53 61Q60 74.5 67 61Z"/>` +
  `<path class="tongue" d="M56.3 68Q60 71.6 63.7 68Q60 65.8 56.3 68Z"/>` +
  `<rect class="tooth" x="57.5" y="61" width="5" height="3.8" rx=".9"/><path class="tooth-ln" d="M60 61.2V64.6"/>` +
  `</g>`;
const FACE_C =   // lose: X eyes, tongue out
  `<g class="face-c">` +
  `<path class="ln" d="M46.4 49.6l7.2 7.2M53.6 49.6l-7.2 7.2M66.4 49.6l7.2 7.2M73.6 49.6l-7.2 7.2"/>` +
  `<path class="mouth" d="M55.4 62.4Q60 59.6 64.6 62.4Q64 67.4 60 67.6Q56 67.4 55.4 62.4Z"/>` +
  `<path class="tongue" d="M60.2 64.4Q64.8 64.2 64.6 68.8Q64.2 71.6 61.6 71Q59.4 70.2 60.2 64.4Z" stroke="var(--ink)" stroke-width="1.6"/>` +
  `<rect class="tooth" x="56.4" y="61.2" width="4.6" height="3.4" rx=".9"/>` +
  `</g>`;
const FACE_D =   // effort: > < eyes, gritted teeth (wind-up, uppercut, getting hit)
  `<g class="face-d">` +
  `<path class="ln" d="M43.4 44.6L54.6 49.4M76.6 44.6L65.4 49.4"/>` +
  `<path class="ln" d="M45.6 50.2L53.4 53.6L45.6 57M74.4 50.2L66.6 53.6L74.4 57" stroke-width="2.8"/>` +
  `<rect class="tooth" x="53.6" y="60.4" width="12.8" height="6.2" rx="2.4" stroke="var(--ink)" stroke-width="2"/>` +
  `<path class="tooth-ln" d="M54.4 63.5H65.6M57.6 60.8V66.2M60 60.8V66.2M62.4 60.8V66.2"/>` +
  `</g>`;

const HEAD =
  J(50, 31, 'earL', EAR_L) +
  J(70, 31, 'earR', EAR_R) +
  `<ellipse class="o fur" cx="60" cy="52" rx="25.5" ry="23"/>` +
  `<path class="fur-sh" d="M38.6 63.4Q45 73 60 73.4Q75 73 81.4 63.4Q78 72.4 60 73.6Q42 72.4 38.6 63.4Z"/>` +
  `<ellipse class="cheek" cx="44.6" cy="61" rx="4.6" ry="2.7"/><ellipse class="cheek" cx="75.4" cy="61" rx="4.6" ry="2.7"/>` +
  `<path class="nose" d="M57.5 57.9Q60 56.9 62.5 57.9L60 60.6Z"/>` +
  FACE_A + FACE_B + FACE_C + FACE_D;

const LEG = (x) =>
  `<rect class="o fur" x="${x - 4.6}" y="95" width="9.2" height="11" rx="4.6"/>` +
  `<ellipse class="o fur" cx="${x}" cy="106.6" rx="9" ry="5"/>` +
  `<path class="toe" d="M${x - 3} 109.2v-2M${x + 0.4} 109.6v-2.2M${x + 3.8} 109.2v-2"/>`;

const BODY =
  `<g class="body">` +
  `<path class="o fur" d="M45 87Q45 74 60 74Q75 74 75 87V92Q75 101 60 101Q45 101 45 92Z"/>` +
  `<path class="o2 trunks" d="M45 88.6H75V93Q75 101 60 101Q45 101 45 93Z"/>` +
  `<path class="trunks-sh" d="M46.6 95.6Q60 101 73.4 95.6Q71.6 99.6 60 99.8Q48.4 99.6 46.6 95.6Z"/>` +
  `<path class="stripe" d="M48.2 92V97.6M71.8 92V97.6"/>` +
  `<path class="split" d="M60 95.4V100.4"/>` +
  `<rect class="o2 band" x="44.4" y="86.4" width="31.2" height="4.2" rx="1.6"/>` +
  `</g>`;

const TOWEL =    // lose: the towel thrown in lands on the belly (lives in the rig so it lies with the body)
  J(60, 86, 'fx-towel', `<path class="o2 towel" d="M45.4 78.6Q60 75.2 74.6 78.6L76.2 95.4Q60 99.4 43.8 95.4Z"/>` +
    `<path class="towel-st" d="M45.8 82.4Q60 79.4 74.2 82.4M44.8 91.6Q60 95.2 75.2 91.6"/>` +
    `<path class="towel-fr" d="M45.6 97.2v2.6M49.8 98v2.6M54 98.6v2.6M58.2 98.9v2.6M62.4 98.9v2.6M66.6 98.6v2.6M70.8 98v2.6M75 97.2v2.6"/>`);

const SVG =
  `<svg class="ch ch-jaepjaep" viewBox="0 0 120 120" role="img" aria-label="잽잽">` +
  J(49, 101, 'legL', LEG(49)) +
  J(71, 101, 'legR', LEG(71)) +
  BODY +
  J(60, 74, 'head', HEAD) +
  arm('L') + arm('R') +
  TOWEL +
  `</svg>`;

const DIZZY_STAR = 'M0-5l1.5 3.2 3.5.4-2.6 2.4.7 3.5L0 2.8l-3.1 1.7.7-3.5-2.6-2.4 3.5-.4Z';
const FONT = `font-family="'BHS',system-ui,-apple-system,'Apple SD Gothic Neo',sans-serif" font-weight="900"`;
const ding = (x, y, n, rot) =>
  `<g transform="translate(${x} ${y})"><g class="p fx-ding d${n}"><g transform="rotate(${rot})">` +
  `<text class="sticker-t" x="0" y="4.6" text-anchor="middle" font-size="13" ${FONT}>땡!</text></g></g></g>`;

const FXSVG =
  `<svg class="fx" viewBox="0 0 120 120" aria-hidden="true">` +
  // speed lines under the uppercut leap
  `<g transform="translate(60 104)"><g class="p fx-speed"><g transform="translate(-60 -104)">` +
    `<path class="spd-ink" d="M47 99V115M55 102V120M65 102V120M73 99V115"/>` +
    `<path class="spd" d="M47 99V115M55 102V120M65 102V120M73 99V115"/>` +
  `</g></g></g>` +
  // KO! comic burst where the uppercut lands
  `<g transform="translate(96 6)"><g class="p fx-pow"><g transform="rotate(-10)">` +
    `<path class="pow" d="${star(0, 0, 21, 13.5, 12)}"/>` +
    `<path class="pow-in" d="${star(0, 0, 15.5, 11.2, 12, 15)}"/>` +
    `<text class="pow-t" x="0" y="5.6" text-anchor="middle" font-size="15.5" ${FONT}>KO!</text>` +
  `</g></g></g>` +
  // 땡땡땡 — the ring bell, three times
  ding(12, 24, 1, -14) + ding(107, 78, 2, 12) + ding(31, 3, 3, -8) +
  // shared dizzy stars (lose); .dz places them over the head of the knocked-down bunny
  `<g class="dz"><g class="fx-dizzy" fill="#FFC83D" stroke="#2A1E2F" stroke-width="1.4" stroke-linejoin="round">` +
    `<path class="star" d="${DIZZY_STAR}"/><path class="star" d="${DIZZY_STAR}"/><path class="star" d="${DIZZY_STAR}"/>` +
  `</g></g>` +
  `</svg>`;

export default {
  id: 'jaepjaep', ko: '잽잽', en: 'Jaepjaep', tagline: '근성 만렙 복서',
  type: '토끼',
  color: '#FF5C93', colorAlt: '#3D7BFF',
  bg: ['#E0457B', '#5A1233'],
  winMs: 2400, hitAt: 1.70, excerptFrom: 1.40,
  quote: { win: '원, 투, 오목! 케이오!', winEn: 'One, two, OMOK! K.O.!', lose: '아직 안 끝났어! 다음 라운드!' },
  anchors: { head: [60, 34], center: [60, 72], feet: [60, 110], sky: [60, -12], fist: [74, 2] },
  cues: [
    { t: 0.33, sfx: 'PUNCH' },
    { t: 0.48, sfx: 'PUNCH' },
    { t: 0.64, sfx: 'PUNCH' },
    { t: 0.74, sfx: 'PUNCH' },
    { t: 1.06, sfx: 'HUP' },
    { t: 1.12, sfx: 'WHOOSH' },
    { t: 1.18, sfx: 'PUNCH', fx: 'sparkle', at: 'fist', shake: 140 },
    { t: 1.22, sfx: 'BELL' },
    { t: 1.38, sfx: 'BELL' },
    { t: 1.42, fx: 'dust', at: 'feet' },
    { t: 1.45, fx: 'sweat', at: 'head' },
    { t: 1.54, sfx: 'BELL' },
    { t: 1.70, fx: 'confetti', at: [60, 26] },
    { t: 1.72, fx: 'sparkle', at: [60, 16] },
  ],
  turnSfx: 'SWISH',
  jingle: { at: 1.70, voices: [
    { wave: 'square', gain: 0.07, lowpass: 3200, notes: 'C5:100 -:20 C5:100 E5:100 G5~:400' },
    { drums: 'K:120 K:100 S:100 BELL:400' },
  ] },
  portrait: '21 2 78 78',
  svg: SVG,
  fx: FXSVG,
};
