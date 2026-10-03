// Every url the shared corpus holds, one per line, for whatever wants to read
// them:   node scripts/index/corpus-urls.js [--since N|--all] [--source S]
//
// Why this exists
// ---------------
// harvest-slugs.js turns a paid row into a permanent free board: a
// `boards.greenhouse.io/acme` link anywhere in a result buys Acme's whole board
// for as long as they keep hiring. But it reads FILES, and the rows worth
// harvesting from no longer land in a file — a paid search deposits them
// straight into public.job_index from the edge function. Without this the
// discovery loop is open at exactly the point where the expensive rows arrive.
//
// So: corpus -> urls -> harvest-slugs -> sources.json -> next crawl pulls those
// boards free, forever. refresh.sh wires the two together.
//
// There is no url column in job_index, deliberately (schema.sql explains the
// 81 MB that saved). The key IS the url: 'u:' || lower(url) for every row in
// the table, checked across all of them, so rebuilding it here is a substring
// and not a guess. Rows keyed 't:' (title|company|location, no url) are skipped
// — they carry nothing to harvest.
//
// Default is the last 7 days rather than everything. The daily pass only needs
// what arrived since the last one, and 340k naukri urls re-read every morning
// would be a slow way to learn nothing: those are sitemap rows, and a sitemap
// row is never an ATS link. `--all` is there for the first sweep.
'use strict';

const SB = process.env.SUPABASE_URL || '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };

const ALL = flag('--all');
const SINCE = Math.max(parseInt(opt('--since', '7'), 10) || 7, 1);
const SOURCE = opt('--source', '');
const CHUNK = 1000;

if (!SB || !KEY) {
  // The same no-op the other writers use: a machine that only wants the crawl
  // should not need server secrets, and a missing key is not an error here.
  console.error('corpus-urls: no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — nothing to read.');
  process.exit(0);
}

(async () => {
  const since = new Date(Date.now() - SINCE * 864e5).toISOString().slice(0, 10);
  const where = [
    'job_key=like.u:*',                       // keyed by url; 't:' rows have none
    ALL ? null : `first_indexed=gte.${since}`,
    SOURCE ? `source=eq.${encodeURIComponent(SOURCE)}` : null,
  ].filter(Boolean).join('&');

  let from = 0, seen = 0;
  for (;;) {
    const r = await fetch(`${SB}/rest/v1/job_index?select=job_key&${where}`, {
      headers: {
        apikey: KEY, Authorization: `Bearer ${KEY}`,
        Range: `${from}-${from + CHUNK - 1}`, 'Range-Unit': 'items',
      },
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));

    if (!r.ok) {
      console.error(`corpus-urls: read failed at row ${from}: ${r.status} ${(await r.text()).slice(0, 200)}`);
      process.exit(1);
    }
    const rows = await r.json();
    if (!rows.length) break;
    // 'u:' off the front and that is the url, lowercased as the key stores it.
    // Lowercasing only ever touched the hostname (99 rows differ in case, all
    // inside the host), and DNS does not care.
    for (const row of rows) process.stdout.write(String(row.job_key).slice(2) + '\n');
    seen += rows.length;
    if (rows.length < CHUNK) break;
    from += CHUNK;
  }
  console.error(`corpus-urls: ${seen} url(s)${ALL ? '' : ` first indexed since ${since}`}${SOURCE ? ` from ${SOURCE}` : ''}`);
})();
