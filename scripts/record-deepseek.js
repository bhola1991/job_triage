#!/usr/bin/env node
// Score the eval cases with a named DeepSeek tier, and measure it.
//
//   node scripts/record-deepseek.js --tier flash
//   node scripts/record-deepseek.js --tier pro --dry
//   node scripts/record-deepseek.js --tier flash --write     # into cases.json
//
// Why this exists
// ---------------
// The pro tier costs 4.9x flash -- 2.198 INR a call against 0.452, measured
// over 117 calls -- and one scoring run was 74.30 INR of it, 96% of that being
// output tokens, which is the reasoning. Nobody has ever checked whether the
// answers are better, and the data could not say: cases.json records one
// DeepSeek answer with no model on it, so even the committed baseline does not
// know which tier produced it.
//
// This asks both, on the same ten postings, against the same hand-written
// bands, with the prompt the app actually sends.
//
// It slices sysPrompt and the reply parser out of index.html rather than
// restating either. A second copy of the prompt would measure a prompt nobody
// ships, which is the one result that would be worse than no result: the whole
// point of eval/cases.json is that the recorded answer and the live prompt stay
// in step.
//
// DEEPSEEK_API_KEY comes from the SHELL, not .env.local -- the repo's other
// keys live in that file but this one is exported by the profile, so a clean
// environment has the four and not this. Checked rather than assumed, because
// a missing key here reads as a model that answers nothing.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CASES = path.join(__dirname, 'eval', 'cases.json');
const h = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const grab = (re) => { const m = h.match(re); if (!m) throw new Error('missing ' + re); return m[0]; };

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const TIER = arg('tier', 'flash');
const DRY = process.argv.includes('--dry');
const WRITE = process.argv.includes('--write');

const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) {
  console.error('DEEPSEEK_API_KEY is not set in this shell.');
  console.error('It is exported by the shell profile, not kept in .env.local -- see');
  console.error('the deno-local-run note. Nothing was called.');
  process.exit(1);
}

/* The app's own prompt and parser, sliced. CONF_CODES and normFlags are what
   turn a reply into the shape the eval's labels are written against, so they
   come from here too rather than being re-derived. */
const T = new Function(
  grab(/const FLAG_CODES = \{[\s\S]*?\nfunction addSpans[\s\S]*?\n}\n/) +
  // CONF_CODES arrives inside the FLAG_CODES slice above; grabbing it again is
  // a redeclaration in the same Function body.
  grab(/const today = [^\n]*\n/) +
  grab(/function grabJSON[\s\S]*?\n}\n/) +
  grab(/function saneDate[\s\S]*?\n}\n/) +
  grab(/function sysPrompt[\s\S]*?\n}\n/) +
  ';return {sysPrompt,grabJSON,normFlags,CONF_CODES,saneDate};')();

const MODELS = { pro: 'deepseek-v4-pro', flash: 'deepseek-flash' };
const model = MODELS[TIER];
if (!model) { console.error(`--tier must be one of ${Object.keys(MODELS).join(', ')}`); process.exit(1); }

const file = JSON.parse(fs.readFileSync(CASES, 'utf8'));
const profile = file.profile;
const track = (profile.tracks && profile.tracks[0]) || null;

/* One posting per request rather than a batch of twelve. The app batches to
   amortise a credit, which is a billing concern; here each case must be scored
   independently or one bad reply would take the others' numbers with it, and a
   batch also lets the model calibrate across cases in a way a single live
   posting never gets. */
async function score(c) {
  const job = {
    id: '0',
    title: String(c.job.title || ''), company: String(c.job.company || ''),
    location: String(c.job.location || ''),
    description: String(c.job.description || '').slice(0, 700) || '(no description available)',
  };
  if (T.saneDate(c.job.posted)) job.posted = c.job.posted;
  const prompt = T.sysPrompt(profile, track) + '\n\nJOBS TO SCORE:\n' + JSON.stringify([job]);
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
  const d = await r.json();
  const txt = (d.choices?.[0]?.message?.content || '').trim();
  if (d.choices?.[0]?.finish_reason === 'length') throw new Error('truncated at the token ceiling');
  const parsed = T.grabJSON(txt);
  const items = Array.isArray(parsed) ? parsed : (parsed.r || parsed.results || []);
  const it = items[0];
  if (!it) throw new Error('no item in the reply');
  const num = (v, dflt) => { const n = parseInt(v, 10); return isNaN(n) ? dflt : Math.max(0, Math.min(100, n)); };
  return {
    s: num(it.s ?? it.score, 0),
    re: num(it.re ?? it.reachability, 45),
    c: String(it.c ?? it.confidence ?? 'l').toLowerCase(),
    f: it.f ?? it.flags ?? [],
    usage: d.usage || {},
  };
}

const r3 = (n) => Math.round(n * 1000) / 1000;
const USD_PER_M = { 'deepseek-v4-pro': { in: 1.32, cached: 0.044, out: 3.96 },
                    'deepseek-flash': { in: 0.30, cached: 0.006, out: 1.20 } };
const USD_INR = 88;

(async () => {
  console.log(`tier ${TIER} (${model}), ${file.cases.length} cases, one request each\n`);
  let tp = 0, fp = 0, fn = 0, inBand = 0, inr = 0, tin = 0, tout = 0, failed = 0;
  const band = [];
  for (const c of file.cases) {
    try {
      const a = await score(c);
      const got = T.normFlags(a.f).map((f) => f.code);
      const want = c.expect.flags;
      tp += got.filter((x) => want.includes(x)).length;
      fp += got.filter((x) => !want.includes(x)).length;
      fn += want.filter((x) => !got.includes(x)).length;
      const okFit = a.s >= c.expect.fit[0] && a.s <= c.expect.fit[1];
      const okReach = a.re >= c.expect.reach[0] && a.re <= c.expect.reach[1];
      if (okFit && okReach) inBand++;
      else band.push(`${c.id} (fit ${a.s} want ${c.expect.fit.join('-')}, reach ${a.re} want ${c.expect.reach.join('-')})`);
      const u = a.usage, px = USD_PER_M[model];
      const cached = u.prompt_cache_hit_tokens || 0, pin = u.prompt_tokens || 0, pout = u.completion_tokens || 0;
      tin += pin; tout += pout;
      inr += ((pin - cached) * px.in + cached * px.cached + pout * px.out) / 1e6 * USD_INR;
      console.log(`${c.id.padEnd(22)} fit ${String(a.s).padStart(3)} reach ${String(a.re).padStart(3)} ` +
        `conf ${a.c.padEnd(2)} flags: ${got.join(',') || '-'}`);
      if (WRITE) c[`recorded_${TIER}`] = { model, s: a.s, re: a.re, c: a.c, f: a.f };
    } catch (e) {
      console.log(`${c.id.padEnd(22)} FAILED: ${e.message.slice(0, 90)}`);
      failed++;
    }
  }
  const n = file.cases.length - failed;
  console.log(`\n${TIER} on ${n} case(s):`);
  console.log(`  flag precision ${tp + fp ? r3(tp / (tp + fp)) : 1}`);
  console.log(`  flag recall    ${tp + fn ? r3(tp / (tp + fn)) : 1}`);
  console.log(`  calibration    ${n ? r3(inBand / n) : 0}`);
  if (band.length) { console.log('  out of band:'); band.forEach((b) => console.log(`    ${b}`)); }
  console.log(`  cost           ${r3(inr)} INR for ${n} postings  (${tin} in / ${tout} out)`);
  console.log(`  per posting    ${n ? r3(inr / n) : 0} INR`);
  if (WRITE && n) {
    fs.writeFileSync(CASES, JSON.stringify(file, null, 2) + '\n');
    console.log(`\nwrote recorded_${TIER} into scripts/eval/cases.json`);
  }
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
