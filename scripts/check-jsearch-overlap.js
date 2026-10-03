#!/usr/bin/env node
// Does JSearch return the SAME postings the Naukri crawler already has?
//
//   node scripts/check-jsearch-overlap.js "data engineer" "operations manager"
//
// Why this exists
// ---------------
// 340,907 of the corpus rows are `thin`: a title, company, city and experience
// range parsed out of a Naukri sitemap slug, with no description, so they can be
// shortlisted and never judged. Naukri's own job API is reCAPTCHA-gated and its
// job page is a client-rendered shell carrying no text, so there is no scraping
// its way to a description.
//
// But Naukri publishes those sitemaps for ONE reason -- Google for Jobs requires
// a complete sitemap, and Naukri wants the traffic. So the text it withholds
// from its API it hands to Google deliberately. JSearch reads Google for Jobs,
// and maps `url: job_apply_link`, which the edge function documents as "the site
// the posting actually lives on". For a Naukri posting that should be the
// naukri.com url -- the same job_key the crawler stored -- which would make the
// deposit an UPGRADE of a thin row rather than a second copy of the job.
//
// That is a chain of four plausible steps and nobody had tested it. This does.
//
// ANSWERED 2026-10-03, and the answer is no. Four titles, 40 rows, ZERO
// pointing at naukri.com -- publishers came back LinkedIn 13, Shine 8, BeBee 4,
// JPMorgan 2, Apna 2, Foundit 2. The reason is already in this repo's own
// measurements and nobody had joined them up: a Naukri job page carries no
// JSON-LD, and Google for Jobs REQUIRES JobPosting structured data to ingest a
// posting. So Naukri is not in Google for Jobs, and its sitemaps are plain SEO
// rather than the Google feed sitemap-jobs.js assumes when it says "every board
// needs Google for Jobs traffic".
//
// Consequence: thin Naukri rows cannot be upgraded by any free route. The API
// is reCAPTCHA-gated, the page has no text, and Google never had it. They stay
// leads -- title, company, city, date, and a url a human can click -- and
// whether 340,907 of those earn their storage is a product call, not a
// technical one.
//
// Keep this script anyway: it is the check for whether ANY source returns
// postings we already hold, and the same three questions apply the next time one
// is added. Run it before believing a new source enriches the corpus.
//
// What it answers, in order of how much it matters:
//
//   1. Does JSearch surface Naukri postings at all? If Google for Jobs does not
//      carry them, the whole idea stops here and thin rows stay thin.
//   2. If it does, is the url EXACTLY our job_key? Then a deposit upgrades the
//      row in place and the corpus gets a judgeable description for free.
//   3. If not exactly, is it the same POSTING under a different url? A Naukri
//      job id is the last 12 digits of the slug and is the stable identity, so
//      an id match with a key mismatch means the deposit will duplicate rather
//      than upgrade -- survivable since f3d0bf9 makes the full copy win the
//      dedup collapse, but worth knowing rather than discovering later.
//
// Reads keys from supabase/.env. Costs one JSearch request per title against
// your quota and writes nothing.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, 'supabase/.env'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const KEY = process.env.JSEARCH_API_KEY || '';
const SB = process.env.SUPABASE_URL || '';
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!KEY) { console.error('JSEARCH_API_KEY not set in supabase/.env — nothing to test.'); process.exit(1); }
if (!SB || !SR) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in supabase/.env.'); process.exit(1); }
// The placeholder that has been in production: base64 for a message, not a key.
if (/^QUxMIFlPVVIgQkFTRS/.test(KEY) || KEY.startsWith('pmx_')) {
  console.error('That key will 401: it is the placeholder, or a Parse/RapidAPI key.');
  console.error('JSearch needs an OpenWeb Ninja key from app.openwebninja.com.');
  process.exit(1);
}

const titles = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!titles.length) { console.error('give at least one title, e.g. "data engineer"'); process.exit(1); }
const WHERE = process.argv.includes('--where') ? process.argv[process.argv.indexOf('--where') + 1] : 'India';

// keyOf() in index.html, mirrored -- the identity job_index, job_checks and
// public.jobs all share. Must match exactly or every lookup below is a miss.
const keyOf = (url) => 'u:' + String(url || '').trim().toLowerCase();
// A Naukri job id is DDMMYY + sequence and parses on 99.9% of sitemap rows, so
// it identifies a posting independently of how the url is dressed.
const naukriId = (url) => (/(\d{12})(?:[/?#]|$)/.exec(String(url || '')) || [])[1] || null;

const rest = async (q) => {
  const r = await fetch(`${SB}/rest/v1/${q}`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`PostgREST ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

(async () => {
  const jobs = [];
  for (const t of titles) {
    const q = new URLSearchParams({ query: `${t} in ${WHERE}`, num_pages: '1', date_posted: 'month', country: 'in' });
    try {
      const r = await fetch(`https://api.openwebninja.com/jsearch/search-v2?${q}`,
        { headers: { 'x-api-key': KEY }, signal: AbortSignal.timeout(40000) });
      if (!r.ok) { console.log(`  ${t}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`); continue; }
      const d = await r.json();
      // v1 returned a bare array, v2 wraps it; accept either, as the edge function does.
      const rows = Array.isArray(d.data) ? d.data : (d.data?.jobs || d.data?.results || d.jobs || []);
      for (const x of rows) {
        jobs.push({ title: x.job_title || '', publisher: x.job_publisher || '',
          url: x.job_apply_link || x.job_google_link || '',
          desc: String(x.job_description || '').length });
      }
      console.log(`  ${t}: ${rows.length} row(s)`);
    } catch (e) { console.log(`  ${t}: ${e.message}`); }
  }
  if (!jobs.length) { console.log('\nJSearch returned nothing — cannot answer the question.'); process.exit(1); }

  const naukri = jobs.filter((j) => /(^|\.)naukri\.com/i.test(j.url));
  console.log(`\n1. does JSearch carry Naukri postings?`);
  console.log(`   ${naukri.length} of ${jobs.length} returned rows point at naukri.com`);
  const pubs = {};
  for (const j of jobs) pubs[j.publisher || '(none)'] = (pubs[j.publisher || '(none)'] || 0) + 1;
  console.log('   publishers: ' + Object.entries(pubs).sort((a, b) => b[1] - a[1])
    .slice(0, 8).map(([p, n]) => `${p} ${n}`).join(', '));
  if (!naukri.length) {
    console.log('\n   -> Google for Jobs is not surfacing Naukri through JSearch for these titles.');
    console.log('      Thin Naukri rows cannot be upgraded this way. The full rows JSearch DOES');
    console.log('      return are still worth depositing, they just land as new postings.');
    return;
  }

  // 2. exact key match -> the deposit upgrades the row in place
  const keys = naukri.map((j) => keyOf(j.url));
  const found = [];
  for (let i = 0; i < keys.length; i += 40) {
    const chunk = keys.slice(i, i + 40).map((k) => `"${k.replace(/"/g, '')}"`).join(',');
    found.push(...await rest(`job_index?select=job_key,tier,source&job_key=in.(${chunk})`));
  }
  const byKey = new Map(found.map((r) => [r.job_key, r]));
  const exact = naukri.filter((j) => byKey.has(keyOf(j.url)));
  console.log(`\n2. is the url exactly our job_key?`);
  console.log(`   ${exact.length} of ${naukri.length} match a stored job_key exactly`);
  const upgradable = exact.filter((j) => {
    const r = byKey.get(keyOf(j.url));
    return r.tier === 'thin' && j.desc > 200;
  });
  console.log(`   ${upgradable.length} of those are stored THIN and arrive with a description`);
  console.log(`   -> ${upgradable.length} row(s) would be upgraded in place by a deposit`);

  // 3. same posting, different url -> the deposit duplicates instead
  const missed = naukri.filter((j) => !byKey.has(keyOf(j.url)));
  const sameId = [];
  for (const j of missed) {
    const id = naukriId(j.url);
    if (!id) continue;
    const hit = await rest(`job_index?select=job_key,tier&job_key=like.*${id}*&limit=1`);
    if (hit.length) sameId.push({ id, theirs: j.url, ours: hit[0].job_key.slice(2), tier: hit[0].tier });
  }
  console.log(`\n3. same posting under a different url?`);
  console.log(`   ${sameId.length} of the ${missed.length} non-matching rows are a posting we already hold`);
  for (const s of sameId.slice(0, 3)) {
    console.log(`     id ${s.id} (${s.tier})`);
    console.log(`       ours:   ${s.ours}`);
    console.log(`       theirs: ${s.theirs}`);
  }
  if (sameId.length) {
    console.log('\n   -> These deposit as a SECOND row rather than an upgrade. Not a');
    console.log('      correctness problem since f3d0bf9 prefers the full copy in the dedup');
    console.log('      collapse, but it means the corpus grows where it could have improved.');
    console.log('      Normalising job_key (strip query and fragment) would convert them.');
  }

  console.log(`\nverdict: ${upgradable.length} upgradable, ${sameId.length} duplicate-instead, ` +
    `${naukri.length - exact.length - sameId.length} unknown to the corpus`);
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
