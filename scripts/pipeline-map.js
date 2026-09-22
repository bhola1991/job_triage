// What happens to a job after it arrives?   node scripts/pipeline-map.js [--check]
//
// Nothing in this repo answers that. README.md tells the story in prose,
// scripts/index/README.md tells a different story about a different
// architecture, and the real answer is spread across three runtimes: vanilla JS
// in index.html, TypeScript on Deno in supabase/functions/api/index.ts, and SQL
// in schema.sql and billing.sql. The de-facto map is the 36 section banners in
// index.html, which CLAUDE.md documents as "grep for these".
//
// This writes that map as Mermaid diagrams into an Obsidian vault.
//
// WHY IT IS NOT A PARSER. The obvious build is to read the source and infer the
// call graph. That fails here twice over: 4,670 lines of IIFE-scoped vanilla JS
// plus TS plus SQL produces hundreds of nodes nobody can read, and the facts
// worth drawing -- which branch means what, what costs a credit, where a row is
// silently dropped -- are not in the syntax at all. A generator that guesses
// emits a confident wrong diagram, which is worse than no diagram.
//
// So the topology is DECLARED, in pipeline-map.spec.js, and three things are
// MACHINE-CHECKED against source on every run:
//
//   anchors    every node points at a declaration that still exists, exactly
//              once. Zero matches means renamed or deleted; two or more means
//              the line number would be a coin toss. Both are failures.
//   coverage   every member of an enumerable set -- edge-function actions,
//              hosted() call sites, SQL objects, section banners -- is either
//              mapped or listed as out of scope with a reason. This is what
//              catches the node you forgot, which anchors alone cannot.
//   constants  every number shown is read out of the source. A label says
//              {MIN_FIT}, never 50, so changing the threshold changes the map.
//
// What none of that proves is that the ARROWS are right. An edge can be drawn
// backwards and every check stays green. The diagram is a curated map whose
// landmarks are verified, not a proof of control flow -- see "What this does
// not capture" in the index note, which says so to the reader too.
//
// Line numbers are never written down here. They drift: when this was built,
// a hours-old trace already had addJobs at 2138 (really 2137), liveBoard at
// 2510 (really 2497) and KEEP_TOP at 2211 (really 2166).
// Flags:
//   --check          resolve and verify everything, write nothing. This is the
//                    form CLAUDE.md §8 names; the bare command writes notes.
//   --render-check   after writing, parse every diagram with Obsidian's own
//                    mermaid. SKIPs loudly if Obsidian is not running.
//   --out <dir>      where the notes go (default: the vault).
//   --root <dir>     read source from a copy instead of this repo, so the
//                    failure paths can be tested without touching tracked files.
//   --accept <id>    print a node's current body hash. Never writes the spec:
//                    a one-keystroke accept is how a tripwire becomes a rubber
//                    stamp. --accept all prints them all.
//   --dump-probe     print the javascript sent to Obsidian and exit. Kept
//                    because that string is built inside a template literal,
//                    where \n and \s are silently eaten -- which cost an hour
//                    once, and produced a probe that died before its own catch.
const fs = require('fs'), path = require('path');

const argv = process.argv.slice(2);
const has = n => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const ROOT = path.resolve(opt('root', path.join(__dirname, '..')));
const CHECK_ONLY = has('check');
const OUT = path.resolve(opt('out', '/home/bhola/Work/notes/Job Triage Pipeline'));
const ACCEPT = opt('accept', null);
const MAX_NODES = 28;

const spec = require(path.join(__dirname, 'pipeline-map.spec.js'));

let bad = 0, warned = 0;
const fail = m => { console.error(`  FAIL  ${m}`); bad++; };
const ok = m => console.log(`  ok    ${m}`);
const warn = m => { console.log(`  WARN  ${m}`); warned++; };

const cache = new Map();
function src(f) {
  if (!cache.has(f)) {
    try { cache.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')); }
    catch (e) { cache.set(f, null); }
  }
  return cache.get(f);
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

/* ── anchors ──────────────────────────────────────────────────────────────
   Each kind names something a human deliberately chose -- a declaration, a
   wire-protocol string, a SQL object. Renaming one of those is an intentional
   act that SHOULD break the map. What must never be anchored is comment text,
   indentation, or a generic fragment: those move for reasons that have nothing
   to do with the pipeline, and the map would cry wolf until nobody read it. */
const PATTERNS = {
  fn:    n => new RegExp(`^[ \\t]*(?:async\\s+)?function\\s+${esc(n)}\\s*\\(`, 'gm'),
  const: n => new RegExp(`^[ \\t]*const\\s+[^;\\n]*\\b${esc(n)}\\s*=`, 'gm'),
  arrow: n => new RegExp(`^[ \\t]*const\\s+${esc(n)}\\s*=\\s*(?:async\\s*)?\\(?`, 'gm'),
  case:  n => new RegExp(`^[ \\t]*case\\s+["']${esc(n)}["']\\s*:`, 'gm'),
  sql:   n => new RegExp(`^create\\s+(?:table\\s+(?:if\\s+not\\s+exists\\s+)?|or\\s+replace\\s+function\\s+|policy\\s+)"?${esc(n)}\\b`, 'gim'),
  re:    p => new RegExp(p, 'gm'),
};
const KINDS = Object.keys(PATTERNS);

function resolveAnchor(id, anchor) {
  const kind = KINDS.find(k => k in anchor);
  if (!kind) { fail(`node ${id} — anchor declares no kind (want one of ${KINDS.join(', ')})`); return null; }
  const text = src(anchor.file);
  if (text === null) { fail(`node ${id} — cannot read ${anchor.file}`); return null; }
  const hits = [...text.matchAll(PATTERNS[kind](anchor[kind]))];
  if (hits.length === 0) {
    fail(`node ${id} — ${kind} anchor "${anchor[kind]}" matched 0 times in ${anchor.file}.\n        Renamed, moved, or deleted — decide which, then fix the anchor in\n        scripts/pipeline-map.spec.js. Do not delete the node to make this pass.`);
    return null;
  }
  if (hits.length > 1) {
    const lines = hits.map(h => lineOf(text, h.index)).join(', ');
    fail(`node ${id} — ${kind} anchor "${anchor[kind]}" matched ${hits.length} times in ${anchor.file}, at lines ${lines}.\n        An anchor that matches more than once would pick a line at random, so this\n        is a failure and not a warning. Narrow it.`);
    return null;
  }
  const line = lineOf(text, hits[0].index);
  return { file: anchor.file, line, matched: hits[0][0].split('\n')[0].trim() };
}

/* Re-read the line we are about to print and confirm it still contains what the
   anchor matched. Off-by-one in offset->line arithmetic is the single most
   likely bug in this program, and it would be invisible: a plausible, wrong
   number in every note. */
function auditLine(id, r) {
  const lines = src(r.file).split('\n');
  const got = (lines[r.line - 1] || '').trim();
  if (!got.includes(r.matched.slice(0, Math.min(24, r.matched.length)))) {
    fail(`node ${id} — emitted ${r.file}:${r.line} but that line reads "${got.slice(0, 50)}", not the anchor match. Line arithmetic is wrong.`);
    return false;
  }
  return true;
}

/* ── section banners ──────────────────────────────────────────────────────
   index.html is one file sectioned by /* ═══ heading ═══ comments, and
   CLAUDE.md §7 says outright that grepping them is how you navigate it. They
   are a second, coarser landmark system: a function moving WITHIN its section
   is routine, but one crossing into another section is a structural change
   worth reading before the map is updated to match. */
function banners() {
  const text = src('index.html');
  return [...text.matchAll(/\/\*+\s*═+\s*([^═]+?)\s*═+/g)]
    .map(m => ({ line: lineOf(text, m.index), name: m[1].trim() }));
}
function sectionOf(line, bs) {
  let cur = null;
  for (const b of bs) { if (b.line <= line) cur = b.name; else break; }
  return cur;
}

/* ── constants ────────────────────────────────────────────────────────────
   Read out of source so a label can say {MIN_FIT} and follow it. Anything that
   is not a flat literal fails: the diagram cannot honestly show the value of a
   computed expression, so it must not pretend to. */
function readConst(name, file, opt) {
  const isObject = opt.object, isStringMap = opt.strings;
  const text = src(file);
  if (text === null) { fail(`constant ${name} — cannot read ${file}`); return null; }
  /* The optional `: ...` is a TypeScript type annotation -- `const X: Record<string, string> = {`.
     It has to be anchored to a colon and not just "anything up to the next =": the loose
     form also matched the name being READ inside some other const's initialiser, where the
     next = belongs to a >= comparison (`const overBar = j => fitOf(j)>=WORK_FIT && ...>=`). */
  const hits = [...text.matchAll(new RegExp(`^[ \\t]*(?:export\\s+)?const\\s+[^;\\n]*\\b${esc(name)}\\b\\s*(?::[^=;\\n]*)?=\\s*`, 'gm'))];
  if (hits.length !== 1) { fail(`constant ${name} — declaration matched ${hits.length} times in ${file}; want exactly 1`); return null; }
  const rest = text.slice(hits[0].index + hits[0][0].length);
  /* A list of names rather than a value: the ten flag codes, spelled as an
     object's keys in one runtime and an array's members in the other. Sorted,
     because the two files agreeing on the SET is the thing worth asserting --
     failing over the order they happen to be written in would be a check that
     cries wolf, and those stop being read. */
  if (opt.keys || opt.array) {
    const m = rest.match(opt.keys ? /^\{([^}]*)\}/ : /^\[([^\]]*)\]/);
    if (!m) { fail(`constant ${name} — expected a flat ${opt.keys ? 'object' : 'array'} literal in ${file}`); return null; }
    const out = opt.keys
      ? [...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1])
      : [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
    if (!out.length) { fail(`constant ${name} — ${opt.keys ? 'object' : 'array'} literal held no names`); return null; }
    return out.sort();
  }
  if (isObject || isStringMap) {
    const m = rest.match(/^\{([^}]*)\}/);
    if (!m) { fail(`constant ${name} — expected a flat object literal in ${file}`); return null; }
    const out = {};
    if (isStringMap) for (const p of [...m[1].matchAll(/(\w+)\s*:\s*["']([^"']*)["']/g)]) out[p[1]] = p[2];
    else for (const p of [...m[1].matchAll(/(\w+)\s*:\s*(\d+)/g)]) out[p[1]] = Number(p[2]);
    if (!Object.keys(out).length) { fail(`constant ${name} — object literal held no ${isStringMap ? 'string' : 'numeric'} keys`); return null; }
    return out;
  }
  // Decimals as well as whole numbers: a probability threshold is a constant
  // like any other, and rounding one to 0 in a diagram would be a lie.
  const n = rest.match(/^(\d+(?:\.\d+)?)\s*[,;]/);
  if (n) return Number(n[1]);
  const s = rest.match(/^['"]([^'"]*)['"]\s*[,;]/);
  if (s) return s[1];
  fail(`constant ${name} — right-hand side in ${file} is not a plain number or string; the diagram cannot show its value`);
  return null;
}

/* ── the palette ──────────────────────────────────────────────────────────
   Stroke only, never fill and never text colour: Obsidian supplies
   --mermaid-node-bg and --mermaid-node-fg, and the moment a fill is set the
   theme's text colour lands on it and one of the two schemes breaks. This vault
   has an empty appearance.json, so it follows the OS and will be read in both.
   Every stroke must therefore clear 3:1 on white AND on Obsidian's default dark
   canvas, which is asserted below with the same maths selfcheck-tokens.js uses.
   Colour is never the only carrier -- each kind also has its own shape and a
   text tag, so the diagram survives a custom theme, colour-blindness, and a
   black-and-white print. */
const PALETTE = { branch: '#8A9199', net: '#4C8FBF', db: '#9B7FD4', credit: '#B8892E', drop: '#D2695E' };
const CANVASES = { white: '#FFFFFF', 'Obsidian dark': '#1E1E1E' };
const srgb = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const rgbOf = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lum = h => { const [r, g, b] = rgbOf(h); return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const SHAPE = {
  entry:  (i, l) => `${i}(["${l}"]):::entry`,
  sync:   (i, l) => `${i}["${l}"]:::sync`,
  branch: (i, l) => `${i}{"${l}"}:::branch`,
  net:    (i, l) => `${i}[/"${l}"/]:::net`,
  db:     (i, l) => `${i}[("${l}")]:::db`,
  credit: (i, l) => `${i}{{"${l}"}}:::credit`,
  drop:   (i, l) => `${i}>"${l}"]:::drop`,
};
const TAG = { net: 'net · ', db: 'db · ', credit: 'cr · ', drop: 'drop · ', entry: '', sync: '', branch: '' };
const mid = s => s.replace(/[^A-Za-z0-9]/g, '_');
const mlabel = s => String(s).replace(/"/g, "'").replace(/\|/g, '/');

/* ── run ──────────────────────────────────────────────────────────────── */
console.log(`pipeline map vs source${ROOT !== path.join(__dirname, '..') ? ` (root: ${ROOT})` : ''}:`);

// 1. constants
const CONST = {};
for (const c of spec.constants || []) {
  const v = readConst(c.name, c.file, c);
  if (v !== null) CONST[c.name] = v;
}
const shown = Object.entries(CONST).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
if (shown.length) ok(`${shown.length} constants read from source — ${shown.join('  ')}`);

/* Constants that must agree across runtimes. Nothing in either file can check
   this: they are different languages, deployed separately, and both values look
   perfectly reasonable on their own. */
for (const inv of spec.invariants || []) {
  const [a, b] = inv.equal;
  if (!(a in CONST) || !(b in CONST)) continue;   // readConst already failed and said why
  const norm = v => typeof v === 'object'
    ? JSON.stringify(Object.fromEntries(Object.entries(v).sort(([x], [y]) => x < y ? -1 : 1)))
    : String(v);
  if (norm(CONST[a]) === norm(CONST[b])) ok(`${a} == ${b} (${norm(CONST[a])})`);
  else fail(`${a} is ${norm(CONST[a])} but ${b} is ${norm(CONST[b])}; they must be equal.\n        ${inv.why}`);
}

const subst = (text, where) => String(text).replace(/\{([A-Za-z_][\w.]*)\}/g, (m, key) => {
  const [head, prop] = key.split('.');
  if (!(head in CONST)) { fail(`${where} — label references {${key}}, which is not an extracted constant. Typo, or add it to spec.constants.`); return m; }
  const v = CONST[head];
  if (prop === undefined) return typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (typeof v !== 'object' || !(prop in v)) { fail(`${where} — {${key}} has no key "${prop}" on ${head}`); return m; }
  return String(v[prop]);
});

// 2. anchors, line audit, section drift
console.log('\nanchors:');
const bs = banners();
const nodes = spec.nodes || {};
const resolved = {};
let audited = 0;
for (const [id, n] of Object.entries(nodes)) {
  const r = resolveAnchor(id, n.anchor);
  if (!r) continue;
  if (!auditLine(id, r)) continue;
  audited++;
  resolved[id] = r;
  if (n.section) {
    const got = r.file === 'index.html' ? sectionOf(r.line, bs) : null;
    if (got !== n.section) fail(`node ${id} resolved inside "${got}", but the spec says "${n.section}". It crossed a section banner — a structural change, not a move. Re-read it before updating the spec.`);
  }
}
if (audited) ok(`${audited} of ${Object.keys(nodes).length} anchors resolve, and every emitted line number re-verified against source`);

// 3. body tripwire
const bodyHash = (file, line) => {
  const lines = src(file).split('\n');
  const out = [];
  for (let i = line - 1; i < lines.length; i++) { out.push(lines[i]); if (i > line - 1 && /^\}/.test(lines[i])) break; }
  return require('crypto').createHash('sha1').update(out.join('\n')).digest('hex').slice(0, 6);
};
if (ACCEPT === 'all') {
  console.log('');
  for (const [id, n] of Object.entries(nodes)) if (n.body && resolved[id]) console.log(`    ${id}: '${bodyHash(resolved[id].file, resolved[id].line)}',`);
  process.exit(0);
}
if (ACCEPT) {
  const r = resolved[ACCEPT];
  if (!r) { console.error(`  no resolved node "${ACCEPT}"`); process.exit(1); }
  console.log(`\n  body hash for ${ACCEPT} is now ${bodyHash(r.file, r.line)} — paste it into the spec yourself.`);
  process.exit(0);
}
let tripwires = 0;
for (const [id, n] of Object.entries(nodes)) {
  if (!n.body || !resolved[id]) continue;
  const got = bodyHash(resolved[id].file, resolved[id].line);
  if (got === n.body) tripwires++;
  else fail(`node ${id} — the code changed since it was mapped (${n.body} -> ${got}).\n        The diagram asserts what this does and why. Re-read ${resolved[id].file}:${resolved[id].line},\n        confirm the map still tells the truth, then: node scripts/pipeline-map.js --accept ${id}`);
}
if (tripwires) ok(`${tripwires} body tripwires unchanged`);

/* ── coverage ─────────────────────────────────────────────────────────────
   Anchors prove the nodes you declared still exist. They cannot prove you
   declared all the nodes: a spec covering 9 of 10 edge-function actions passes
   every anchor check forever while the diagram lies by omission. Wherever the
   source is a closed list, demand the spec account for every member. */
console.log('\ncoverage:');
const claimed = new Set();
for (const n of Object.values(nodes)) {
  const k = KINDS.find(k => k in n.anchor);
  if (k && k !== 're') claimed.add(`${k}:${n.anchor[k]}`);
}
const scoped = (set, member) => ((spec.outOfScope || {})[set] || {})[member];

function gate(setName, found, kind, where) {
  let missing = 0;
  for (const m of found) {
    if (claimed.has(`${kind}:${m}`)) continue;
    if (scoped(setName, m)) continue;
    fail(`${where} declares ${kind === 'case' ? `case "${m}"` : m}, which no node claims and nothing lists as out of scope.\n        The map would render as if it did not exist.`);
    missing++;
  }
  if (!missing) ok(`${found.length} of ${found.length} ${setName} accounted for`);
}

const api = src('supabase/functions/api/index.ts');
if (api) {
  const cases = [...api.matchAll(/^[ \t]*case\s+"([a-z_]+)"\s*:/gm)].map(m => m[1]);
  gate('edge-function actions', cases, 'case', 'supabase/functions/api/index.ts');

  // The browser and the server must agree on the action list. This one has
  // value beyond the diagram: it catches index.html calling an action the
  // edge function does not implement, which would be a 400 at runtime.
  const idx = src('index.html') || '';
  const calls = [...new Set([...idx.matchAll(/hosted\(\s*'([a-z_]+)'/g)].map(m => m[1]))];
  const orphan = calls.filter(c => !cases.includes(c));
  const unused = cases.filter(c => !calls.includes(c));
  if (orphan.length) fail(`index.html calls hosted('${orphan.join("'), hosted('")}'), which the edge function does not implement`);
  if (unused.length) warn(`the edge function implements ${unused.map(u => `"${u}"`).join(', ')}, which index.html never calls`);
  if (!orphan.length && !unused.length) ok(`${calls.length} hosted() call sites map 1:1 onto the ${cases.length} edge-function actions`);
}

for (const f of ['schema.sql', 'billing.sql']) {
  const sql = src(f);
  if (!sql) continue;
  const objs = [...sql.matchAll(/^create\s+(?:table\s+(?:if\s+not\s+exists\s+)?|or\s+replace\s+function\s+)(public\.\w+)/gim)]
    .map(m => m[1].toLowerCase());
  gate(`${f} objects`, [...new Set(objs)], 'sql', f);
}

const unmapped = bs.map(b => b.name).filter(n => !Object.values(nodes).some(x => x.section === n) && !scoped('index.html section banners', n));
if (unmapped.length) fail(`${unmapped.length} index.html section banner(s) neither mapped nor listed as out of scope: ${unmapped.slice(0, 4).map(n => `"${n}"`).join(', ')}${unmapped.length > 4 ? ` and ${unmapped.length - 4} more` : ''}`);
else ok(`${bs.length} of ${bs.length} index.html section banners accounted for`);

// 4. palette + size
console.log('\npalette and layout:');
let pbad = 0;
for (const [k, hex] of Object.entries(PALETTE)) {
  for (const [name, bg] of Object.entries(CANVASES)) {
    const r = ratio(hex, bg);
    if (r < 3) { fail(`kind "${k}" stroke ${hex} is ${r.toFixed(2)}:1 on ${name}, under the 3:1 floor`); pbad++; }
  }
}
if (!pbad) ok(`${Object.keys(PALETTE).length} kind strokes clear 3:1 on both ${Object.keys(CANVASES).join(' and ')}`);
for (const g of spec.diagrams || []) {
  const n = Object.values(nodes).filter(x => x.diagram === g.id).length;
  if (n > MAX_NODES) fail(`diagram "${g.id}" has ${n} nodes, over the ${MAX_NODES} cap — it will be unreadable. Split it.`);
}

/* ── emit ────────────────────────────────────────────────────────────────
   Generation runs the same gates. A failed check writes nothing at all, so a
   wrong diagram cannot be extracted from this program even by accident. */
function renderGraph(g) {
  const mine = Object.entries(nodes).filter(([, n]) => n.diagram === g.id);
  const groups = [...new Set(mine.map(([, n]) => n.group || ''))];
  const L = [];
  L.push('```mermaid');
  L.push('flowchart TD');
  for (const grp of groups) {
    const inGrp = mine.filter(([, n]) => (n.group || '') === grp);
    const ind = grp ? '    ' : '  ';
    if (grp) L.push(`  subgraph ${mid(grp)}["${mlabel(grp)}"]`);
    for (const [id, n] of inGrp) {
      const r = resolved[id];
      const where = r ? `<br/><small>${r.file.split('/').pop()}:${r.line}</small>` : '';
      L.push(ind + SHAPE[n.kind](mid(id), mlabel(TAG[n.kind] + subst(n.label, `node ${id}`)) + where));
    }
    if (grp) L.push('  end');
  }
  for (const e of (spec.edges || []).filter(e => nodes[e.from] && nodes[e.to] && nodes[e.from].diagram === g.id && nodes[e.to].diagram === g.id)) {
    const arrow = e.style === 'drop' ? '-.->' : '-->';
    const lab = e.label ? `|"${mlabel(subst(e.label, `edge ${e.from}->${e.to}`))}"|` : '';
    L.push(`  ${mid(e.from)} ${arrow}${lab} ${mid(e.to)}`);
  }
  for (const [k, hex] of Object.entries(PALETTE)) L.push(`  classDef ${k} stroke:${hex},stroke-width:2px${k === 'drop' ? ',stroke-dasharray:4 3' : ''}`);
  L.push('  classDef sync stroke-width:1.5px');
  L.push('  classDef entry stroke-width:2.5px');
  L.push('```');
  L.push('');
  L.push('## Anchors');
  L.push('');
  L.push('| node | kind | where | what |');
  L.push('|---|---|---|---|');
  for (const [id, n] of mine) {
    const r = resolved[id];
    // A pipe in a note would end the table cell. keyOf's note contains one.
    const cell = subst(n.note || n.label, `note ${id}`).replace(/\|/g, '\\|');
    L.push(`| \`${id}\` | ${n.kind} | \`${r ? `${r.file}:${r.line}` : '—'}\` | ${cell} |`);
  }
  return L.join('\n');
}

function write() {
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const fm = (title, extra = '') => `---\ntags:\n  - jobtriage/pipeline\ngenerated: ${stamp}\n${extra}---\n\n`;
  const files = [];
  for (const g of spec.diagrams) {
    const nb = (g.neighbours || []).map(n => `- → [[${n}]]`).join('\n');
    const body = fm(g.title, 'up: "[[JT Pipeline Map]]"\n')
      + `# ${g.title}\n\n> Generated by \`scripts/pipeline-map.js\` on ${stamp}. Do not edit by hand —\n> edit \`scripts/pipeline-map.spec.js\` and regenerate.\n\n${g.intro}\n\n`
      + renderGraph(g) + (nb ? `\n\n## Neighbours\n\n${nb}\n` : '\n');
    const f = path.join(OUT, `${g.file}.md`);
    fs.writeFileSync(f, body);
    files.push(f);
  }
  const index = fm('JT Pipeline Map')
    + `# JT Pipeline Map\n\n> Generated by \`scripts/pipeline-map.js\` on ${stamp} from \`scripts/pipeline-map.spec.js\`.\n> Do not edit these notes by hand.\n\n`
    + `What happens to one job, from the moment it arrives to the moment it is drawn on screen.\n\n## The maps\n\n`
    + spec.diagrams.map(g => `- [[${g.file}]] — ${g.intro}`).join('\n')
    + `\n\n## What is checked, and what is not\n\n`
    + `\`node scripts/pipeline-map.js --check\` proves three things: every node still points at a declaration that exists in the source exactly once; every edge-function action, \`hosted()\` call site, SQL object and section banner is either on a map or explicitly out of scope; and every number shown was read out of the source rather than typed here.\n\n`
    + `**It does not prove the arrows are right.** An edge can be drawn backwards and every check stays green. This is a curated map whose landmarks are verified — not a proof of control flow, and not a record of what any particular run actually did.\n`;
  fs.writeFileSync(path.join(OUT, 'JT Pipeline Map.md'), index);
  files.push(path.join(OUT, 'JT Pipeline Map.md'));
  return files;
}

/* ── does it actually render? ────────────────────────────────────────────
   A Mermaid syntax error does not throw -- Obsidian draws a red error box in
   place of the diagram, which is invisible to anything that only checks the
   file was written. So parse every emitted block with Obsidian's own Mermaid,
   the same borrow-Obsidian-as-a-renderer trick scripts/selfcheck-icon.js uses
   for the app icon. Resolve the CLI by identity, not by name: OBS Studio also
   installs an "obs", and launching a screen recorder from a check script is
   not a harmless miss. */
function findObsidianCli() {
  if (process.env.OBSIDIAN_CLI) return process.env.OBSIDIAN_CLI;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const f = path.join(dir, 'obs');
    try {
      fs.accessSync(f, fs.constants.X_OK);
      const head = fs.readFileSync(f).subarray(0, 4096);
      if (head.subarray(0, 4).toString('binary') === '\x7fELF') continue;   // OBS Studio
      if (/obsidian/i.test(head.toString('utf8'))) return f;
    } catch { /* next */ }
  }
  return null;
}
function renderCheck() {
  console.log('\nrendering:');
  const cli = findObsidianCli();
  if (!cli) { console.log('  SKIP  no Obsidian CLI on PATH (OBS Studio also installs an "obs"; set OBSIDIAN_CLI)'); console.log('        the diagrams were NOT parsed — syntax errors would be invisible'); return 1; }
  const tmp = path.join(require('os').tmpdir(), `pipeline-render-${process.pid}.json`);
  const probe = `(()=>{const fs=require("fs");const out=${JSON.stringify(tmp)};setTimeout(async()=>{const r={results:[]};try{
const m=window.mermaid; if(!m||typeof m.parse!=="function"){fs.writeFileSync(out,JSON.stringify({error:"Obsidian exposes no mermaid parser"}));return}
if(m.initialize) try{m.initialize({startOnLoad:false})}catch(e){}
const dir=${JSON.stringify(OUT)};
for(const fn of fs.readdirSync(dir).filter(x=>x.endsWith(".md")).sort()){
  const F="\`\`\`"; const segs=fs.readFileSync(dir+"/"+fn,"utf8").split(F+"mermaid").slice(1).map(x=>x.slice(0,x.indexOf(F)));
  for(const b of segs){
    try{ await m.parse(b); r.results.push([fn,"ok"]) }catch(e){ r.results.push([fn,"FAIL",String(e.message||e).split(String.fromCharCode(10))[0].slice(0,120)]) }
  }
}
try{ await m.parse(["flowchart TD"," A[x --> ]]][[ B"].join(String.fromCharCode(10))); r.control=false }catch(e){ r.control=true }
}catch(e){r.error=String(e)}
fs.writeFileSync(out,JSON.stringify(r))},0);return "ok"})()`;
  if (has('dump-probe')) { console.log(probe); return 0; }
  try {
    fs.rmSync(tmp, { force: true });
    require('child_process').execFileSync(cli, ['eval', `code=${probe}`], { stdio: 'pipe', timeout: 20000 });
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline && !fs.existsSync(tmp)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    if (!fs.existsSync(tmp)) throw new Error('no answer from Obsidian');
    const r = JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.rmSync(tmp, { force: true });
    if (r.error) { fail(`render: ${r.error}`); return 0; }
    // If a deliberately broken diagram parses clean, the parser is not checking
    // anything and every "ok" above is worthless.
    if (r.control !== true) { fail('render: the parser accepted deliberately broken syntax, so it is not validating anything'); return 0; }
    for (const [note, verdict, err] of r.results) if (verdict !== 'ok') fail(`render: ${note} — ${err}`);
    if (!r.results.some(x => x[1] !== 'ok')) ok(`${r.results.length} diagrams parse with Obsidian's mermaid (and a broken control is rejected)`);
    return 0;
  } catch (e) {
    console.log(`  SKIP  Obsidian did not answer (${String(e.message || e).split('\n')[0]})`);
    console.log('        the diagrams were NOT parsed — syntax errors would be invisible');
    return 1;
  }
}

if (bad) {
  console.error(`\n${bad} problem(s)${warned ? `, ${warned} warning(s)` : ''}. The map is stale: generating it now would write a confident,`);
  console.error(`wrong diagram into ${OUT}. Nothing was written. Fix scripts/pipeline-map.spec.js.`);
  process.exit(1);
}
if (CHECK_ONLY) { console.log(warned ? `\nALL PASS (${warned} warning(s))` : '\nALL PASS'); process.exit(0); }
const written = write();
console.log(`\nwrote ${written.length} notes to ${OUT}`);
let skipped = 0;
if (has('render-check')) skipped = renderCheck();
if (bad) { console.error(`\n${bad} problem(s) after writing. The notes on disk are not trustworthy.`); process.exit(1); }
if (skipped) { console.log('\nPASS (with skips)'); process.exit(0); }
console.log(warned ? `ALL PASS (${warned} warning(s))` : 'ALL PASS');
