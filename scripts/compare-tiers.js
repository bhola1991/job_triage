#!/usr/bin/env node
// Is deepseek-v4-pro worth 4.9x deepseek-flash?
//
//   node scripts/compare-tiers.js            # what the data can answer today
//   node scripts/compare-tiers.js --overlap  # only jobs both tiers have scored
//
// Why this exists
// ---------------
// Reasoning was switched on for the pro tier, TOK_CAP went 4,000 -> 16,000, and
// the cost of a scoring call went from ~0.07 INR to a measured 2.48 average --
// about 31x. Nobody has ever checked whether the answers got better, because
// until public.jobs gained ai_model nothing joined a score to the model that
// produced it: usage_events.note knew the model per CALL, public.jobs knew the
// score per JOB, and there was no column between them.
//
// Measured 2026-10-04 from usage_events:
//   deepseek-flash    72 calls   0.452 INR avg   3,963 output tokens avg
//   deepseek-v4-pro   45 calls   2.198 INR avg   5,994 output tokens avg
//
// What "better" has to mean here
// ------------------------------
// Not a higher score. A model that scores everything 90 is worse, not better,
// and the app only ever shows the top of a list -- so what matters is the
// ORDER, and specifically whether the two tiers disagree about which jobs reach
// the screen. Two numbers say that:
//
//   top-K overlap   of the K highest-scored jobs, how many both tiers pick.
//                   High overlap means the extra money buys reorderings nobody
//                   sees, because the same jobs surface either way.
//   rank distance   how far apart the two put the same job, averaged. Small
//                   means the disagreement is noise rather than judgement.
//
// Neither is proof. Proof needs an OUTCOME -- did the person apply, did anyone
// answer -- and public.matcher_outcomes holds 10 rows, which cannot separate two
// rankers. So this reports agreement, says plainly when it cannot conclude, and
// refuses to dress a 10-row sample as an answer.
//
// How to get the comparison data
// ------------------------------
// There is no DEEPSEEK_API_KEY on this machine by design -- it is a Supabase
// secret the edge function holds -- so this script cannot score anything itself.
// It reads what the app has already scored. To create an overlap: score a batch
// on one tier, then rescore the same jobs on the other, and run this. Board
// search scores on flash and the Score button scores on pro, so an ordinary
// session produces both.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, 'supabase/.env'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const SB = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !SR) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in supabase/.env.'); process.exit(1); }
const K = Math.max(1, Number((process.argv[process.argv.indexOf('--k') + 1]) || 20) || 20);

const rest = async (q) => {
  const r = await fetch(`${SB}/rest/v1/${q}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  if (!r.ok) throw new Error(`PostgREST ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
};

(async () => {
  const rows = await rest('jobs?select=job_key,title,company,ai_score,ai_reachability,ai_model&ai_score=not.is.null&limit=20000');
  const byModel = new Map();
  for (const r of rows) {
    const m = r.ai_model || '(unrecorded)';
    if (!byModel.has(m)) byModel.set(m, []);
    byModel.get(m).push(r);
  }

  console.log(`scored jobs: ${rows.length}\n`);
  console.log('by model:');
  for (const [m, rs] of [...byModel].sort((a, b) => b[1].length - a[1].length)) {
    const sc = rs.map((r) => Number(r.ai_score)).filter(Number.isFinite);
    const avg = sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(1) : '-';
    const at50 = sc.filter((x) => x >= 50).length;
    console.log(`  ${m.padEnd(18)} ${String(rs.length).padStart(5)} jobs   avg ${String(avg).padStart(5)}` +
      `   ${String(at50).padStart(4)} at 50+   max ${sc.length ? Math.max(...sc) : '-'}`);
  }

  const models = [...byModel.keys()].filter((m) => m !== '(unrecorded)');
  const unrec = (byModel.get('(unrecorded)') || []).length;
  if (unrec) {
    console.log(`\n  ${unrec} job(s) carry no ai_model: scored before the column existed, or on the`);
    console.log('  user\'s own key, where the model is theirs and not ours to record.');
  }

  if (models.length < 2) {
    console.log('\n── cannot conclude ──');
    console.log('Fewer than two models have scored anything with ai_model recorded, so there is');
    console.log('nothing to compare. Score a batch on one tier and rescore it on the other:');
    console.log('board search scores on flash, the Score button scores on pro.');
    return;
  }

  /* Only jobs BOTH tiers have scored can be compared, and a row carries one
     ai_model -- the last to write it. So an overlap needs the same job scored
     twice with the value read in between, which is what rescoring produces. */
  const keysOf = (m) => new Set(byModel.get(m).map((r) => r.job_key));
  const [a, b] = models;
  const shared = [...keysOf(a)].filter((k) => keysOf(b).has(k));
  console.log(`\noverlap between ${a} and ${b}: ${shared.length} job(s)`);
  if (shared.length < 10) {
    console.log('\n── cannot conclude ──');
    console.log('A row holds one ai_model, the last that wrote it, so a job scored twice reads');
    console.log('as whichever tier went second -- there is no overlap to measure and the counts');
    console.log('above are two different job sets, not two readings of one. Comparing them');
    console.log('would be comparing the jobs, not the models.');
    console.log('\nWhat would answer it: score a set on one tier, record ai_score elsewhere,');
    console.log('rescore on the other, then compare the two readings per job. That needs a');
    console.log('second score column or a snapshot, and is the same instrumentation');
    console.log('eval-matcher.js --live needs. Worth building once, not guessing around.');
    return;
  }

  // Genuine overlap: rank each tier's view of the shared set and compare.
  const rank = (m) => {
    const mine = byModel.get(m).filter((r) => keysOf(a).has(r.job_key) && keysOf(b).has(r.job_key));
    mine.sort((x, y) => Number(y.ai_score) - Number(x.ai_score));
    return new Map(mine.map((r, i) => [r.job_key, i]));
  };
  const ra = rank(a), rb = rank(b);
  const topA = [...ra].filter(([, i]) => i < K).map(([k]) => k);
  const topB = new Set([...rb].filter(([, i]) => i < K).map(([k]) => k));
  const both = topA.filter((k) => topB.has(k)).length;
  let dist = 0;
  for (const k of shared) dist += Math.abs((ra.get(k) ?? 0) - (rb.get(k) ?? 0));
  console.log(`\ntop-${K} overlap : ${both}/${Math.min(K, shared.length)}`);
  console.log(`mean rank move : ${(dist / shared.length).toFixed(1)} places`);
  console.log('\nHigh overlap means the pricier tier is buying reorderings nobody sees, since');
  console.log('the same jobs reach the screen either way. Low overlap means the tiers disagree');
  console.log('about what matters -- and which one is RIGHT still needs outcomes, which');
  console.log('public.matcher_outcomes has 10 of.');
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
