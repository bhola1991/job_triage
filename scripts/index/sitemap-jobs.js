// Read a board's own public sitemap into index rows:
//   node scripts/index/sitemap-jobs.js <sitemap-url|file> [--limit N] [--out f.jsonl]
//   node scripts/index/sitemap-jobs.js https://www.naukri.com/sitemap/sitemap.xml --list
//
// Why this exists
// ---------------
// Every board needs Google for Jobs traffic, and Google requires a sitemap
// listing every job page. So boards publish their COMPLETE index, publicly and
// deliberately, for crawlers — the one door they hold open while they defend
// the search endpoint we have been paying Apify to squeeze through.
//
// Measured 2026-09-25: `naukri.com/sitemap/jobDescPagesPune.xml` returns
// **18,806 job urls** for one city, 3.85 MB, no key, no actor, no cost. Mumbai
// ships as two gzipped files; Delhi, Noida, Bengaluru, Kolkata, Ahmedabad each
// have their own. Compare a paid LinkedIn pull: 30 rows for ₹13.20.
//
// The catch, stated plainly: a Naukri job page is a client-rendered shell — 200
// OK, ~36 KB, and zero job text in the HTML (no JSON-LD, no __NEXT_DATA__).
// So a sitemap row is NOT a job description and this file never pretends it is.
// What it is, is the SLUG, and the slug carries a surprising amount:
//
//   job-listings-senior-app-developer-…-benovymed-healthcare-private-ltd-
//   pune-2-to-7-years-080926910680
//            └ title ──┘ └ company ─────┘ └ city ┘ └ experience ┘ └ id ┘
//
// Title, company, city and experience — free, before fetching anything. That is
// exactly the input stage one wants: retrieve.js cuts an index to a few hundred
// candidates on title match + BM25 at no cost, and only those survivors are
// worth paying to read. This turns acquisition from "buy 30 random rows" into
// "buy the 60 rows you already know you want".
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const UA = 'Mozilla/5.0 (compatible; jobtriage/1.0; +https://jobtriage.reachbhola.workers.dev)';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const target = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--limit' && args[args.indexOf(a) - 1] !== '--out');
if (!target) {
  console.error('usage: node scripts/index/sitemap-jobs.js <sitemap-url|file> [--list] [--limit N] [--out f.jsonl]');
  console.error('  --list  print the child sitemaps of an index and stop (sitemaps of sitemaps are normal)');
  process.exit(1);
}
const LIMIT = Number(opt('--limit', 0)) || 0;
const OUT = opt('--out', path.join(__dirname, 'sitemap.jsonl'));

/* Sitemaps are routinely gzipped (Naukri ships Mumbai as .xml.gz) and the
   Content-Encoding header is not reliable about it, so sniff the magic bytes
   rather than trusting the transport. */
async function load(src) {
  let buf;
  if (/^https?:/i.test(src)) {
    const r = await fetch(src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) });
    if (!r.ok) throw new Error(`http ${r.status} — ${r.status === 403 ? 'the CDN is gating non-allowlisted crawlers (Foundit does this)' : 'not readable'}`);
    buf = Buffer.from(await r.arrayBuffer());
  } else buf = fs.readFileSync(src);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  return buf.toString('utf8');
}

const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);

/* ── slug → row ──────────────────────────────────────────────────────────────
   Naukri only, for now: all 18,806 Pune slugs matched this one grammar, so it
   is parsed rather than guessed at. A board with a different shape gets its own
   branch here; the url is always kept, so an unparsed row is thin, never lost. */
const NAUKRI = /^job-listings-(.+?)-(\d+)-to-(\d+)-years-(\d+)$/;

/* Cities trail the company in the slug and there may be several. This list only
   has to cover what actually appears; anything missed stays in the title, which
   costs recall nothing because stage one matches titles by substring. */
const CITIES = new Set(('pune mumbai navi thane delhi noida gurgaon gurugram bengaluru bangalore hyderabad ' +
  'chennai kolkata ahmedabad jaipur indore kochi cochin coimbatore chandigarh lucknow nagpur surat vadodara ' +
  'bhubaneswar mysore mysuru trivandrum kanpur nashik kalyan faridabad ghaziabad remote india').split(' '));

/* Corporate suffixes end a company name. Scanning from the right for the
   nearest one is wrong less often than splitting on a fixed position, and when
   it finds nothing the words stay in the title — deliberately, because a title
   carrying extra words still matches, while a title missing words does not. */
const SUFFIX = new Set(('ltd limited pvt private llp inc corp corporation incorporated company co technologies ' +
  'technology solutions services systems software consulting consultancy consultants labs group india ' +
  'enterprises industries bank insurance analytics digital global ventures partners associates').split(' '));

const deslug = (s) => s.replace(/-/g, ' ').trim();

function naukriRow(url) {
  const slug = url.split('?')[0].split('#')[0].replace(/\/$/, '').split('/').pop();
  const m = NAUKRI.exec(slug);
  if (!m) return { source: 'naukri-sitemap', partial: true, url, title: deslug(slug), company: '', location: '', description: deslug(slug), posted: '' };
  const [, body, lo, hi, id] = m;
  const parts = body.split('-');

  const cities = [];
  while (parts.length && CITIES.has(parts[parts.length - 1])) cities.unshift(parts.pop());

  /* A corporate suffix marks where a company name ENDS; nothing in the slug
     marks where it begins, so this takes a short window back from the suffix
     and refuses the split when it would leave less than two words of title.
     "benovymed healthcare private ltd" comes out whole; "manager bindz
     consulting" keeps all three words in the title rather than eating the job
     title to name the employer. When in doubt the words stay in `title`, which
     costs nothing — stage one matches titles by substring, so a title carrying
     an extra word still matches and a title missing one does not. */
  let company = '';
  const last = parts.length - 1;
  const end = SUFFIX.has(parts[last]) ? last : (SUFFIX.has(parts[last - 1]) ? last - 1 : -1);
  if (end >= 0) {
    for (let start = Math.max(0, end - 3); start <= end; start++) {
      if (end - start + 1 < 2) break;                  // a bare "ltd" is not a company
      if (start >= 2) { company = parts.splice(start).join(' '); break; }
    }
  }

  const title = parts.join(' ');
  return {
    source: 'naukri-sitemap',
    // Loud on every row: there is no description here. A consumer that needs
    // one has to fetch the page, and that is the whole point of the funnel.
    partial: true,
    id, url,
    title: title || deslug(body),
    company,
    location: cities.join(', '),
    exp_min: Number(lo), exp_max: Number(hi),
    // Not a job description — the de-slugged line, so BM25 in retrieve.js has
    // tokens to weigh instead of an empty field. Named `description` only
    // because that is the field the index store already uses.
    description: deslug(body),
    posted: '',
  };
}

(async () => {
  const xml = await load(target);
  const urls = locs(xml);
  const children = urls.filter((u) => /\.xml(\.gz)?(\?|$)/i.test(u));

  if (flag('--list') || (children.length && children.length === urls.length)) {
    console.log(`${children.length} child sitemap(s) — this is an index, not a job list:\n`);
    children.slice(0, 60).forEach((u) => console.log('  ' + u));
    if (!flag('--list')) console.log('\nPick one and run it directly.');
    return;
  }

  const jobs = (LIMIT ? urls.slice(0, LIMIT) : urls).map(naukriRow);
  fs.writeFileSync(OUT, jobs.map((j) => JSON.stringify(j)).join('\n') + '\n');

  const named = jobs.filter((j) => j.company).length;
  console.log(`${urls.length} url(s) in the sitemap${LIMIT ? `, took ${jobs.length}` : ''}`);
  console.log(`  company parsed out of the slug: ${named}/${jobs.length}`);
  console.log(`  wrote ${path.relative(path.join(__dirname, '..', '..'), OUT)}  — free, no key, no actor\n`);
  jobs.slice(0, 5).forEach((j) =>
    console.log(`  ${String(j.title).slice(0, 46).padEnd(48)} ${String(j.company).slice(0, 24).padEnd(26)} ${j.location} ${j.exp_min}-${j.exp_max}y`));
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
