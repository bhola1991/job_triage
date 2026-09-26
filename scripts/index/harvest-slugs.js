// Harvest ATS company slugs out of job URLs you already paid for:
//   node scripts/index/harvest-slugs.js <file...> [--verify] [--write]
//   cat urls.json | node scripts/index/harvest-slugs.js - --verify --write
//
// Why this exists
// ---------------
// Acquisition is the dominant cost and it scales with headcount (see README).
// But a paid row is not only a job — it is *evidence that a company exists and
// is hiring*, and for anyone on Greenhouse/Lever/Ashby/Workable/SmartRecruiters/
// Recruitee that evidence is a slug, and a slug is their WHOLE board, free,
// for as long as they keep hiring.
//
// So a search that cost ₹13.20 and returned 30 LinkedIn rows is worth more than
// 30 rows: every `boards.greenhouse.io/acme` link in it buys Acme permanently.
// Measured on the seed list, an ATS board averages ~103 jobs (4,838 from 47).
// This turns paid search from a source of jobs into a discovery channel for
// free ones, which is the only version of acquisition that gets cheaper as it
// runs rather than more expensive.
//
// The regexes are NOT copied. They are sliced out of index.html's `ATS` table,
// the same trick scripts/selfcheck-boards.js uses, because a second copy of a
// host pattern is a second thing to keep in step and it would drift silently —
// the failure being an empty harvest, which looks exactly like "nothing new".
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SOURCES = path.join(__dirname, 'sources.json');

/* ── the ATS table, read from the app ── */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const m = html.match(/const ATS = \{[\s\S]*?\n\};\n/);
if (!m) {
  console.error('Could not find `const ATS = {…};` in index.html. If it was renamed, fix the slice here —');
  console.error('do not paste a copy of the host patterns into this file.');
  process.exit(1);
}
// Only `host` and `url` are ever touched. The row/job mappers in the table
// reference helpers that live outside this slice, which is harmless: a function
// body is not evaluated until it is called, and these never are.
const ATS = new Function(m[0] + 'return ATS;')();
const PLATFORMS = Object.keys(ATS);

/* ── input ── */
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const VERIFY = flag('--verify'), WRITE = flag('--write');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: node scripts/index/harvest-slugs.js <file...|-> [--verify] [--write]');
  console.error('  files may be JSON or JSONL, of any shape: every string that looks like');
  console.error('  a URL is considered, so an app backup export works as-is.');
  process.exit(1);
}

const read = (f) => (f === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(f, 'utf8'));

/* Any shape at all. A Backup & transfer export, index.jsonl, a bare array of
   strings — the only thing asked of the input is that URLs appear in it
   somewhere, because requiring a schema would mean maintaining one. */
function urlsIn(text) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { if (/^https?:\/\//i.test(v)) out.add(v); return; }
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') return Object.values(v).forEach(walk);
  };
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { walk(JSON.parse(s)); continue; } catch { /* not JSONL: fall through */ }
  }
  try { walk(JSON.parse(text)); } catch { /* not one JSON document either */ }
  // Last resort for HTML/CSV/log input: scrape bare URLs out of the text.
  if (!out.size) (text.match(/https?:\/\/[^\s"'<>)\]]+/g) || []).forEach((u) => out.add(u));
  return [...out];
}

/* ── slugs ── */
/* atsOfUrl() in the app deliberately returns null without a job id, because it
   is answering "which posting is this?". Here the question is "which company is
   this?", and a board root with no posting on it answers that perfectly well. */
function slugOf(url) {
  for (const platform of PLATFORMS) {
    const hit = String(url).match(ATS[platform].host);
    if (hit && hit[1]) return { platform, slug: hit[1] };
  }
  return null;
}

const sources = JSON.parse(fs.readFileSync(SOURCES, 'utf8'));
const known = new Map();                       // platform -> Set(lowercased)
for (const [k, v] of Object.entries(sources)) {
  if (k.startsWith('_') || !Array.isArray(v)) continue;
  known.set(k, new Set(v.map((s) => String(s).toLowerCase())));
}

const urls = [];
for (const f of files) { try { urls.push(...urlsIn(read(f))); } catch (e) { console.error(`skipped ${f}: ${e.message}`); } }

const found = new Map();                       // platform -> Map(lower -> slug as written)
let matched = 0;
for (const u of urls) {
  const hit = slugOf(u);
  if (!hit) continue;
  matched++;
  const lower = hit.slug.toLowerCase();
  if (known.get(hit.platform)?.has(lower)) continue;
  if (!found.has(hit.platform)) found.set(hit.platform, new Map());
  found.get(hit.platform).set(lower, hit.slug);
}

console.log(`read ${urls.length} url(s) from ${files.length} file(s)`);
console.log(`  ${matched} sit on a known ATS; ${[...found.values()].reduce((n, s) => n + s.size, 0)} company slug(s) are new\n`);

/* ── verify ──
   9 of the seed list's 47 sources 404'd: companies move ATS and change slugs.
   A slug that does not resolve is not a discovery, it is a future 404 in the
   crawl — so --verify asks each board for its jobs before the list grows. */
async function verify(platform, slug) {
  const url = ATS[platform].url(slug);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { ok: false, why: `http ${r.status}` };
    const d = await r.json();
    let n = null;
    try { const rows = ATS[platform].rows(d); if (Array.isArray(rows)) n = rows.length; } catch { /* generic below */ }
    if (n === null) {
      const rows = Array.isArray(d) ? d : (d.jobs || d.data || d.results || d.postings || d.content || []);
      n = Array.isArray(rows) ? rows.length : 0;
    }
    return n > 0 ? { ok: true, n } : { ok: false, why: 'board is empty' };
  } catch (e) {
    return { ok: false, why: (e && e.message) || 'network' };
  }
}

(async () => {
  const keep = new Map();
  let jobs = 0;
  for (const [platform, slugs] of found) {
    for (const slug of slugs.values()) {
      if (!VERIFY) { if (!keep.has(platform)) keep.set(platform, []); keep.get(platform).push(slug); continue; }
      const v = await verify(platform, slug);
      console.log(`  ${v.ok ? 'ok  ' : 'drop'} ${platform}/${slug}${v.ok ? `  ${v.n} jobs` : `  — ${v.why}`}`);
      if (!v.ok) continue;
      jobs += v.n;
      if (!keep.has(platform)) keep.set(platform, []);
      keep.get(platform).push(slug);
    }
  }
  const total = [...keep.values()].reduce((n, a) => n + a.length, 0);
  if (VERIFY) console.log(`\n${total} slug(s) resolve, carrying ${jobs} job(s) — all free and keyless`);
  if (!total) { console.log('\nNothing new to add.'); return; }

  if (!WRITE) {
    console.log('\nDry run. Re-run with --write to add these to sources.json:');
    for (const [p, a] of keep) console.log(`  ${p}: ${a.join(', ')}`);
    return;
  }
  for (const [p, a] of keep) {
    // A platform the seed list never had is a new key, not an error.
    if (!Array.isArray(sources[p])) sources[p] = [];
    sources[p] = [...new Set([...sources[p], ...a])].sort();
  }
  fs.writeFileSync(SOURCES, JSON.stringify(sources, null, 2) + '\n');
  console.log(`\nwrote ${total} slug(s) into ${path.relative(ROOT, SOURCES)}`);
})();
