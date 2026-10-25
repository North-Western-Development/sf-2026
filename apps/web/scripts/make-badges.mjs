// Generates the pixel-art badge icons in public/badges from the maps below:
//   node scripts/make-badges.mjs
// One character per pixel; '.' is transparent. File names match the badge codes in
// COMMENDATION_CATALOG (packages/database/src/commendations.ts), lowercased.
// Ladder badges use C (main) and c (shade), recoloured per level from grey to gold.
import fs from 'node:fs';
import path from 'node:path';

const FIXED = {
  Y: '#ffff66', // star yellow
  W: '#ffffff', // star core
  B: '#3ccbff', // NWD blue (light)
  D: '#3350d6', // NWD blue (deep)
  V: '#55578a', // slate-violet outline
  K: '#1b1d33', // dark fill
};

const SINGLE = {
  // Shield with the NWD star.
  staff: `
..VVVVVVVV..
.VDDDDDDDDV.
.VDDDDYDDDV.
.VDDDYYYDDV.
.VDYYYWYYYV.
.VDDDYYYDDV.
.VDDDDYDDDV.
.VDDDDDDDDV.
..VDDDDDDV..
...VDDDDV...
....VDDV....
.....VV.....`,
  // Antenna sending its first signal.
  early_transmitter: `
.B........B.
B..B....B..B
B.B..YY..B.B
B.B.YWWY.B.B
B..B.YY.B..B
.B...VV...B.
.....VV.....
....VKKV....
....VKKV....
...VKKKKV...
...VKKKKV...
..VVVVVVVV..`,
};

const LADDERS = {
  // Headset.
  comm_link: {
    levels: 8,
    map: `
...CCCCCC...
..CC....CC..
.Cc......cC.
.C........C.
.C........C.
CCC......CCC
CcC......CcC
CcC......CcC
CCC......CCC
.........C..
.......CCC..
............`,
  },
  // Speech bubble with three dots.
  signal: {
    levels: 6,
    map: `
............
..CCCCCCCC..
.CCCCCCCCCC.
.CCCCCCCCCC.
.CCWCCWCCWC.
.CCWCCWCCWC.
.CCCCCCCCCC.
.cCCCCCCCCc.
..cccccccc..
...Cc.......
..Cc........
............`,
  },
  // A planet with an orbit.
  orbit: {
    levels: 4,
    map: `
...........W
.....ccc..W.
...ccCCCcW..
..cCCCCCWc..
..cCCCCWCc..
.cCCCCWCCCc.
.cCCCWCCCCc.
..cCWCCCCc..
..cWCCCCCc..
..WccCCCcc..
.W...ccc....
W...........`,
  },
};

// Level colours from grey through green, blue and violet to gold.
const SPECTRUM = ['#9aa3b5', '#a3e635', '#3be38f', '#2dd4bf', '#3ccbff', '#9b7bff', '#ff6bd6', '#ffd23f'];
const pick = (levels) => (levels >= SPECTRUM.length ? SPECTRUM : Array.from({ length: levels }, (_, i) => SPECTRUM[Math.round((i * (SPECTRUM.length - 1)) / (levels - 1))]));
const shade = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(v * 0.62).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
};

function svg(map, palette) {
  const rects = [];
  map
    .trim()
    .split('\n')
    .forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch !== '.') rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[ch]}"/>`);
      })
    );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" shape-rendering="crispEdges">${rects.join('')}</svg>\n`;
}

const out = path.resolve(import.meta.dirname, '../public/badges');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let n = 0;
for (const [name, map] of Object.entries(SINGLE)) {
  fs.writeFileSync(path.join(out, `${name}.svg`), svg(map, FIXED));
  n++;
}
for (const [family, { levels, map }] of Object.entries(LADDERS)) {
  pick(levels).forEach((colour, i) => {
    fs.writeFileSync(path.join(out, `${family}_${i + 1}.svg`), svg(map, { ...FIXED, C: colour, c: shade(colour) }));
    n++;
  });
}
console.log(`Wrote ${n} badges to ${out}`);
