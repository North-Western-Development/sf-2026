// Builds src/lib/emoji-data.json from emoji-datasource-twitter (Twemoji, the set Discord uses):
//   node scripts/make-emoji-data.mjs
// Each entry: [emoji, shortcode, otherShortcodes, categoryIndex, sheetX, sheetY, skinTones?]
// where skinTones maps a tone index (1-5) to [emoji, sheetX, sheetY].
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const all = require('emoji-datasource-twitter/emoji.json');

const CATEGORIES = ['Smileys & Emotion', 'People & Body', 'Animals & Nature', 'Food & Drink', 'Activities', 'Travel & Places', 'Objects', 'Symbols', 'Flags'];
const TONES = ['1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF'];
const chars = (unified) => String.fromCodePoint(...unified.split('-').map((h) => parseInt(h, 16)));

const list = all
  // Keep "obsoleted" entries: the data marks gender-neutral forms (🧟 zombie) as obsoleted, but Discord lists them.
  .filter((e) => e.has_img_twitter && CATEGORIES.includes(e.category))
  .sort((a, b) => a.sort_order - b.sort_order)
  .map((e) => {
    const row = [chars(e.unified), e.short_name, e.short_names.filter((n) => n !== e.short_name), CATEGORIES.indexOf(e.category), e.sheet_x, e.sheet_y];
    if (e.skin_variations) {
      const tones = {};
      TONES.forEach((t, i) => {
        const v = e.skin_variations[t];
        if (v?.has_img_twitter) tones[i + 1] = [chars(v.unified), v.sheet_x, v.sheet_y];
      });
      if (Object.keys(tones).length) row.push(tones);
    }
    return row;
  });

const size = Math.max(...all.map((e) => Math.max(e.sheet_x, e.sheet_y))) + 1;
const out = { categories: CATEGORIES, sheetSize: size, emoji: list };
const file = path.resolve(import.meta.dirname, '../src/lib/emoji-data.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(`Wrote ${list.length} emoji (${(fs.statSync(file).size / 1024).toFixed(0)} KB), sheet ${size}x${size} cells`);
