// Give every indexed job a meaning-vector:  node scripts/index/embed.js
//
// Word matching cannot see that "Brand Storytelling Lead" and "Content
// Strategist" are the same job — they share no words. An embedding turns text
// into ~384 numbers positioned so that similar MEANINGS land near each other,
// and then "similar" is just a dot product.
//
// This runs at CRAWL time, once per job, and the vectors are shared by every
// user — the same argument as the index itself. Per user the only new work is
// embedding their own track titles, which is a handful of short strings.
//
// The model runs locally and needs no API key. In production you would more
// likely call a hosted embedding endpoint at ingest; the shape is identical,
// only `embedAll` changes.
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const IN = process.argv[2] || path.join(DIR, 'index.jsonl');
const OUT = path.join(DIR, 'vectors.bin');
const META = path.join(DIR, 'vectors.json');
const MODEL = 'Xenova/all-MiniLM-L6-v2';
const BATCH = 64;
// MiniLM truncates around 256 tokens anyway, so feeding it the whole 7 KB
// posting wastes time and blurs the vector. The title plus the opening of the
// description is what actually names the role.
const TEXT = j => `${j.title}. ${j.company}. ${String(j.description || '').slice(0, 600)}`;

const rows = fs.readFileSync(IN, 'utf8').trim().split('\n').map(l => JSON.parse(l));
console.log(`embedding ${rows.length} jobs with ${MODEL}`);

const { pipeline } = await import('@xenova/transformers');
const pipe = await pipeline('feature-extraction', MODEL, { quantized: true });

let dims = 0, done = 0;
const chunks = [];
const t0 = Date.now();
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH).map(TEXT);
  const out = await pipe(batch, { pooling: 'mean', normalize: true });
  dims = out.dims[1];
  chunks.push(Float32Array.from(out.data));
  done += batch.length;
  if (i % (BATCH * 10) === 0 || done === rows.length)
    process.stderr.write(`  ${done}/${rows.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s\r`);
}
const all = new Float32Array(rows.length * dims);
let at = 0;
for (const c of chunks) { all.set(c, at); at += c.length; }
fs.writeFileSync(OUT, Buffer.from(all.buffer));
fs.writeFileSync(META, JSON.stringify({ model: MODEL, dims, count: rows.length, source: path.basename(IN),
                                        built: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
const secs = (Date.now() - t0) / 1000;
console.log(`\n${rows.length} vectors x ${dims} dims in ${secs.toFixed(0)}s (${(rows.length / secs).toFixed(0)}/sec)`);
console.log(`${OUT}  ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB  (${(dims * 4)} bytes/job)`);
