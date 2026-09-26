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
const files = args.filter((a) => !a.startsWith('--'));
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
    url: String(r.url || '').slice(0, 2000),
    title: clean(r.title, 300) || '(untitled)',
    company: clean(r.company, 200),
    location: clean(r.location, 200),
    posted: date(r.posted),
    description: tier === 'full' ? desc.slice(0, CAP) : null,
    tier,
    exp_min: int(r.exp_min), exp_max: int(r.exp_max),
    publisher: clean(r.publisher, 120),
    updated_at: new Date().toISOString(),
  };
}

const seen = new Map();       // job_key -> row; last one wins within a run
let read = 0, skipped = 0;
for (const f of files) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const s = line.trim(); if (!s) continue;
    let r; try { r = JSON.parse(s); } catch { continue; }
    read++;
    // A row with no url and no title cannot be identified or shown.
    if (!r || (!r.url && !r.title)) { skipped++; continue; }
    const v = row(r);
    seen.set(v.job_key, v);
  }
  console.log(`  read ${path.relative(ROOT, f)}`);
}

const rows = [...seen.values()];
const full = rows.filter((r) => r.tier === 'full').length;
const bytes = rows.reduce((n, r) => n + (r.description ? r.description.length : 0), 0);
console.log(`\n${read} row(s) read, ${skipped} unusable, ${rows.length} distinct job_key`);
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
  let sent = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const body = rows.slice(i, i + CHUNK);
    const r = await fetch(`${url}/rest/v1/job_index?on_conflict=job_key`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(body),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (!r.ok) { console.error(`\n  failed at row ${i}: ${r.status} ${(await r.text()).slice(0, 300)}`); process.exit(1); }
    sent += body.length;
    process.stdout.write(`\r  pushed ${sent}/${rows.length}`);
  }
  console.log(`\r  pushed ${sent} row(s) into public.job_index     `);
})();
