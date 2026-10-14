// Read every board that publishes its jobs the way Google for Jobs wants them.
//
//   node scripts/index/jsonld-boards.js scripts/index/jsonld.jsonl [--cap 400] [--only board]
//
// Which boards: sources.json "jsonld", each a board and its job sitemap, as
// found by probe-boards.js (verdict BULK). One reader for all of them, because
// they all publish the same two things: a sitemap listing every job page, and
// schema.org JobPosting data on each page -- title, employer, place, dates and
// the full description, already structured. No per-board scraper.
//
// A second page type for boards with no JobPosting data but stable labelled
// fields, which is common on older job-board software: "ids" in the board's
// config maps each field to the END of an element id on the page, e.g.
//   "ids": { "title": "JD1_lblJobTitle", "description": "JD1_lblJobDesc", ... }
// Matched by suffix because the same software prefixes ids differently from
// one install to the next (devnetjobs.org "ctl00_…", devnetjobsindia.org not).
// Still config, not code: a new board on known software is one sources.json entry.
//
// The output is a SNAPSHOT, like every other file refresh.sh feeds verify.js:
// one row for every posting the board lists today. Membership is how verify.js
// knows a posting closed, so a listed posting is emitted even when its page has
// not been read yet -- as a thin row, which push-index.js declines to deposit.
//
// Pages are read once. What a page said is kept in jsonld.cache.json beside
// this file, so each night fetches only what is NEW, at most --cap pages a
// board, one at a time per board with a pause between. A board with a large
// backlog therefore fills over a few nights rather than in one burst. robots.txt
// is read first and honoured.
'use strict';
const fs = require('fs');
const path = require('path');
const { get, robots, locs, jobPosting, JOBISH } = require('./probe-boards.js');

const HERE = __dirname;
const CACHE = path.join(HERE, 'jsonld.cache.json');
const PAUSE_MS = 1500;
const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--cap' && args[args.indexOf(a) - 1] !== '--only');
const CAP = +(args[args.indexOf('--cap') + 1] || 0) || 400;
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
if (!OUT) { console.error('usage: jsonld-boards.js <out.jsonl> [--cap N] [--only board]'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (h) => String(h || '').replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const day = (v) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : ''; };

/* JobPosting into an index row. jobLocation is an object or an array of them,
   and addressCountry is a string or {name}; a remote role says so in
   jobLocationType instead of naming a place. */
function toRow(jp, url, board) {
  const places = [].concat(jp.jobLocation || []).map((l) => {
    const a = (l && l.address) || {};
    const c = typeof a.addressCountry === 'object' ? a.addressCountry && a.addressCountry.name : a.addressCountry;
    return [a.addressLocality, a.addressRegion, c].filter(Boolean).join(', ');
  }).filter(Boolean);
  if (/TELECOMMUTE/i.test(String(jp.jobLocationType || ''))) places.unshift('Remote');
  const org = jp.hiringOrganization;
  return {
    title: text(jp.title), company: text(typeof org === 'object' ? org && org.name : org), url,
    location: [...new Set(places)].join(' / '), description: text(jp.description),
    posted: day(jp.datePosted), valid_through: day(jp.validThrough),
    employment: [].concat(jp.employmentType || []).join(','), source: `jsonld:${board}`,
  };
}

/* The element whose id ends in `suffix`, as text. Balanced on its own tag name,
   because a description is a span or div full of nested markup. */
function byId(html, suffix) {
  const m = new RegExp(`<([a-z0-9]+)[^>]*\\bid="[^"]*${suffix}"[^>]*>`, 'i').exec(html);
  if (!m) return '';
  const tag = m[1].toLowerCase(), re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = m.index + m[0].length;
  let depth = 1, t;
  while ((t = re.exec(html))) { depth += t[1] ? -1 : 1; if (!depth) return text(html.slice(m.index + m[0].length, t.index)); }
  return '';
}
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const dmy = (s) => {   // "15 Nov 2026" -> "2026-11-15"; anything else -> ''
  const m = /(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})/i.exec(String(s || ''));
  return m && MON[m[2].toLowerCase()] ? `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}` : day(s);
};
function idsRow(html, url, board, ids) {
  const f = (k) => [].concat(ids[k] || []).map((sfx) => byId(html, sfx)).filter(Boolean).join(', ').replace(/,\s*,/g, ',').replace(/,\s*$/, '');
  const r = { title: f('title'), company: f('company'), url, location: f('location'), description: f('description'),
    posted: dmy(f('posted')), valid_through: dmy(f('valid_through')), employment: f('employment'), source: `jsonld:${board}` };
  return r.title && r.description ? r : null;
}

async function jobUrls(sitemap) {
  const out = [], seen = new Set(), queue = [sitemap];
  while (queue.length && seen.size < 60) {
    const sm = queue.shift(); if (seen.has(sm)) continue; seen.add(sm);
    const r = await get(sm, 60000); if (!r.ok) continue;
    const L = locs(r.text);
    if (/<sitemapindex/i.test(r.text.slice(0, 2000))) queue.push(...L.filter((u) => JOBISH.test(u)));
    else out.push(...L.filter((u) => { try { return JOBISH.test(new URL(u).pathname); } catch { return false; } }));
  }
  return [...new Set(out)];
}

(async () => {
  const SRC = JSON.parse(fs.readFileSync(path.join(HERE, 'sources.json'), 'utf8'));
  const boards = Object.entries(SRC.jsonld || {}).filter(([b]) => !ONLY || b === ONLY);
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { /* first run */ }
  const today = new Date().toISOString().slice(0, 10);
  const rows = [], meta = {};

  // Boards in parallel, each board's own requests one at a time.
  await Promise.all(boards.map(async ([board, cfg]) => {
    const conf = typeof cfg === 'string' ? { sitemap: cfg } : cfg;
    const skip = conf.exclude ? new RegExp(conf.exclude, 'i') : null;
    // Which sitemap urls are postings, when "looks like a job url" is not enough
    // (devnetjobs lists consulting_jobs.aspx and search_jobs.aspx beside them).
    const only = conf.match ? new RegExp(conf.match, 'i') : null;
    const m = meta[board] = { listed: 0, cached: 0, fetched: 0, nodata: 0, failed: 0, expired: 0, skipped: 0, backlog: 0 };
    let origin; try { origin = new URL(conf.sitemap).origin; } catch { m.error = 'bad sitemap url'; return; }
    const rb = await get(origin + '/robots.txt');
    const R = robots(rb.ok ? rb.text : '');
    const urls = (await jobUrls(conf.sitemap)).filter((u) => !(skip && skip.test(u)) && (!only || only.test(u)));
    m.listed = urls.length;
    if (!urls.length) {
      /* A sitemap that failed to load is not a board that closed every job.
         verify.js reads absence as closure, so carry what was read before
         forward unchanged, and let a real closure show up on a night it loads. */
      m.error = 'sitemap listed no job pages; kept last run\'s postings';
      for (const [u, c] of Object.entries(cache)) if (c.source === `jsonld:${board}` && !c.nodata) { rows.push(c); m.cached++; }
      return;
    }
    let budget = CAP;
    for (const u of urls) {
      let c = cache[u];
      if (!c) {
        let p = '/'; try { p = new URL(u).pathname; } catch { /* keep / */ }
        if (R.blocked(p)) { m.skipped++; continue; }
        if (budget <= 0) { m.backlog++; rows.push({ title: '', url: u, source: `jsonld:${board}`, partial: true }); continue; }
        budget--; await sleep(PAUSE_MS);
        const r = await get(u, 30000);
        if (!r.ok) { m.failed++; continue; }              // not cached: tried again tomorrow
        const jp = conf.ids ? null : jobPosting(r.text);
        const got = conf.ids ? idsRow(r.text, u, board, conf.ids) : jp && toRow(jp, u, board);
        c = cache[u] = got || { nodata: true, at: today };
        m.fetched++;
      } else m.cached++;
      if (c.nodata) { m.nodata++; continue; }
      if (c.valid_through && c.valid_through < today) { m.expired++; continue; }
      if (skip && skip.test(c.employment || '')) { m.skipped++; continue; }
      rows.push(c);
    }
    // Forget what the board no longer lists, or the cache only ever grows.
    const live = new Set(urls);
    for (const u of Object.keys(cache)) if (cache[u].source === `jsonld:${board}` && !live.has(u)) delete cache[u];
  }));

  fs.writeFileSync(CACHE, JSON.stringify(cache));
  fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  for (const [b, m] of Object.entries(meta)) {
    console.log(`  ${b.padEnd(22)} listed ${m.listed}, read before ${m.cached}, read now ${m.fetched}, still to read ${m.backlog}` +
      `${m.nodata ? `, no data ${m.nodata}` : ''}${m.failed ? `, failed ${m.failed}` : ''}${m.expired ? `, expired ${m.expired}` : ''}` +
      `${m.skipped ? `, skipped ${m.skipped}` : ''}${m.error ? ` — ${m.error}` : ''}`);
  }
  console.log(`  ${rows.length} rows -> ${path.relative(process.cwd(), OUT)}`);
})();
