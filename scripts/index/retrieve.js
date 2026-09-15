// Stage one of the funnel:  node scripts/index/retrieve.js --titles "..." --skills "..." [--top 200]
//
// The index is too big to LLM-score per user: at ~Rs 0.017/row, judging 100k
// jobs for one person costs Rs 1,667. So a cheap retriever cuts the index down
// to a few hundred candidates FIRST, and only those go to scoreAndCut.
//
// BM25 over title and description, no API and no model: the whole point is
// that stage one must cost nothing, because it runs against the entire index
// for every user. Titles are weighted, because a job whose TITLE is the role
// is a different thing from one that mentions it in a requirements list.
const fs = require('fs');

const STOP = new Set(('a an the and or of to in for on with at by from as is are be we you your our will'
  + ' this that it its their they he she who what when where how all any can could would should has have had'
  + ' not no if then than more most other some such only own same so too very just about into over under')
  .split(/\s+/));
const tok = s => String(s || '').toLowerCase().match(/[a-z0-9+#.]{2,}/g)?.filter(w => !STOP.has(w)) || [];

const K1 = 1.5, B = 0.75, TITLE_WEIGHT = 3;

function build(rows) {
  const docs = rows.map(r => {
    const t = tok(r.title), d = tok(r.description);
    const tf = new Map();
    // A title term counts TITLE_WEIGHT times: same machinery, no special case at scoring time.
    for (let i = 0; i < TITLE_WEIGHT; i++) for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    for (const w of d) tf.set(w, (tf.get(w) || 0) + 1);
    return { tf, len: t.length * TITLE_WEIGHT + d.length };
  });
  const df = new Map();
  for (const doc of docs) for (const w of doc.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  const N = docs.length, avg = docs.reduce((s, d) => s + d.len, 0) / N;
  const idf = new Map();
  for (const [w, n] of df) idf.set(w, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  return { docs, idf, avg };
}

function score(ix, terms) {
  const { docs, idf, avg } = ix;
  return docs.map((doc, i) => {
    let s = 0;
    for (const w of terms) {
      const f = doc.tf.get(w); if (!f) continue;
      s += (idf.get(w) || 0) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * doc.len / avg));
    }
    return { i, s };
  });
}

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

const file = arg('index', 'scripts/index/index.jsonl');
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const titles = list(arg('titles', 'Platform Engineer,Staff Engineer,Infrastructure Engineer,Site Reliability Engineer'));
const skills = list(arg('skills', 'kubernetes,terraform,postgres,python,go,aws,docker'));
const TOP = +arg('top', 200);

// A profile is its titles and its skills. Titles repeat so they outweigh skills
// in the query the same way they do in the document.
const terms = [];
for (const t of titles) for (let i = 0; i < 3; i++) terms.push(...tok(t));
for (const s of skills) terms.push(...tok(s));

const t0 = Date.now();
const ix = build(rows);
const tBuild = Date.now() - t0;
const t1 = Date.now();
const ranked = score(ix, terms).sort((a, b) => b.s - a.s);

/* Hybrid, because BM25 alone is not safe here. Measured on this index: a job
   titled exactly "Platform Engineer" with a short posting scores below a long
   DevOps posting that says kubernetes twenty times, so BM25's top 200 held only
   47% of the jobs whose titles literally name the role. Raising the title
   weight from 3 to 20 moved that by one point — the term mass in descriptions
   dominates whatever you do to the title, so this is not a tuning problem.
   Channel A takes every literal title match outright; channel B fills the rest
   of the pool by BM25, which is what finds the roles named something else. */
const wantedTitle = r => titles.some(t => r.title.toLowerCase().includes(t.toLowerCase()));
const chosen = new Map();
rows.forEach((r, i) => { if (wantedTitle(r)) chosen.set(i, 'title'); });
const titleHits = chosen.size;
for (const r of ranked) { if (chosen.size >= TOP) break; if (!chosen.has(r.i)) chosen.set(r.i, 'bm25'); }
const tQuery = Date.now() - t1;

const byScore = new Map(ranked.map(r => [r.i, r.s]));
const top = [...chosen.keys()]
  .sort((a, b) => (byScore.get(b) || 0) - (byScore.get(a) || 0))
  .map(i => ({ ...rows[i], _bm25: +(byScore.get(i) || 0).toFixed(2), _via: chosen.get(i) }));
fs.writeFileSync('scripts/index/candidates.jsonl', top.map(r => JSON.stringify(r)).join('\n') + '\n');

console.log(`index ${rows.length} jobs · built in ${tBuild}ms · queried in ${tQuery}ms · zero API calls\n`);
console.log(`candidates: ${top.length}  (${titleHits} by title match, ${top.length - titleHits} by BM25)\n`);
for (const j of top.slice(0, 12))
  console.log(`  ${j._via.padEnd(5)} ${String(j._bm25).padStart(6)}  ${j.title.slice(0, 48).padEnd(50)} ${(j.company || '').slice(0, 14).padEnd(15)} ${j.publisher}`);

// Recall sanity check: every job whose TITLE contains one of the target titles
// is unambiguously relevant. If the cheap stage drops those, it is not safe to
// put in front of the expensive one.
const want = rows.map((r, i) => ({ r, i })).filter(({ r }) =>
  titles.some(t => r.title.toLowerCase().includes(t.toLowerCase())));
const kept = new Set(chosen.keys());
const hit = want.filter(({ i }) => kept.has(i)).length;
console.log(`\nrecall check — jobs whose title literally matches a target title:`);
console.log(`  ${want.length} in the index, ${hit} inside the top ${TOP}  =  ${want.length ? (hit / want.length * 100).toFixed(0) : '-'}%`);

const LLM_PER_ROW = 0.20 / 12;
console.log(`\ncost to LLM-score, at Rs ${LLM_PER_ROW.toFixed(4)}/row:`);
console.log(`  whole index (${rows.length})      Rs ${(rows.length * LLM_PER_ROW).toFixed(2)}`);
console.log(`  top ${TOP} only                 Rs ${(TOP * LLM_PER_ROW).toFixed(2)}   <- ${(rows.length / TOP).toFixed(0)}x cheaper, per user, per refresh`);
