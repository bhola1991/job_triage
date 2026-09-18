// Stage one of the funnel:
//   node scripts/index/retrieve.js --titles "..." --skills "..." [--top 200] [--vec-extra 100]
//
// The index is too big to LLM-score per user: at ~Rs 0.017/row, judging 100k
// jobs for one person costs Rs 1,667. So a cheap retriever cuts the index down
// to a few hundred candidates FIRST, and only those go to scoreAndCut.
//
// Three channels, because each fails where another works:
//
//   A  title match   a job whose TITLE names the role is not a ranking
//                    question. Measured: BM25 alone put only 47% of these in
//                    its top 200, and raising the title weight from 3 to 20
//                    moved that by one point - description term mass dominates,
//                    so it is not a tuning problem. Take them outright.
//   B  BM25          word overlap, weighted by how rare each word is and
//                    divided by length. Finds roles named something else that
//                    still SAY the right things. Free.
//   C  embeddings    cosine over the vectors embed.mjs stored at crawl time.
//                    Finds "Brand Storytelling Lead" for a content strategist -
//                    no shared words, same job. Needs vectors.bin; without it
//                    this degrades to two channels rather than failing, so the
//                    script still runs with nothing installed.
const fs = require('fs'), path = require('path');

const STOP = new Set(('a an the and or of to in for on with at by from as is are be we you your our will'
  + ' this that it its their they he she who what when where how all any can could would should has have had'
  + ' not no if then than more most other some such only own same so too very just about into over under')
  .split(/\s+/));
const tok = s => String(s || '').toLowerCase().match(/[a-z0-9+#.]{2,}/g)?.filter(w => !STOP.has(w)) || [];
const K1 = 1.5, B = 0.75, TITLE_WEIGHT = 3;

function bm25(rows) {
  const docs = rows.map(r => {
    const t = tok(r.title), d = tok(r.description);
    const tf = new Map();
    for (let i = 0; i < TITLE_WEIGHT; i++) for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    for (const w of d) tf.set(w, (tf.get(w) || 0) + 1);
    return { tf, len: t.length * TITLE_WEIGHT + d.length };
  });
  const df = new Map();
  for (const doc of docs) for (const w of doc.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  const N = docs.length, avg = docs.reduce((s, d) => s + d.len, 0) / N, idf = new Map();
  for (const [w, n] of df) idf.set(w, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  return terms => docs.map((doc, i) => {
    let s = 0;
    for (const w of terms) {
      const f = doc.tf.get(w); if (!f) continue;
      s += (idf.get(w) || 0) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * doc.len / avg));
    }
    return { i, s };
  }).sort((a, b) => b.s - a.s);
}

/* Vectors are normalised at build time, so cosine similarity is a dot product
   and ranking the whole index is one pass of multiply-add: no model, no call. */
function loadVectors(dir, expected) {
  const meta = path.join(dir, 'vectors.json'), bin = path.join(dir, 'vectors.bin');
  if (!fs.existsSync(meta) || !fs.existsSync(bin)) return null;
  const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
  if (m.count !== expected) {
    console.error(`  ! vectors.json says ${m.count} jobs, index has ${expected} — re-run embed.mjs. Skipping channel C.`);
    return null;
  }
  const buf = fs.readFileSync(bin);
  return { ...m, data: new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4) };
}
const cosineRank = (V, q) => {
  const { dims, count, data } = V, out = new Array(count);
  for (let i = 0; i < count; i++) {
    let s = 0, off = i * dims;
    for (let k = 0; k < dims; k++) s += data[off + k] * q[k];
    out[i] = { i, s };
  }
  return out.sort((a, b) => b.s - a.s);
};

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

async function main() {
  const dir = path.join(__dirname);
  const rows = fs.readFileSync(arg('index', path.join(dir, 'index.jsonl')), 'utf8')
    .trim().split('\n').map(l => JSON.parse(l));
  const titles = list(arg('titles', 'Platform Engineer,Staff Engineer,Infrastructure Engineer,Site Reliability Engineer'));
  const skills = list(arg('skills', 'kubernetes,terraform,postgres,python,go,aws,docker'));
  const TOP = +arg('top', 200);
  // The vector channel's own allowance, on top of TOP rather than inside it.
  // Same half-of-the-pool ratio validate.js measures with (--per 60 --vec-extra 30).
  const VEC_EXTRA = +arg('vec-extra', Math.round(TOP / 2));

  const terms = [];
  for (const t of titles) for (let i = 0; i < 3; i++) terms.push(...tok(t));
  for (const s of skills) terms.push(...tok(s));

  const t0 = Date.now();
  const rankBM = bm25(rows);
  const byBM = rankBM(terms);
  const V = loadVectors(dir, rows.length);

  // Channel C embeds only the query — a few short strings — so the per-user
  // cost of meaning-matching is one tiny call, not one per job.
  let byVec = null;
  if (V) {
    try {
      const { pipeline } = await import('@xenova/transformers');
      const pipe = await pipeline('feature-extraction', V.model, { quantized: true });
      const out = await pipe([`${titles.join('. ')}. Skills: ${skills.join(', ')}.`],
                             { pooling: 'mean', normalize: true });
      byVec = cosineRank(V, Array.from(out.data));
    } catch (e) {
      console.error(`  ! could not embed the query (${e.message}). Skipping channel C.`);
    }
  }

  const chosen = new Map();
  rows.forEach((r, i) => {
    if (titles.some(t => r.title.toLowerCase().includes(t.toLowerCase()))) chosen.set(i, 'title');
  });
  const titleHits = chosen.size;
  /* BM25 fills the pool to TOP; the vector channel then ADDS beyond it rather
     than sharing it. Interleaving the two inside one fixed budget is what this
     script used to do, and validate.js records the measurement against it
     (see its channel C block): recall fell 70% -> 68%, because every vector
     pick displaced a BM25 pick that was already earning its place. Embeddings
     are here to reach what word overlap cannot see, so they widen the net
     instead of re-cutting it -- and the two scripts now agree, which is the
     point of validating one with the other. */
  for (let n = 0; chosen.size < TOP && n < byBM.length; n++)
    if (!chosen.has(byBM[n].i)) chosen.set(byBM[n].i, 'bm25');
  if (byVec && VEC_EXTRA > 0) {
    let added = 0;
    for (let n = 0; added < VEC_EXTRA && n < byVec.length; n++)
      if (!chosen.has(byVec[n].i)) { chosen.set(byVec[n].i, 'vector'); added++; }
  }

  const score = new Map(byBM.map(r => [r.i, r.s]));
  const top = [...chosen.keys()].sort((a, b) => (score.get(b) || 0) - (score.get(a) || 0))
    .map(i => ({ ...rows[i], _bm25: +(score.get(i) || 0).toFixed(2), _via: chosen.get(i) }));
  fs.writeFileSync(path.join(dir, 'candidates.jsonl'), top.map(r => JSON.stringify(r)).join('\n') + '\n');

  const by = t => top.filter(j => j._via === t).length;
  console.log(`index ${rows.length} jobs · ${Date.now() - t0}ms · ${byVec ? 'three' : 'two'} channels`);
  console.log(`candidates ${top.length}: ${titleHits} title · ${by('bm25')} bm25 · ${by('vector')} vector\n`);
  for (const j of top.slice(0, 12))
    console.log(`  ${j._via.padEnd(6)} ${j.title.slice(0, 50).padEnd(52)} ${(j.company || '').slice(0, 14)}`);

  const kept = new Set(chosen.keys());
  const want = rows.map((r, i) => i).filter(i => titles.some(t => rows[i].title.toLowerCase().includes(t.toLowerCase())));
  console.log(`\nliteral title matches kept: ${want.filter(i => kept.has(i)).length}/${want.length}`);
  const R = 0.20 / 12;
  // top.length, not TOP: the title channel alone can exceed the budget, and
  // this line is the whole reason the script exists.
  console.log(`scoring cost: whole index Rs ${(rows.length * R).toFixed(2)} · this pool Rs ${(top.length * R).toFixed(2)}`);
}
main();
