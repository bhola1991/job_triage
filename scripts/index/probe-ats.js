#!/usr/bin/env node
// Guess a company's ATS board from its NAME, and keep what answers:
//
//   node scripts/index/probe-ats.js --sample 80            # all regions, 80 each
//   node scripts/index/probe-ats.js --source arbeitnow --sample 150
//   node scripts/index/probe-ats.js --sample 80 --write    # append hits to sources.json
//   node scripts/index/probe-ats.js --names acme,globex    # probe specific names
//
// Why this exists
// ---------------
// harvest-slugs.js is the REACTIVE half: it mines job urls we already paid for
// for `boards.greenhouse.io/acme` patterns. That only ever finds companies which
// happened to appear in a paid search. Checked against the live corpus on
// 2026-10-03 it has nothing left to find -- 347,092 rows yielded 24 distinct ATS
// slugs and all 24 were already in sources.json.
//
// This is the proactive half. An ATS board url is PREDICTABLE from a company
// name, so a name is a free lottery ticket on a whole board: one hit buys every
// posting that company advertises, with full descriptions, keyless, for as long
// as they keep hiring -- measured at ~103 jobs each (4,838 from 47 companies).
// That is the one form of acquisition that gets cheaper as it runs.
//
// The name list is already paid for. job_index carries 51,631 distinct Indian
// companies from Naukri plus, usefully for coverage beyond India, 647 from
// Singapore's MyCareersFuture, 284 from Germany's Arbeitnow and 647 from
// Himalayas. So the regions can be probed SEPARATELY, which matters because the
// whole question is whether the hit rate outside US tech is worth a full pass:
// Greenhouse, Lever and Ashby skew heavily American, and if an Indian or
// Singaporean employer is simply not on one of them, 150,000 requests would buy
// nothing. Measure per region first, decide after.
//
// Every endpoint below is the same public, keyless JSON a company's own careers
// page loads in the browser -- the point README makes about reading feeds rather
// than scraping. A miss is a 404 and costs nobody anything.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SOURCES = path.join(__dirname, 'sources.json');
for (const line of fs.readFileSync(path.join(ROOT, 'supabase/.env'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const SB = process.env.SUPABASE_URL || '';
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const SAMPLE = Math.max(1, Number(arg('sample', 60)) || 60);
const CONC = Math.max(1, Number(arg('conc', 6)) || 6);

/* Regions, named by the source that supplies them, because that is the only
   geography we actually know about a row. */
const REGIONS = {
  'mycareersfuture': 'Singapore / SE Asia',
  'arbeitnow': 'Germany / Europe',
  'himalayas': 'global remote (US-weighted)',
  'naukri-sitemap': 'India',
};

/* The six platforms whose board JSON is public and keyless. Each takes a slug
   and answers with its postings; `rows` pulls the count out of whatever shape
   that particular vendor returns, since no two agree. */
const ATS = {
  greenhouse: { url: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
    rows: (d) => (d && Array.isArray(d.jobs) ? d.jobs.length : 0) },
  lever: { url: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
    rows: (d) => (Array.isArray(d) ? d.length : 0) },
  ashby: { url: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
    rows: (d) => (d && Array.isArray(d.jobs) ? d.jobs.length : 0) },
  workable: { url: (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}?details=true`,
    rows: (d) => (d && Array.isArray(d.jobs) ? d.jobs.length : 0) },
  smartrecruiters: { url: (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings`,
    rows: (d) => (d && Array.isArray(d.content) ? d.content.length : 0) },
  recruitee: { url: (s) => `https://${s}.recruitee.com/api/offers/`,
    rows: (d) => (d && Array.isArray(d.offers) ? d.offers.length : 0) },
  /* No workable probe. apply.workable.com allows a fixed number of calls a DAY
     -- 429 with Retry-After: 85902 once tripped -- so asking it about 647
     companies spends a day's quota to find a handful of boards that ingest.js
     then cannot crawl for 24 hours. Workable comes in through the aggregate at
     jobs.workable.com instead, which the edge function queries per search. */
};

/* Legal suffixes carry no identity and never appear in a slug. The list is
   deliberately multi-jurisdiction: this is being pointed at Singapore, Germany
   and India, not just at Delaware. */
const SUFFIX = new RegExp('\\b(' + [
  'private limited', 'pvt ltd', 'pvt\\. ltd', 'pvt', 'limited', 'ltd', 'llp',
  'inc', 'incorporated', 'llc', 'corp', 'corporation', 'co', 'company',
  'gmbh', 'ag', 'ug', 'kg', 'bv', 'nv', 'sa', 'sas', 'srl', 'spa', 'ab', 'as', 'oy', 'aps',
  'pte ltd', 'pte', 'sdn bhd', 'sdn', 'bhd', 'tbk', 'plc',
  'technologies', 'technology', 'solutions', 'services', 'systems', 'labs', 'group', 'holdings',
].join('|') + ')\\b', 'gi');

const GENERIC = new Set(['india', 'china', 'global', 'international', 'national', 'general',
  'career', 'careers', 'jobs', 'hiring', 'staffing', 'consulting', 'consultancy', 'recruitment',
  'software', 'digital', 'data', 'cloud', 'media', 'health', 'finance', 'bank', 'retail',
  'owner', 'smart', 'superior', 'linear', 'atlas', 'automation', 'engineering', 'management',
  'enterprise', 'enterprises', 'ventures', 'partners', 'associates', 'industries', 'infotech']);

function slugs(name) {
  const base = String(name || '').toLowerCase()
    .replace(/[&+]/g, ' and ').replace(SUFFIX, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base || base.length < 3) return [];
  const words = base.split(' ');
  /* Full name only, concatenated or hyphenated. There WAS a first-word rule
     here -- "Zomato Media" -> zomato -- and the 2026-10-03 sample showed why it
     cannot stay: a first word is usually a common noun, and common nouns are
     real boards belonging to somebody else. It matched greenhouse/`india` for
     three different Indian companies, ashby/`owner` for "owner tata consultancy
     services" (Owner is a US company), greenhouse/`general` for General Motors,
     plus `career`, `automation`, `smart`, `superior` and ashby/`linear` for
     "Linear Service GmbH". Every one a confident wrong answer, and --write would
     have put them in sources.json where ingest.js would crawl another company's
     jobs under this one's name. A probe that guesses is worse than no probe. */
  /* And a slug that is one common word is still a collision even when it came
     from the whole name. "solutions india pvt ltd" loses every token to SUFFIX
     and arrives as `india`, which IS a greenhouse board -- belonging to somebody
     else. A company identified by a word this generic cannot be probed by name
     at all, so it is skipped rather than guessed at. */
  return [...new Set([words.join(''), words.join('-')])]
    .filter((s) => s.length >= 4 && s.length <= 40 && !GENERIC.has(s));
}

const getJson = async (url) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'JobTriage index', Accept: 'application/json' },
      signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const t = await r.text();
    try { return JSON.parse(t); } catch { return null; }
  } catch { return null; }
};

async function companies(source, n) {
  const q = `job_index?select=company&source=eq.${encodeURIComponent(source)}` +
            `&company=not.is.null&limit=${n * 4}`;
  const r = await fetch(`${SB}/rest/v1/${q}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  if (!r.ok) throw new Error(`PostgREST ${r.status}`);
  const seen = new Set();
  for (const row of await r.json()) {
    const c = String(row.company || '').trim();
    if (c.length > 2) seen.add(c);
    if (seen.size >= n) break;
  }
  return [...seen];
}

// Bounded concurrency: polite to six vendors at once, and a probe is cheap.
async function pool(items, worker) {
  const q = items.slice(); const out = [];
  await Promise.all(Array.from({ length: CONC }, async () => {
    for (let it; (it = q.shift());) out.push(await worker(it));
  }));
  return out;
}

(async () => {
  const named = arg('names', '');
  const groups = named
    ? [['--names', named.split(',').map((s) => s.trim()).filter(Boolean)]]
    : await (async () => {
        const only = arg('source', '');
        const srcs = only ? [only] : Object.keys(REGIONS);
        const g = [];
        for (const s of srcs) g.push([s, await companies(s, SAMPLE)]);
        return g;
      })();

  const hits = [];
  for (const [source, names] of groups) {
    if (!names.length) { console.log(`\n${source}: no companies found`); continue; }
    console.log(`\n${source}${REGIONS[source] ? `  (${REGIONS[source]})` : ''}` +
      `  — ${names.length} companies, ${names.reduce((n, c) => n + slugs(c).length, 0)} slug candidates`);
    const found = [];
    await pool(names, async (name) => {
      for (const s of slugs(name)) {
        for (const [plat, cfg] of Object.entries(ATS)) {
          const d = await getJson(cfg.url(s));
          const n = d ? cfg.rows(d) : 0;
          if (n > 0) {
            found.push({ source, name, platform: plat, slug: s, jobs: n });
            console.log(`   HIT  ${plat.padEnd(15)} ${s.padEnd(26)} ${String(n).padStart(4)} jobs   (${name})`);
            return;                              // one board per company is enough
          }
        }
      }
    });
    hits.push(...found);
    const jobs = found.reduce((n, h) => n + h.jobs, 0);
    console.log(`   ${found.length}/${names.length} companies have a board ` +
      `(${(100 * found.length / names.length).toFixed(1)}%), ${jobs} jobs behind them` +
      (found.length ? `, ~${Math.round(jobs / found.length)} each` : ''));
  }

  console.log('\n── verdict ──');
  if (!hits.length) {
    console.log('No boards found. These employers are not on a probeable ATS, so a full');
    console.log('pass would buy nothing -- which is exactly what this script is for.');
    return;
  }
  const byPlat = {};
  for (const h of hits) byPlat[h.platform] = (byPlat[h.platform] || 0) + 1;
  console.log('by platform: ' + Object.entries(byPlat).sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p} ${n}`).join(', '));
  for (const [source] of groups) {
    const f = hits.filter((h) => h.source === source);
    const names = groups.find((g) => g[0] === source)[1];
    if (!names.length) continue;
    const rate = f.length / names.length;
    console.log(`${source.padEnd(16)} ${(100 * rate).toFixed(1)}%  ` +
      `-> extrapolated over its whole list: see README; jobs/board ~${f.length ? Math.round(f.reduce((n, h) => n + h.jobs, 0) / f.length) : 0}`);
  }
  if (has('write')) {
    const cur = JSON.parse(fs.readFileSync(SOURCES, 'utf8'));
    /* Which platforms ingest.js can actually crawl, read out of ingest.js rather
       than listed again here -- a second copy would drift, and the failure is
       invisible. This existed as `if (!Array.isArray(cur[platform])) continue`,
       which skipped any platform sources.json had no key for and said nothing:
       the 2026-10-03 Himalayas pass found 126 boards, wrote 89, and binned 35 on
       smartrecruiters, recruitee and workable. A discovery tool that discards
       discoveries quietly is worse than one that crashes. */
    const crawler = fs.readFileSync(path.join(__dirname, 'ingest.js'), 'utf8');
    const supported = new Set(Object.keys(ATS).filter((pl) => new RegExp(`^  ${pl}: \\{`, 'm').test(crawler)));
    const orphans = [...new Set(hits.map((h) => h.platform))].filter((pl) => !supported.has(pl));
    let added = 0;
    for (const h of hits) {
      if (!supported.has(h.platform)) continue;
      if (!Array.isArray(cur[h.platform])) cur[h.platform] = [];   // create, never skip
      if (cur[h.platform].includes(h.slug)) continue;
      cur[h.platform].push(h.slug); added++;
    }
    if (orphans.length) {
      const lost = hits.filter((h) => orphans.includes(h.platform));
      console.log(`\n  !! ${lost.length} board(s) NOT saved: ingest.js has no crawler for ` +
        `${orphans.join(', ')}. Add one there first, then re-run -- these are found and unusable.`);
    }
    for (const k of Object.keys(cur)) if (Array.isArray(cur[k])) cur[k].sort();
    fs.writeFileSync(SOURCES, JSON.stringify(cur, null, 2) + '\n');
    console.log(`\nwrote ${added} new slug(s) to ${path.relative(ROOT, SOURCES)}`);
    console.log('ingest.js will crawl them on the next pass; nothing else to do.');
  } else {
    console.log('\n(--write would append these to sources.json)');
  }
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
