// Deposit snapshots into the shared corpus:
//   node scripts/index/push-index.js <snapshot.jsonl…> [--dry]
//
// Reads what sitemap-jobs.js and ingest.js already write — two different row
// shapes — and upserts both into public.job_index. Shared and not per-user,
// because acquiring a posting costs ~16x what deciding about it costs, so the
// row bought once and served to everyone is the only one that scales.
//
// Two tiers, decided here and not guessed later. A row with a real description
// is `full` and can be judged; a row without one is `thin` and is a shortlist
// candidate only. sitemap-jobs.js stamps `partial: true` on every row it makes
// for exactly this reason — a Naukri job page is a client-rendered shell — and
// that flag is honoured over the presence of a description, because the
// description it carries is a de-slugged title line, not a posting.
//
// Descriptions are capped at CAP characters, which is the cap scrapedJob() and
// the JSearch mapper already apply in the edge function. Measured on a real
// crawl the median description is 7,319 characters and the max 36,121; 4,840
// jobs is 37 MB on disk, so an uncapped six-figure corpus would not fit the
// database it lives in. The index is a filter, not a document store.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CAP = 4000;
const CHUNK = 500;            // rows per request; descriptions make these bodies large

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
/* Do not store what the app cannot search. index.html:3450 clamps since_days to
   `Math.min(30, ...)` and search_index filters `posted >= current_date - p_days`,
   so a corpus row older than 30 days is unreachable by any search this product
   can make. Measured 2026-09-28: 69,624 such rows, about 54 MB of a 500 MB tier
   -- dead weight that also came back every night.

   Capped HERE and deliberately not in sitemap-jobs.js, which has its own
   --max-age. That flag filters the snapshot FILE, and verify.js reads that same
   file to decide what is still listed -- so capping the crawl would make every
   older posting look absent and close it. That is the mass false closure of
   185184c all over again, from the other end. job_index is the SEARCH corpus and
   wants only what is searchable; job_checks is the liveness record and wants the
   whole history. The cap belongs to the first and never to the second.

   35 rather than 30: a few days of margin, so a row does not flicker out of the
   corpus on the boundary and get re-pushed the next night. --max-age 0 disables. */
const VALUED = new Set(['--max-age']);
const MAX_AGE = args.includes('--max-age') ? Number(args[args.indexOf('--max-age') + 1]) || 0 : 35;
const files = args.filter((a, i, all) => !a.startsWith('--') && !VALUED.has(all[i - 1]));
if (!files.length) {
  console.error('usage: node scripts/index/push-index.js <snapshot.jsonl…> [--dry]');
  console.error('  snapshots come from sitemap-jobs.js or ingest.js; either shape is accepted.');
  process.exit(1);
}

/* Mirrored from index.html, same as verify.js does it and for the same reason:
   this file is offline by design and the app is a browser IIFE. The shape is
   fixed by schema.sql's comment on job_key, and selfcheck-boards.js keeps the
   real one honest. */
const keyOf = (j) => {
  const u = String(j.url || '').trim();
  if (u && u !== 'nan') return 'u:' + u.toLowerCase();
  return 't:' + [j.title, j.company, j.location].map((x) => String(x || '').trim().toLowerCase()).join('|');
};

/* Truncate without splitting an emoji -- see the note in the edge function's
   cut(). A cut at CAP can land between a surrogate pair; the lone surrogate has
   no UTF-8 encoding, so the body ships replacement bytes and PostgREST rejects
   the entire batch as invalid json. One Ashby posting cost 500 rows a night
   until this existed. */
const cut = (s, n) => {
  const t = String(s).slice(0, n);
  const last = t.charCodeAt(t.length - 1);
  return (last >= 0xD800 && last <= 0xDBFF) ? t.slice(0, -1) : t;
};
const clean = (v, n) => { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, n) : null; };
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
const int = (v) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Math.trunc(Number(v)) : null);

function row(r) {
  const desc = String(r.description || '');
  // `partial` wins over the presence of text: a sitemap row's "description" is
  // a de-slugged title line, and calling that full would send it to a judge.
  const tier = (!r.partial && desc.length > 200) ? 'full' : 'thin';
  return {
    job_key: keyOf(r),
    source: clean(r.source, 80) || 'unknown',
    // No url column: job_key IS 'u:' || lower(url) for every row, so storing it
    // again cost 42 MB of exact duplication in the table whose key is already
    // its largest consumer. Readers derive it with substring(job_key from 3).
    title: clean(r.title, 300) || '(untitled)',
    company: clean(r.company, 200),
    location: clean(r.location, 200),
    posted: date(r.posted),
    description: tier === 'full' ? cut(desc, CAP) : null,
    tier,
    exp_min: int(r.exp_min), exp_max: int(r.exp_max),
    publisher: clean(r.publisher, 120),
    updated_at: new Date().toISOString(),
  };
}

const seen = new Map();       // job_key -> row; last one wins within a run
let read = 0, skipped = 0, stale = 0, thinSkipped = 0;
for (const f of files) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const s = line.trim(); if (!s) continue;
    let r; try { r = JSON.parse(s); } catch { continue; }
    read++;
    // A row with no url and no title cannot be identified or shown.
    if (!r || (!r.url && !r.title)) { skipped++; continue; }
    const v = row(r);
    // Unknown is not old: a row with no date is KEPT, the same rule the app's
    // own age cut follows. Only a date that is actually too old drops the row.
    if (MAX_AGE && v.posted && (Date.now() - Date.parse(v.posted)) / 864e5 > MAX_AGE) { stale++; continue; }
    /* THIN ROWS DO NOT ENTER THE CORPUS, from 2026-10-04.
       A thin row is a title, company, city and experience range parsed out of a
       sitemap slug, with no description -- and three separate routes to getting
       one are all shut: Naukri's job API answers 406 recaptcha required, its job
       page is a client-rendered shell with no job text, and Google for Jobs does
       not carry Naukri at all because those pages have no JSON-LD. So the
       description is not late, it is never coming.
       Which means the score is the problem, not the storage. live.add sends every
       index row through scoreAndCut, so a thin row IS scored -- on four words of
       slug, with `thin` raised and confidence low. Measured on the eval set that
       produces fit 55 from a title alone. For a video-editor search that was 52
       of 60 rows carrying a guessed number next to 8 carrying an informed one,
       and the colour law cannot tell them apart: a guessed 62 and a real 62
       render identically. Someone uploading a CV to be told what to apply for is
       owed the second kind and nothing else.
       Not a storage decision: the database is 564 MB of 8 GB on Pro. And not a
       cost to accumulation either -- thin arrivals went 291,274 -> 49,632 -> 477
       across three crawls, because a board's live inventory does not grow, while
       full rows went 2,941 -> 3,245 -> 16,776 and are still accelerating.
       The crawl that produces them still runs: verify.js needs those snapshots to
       keep liveness on the Naukri postings people actually TRACK, which is how a
       row says "gone from the board". It just stops depositing them here. */
    if (v.tier === 'thin') { thinSkipped++; continue; }
    seen.set(v.job_key, v);
  }
  console.log(`  read ${path.relative(ROOT, f)}`);
}

const rows = [...seen.values()];
const full = rows.filter((r) => r.tier === 'full').length;
const bytes = rows.reduce((n, r) => n + (r.description ? r.description.length : 0), 0);
console.log(`\n${read} row(s) read, ${skipped} unusable, ${rows.length} distinct job_key`);
if (stale) console.log(`  ${stale} row(s) older than ${MAX_AGE}d not stored (the app cannot search them; liveness still tracks them)`);
if (thinSkipped) console.log(`  ${thinSkipped} thin row(s) not stored (no description, so no score worth showing; liveness still tracks them)`);
console.log(`  full ${full} · thin ${rows.length - full}`);
console.log(`  description payload: ${(bytes / 1e6).toFixed(1)} MB after the ${CAP}-char cap`);

if (DRY) { console.log('\n--dry: nothing sent.'); process.exit(0); }

(async () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('\nSUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set, nothing sent.');
    console.log('  They live in supabase/.env, which is gitignored. Run with --dry to see the shape.');
    return;
  }
  const send = async (body) => {
    const r = await fetch(`${url}/rest/v1/job_index?on_conflict=job_key`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(body),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    return r.ok ? null : `${r.status} ${(await r.text()).slice(0, 200)}`;
  };

  /* One bad chunk used to kill the whole push. On 2026-10-03 it did: row 14,000
     of 18,503 came back `400 PGRST102 Empty or invalid json` and process.exit(1)
     threw away the remaining 4,503 rows. The chunk was not the problem -- 1.60
     MB, no control characters, no lone surrogates, largest row 6.5 KB, and a
     2.22 MB chunk had already gone through at row 3,000. PostgREST says exactly
     that when a body arrives truncated, so it was the wire, not the data.
     Which makes aborting the wrong response twice over: the work is retryable,
     and a nightly crawl nobody is watching must not lose a quarter of its
     output to one dropped connection. So: retry with backoff, then halve the
     chunk in case size really was the issue, and only then give up on THAT
     chunk and carry on with the rest. */
  let sent = 0, lost = 0;
  const failures = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const body = rows.slice(i, i + CHUNK);
    let err = await send(body);
    for (let attempt = 1; err && attempt <= 3; attempt++) {
      await new Promise((r) => setTimeout(r, 400 * attempt * attempt));
      err = await send(body);
    }
    if (err) {
      // Maybe it really was too big: try it in halves before writing it off.
      const mid = Math.ceil(body.length / 2);
      const a = await send(body.slice(0, mid));
      const b = a ? null : await send(body.slice(mid));
      if (!a && !b) { sent += body.length; process.stdout.write(`\r  pushed ${sent}/${rows.length} (split one chunk)`); continue; }
      failures.push(`row ${i}: ${err}`);
      lost += body.length;
      continue;
    }
    sent += body.length;
    process.stdout.write(`\r  pushed ${sent}/${rows.length}`);
  }
  console.log(`\r  pushed ${sent} row(s) into public.job_index     `);
  if (lost) {
    console.error(`  ${lost} row(s) in ${failures.length} chunk(s) did NOT land:`);
    failures.slice(0, 5).forEach((f) => console.error(`    ${f}`));
    process.exitCode = 1;        // refresh.sh should notice, but only at the end
  }
})();
