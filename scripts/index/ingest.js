// Build the shared job index:  node scripts/index/ingest.js [out.jsonl]
//
// Crawl once, centrally, into one store. Everything here is free and keyless:
// an ATS feed is the same JSON the company's own careers page loads. That is
// the whole argument for an index — acquisition costs ~16x what scoring costs
// per row (see scripts/index/README.md), so the row you buy once and serve to
// every user is the only version of this that scales.
//
// Output is JSON Lines in the app's own Job shape, so a row from the index and
// a row from a live search are the same object downstream.
const fs = require('fs'), path = require('path');
const SRC = require('./sources.json');

const strip = h => String(h || '').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim();
const day = v => { const d = new Date(v); return isNaN(+d) ? '' : d.toISOString().slice(0, 10); };

// Same three feeds the app reads, same parse shape. Kept deliberately small:
// each returns {title, company, url, location, description, posted, publisher}.
const ATS = {
  greenhouse: {
    url: s => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`,
    rows: (d, s) => (d.jobs || []).map(x => ({
      title: x.title || '', company: s, url: x.absolute_url || '',
      location: (x.location && x.location.name) || '',
      description: strip(x.content || ''), posted: (x.updated_at || '').slice(0, 10) })),
  },
  lever: {
    url: s => `https://api.lever.co/v0/postings/${s}?mode=json`,
    rows: (d, s) => (Array.isArray(d) ? d : []).map(x => ({
      title: x.text || '', company: s, url: x.hostedUrl || x.applyUrl || '',
      location: (x.categories && x.categories.location) || '',
      description: strip(x.descriptionPlain || x.description || ''), posted: day(x.createdAt) })),
  },
  ashby: {
    url: s => `https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=true`,
    rows: (d, s) => (d.jobs || []).map(x => ({
      title: x.title || '', company: s, url: x.jobUrl || x.applyUrl || '',
      location: x.location || '',
      description: strip(x.descriptionPlain || x.descriptionHtml || ''), posted: (x.publishedAt || '').slice(0, 10) })),
  },
  /* The three below were added 2026-10-03 because probe-ats.js found boards on
     them and --write silently dropped every one: it only appends to a
     sources.json key that already exists, and only greenhouse/lever/ashby did.
     35 boards of 126 went in the bin on the first real pass. */
  smartrecruiters: {
    url: s => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`,
    // The ONLY one of the five with no description in its listing -- `ref` is an
    // API url, not the text. Fetching each posting would be one request per job,
    // so these arrive without one and push-index.js tiers them thin on its own,
    // which is the honest outcome rather than a fabricated snippet.
    rows: (d, s) => (d.content || []).map(x => ({
      title: x.name || '', company: s,
      url: x.id ? `https://jobs.smartrecruiters.com/${s}/${x.id}` : '',
      location: (x.location && (x.location.fullLocation ||
        [x.location.city, x.location.region].filter(Boolean).join(', '))) || '',
      description: '', posted: (x.releasedDate || '').slice(0, 10) })),
  },
  recruitee: {
    url: s => `https://${s}.recruitee.com/api/offers/`,
    rows: (d, s) => (d.offers || []).map(x => ({
      title: x.title || x.position || '', company: x.company_name || s,
      url: x.careers_url || '',
      location: [x.city, x.country].filter(Boolean).join(', ') || x.location || '',
      description: strip(x.description || x.requirements || ''),
      posted: String(x.published_at || x.created_at || '').slice(0, 10) })),
  },
  // Per-company, which is NOT the same as the jobs.workable.com aggregate the
  // edge function queries: that caps at ten rows a query, this returns a
  // company's whole board with descriptions (9,440 characters in the sample).
  workable: {
    url: s => `https://apply.workable.com/api/v1/widget/accounts/${s}?details=true`,
    rows: (d, s) => (d.jobs || []).map(x => ({
      title: x.title || '', company: (d.name || s),
      url: x.url || x.shortlink || x.application_url || '',
      location: (Array.isArray(x.locations) && x.locations[0]) ||
        [x.city, x.state, x.country].filter(Boolean).join(', ') || '',
      description: strip(x.description || ''),
      posted: String(x.published_on || x.created_at || '').slice(0, 10) })),
  },
};
const FEED = {
  remoteok: d => (Array.isArray(d) ? d : []).filter(x => x && x.position).map(x => ({
    title: x.position, company: x.company || '', url: x.url || '',
    location: `${x.location || 'Anywhere'} (remote)`, description: strip(x.description), posted: day(x.date) })),
  arbeitnow: d => (d.data || []).map(x => ({
    title: x.title || '', company: x.company_name || '', url: x.url || '',
    location: x.location || '', description: strip(x.description), posted: day(x.created_at * 1000) })),
  remotive: d => (d.jobs || []).map(x => ({
    title: x.title || '', company: x.company_name || '', url: x.url || '',
    location: `${x.candidate_required_location || 'Anywhere'} (remote)`,
    description: strip(x.description), posted: day(x.publication_date) })),
};

/* ── paged sources ──────────────────────────────────────────────────────────
   The feeds above hand back one page and stop. These two hand back a cursor,
   and they are large: Himalayas reports 96,023 postings and Singapore's
   MyCareersFuture 91,026, both keyless.

   Which is exactly why they are CAPPED. Those are full rows carrying real
   descriptions -- the thing that makes a row judgeable and also the thing that
   costs space. At the 4,000-character cap push-index.js applies, 187k of them
   is roughly 750 MB against a 500 MB database. PAGE_CAP keeps a run bounded
   and honest; raising it is a decision to make after thin rows stop carrying a
   description they do not have, which is where the space actually went. */
/* Page size is the SOURCE's choice, not ours. Himalayas caps at 20 a page
   whatever `limit` says -- 96,023 postings would be 4,800 requests, so it is a
   drip rather than a crawl and the cap below is what one polite run takes.
   job_index upserts on job_key, so successive runs accumulate rather than
   repeat. MyCareersFuture honours 100. */
async function paged(urlFor, rowsOf, map, cap) {
  const out = [];
  // Did we reach the END of the source, or did we stop because the cap said so?
  // verify.js cannot tell those apart from the rows alone, and the difference
  // decides whether absence from this run means anything. Running out of pages
  // is a census; stopping at the cap is a sample.
  let complete = false;
  for (let i = 0; i < cap; i++) {
    const d = await get(urlFor(i, out.length));
    const rows = rowsOf(d) || [];
    if (!rows.length) { complete = true; break; }
    out.push(...rows.map(map));
  }
  return { rows: out, complete };
}

const PAGED = {
  // pubDate is unix seconds. locationRestrictions is an array and often empty,
  // which for a remote board means "anywhere" rather than "unknown".
  himalayas: () => paged(
    (_i, n) => `https://himalayas.app/jobs/api?limit=100&offset=${n}`,
    (d) => d.jobs,
    (x) => ({ title: x.title || '', company: x.companyName || '',
      url: x.applicationLink || x.guid || '',
      location: ((x.locationRestrictions || []).join(', ') || 'Anywhere') + ' (remote)',
      description: strip(x.description), posted: day((x.pubDate || 0) * 1000) }), 50),

  // Singapore's government board. Offset paging, and the posting url is built
  // from the uuid rather than returned.
  mycareersfuture: () => paged(
    (i) => `https://api.mycareersfuture.gov.sg/v2/jobs?limit=100&page=${i}`,
    (d) => d.results,
    (x) => ({ title: x.title || '', company: (x.postedCompany || {}).name || (x.hiringCompany || {}).name || '',
      url: x.uuid ? `https://www.mycareersfuture.gov.sg/job/${x.uuid}` : '',
      location: [(x.address || {}).building, (x.address || {}).district, 'Singapore'].filter(Boolean).join(', '),
      description: strip(x.description),
      posted: ((x.metadata || {}).newPostingDate || '').slice(0, 10) }), 20),
};

/* Per-host spacing, because one vendor said so. The first crawl of the Workable
   per-company boards returned 429 for every one of the eight: with 8 workers and
   no gap, apply.workable.com sees a burst and refuses the lot. A 429 was then
   thrown like any other status and the boards just vanished into `failed`.
   Honoured here rather than worked around -- 429 means slow down, so this slows
   down, and respects Retry-After when they send one. */
const HOST_GAP_MS = { 'apply.workable.com': 1100 };
const lastHit = new Map();
async function paced(host) {
  const gap = HOST_GAP_MS[host]; if (!gap) return;
  const wait = (lastHit.get(host) || 0) + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}
const get = async (url, tries = 3) => {
  // No url in the user agent: see sitemap-jobs.js — an edge that 403s any UA
  // containing one. (This comment sat INSIDE the object literal for one commit
  // and silently ate the closing brace; ingest.js is not covered by any check,
  // so it stayed broken until the next crawl.)
  const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
  for (let attempt = 1; ; attempt++) {
    await paced(host);
    const r = await fetch(url, { headers: { 'User-Agent': 'JobTriage index' },
                                 signal: AbortSignal.timeout(30000) });
    if (r.ok) return r.json();
    // 429 and 5xx are "later", not "no". Anything else is a real answer.
    if ((r.status === 429 || r.status >= 500) && attempt < tries) {
      const after = Number(r.headers.get('retry-after'));
      await new Promise((res) => setTimeout(res, Number.isFinite(after) && after > 0
        ? Math.min(after, 30) * 1000 : 800 * attempt * attempt));
      continue;
    }
    throw new Error(`${r.status}`);
  }
};

// One task per source. A source that fails is reported and skipped, never fatal:
// a thin index is recoverable, a crawl that dies on one 404 is not.
async function main() {
  const out = path.resolve(process.argv[2] || 'scripts/index/index.jsonl');
  const tasks = [];
  /* No 'workable' here, and the ATS entry above is kept only so the shape is
     documented. apply.workable.com enforces a DAILY quota: once tripped it
     answers 429 with `Retry-After: 85902` -- 23.9 hours -- and the probe plus
     two crawls tripped it in an afternoon. Eight boards against a 24-hour
     window is not a crawl, and probing for more boards burns the same quota
     faster than crawling can spend it.
     None of which costs us Workable: jobs.workable.com, a DIFFERENT host with
     no such limit, serves the whole 170,321-posting aggregate and the edge
     function queries it per title on every search. So Workable arrives through
     the front door and this back one stays shut. */
  for (const platform of ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee'])
    for (const slug of SRC[platform] || [])
      tasks.push({ name: `${platform}:${slug}`, publisher: platform,
                   run: () => get(ATS[platform].url(slug)).then(d => ATS[platform].rows(d, slug)) });
  // A single-page feed is a WINDOW on a larger board, never its census: RemoteOK
  // and Remotive hand back the newest ~100 and stop, so a posting falling off
  // page one is not a posting that closed. Absence here proves nothing, and
  // saying so is the whole fix.
  for (const [name, url] of Object.entries(SRC.feeds || {}))
    tasks.push({ name, publisher: name, census: 'window', run: () => get(url).then(FEED[name]) });
  for (const [name, run] of Object.entries(PAGED))
    tasks.push({ name, publisher: name, census: 'paged', run });

  const seen = new Set(), rows = [], failed = [];
  const complete = [], partial = [];
  let dupes = 0;
  // Bounded concurrency: polite to every host, and fast enough for 47 sources.
  const queue = tasks.slice();
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let t; (t = queue.shift());) {
      try {
        const got = await t.run();
        // paged() answers with {rows, complete}; an ATS board or a feed answers
        // with a plain array. An ATS board IS the company's whole list, so it
        // is a census; a feed is not, whatever it returns.
        const list = Array.isArray(got) ? got : (got.rows || []);
        const isCensus = Array.isArray(got) ? t.census !== 'window' : !!got.complete;
        (isCensus ? complete : partial).push(t.name);
        let kept = 0;
        for (const j of list) {
          if (!j.title || !j.url) continue;
          const key = j.url.split(/[?#]/)[0].toLowerCase();
          if (seen.has(key)) { dupes++; continue; }          // URL-first dedup, as the app does
          seen.add(key);
          rows.push({ ...j, publisher: t.publisher, source: t.name, indexed: new Date().toISOString().slice(0, 10) });
          kept++;
        }
        process.stderr.write(`  ${t.name}: ${kept}\n`);
      } catch (e) { failed.push(`${t.name}: ${e.message}`); }
    }
  }));

  // A crawl that kept nothing is a failure, not an empty index. Writing it out
  // replaced a good index.jsonl with a single newline, reported NaN bytes/job,
  // and still exited 0 -- so cron called it a success and the next retrieve.js
  // died on JSON.parse('') with no hint why.
  if (!rows.length) {
    console.error(`\nno jobs crawled from ${tasks.length} sources; leaving ${out} untouched`);
    if (failed.length) console.error(`failed:\n  ${failed.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  /* The sidecar, same shape and same reason as sitemap-jobs.js: tell the
     verifier what this run could NOT see. Written even when everything was a
     census, because an absent file is ambiguous between "nothing was capped"
     and "an older crawler wrote this". */
  fs.writeFileSync(out.replace(/\.jsonl$/, '') + '.meta.json',
    JSON.stringify({ at: new Date().toISOString(), complete: complete.sort(),
                     partial: partial.sort(), failed }, null, 2) + '\n');
  const bytes = fs.statSync(out).size;
  console.log(`\nindexed ${rows.length} jobs from ${tasks.length - failed.length}/${tasks.length} sources`);
  console.log(`dropped ${dupes} duplicates by URL`);
  console.log(`${out}  ${(bytes / 1e6).toFixed(1)} MB  (${Math.round(bytes / rows.length)} bytes/job)`);
  if (failed.length) console.log(`\nfailed (skipped, not fatal):\n  ${failed.join('\n  ')}`);
  if (partial.length) console.log(`\nsampled, not enumerated (absence here will NOT close a row):\n  ${partial.join(', ')}`);
}
main();
