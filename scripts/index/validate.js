// Is the free retriever good enough to put in front of the paid scorer?
//   node scripts/index/validate.js --backup <triage-backup.json> [--per 60] [--no-vector]
//
// A Backup & transfer export carries jobs the real scorer has already judged,
// which is ground truth that costs nothing to obtain. Mix those into the index,
// retrieve exactly as production would, and count how many the cheap stage
// keeps. If it drops the jobs the scorer liked, the index model delivers worse
// results than today's narrow search, however much cheaper it is.
//
// Retrieval is PER TRACK, then unioned. Measured on a real 4-track profile:
// merging every track's titles into one query dropped recall to 1/40, because
// "Operations Manager" and "Video Editor" and "Founder" in one bag match
// nothing well. A person's pool is the union of their tracks' pools.
const fs = require('fs'), path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const DIR = __dirname;

const STOP = new Set(('a an the and or of to in for on with at by from as is are be we you your our will this that it its their they he she who what when where how all any can could would should has have had not no if then than more most other some such only own same so too very just about into over under').split(/\s+/));
const tok = s => String(s || '').toLowerCase().match(/[a-z0-9+#.]{2,}/g)?.filter(w => !STOP.has(w)) || [];
const K1 = 1.5, B = 0.75, TW = 3;

async function main() {
  const b = JSON.parse(fs.readFileSync(arg('backup'), 'utf8'));
  const p = b.profiles[Object.keys(b.profiles)[0]];
  const labelled = p.jobs.filter(j => String(j.ai_score || '').trim() !== '')
    .map(j => ({ title: j.title || '', company: j.company || '', description: j.description || '', _truth: +j.ai_score }));
  const index = fs.readFileSync(path.join(DIR, 'index.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const rows = index.concat(labelled);

  const docs = rows.map(r => {
    const t = tok(r.title), d = tok(r.description), tf = new Map();
    for (let i = 0; i < TW; i++) for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    for (const w of d) tf.set(w, (tf.get(w) || 0) + 1);
    return { tf, len: t.length * TW + d.length };
  });
  const df = new Map(); for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  const N = docs.length, avg = docs.reduce((s, d) => s + d.len, 0) / N, idf = new Map();
  for (const [w, n] of df) idf.set(w, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  const rankBM = terms => docs.map((doc, i) => {
    let s = 0;
    for (const w of terms) { const f = doc.tf.get(w); if (!f) continue;
      s += (idf.get(w) || 0) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * doc.len / avg)); }
    return { i, s };
  }).sort((a, b) => b.s - a.s);

  // Channel C. The crawled rows were embedded at ingest; the backup's rows were
  // not, so they are embedded here — which is exactly what production does when
  // a new job arrives between crawls.
  let vec = null;
  const meta = path.join(DIR, 'vectors.json');
  if (!process.argv.includes('--no-vector') && fs.existsSync(meta)) {
    try {
      const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
      const buf = fs.readFileSync(path.join(DIR, 'vectors.bin'));
      const idxVecs = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
      const { pipeline } = await import('@xenova/transformers');
      const pipe = await pipeline('feature-extraction', m.model, { quantized: true });
      const extra = await pipe(labelled.map(j => `${j.title}. ${j.company}. ${j.description.slice(0, 600)}`),
                               { pooling: 'mean', normalize: true });
      const all = new Float32Array(rows.length * m.dims);
      all.set(idxVecs, 0); all.set(Float32Array.from(extra.data), index.length * m.dims);
      vec = { dims: m.dims, data: all, pipe, model: m.model };
      console.log(`channel C on: ${m.model}, ${m.dims} dims`);
    } catch (e) { console.error(`  ! channel C off (${e.message})`); }
  }
  const rankVec = async text => {
    const out = await vec.pipe([text], { pooling: 'mean', normalize: true });
    const q = Array.from(out.data), { dims, data } = vec, res = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      let s = 0, off = i * dims;
      for (let k = 0; k < dims; k++) s += data[off + k] * q[k];
      res[i] = { i, s };
    }
    return res.sort((a, b) => b.s - a.s);
  };

  const PER = Number(arg('per', 60));
  const VEC_EXTRA = Number(arg('vec-extra', 30));
  const skills = (p.profile.hard_skills || []).slice(0, 8);
  const pool = new Set(), perTrack = [];
  for (const t of p.profile.tracks) {
    const terms = [];
    for (const ti of t.titles || []) for (let i = 0; i < 3; i++) terms.push(...tok(ti));
    for (const s of skills) terms.push(...tok(s));
    const mine = new Set();
    rows.forEach((row, i) => { if ((t.titles || []).some(x => row.title.toLowerCase().includes(x.toLowerCase()))) mine.add(i); });
    // BM25 fills the track's own slots first. The vector channel then ADDS on
    // top rather than sharing them: interleaving the two at a fixed pool size
    // measured WORSE (70% -> 68%), because every vector pick displaced a BM25
    // pick that was already earning its place. Embeddings are there to reach
    // what word overlap cannot see, so they should widen the net, not re-cut it.
    const bm = rankBM(terms);
    for (let n = 0; mine.size < PER && n < bm.length; n++) if (!mine.has(bm[n].i)) mine.add(bm[n].i);
    if (vec && VEC_EXTRA > 0) {
      const rv = await rankVec(`${(t.titles || []).join('. ')}. Skills: ${skills.join(', ')}.`);
      let added = 0;
      for (let n = 0; added < VEC_EXTRA && n < rv.length; n++)
        if (!mine.has(rv[n].i)) { mine.add(rv[n].i); added++; }
    }
    mine.forEach(i => pool.add(i));
    perTrack.push([t.label, mine.size]);
  }

  console.log(`\nindex ${index.length} crawled + ${labelled.length} scored = ${rows.length}`);
  console.log(`per-track pools (${PER} slots each):`);
  for (const [l, n] of perTrack) console.log(`  ${String(n).padStart(4)}  ${l}`);
  console.log(`  ---- union: ${pool.size} candidates = Rs ${(pool.size * 0.20 / 12).toFixed(2)} to score`);
  const lab = labelled.map((j, k) => ({ ...j, in: pool.has(index.length + k) }));
  const good = lab.filter(j => j._truth >= 65), junk = lab.filter(j => j._truth <= 20);
  const gk = good.filter(j => j.in).length;
  console.log(`\nof the ${good.length} jobs the real scorer rated 65+: ${gk} in the pool (${(gk / good.length * 100).toFixed(0)}%)`);
  console.log(`of the ${junk.length} it rated <=20 (HN noise):  ${junk.filter(j => j.in).length} in the pool`);
  console.log(`\nwhole index would cost Rs ${(rows.length * 0.20 / 12).toFixed(2)} — this pool is ${(rows.length / pool.size).toFixed(0)}x less`);
}
main();
