// Can this job board be bulk-downloaded, and how?
//
//   node scripts/index/probe-boards.js idealist.org mandy.com ...
//   node scripts/index/probe-boards.js --file boards.txt [--out probe.jsonl]
//   node scripts/index/probe-boards.js --from-profiles      # what refresh.sh runs
//
// --from-profiles reads every board named in a live profile, probes only the
// ones never probed before (probe-boards.results.jsonl is the ledger), appends
// what it finds, and adds each BULK board to sources.json "jsonld" so the same
// night's jsonld-boards.js reads it. Everything else waits in the ledger, and
// scripts/insights.js lists it each morning ranked by how many people want it.
//
// Why this exists
// ---------------
// The nightly crawl downloads whole sources; it does not search them. So the
// way it gets better for a new kind of user is by gaining SOURCES, and the list
// of which sources matter comes from the users themselves: every direction on
// every profile names the specialist boards for that work (tracks[].boards).
// At search time those are only ever reached through a Google `site:` query.
// This asks the prior question for each one -- is there a door it holds open?
//
// A board that wants Google for Jobs traffic has to publish two things, and
// both are exactly what a bulk crawl needs:
//   1. a sitemap listing every job page, and
//   2. schema.org JobPosting JSON-LD on each of those pages -- title, company,
//      location, date and the full description, already structured.
// One generic reader (sitemap -> pages -> JSON-LD) therefore covers every board
// that has both, with no per-board scraper. A feed (RSS/Atom) is the other
// cheap door. Anything with neither needs a scraper written for it, or stays a
// Google `site:` query.
//
// It reads robots.txt first and does not fetch a page robots.txt disallows.
// One request at a time per host; a handful of requests per board in total.
'use strict';
const fs = require('fs');
const zlib = require('zlib');

const UA = 'Mozilla/5.0 (compatible; jobtriage/1.0)';   // same as sitemap-jobs.js; see the note there on why no url
const JOBISH = /(job|vacanc|career|opportunit|position|posting|opening|recruit|gig|work-with)/i;

async function get(url, ms = 20000) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
    let buf = Buffer.from(await r.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) { try { buf = zlib.gunzipSync(buf); } catch { /* not gzip after all */ } }
    return { ok: r.ok, status: r.status, url: r.url, text: buf.toString('utf8'), type: r.headers.get('content-type') || '' };
  } catch (e) { return { ok: false, status: 0, url, text: '', type: '', err: e.name === 'TimeoutError' ? 'timeout' : (e.cause && e.cause.code) || e.message }; }
}

/* robots.txt for `*`: the Disallow prefixes, and every Sitemap line. A parser
   this small is wrong about wildcards and Allow overrides, and wrong in the
   cautious direction: it treats a Disallow as final. */
function robots(text) {
  const maps = [], dis = []; let mine = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'sitemap') maps.push(v);
    else if (k === 'user-agent') mine = v === '*';
    else if (k === 'disallow' && mine && v) dis.push(v);
  }
  return { maps, dis, blocked: (p) => dis.some((d) => d === '/' || p.startsWith(d.replace(/\*.*$/, ''))) };
}
const locs = (xml) => [...String(xml).matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/gi)].map((m) => m[1].replace(/&amp;/g, '&'));

/* The JobPosting on a page, if any. JSON-LD arrives as an object, an array, or
   wrapped in @graph, and sites get the JSON subtly wrong often enough that a
   failed parse is ordinary rather than an error. */
function jobPosting(html) {
  for (const m of String(html).matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let d; try { d = JSON.parse(m[1].trim()); } catch { continue; }
    const all = [].concat(d && d['@graph'] ? d['@graph'] : d);
    const jp = all.find((x) => x && [].concat(x['@type'] || []).includes('JobPosting'));
    if (jp) return jp;
  }
  return null;
}

async function probe(domain) {
  const out = { board: domain, verdict: 'none', how: '', jobs_listed: 0, desc_chars: 0, fields: '', notes: [] };
  let base = `https://${domain}`;
  const home = await get(base + '/');
  if (!home.ok && home.status === 0) {
    const www = await get(`https://www.${domain}/`);
    if (www.ok || www.status) { base = `https://www.${domain}`; Object.assign(home, www); }
  }
  if (home.status === 0) { out.verdict = 'unreachable'; out.notes.push(home.err || 'no answer'); return out; }
  if (home.url) { try { base = new URL(home.url).origin; } catch { /* keep base */ } }
  if (home.status === 403 || home.status === 429 || /just a moment|attention required|captcha/i.test(home.text.slice(0, 3000))) out.notes.push(`home ${home.status}: bot wall`);

  const rb = await get(base + '/robots.txt');
  const R = robots(rb.ok && !/<html/i.test(rb.text.slice(0, 200)) ? rb.text : '');
  if (R.dis.includes('/')) out.notes.push('robots.txt disallows everything');

  /* Sitemaps: what robots.txt names, else the conventional places. Walk at most
     two levels and a few files -- enough to find the job sitemap, not a crawl. */
  const seeds = R.maps.length ? R.maps : [base + '/sitemap.xml', base + '/sitemap_index.xml'];
  const jobUrls = []; let files = 0, seenIndex = false;
  const queue = seeds.slice(0, 6);
  while (queue.length && files < 7 && jobUrls.length < 3) {
    const sm = queue.shift(); files++;
    const r = await get(sm, 30000); if (!r.ok || !/<(urlset|sitemapindex)/i.test(r.text.slice(0, 2000))) continue;
    const L = locs(r.text);
    if (/<sitemapindex/i.test(r.text.slice(0, 2000))) {
      seenIndex = true;
      const kids = L.filter((u) => JOBISH.test(u));
      queue.unshift(...(kids.length ? kids : L).slice(0, 3));
      out.sitemap_children = (out.sitemap_children || 0) + L.length;
    } else {
      const jobs = L.filter((u) => { try { return JOBISH.test(new URL(u).pathname); } catch { return false; } });
      if (jobs.length >= 3) { out.jobs_listed += jobs.length; out.sitemap = sm; jobUrls.push(...jobs.slice(0, 3)); }
    }
  }
  if (!out.sitemap && (R.maps.length || seenIndex)) out.notes.push('has a sitemap, but no job pages found in the files read');

  // A feed, from the home page's own <link> or the usual addresses.
  const feedLink = /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i.exec(home.text);
  const href = feedLink && /href=["']([^"']+)["']/i.exec(feedLink[0]);
  for (const f of [href && new URL(href[1], base).href, base + '/jobs/feed', base + '/jobs.rss', base + '/feed'].filter(Boolean).slice(0, 3)) {
    const r = await get(f); if (!r.ok || !/<(rss|feed)[\s>]/i.test(r.text.slice(0, 1500))) continue;
    const items = (r.text.match(/<(item|entry)[\s>]/gi) || []).length;
    if (items) { out.feed = f; out.feed_items = items; break; }
  }

  // One job page: is the posting there as structured data, with its text?
  for (const u of jobUrls) {
    let path = '/'; try { path = new URL(u).pathname; } catch { continue; }
    if (R.blocked(path)) { out.notes.push('robots.txt disallows the job pages'); break; }
    const r = await get(u);
    if (!r.ok) { out.notes.push(`job page ${r.status || r.err}`); continue; }
    const jp = jobPosting(r.text);
    if (!jp) { out.notes.push('job page has no JobPosting data'); break; }
    const desc = String(jp.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    out.desc_chars = desc.length; out.sample = u;
    out.fields = ['title', 'hiringOrganization', 'jobLocation', 'datePosted', 'validThrough', 'baseSalary', 'employmentType'].filter((k) => jp[k]).join(',');
    break;
  }

  if (out.sitemap && out.desc_chars >= 200) { out.verdict = 'BULK'; out.how = 'sitemap + JobPosting data'; }
  else if (out.feed && out.feed_items >= 5) { out.verdict = 'FEED'; out.how = `feed, ${out.feed_items} items`; }
  else if (out.sitemap) { out.verdict = 'LIST-ONLY'; out.how = 'sitemap of job pages, but the page text needs its own scraper'; }
  else if (out.notes.some((n) => /bot wall|disallows everything/.test(n))) { out.verdict = 'WALLED'; out.how = 'blocks crawlers'; }
  else { out.verdict = 'none'; out.how = 'no sitemap of jobs and no feed found'; }
  return out;
}

// Shared with jsonld-boards.js, which reads the boards this finds.
module.exports = { get, robots, locs, jobPosting, JOBISH, UA, wantedBoards, coveredBoards };   // hoisted from below
if (require.main !== module) return;

/* The boards live profiles name, with how many people name each. Profiles are
   rows now; an account that has never migrated still keeps its profile in the
   one-blob store, so that is read for those accounts only. Only tracks[].boards
   is used -- the rest of the profile, the CV above all, is not looked at. */
/* Already crawled another way: the ATS platforms ingest.js reads company by
   company, every host in sources.json "feeds" and the paged feeds, and the
   boards the paid scrapers cover. Probing them only finds their marketing
   site, and a BULK verdict would read the same postings twice. */
function coveredBoards() {
  const SRC = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'sources.json'), 'utf8'));
  const covered = new Set(['greenhouse.io', 'job-boards.greenhouse.io', 'boards.greenhouse.io', 'greenhouse.com', 'lever.co', 'jobs.lever.co',
    'ashbyhq.com', 'jobs.ashbyhq.com', 'smartrecruiters.com', 'recruitee.com', 'workable.com', 'himalayas.app', 'jobicy.com',
    'workingnomads.com', 'mycareersfuture.gov.sg', 'linkedin.com', 'indeed.com', 'naukri.com', 'upwork.com']);
  Object.values(SRC.feeds || {}).forEach((u) => { try { covered.add(new URL(u).hostname.replace(/^www\./, '')); } catch { /* skip */ } });
  return covered;
}

async function wantedBoards() {
  const env = {};
  for (const l of fs.readFileSync(require('path').join(__dirname, '../../supabase/.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const q = async (p) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${p}`, { headers: H, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`${p.split('?')[0]} ${r.status}`); return r.json(); };
  const want = new Map();
  const add = (user, tracks) => [].concat(tracks || []).forEach((t) => [].concat((t && t.boards) || []).forEach((b) => {
    const k = String(b).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (k.includes('.')) { if (!want.has(k)) want.set(k, new Set()); want.get(k).add(user); }
  }));
  const rows = await q('profiles?select=user_id,tracks&deleted=is.false');
  rows.forEach((r) => add(r.user_id, r.tracks));
  const haveRows = new Set(rows.map((r) => r.user_id));
  for (const s of await q('user_state?select=user_id,v&k=eq.triage:db')) {
    if (haveRows.has(s.user_id)) continue;
    let d; try { d = JSON.parse(s.v); } catch { continue; }
    Object.values((d && d.profiles) || {}).forEach((p) => p && p.profile && add(s.user_id, p.profile.tracks));
  }
  return want;
}

(async () => {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--file'), oi = args.indexOf('--out');
  let boards = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--file' && args[i - 1] !== '--out');
  if (fi > -1) boards = boards.concat(fs.readFileSync(args[fi + 1], 'utf8').split(/\s+/).filter(Boolean));
  boards = [...new Set(boards.map((b) => b.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')))];

  const LEDGER = require('path').join(__dirname, 'probe-boards.results.jsonl');
  const fromProfiles = args.includes('--from-profiles');
  if (fromProfiles) {
    const done = new Set(); try { fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).forEach((l) => done.add(JSON.parse(l).board.replace(/^www\./, ''))); } catch { /* no ledger yet */ }
    const want = await wantedBoards();
    const covered = coveredBoards();
    boards = [...want.keys()].filter((b) => !done.has(b) && !covered.has(b));
    console.log(`  ${want.size} boards named across live profiles, ${boards.length} not probed before`);
    if (!boards.length) return;
  }
  if (!boards.length) { console.error('usage: probe-boards.js <domain>... | --file boards.txt [--out probe.jsonl]'); process.exit(1); }

  const results = []; let next = 0;
  // Eight boards at a time; each board's own requests stay sequential.
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < boards.length) {
      const b = boards[next++];
      const r = await probe(b).catch((e) => ({ board: b, verdict: 'error', how: e.message, notes: [] }));
      results.push(r); process.stderr.write(`  ${r.verdict.padEnd(11)} ${b}\n`);
    }
  }));
  if (oi > -1) fs.writeFileSync(args[oi + 1], results.map((r) => JSON.stringify(r)).join('\n') + '\n');
  if (fromProfiles) {
    fs.appendFileSync(LEDGER, results.map((r) => JSON.stringify({ ...r, probed: new Date().toISOString().slice(0, 10) })).join('\n') + '\n');
    const bulk = results.filter((r) => r.verdict === 'BULK' && r.sitemap);
    if (bulk.length) {
      const SP = require('path').join(__dirname, 'sources.json');
      const SRC = JSON.parse(fs.readFileSync(SP, 'utf8'));
      SRC.jsonld = SRC.jsonld || {};
      bulk.forEach((r) => { if (!SRC.jsonld[r.board]) SRC.jsonld[r.board] = { sitemap: r.sitemap }; });
      fs.writeFileSync(SP, JSON.stringify(SRC, null, 2) + '\n');
      console.log(`  added to the nightly read: ${bulk.map((r) => r.board).join(', ')}`);
    }
  }

  const order = ['BULK', 'FEED', 'LIST-ONLY', 'WALLED', 'none', 'unreachable', 'error'];
  results.sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || (b.jobs_listed || 0) - (a.jobs_listed || 0));
  console.log(['verdict', 'board', 'jobs listed', 'desc chars', 'how / notes'].join('\t'));
  for (const r of results) console.log([r.verdict, r.board, r.jobs_listed || '', r.desc_chars || '', [r.how].concat(r.notes || []).filter(Boolean).join('; ')].join('\t'));
  const tally = {}; results.forEach((r) => { tally[r.verdict] = (tally[r.verdict] || 0) + 1; });
  console.log('\n' + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · '));
})();
