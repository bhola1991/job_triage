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

const get = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': 'JobTriage index (jobtriage.reachbhola.workers.dev)' },
                               signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
};

// One task per source. A source that fails is reported and skipped, never fatal:
// a thin index is recoverable, a crawl that dies on one 404 is not.
async function main() {
  const out = path.resolve(process.argv[2] || 'scripts/index/index.jsonl');
  const tasks = [];
  for (const platform of ['greenhouse', 'lever', 'ashby'])
    for (const slug of SRC[platform] || [])
      tasks.push({ name: `${platform}:${slug}`, publisher: platform,
                   run: () => get(ATS[platform].url(slug)).then(d => ATS[platform].rows(d, slug)) });
  for (const [name, url] of Object.entries(SRC.feeds || {}))
    tasks.push({ name, publisher: name, run: () => get(url).then(FEED[name]) });

  const seen = new Set(), rows = [], failed = [];
  let dupes = 0;
  // Bounded concurrency: polite to every host, and fast enough for 47 sources.
  const queue = tasks.slice();
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let t; (t = queue.shift());) {
      try {
        const got = await t.run();
        let kept = 0;
        for (const j of got) {
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

  fs.writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const bytes = fs.statSync(out).size;
  console.log(`\nindexed ${rows.length} jobs from ${tasks.length - failed.length}/${tasks.length} sources`);
  console.log(`dropped ${dupes} duplicates by URL`);
  console.log(`${out}  ${(bytes / 1e6).toFixed(1)} MB  (${Math.round(bytes / rows.length)} bytes/job)`);
  if (failed.length) console.log(`\nfailed (skipped, not fatal):\n  ${failed.join('\n  ')}`);
}
main();
