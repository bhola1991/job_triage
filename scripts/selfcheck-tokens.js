// Does every consumer still agree with the tokens?   node scripts/selfcheck-tokens.js
//
// Tokens reach CSS by hand here: no Style Dictionary, no build step, no
// generator. design/jobtriage.tokens.json is the source of truth and the same
// values are transcribed into index.html, ui-kit/src/v2/tokens.css and
// legal.css. Nothing verified that, and it drifted exactly as you would expect:
// legal.css was off on three of the seven tokens it carries, index.html's light
// shadows used a different shadow colour, the source of truth was missing
// shadow-md and the four dark row washes outright, and ui-kit's light theme
// never overrode the four -tint names its own components.css reads -- so every
// pill, outline button and callout rendered a dark translucent wash on white.
//
// This is that check. It does not generate anything; it only refuses to agree
// that four hand-maintained copies are the same when they are not.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const truth = JSON.parse(read('design/jobtriage.tokens.json'));
const norm = v => String(v).replace(/\s+/g, '').toUpperCase();
const decls = block => Object.fromEntries(
  [...block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));

/* The app and the kit disagree on ONE name, deliberately: the source of truth
   calls the light wash behind a chip "-chip", and index.html carries that value
   under the "-tint" name (its dark theme's name for the same role). ui-kit now
   defines both. So when checking the app, a "-chip" token is looked up as
   "-tint". This is a naming alias, not a second colour -- if the VALUES ever
   differ, that is drift and this check still catches it. */
const appAlias = k => k.replace(/-chip$/, '-tint');

let bad = 0;
const fail = m => { console.error(`  FAIL  ${m}`); bad++; };

function compare(label, sets, { alias = k => k, only = null } = {}) {
  let checked = 0;
  for (const [setName, block] of Object.entries(sets)) {
    const got = decls(block);
    for (const [key, meta] of Object.entries(truth[setName].color)) {
      if (only && !only.has(key)) continue;          // this file carries a subset
      const name = alias(key), have = got[name];
      if (have === undefined) fail(`${label}: ${setName}.${name} is not defined`);
      else if (norm(have) !== norm(meta.value)) fail(`${label}: ${setName}.${name} is ${have} — tokens say ${meta.value}`);
      else checked++;
    }
  }
  if (!bad) console.log(`  ok    ${label} — ${checked} values match`);
}

const grab = (src, re, what) => {
  const m = src.match(re);
  if (!m) { fail(`could not find ${what} — this check needs updating, not ignoring`); return ''; }
  return m[1];
};

console.log('tokens vs consumers:');

const app = read('index.html');
compare('index.html', {
  dark: grab(app, /\n {2}:root\{\s*\n\s*color-scheme:dark;([\s\S]*?)\n {2}\}/, "index.html's dark :root"),
  light: grab(app, /:root\[data-theme="light"\]\{\s*\n\s*color-scheme:light;([\s\S]*?)\n {2}\}/, "index.html's light :root"),
}, { alias: appAlias });

const kit = read('ui-kit/src/v2/tokens.css');
const [kitDark, kitLight] = kit.split('[data-palette="v2"][data-theme="light"]');
compare('ui-kit/src/v2/tokens.css', { dark: kitDark, light: kitLight });

// legal.css carries only the handful the public pages actually use.
const legal = read('legal.css');
const LEGAL_ONLY = new Set(['ink', 'panel', 'line', 'text', 'muted', 'go']);
compare('legal.css', {
  dark: grab(legal, /:root\{ color-scheme:dark;([\s\S]*?)\}/, "legal.css's dark :root"),
  light: grab(legal, /:root\{ color-scheme:light;([\s\S]*?)\}/, "legal.css's light :root"),
}, { only: LEGAL_ONLY });

/* Every token the kit's CSS reads must exist in BOTH themes. A token defined in
   only one silently falls through to the other theme's value, which is how the
   light pills came to render a dark translucent tint. Fonts are exempt: they do
   not change per theme. */
console.log('\nui-kit token resolution:');
const FONTS = new Set(['--disp', '--mono']);
const used = new Set([...read('ui-kit/src/v2/components.css').matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]));
const inDark = new Set(Object.keys(decls(kitDark)).map(k => '--' + k));
const inLight = new Set(Object.keys(decls(kitLight)).map(k => '--' + k));
for (const t of [...used].sort()) {
  if (FONTS.has(t)) continue;
  if (!inDark.has(t) && !inLight.has(t)) fail(`components.css reads ${t}, which tokens.css never defines`);
  else if (!inLight.has(t)) fail(`components.css reads ${t}, defined only in dark — light falls through to the dark value`);
  else if (!inDark.has(t)) fail(`components.css reads ${t}, defined only in light`);
}
if (!bad) console.log(`  ok    all ${used.size} tokens components.css reads resolve in both themes`);

/* Accent-as-text on its own tint must clear WCAG AA (4.5:1 for the 11-13px this
   is used at). It did not, in both themes, and nothing noticed: light --go was
   4.25 and --due 4.34, dark --due 3.08 and --awaiting 3.78 against the lightest
   surface they sit on. Dark --due could not be fixed by changing the wash -- it
   measured 3.59 even with no tint at all -- so the accents themselves moved.
   Measured against the worst surface each can land on, which is --panel2 in
   dark (the lightest) and the chip itself in light. */
console.log('\naccent-on-tint and accent-on-row contrast (AA needs 4.5:1):');
const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const rgb = (hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = (hex) => { const [r, g, b] = rgb(hex); return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// Flatten a translucent tint onto the surface behind it.
const flatten = (value, surface) => {
  const m = value.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([.\d]+)\)/);
  if (!m) return value;                                  // already opaque
  const [, r, g, b, a] = m, al = parseFloat(a), base = rgb(surface);
  const mix = [r, g, b].map((c, i) => Math.round(+c * al + base[i] * (1 - al)));
  return '#' + mix.map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('');
};
const AA = 4.5;
for (const [label, block, surface] of [['dark', kitDark, '--panel2'], ['light', kitLight, null]]) {
  const t = decls(block);
  for (const tone of ['go', 'due', 'closing', 'awaiting']) {
    const fg = t[tone];
    if (!fg) { fail(`${label}: --${tone} missing`); continue; }
    /* Two backgrounds, because the accent is used as text on both: the chip
       (.pill2/.callout/.btn2.outline) and the whole-row wash (.qfact .v.<tone>
       in the app). The chip sits on an arbitrary surface, so it is measured
       against the lightest one it can land on; the row only ever sits on the
       page, so it is measured against --ink. */
    for (const [part, against] of [['tint', surface], ['row', '--ink']]) {
      const value = t[`${tone}-${part}`];
      if (!value) { fail(`${label}: --${tone}-${part} missing`); continue; }
      const base = against ? t[against.replace('--', '')] : '#FFFFFF';
      const bg = flatten(value, base);
      const r = ratio(fg, bg);
      if (r < AA) fail(`${label}: --${tone} ${fg} on its ${part} (${bg}) is ${r.toFixed(2)}:1, needs ${AA}:1`);
      else console.log(`  ok    ${label} --${tone} ${fg} on ${part} ${bg} = ${r.toFixed(2)}:1`);
    }
  }
}

console.log(bad ? `\n${bad} problem(s). A token change is four edits, in one commit: design/jobtriage.tokens.json,\nui-kit/src/v2/tokens.css, index.html's two :root blocks, and legal.css.` : '\nALL PASS');
process.exit(bad ? 1 : 0);
