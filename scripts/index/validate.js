// Is the free retriever good enough to put in front of the paid scorer?
//   node scripts/index/validate.js --backup <triage-backup.json> [--per 60]
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
const fs=require('fs');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i>-1?process.argv[i+1]:d;};

const b=JSON.parse(fs.readFileSync(arg('backup'),'utf8'));
const p=b.profiles[Object.keys(b.profiles)[0]];
const labelled=p.jobs.filter(j=>String(j.ai_score||'').trim()!=='')
  .map(j=>({title:j.title||'',company:j.company||'',description:j.description||'',_truth:+j.ai_score}));
const index=fs.readFileSync('scripts/index/index.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l));
const rows=index.concat(labelled);
const STOP=new Set(('a an the and or of to in for on with at by from as is are be we you your our will this that it its their they he she who what when where how all any can could would should has have had not no if then than more most other some such only own same so too very just about into over under').split(/\s+/));
const tok=s=>String(s||'').toLowerCase().match(/[a-z0-9+#.]{2,}/g)?.filter(w=>!STOP.has(w))||[];
const K1=1.5,B=0.75,TW=3;
const docs=rows.map(r=>{const t=tok(r.title),d=tok(r.description);const tf=new Map();
  for(let i=0;i<TW;i++)for(const w of t)tf.set(w,(tf.get(w)||0)+1);
  for(const w of d)tf.set(w,(tf.get(w)||0)+1);return {tf,len:t.length*TW+d.length};});
const df=new Map(); for(const d of docs) for(const w of d.tf.keys()) df.set(w,(df.get(w)||0)+1);
const N=docs.length, avg=docs.reduce((s,d)=>s+d.len,0)/N, idf=new Map();
for(const [w,n] of df) idf.set(w,Math.log(1+(N-n+0.5)/(n+0.5)));
const rank=terms=>docs.map((doc,i)=>{let s=0;for(const w of terms){const f=doc.tf.get(w);if(!f)continue;
  s+=(idf.get(w)||0)*(f*(K1+1))/(f+K1*(1-B+B*doc.len/avg));}return{i,s};}).sort((a,b)=>b.s-a.s);

const PER=Number(arg('per',60));   // candidates per track
const skills=(p.profile.hard_skills||[]).slice(0,8);
const pool=new Set(); const perTrack=[];
for(const t of p.profile.tracks){
  const terms=[]; for(const ti of t.titles||[]) for(let i=0;i<3;i++) terms.push(...tok(ti));
  for(const s of skills) terms.push(...tok(s));
  const r=rank(terms);
  // hybrid: literal title matches first, then BM25 fills the track's slots
  const mine=new Set();
  rows.forEach((row,i)=>{ if((t.titles||[]).some(x=>row.title.toLowerCase().includes(x.toLowerCase()))) mine.add(i); });
  for(const x of r){ if(mine.size>=PER) break; mine.add(x.i); }
  mine.forEach(i=>pool.add(i));
  perTrack.push([t.label, mine.size]);
}
console.log(`index ${index.length} crawled + ${labelled.length} scored = ${rows.length}`);
console.log(`\nper-track pools (${PER} slots each, hybrid):`);
for(const [l,n] of perTrack) console.log(`  ${String(n).padStart(4)}  ${l}`);
console.log(`  ---- union: ${pool.size} candidates  =  Rs ${(pool.size*0.20/12).toFixed(2)} to LLM-score`);
const lab=labelled.map((j,k)=>({...j,in:pool.has(index.length+k)}));
const good=lab.filter(j=>j._truth>=65), junk=lab.filter(j=>j._truth<=20);
console.log(`\nof the ${good.length} jobs the real scorer rated 65+: ${good.filter(j=>j.in).length} are in the pool  (${(good.filter(j=>j.in).length/good.length*100).toFixed(0)}%)`);
console.log(`of the ${junk.length} it rated <=20 (HN noise):  ${junk.filter(j=>j.in).length} are in the pool`);
console.log(`\nfull index would cost Rs ${(rows.length*0.20/12).toFixed(2)} to score; this pool costs Rs ${(pool.size*0.20/12).toFixed(2)} — ${(rows.length/pool.size).toFixed(0)}x less`);
