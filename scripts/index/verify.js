// Is this posting still real? — node scripts/index/verify.js <snapshot.jsonl…> [--store f.json]
//
// Liveness is not a fetch. It is a set operation.
// ----------------------------------------------
// Fetching each job page to ask "are you still open?" does not work and cannot
// be made to work: measured 2026-09-25, every one of a sample of live Upwork
// and Remotive urls returned 403 to a datacentre IP, and Naukri's robots.txt
// names Claude, GPTBot and Perplexity and disallows them the whole site.
//
// But the boards hand us their complete current index for free, every day, to
// be crawled — sitemaps, RSS, ATS boards, the free JSON feeds. So membership
// answers the question without a single page fetch:
//
//   in today's snapshot, not in yesterday's   -> new
//   in both                                   -> still open, days_open++
//   in yesterday's, gone today                -> closed, and we know the day
//   gone, then back                           -> reposted
//
// Free, unblockable, and it accrues into something no vendor sells: a per-job
// time series that gets better the longer it runs.
//
// What this file deliberately does NOT do
// ---------------------------------------
// It does not ask Jev anything. Every signal here is a count or a date, and the
// house rule is that Jev is never asked dates, counts, or numbers between
// levels — it answers judgments from the state it is given. So this computes
// the facts and marks what is SUSPECT; judging "is this a genuine opening or a
// pipeline ad" is a later, cheaper pass over the residue.
//
// It also does no network at all. Snapshots come from the tools that already
// exist (`sitemap-jobs.js`, `ingest.js`), which keeps the diff pure, offline
// and testable, and keeps the fetching policy in one place rather than two.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ROOT = path.join(DIR, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

const STORE = arg('store', path.join(DIR, 'checks.json'));
const SUSPECT_OUT = arg('suspect', path.join(DIR, 'suspect.jsonl'));

/* Suspicion thresholds. These are counts and dates on purpose — cheap, exact,
   and arguable. They do not decide anything; they decide what is worth the
   price of a judgment later. Tune them from the store, not from taste. */
const EVERGREEN_DAYS = 60;   // continuously advertised this long is a pipeline ad, not an opening
const REPOST_MIN = 3;        // taken down and put back this often is churn
const today = () => new Date().toISOString().slice(0, 10);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

const files = process.argv.slice(2).filter((a) => !a.startsWith('--') &&
  process.argv[process.argv.indexOf(a) - 1] !== '--store' &&
  process.argv[process.argv.indexOf(a) - 1] !== '--suspect');
if (!files.length) {
  console.error('usage: node scripts/index/verify.js <snapshot.jsonl…> [--store f.json] [--suspect f.jsonl]');
  console.error('  a snapshot is JSONL with {url, …} rows — what sitemap-jobs.js or ingest.js writes.');
  console.error('  Each run is one observation. Run it daily; the value is in the series, not the run.');
  process.exit(1);
}

/* ── read today's observation ── */
const seen = new Map();                       // url -> row
for (const f of files) {
  let n = 0;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const s = line.trim(); if (!s) continue;
    let r; try { r = JSON.parse(s); } catch { continue; }
    if (!r || !r.url) continue;
    seen.set(r.url, r); n++;
  }
  console.log(`  read ${n} row(s) from ${path.relative(ROOT, f)}`);
}
if (!seen.size) { console.error('no rows with a url — nothing to verify'); process.exit(1); }

/* The source a snapshot came from, so a partial run cannot be read as a mass
   closure. Verifying only the Pune sitemap must never mark Mumbai closed. */
const sources = new Set([...seen.values()].map((r) => r.source || 'unknown'));

/* ── the store ── */
const store = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : { runs: 0, jobs: {} };
const now = today();
const first = store.runs === 0;
store.runs++;

let fresh = 0, open = 0, closed = 0, reposted = 0;

for (const [url, row] of seen) {
  const j = store.jobs[url];
  if (!j) {
    store.jobs[url] = { source: row.source || 'unknown', title: row.title || '', company: row.company || '',
      location: row.location || '', partial: !!row.partial,
      first_seen: now, last_seen: now, runs: 1, reposts: 0, closed_on: null };
    fresh++;
  } else {
    // Back after an absence. The gap is the interesting part: a role taken down
    // and re-advertised is either hard to fill or was never being filled.
    if (j.closed_on) { j.reposts++; j.closed_on = null; reposted++; }
    j.last_seen = now; j.runs++;
    open++;
  }
}

/* Absent today, and today's run covered its source: that is a closure, not a
   gap in our own coverage. Anything from a source this run did not look at is
   left strictly alone. */
for (const [url, j] of Object.entries(store.jobs)) {
  if (seen.has(url) || j.closed_on || !sources.has(j.source)) continue;
  j.closed_on = now;
  j.open_days = days(j.first_seen, now);
  closed++;
}

/* ── suspects ──
   Not "these are fake". These are the rows where a cheap fact says the posting
   is behaving unlike a real opening, and therefore the only rows worth paying
   to judge. Everything else is left alone. */
const suspects = [];
for (const [url, j] of Object.entries(store.jobs)) {
  const why = [];
  const age = days(j.first_seen, j.closed_on || now);
  if (!j.closed_on && age >= EVERGREEN_DAYS) why.push(`open ${age}d`);
  if (j.reposts >= REPOST_MIN) why.push(`reposted ${j.reposts}x`);
  if (why.length) suspects.push({ url, ...j, age, why });
}
fs.writeFileSync(SUSPECT_OUT, suspects.map((s) => JSON.stringify(s)).join('\n') + (suspects.length ? '\n' : ''));
fs.writeFileSync(STORE, JSON.stringify(store, null, 0));

/* ── report ── */
const total = Object.keys(store.jobs).length;
const live = Object.values(store.jobs).filter((j) => !j.closed_on).length;
console.log(`\nrun ${store.runs} · ${now} · sources: ${[...sources].join(', ')}`);
console.log(`  new        ${fresh}`);
console.log(`  still open ${open}`);
console.log(`  closed     ${closed}`);
console.log(`  reposted   ${reposted}`);
console.log(`\nstore: ${total} job(s) known, ${live} currently listed`);
console.log(`suspect: ${suspects.length} (open >= ${EVERGREEN_DAYS}d, or reposted >= ${REPOST_MIN}x) -> ${path.relative(ROOT, SUSPECT_OUT)}`);
if (first) {
  console.log('\nFirst run: everything is "new" and nothing can be closed yet. That is not a');
  console.log('result — the value is in the second run and every one after it. Run it daily.');
}
if (has('report')) {
  const byAge = Object.values(store.jobs).filter((j) => j.closed_on)
    .map((j) => j.open_days).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (byAge.length) {
    const med = byAge[Math.floor(byAge.length / 2)];
    console.log(`\nclosed postings: median ${med}d open (n=${byAge.length})`);
  }
  suspects.slice(0, 10).forEach((s) =>
    console.log(`  ${String(s.title).slice(0, 44).padEnd(46)} ${s.why.join(', ')}`));
}
