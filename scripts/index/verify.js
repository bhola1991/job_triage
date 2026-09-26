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
// It also does no network in the diff path. Snapshots come from the tools that
// already exist (`sitemap-jobs.js`, `ingest.js`), which keeps the diff pure,
// offline and testable, and keeps the fetching policy in one place. The only
// network here is the optional `--push`, which is a write and nothing else.
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
/* The date a snapshot was TAKEN, which is not always the date it is processed.
   Backfilling a series from snapshots already on disk is the normal case --
   otherwise every replayed observation stamps as today, first_seen == last_seen
   for everything, and every age reads as zero. The counts would still be right
   and every date would be wrong, which is the worst kind of wrong: quietly. */
const today = () => {
  const v = arg('asof', '');
  if (!v) return new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) { console.error(`--asof must be YYYY-MM-DD, got ${v}`); process.exit(1); }
  return v;
};
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/* Flags that consume the next argument, listed once. The previous version
   named --store and --suspect inline, so adding --asof silently turned its
   date into an input filename and the failure was `ENOENT: open '2026-09-24'`.
   Any new value-taking flag goes here and nowhere else. */
const VALUED = new Set(['--store', '--suspect', '--asof']);
const files = process.argv.slice(2).filter((a, i, all) =>
  !a.startsWith('--') && !VALUED.has(all[i - 1]));
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
console.log(`\nrun ${store.runs} · ${now}${arg('asof','') ? ' (--asof)' : ''} · sources: ${[...sources].join(', ')}`);
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

/* ── push ──
   `public.job_checks` is deliberately not per-user: whether a posting is still
   listed is a fact about the posting, so one check serves everyone holding it.
   Which is why this writes through the SERVICE ROLE and why the table has a
   select policy and no others — there is no user to scope a write by.
   Off unless asked, and a no-op without credentials, so the diff stays runnable
   by anyone with no keys at all. */
async function push() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('\n--push: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set, nothing sent.');
    console.log('  The service role key is a server secret and is not in .env.local by design.');
    return;
  }
  /* The store is keyed by url; `job_checks.job_key` is keyOf() — the identity
     `public.jobs` already uses. Pushing the raw url would produce a table that
     looks right and joins to nothing, which is the worst of both. keyOf is
     mirrored rather than imported because this file is offline by design and
     index.html is a browser IIFE; selfcheck-boards.js keeps the real one
     honest, and the shape is fixed by schema.sql's comment on the column. */
  const keyOf = (j) => {
    const u = String(j.url || '').trim();
    if (u && u !== 'nan') return 'u:' + u.toLowerCase();
    return 't:' + [j.title, j.company, j.location].map((x) => String(x || '').trim().toLowerCase()).join('|');
  };
  const rows = Object.entries(store.jobs).map(([url, j]) => ({
    job_key: keyOf({ ...j, url }), source: j.source, first_seen: j.first_seen, last_seen: j.last_seen,
    runs: j.runs, reposts: j.reposts, closed_on: j.closed_on, checked_at: new Date().toISOString(),
  }));
  // PostgREST takes an array, but not 18,806 of them in one body.
  const CHUNK = 1000;
  let sent = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const body = rows.slice(i, i + CHUNK);
    const r = await fetch(`${url}/rest/v1/job_checks?on_conflict=job_key`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(body),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (!r.ok) { console.error(`  push failed at row ${i}: ${r.status} ${(await r.text()).slice(0, 200)}`); return; }
    sent += body.length;
    process.stdout.write(`\r  pushed ${sent}/${rows.length}`);
  }
  console.log(`\r  pushed ${sent} row(s) into public.job_checks     `);
}

if (has('push')) push();
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
