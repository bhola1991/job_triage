// Matcher eval: node scripts/eval-matcher.js [--write-baseline]
//
// Two jobs, and it is worth being clear which is which.
//
// The first is a REGRESSION GATE. scripts/eval/cases.json carries a model
// answer captured once and committed, so everything downstream of the model --
// which flags are recognised, how a fact finds its quote, how confidence turns
// into a rank -- runs the same way on every machine, every time. Those numbers
// are compared against scripts/eval/baseline.json and a drop fails the build.
// Nothing here calls a model, so it costs nothing and works offline.
//
// The second is a MEASUREMENT. The metrics printed are the matcher's flag
// precision and recall and its score calibration against hand-written labels.
// Ten cases is a floor to build on, not a claim about the real world; the
// number that matters is whether it moves when the prompt changes.
//
// What it does NOT do is judge the model. The recorded answers are a fixed
// input. To re-measure the model itself, re-record `recorded` from a live
// scoring run and commit the change -- the diff in these metrics is then the
// prompt's effect, isolated, which is the whole reason to record at all.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const h = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = re => { const m = h.match(re); if (!m) throw new Error('missing ' + re); return m[0]; };

/* The app is one IIFE, so none of this is reachable from a page console -- it
   has to be sliced out and compiled as one unit. Separate eval() calls would
   not see each other's consts. */
const T = new Function(
  grab(/const FLAG_CODES = \{[\s\S]*?\nfunction addSpans[\s\S]*?\n}\n/) +
  grab(/const isScored = [\s\S]*?\nfunction rankOf[\s\S]*?\n}\n/) +
  ';return {FLAG_CODES,FLAG_SHORT,normFlags,flagsOf,bestSentence,addSpans,mergeJudgment,rankOf,fitOf,reachOf,isScored,SPAN_FLOOR,FLAG_P,'
  + 'scoreFromDist,fitFromJudgment,reachFromJudgment,judgmentOf,confWeight,FIT_W,REACH_W,REACH_BASE};'
)();

const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'eval', 'cases.json'), 'utf8'));
const BASELINE_PATH = path.join(__dirname, 'eval', 'baseline.json');

/* Which slice of the labelled set to run. Two different questions, so two
   different sets, and conflating them is how a gate stops meaning anything:

     --set all       every case. The REGRESSION gate, and the default, because
                     that is what this file has always been and quietly
                     narrowing a release gate is worse than not splitting.
     --set tune      the 8 cases work happens on.
     --set holdout   the 2 that are never tuned on. The only honest input to
                     "did this change actually help", as opposed to "did I fit
                     the cases I was staring at".

   A case with no `set` counts as tune, so an unlabelled case is never silently
   promoted into the holdout. Baselines are stored per set and never compared
   across sets — 8 cases and 10 cases do not produce comparable numbers. */
const SET = (() => {
  const i = process.argv.indexOf('--set');
  const v = i > -1 ? process.argv[i + 1] : 'all';
  if (!['all', 'tune', 'holdout'].includes(v)) { console.error(`unknown --set ${v} (all|tune|holdout)`); process.exit(1); }
  return v;
})();
if (SET !== 'all') CASES.cases = CASES.cases.filter(c => (c.set || 'tune') === SET);
if (!CASES.cases.length) { console.error(`no cases in --set ${SET}`); process.exit(1); }

let failed = 0;
const fail = m => { console.error('  FAIL  ' + m); failed++; };
const ok = m => console.log('  ok    ' + m);

// ── 1. rankOf: the confidence mapping acceptance ─────────────────────────
/* rankOf multiplies by a number derived from an ordinal, and Jev answers in
   the same three words DeepSeek's h/m/l were expanded into. If that mapping
   moves, every list in the app reorders and nothing says so. */
{
  const at = (fit, reach, conf) => T.rankOf({ ai_score: String(fit), ai_reachability: String(reach), ai_confidence: conf });
  const want = { high: 1, medium: 0.9, low: 0.78 };
  let bad = 0;
  Object.keys(want).forEach(k => {
    const got = at(100, 100, k) / at(100, 100, 'high');
    if (Math.abs(got - want[k]) > 1e-9) { fail(`confidence "${k}" weighs ${got}, expected ${want[k]}`); bad++; }
  });
  // An unknown or missing value has to land on the cautious end, not on 1.
  if (Math.abs(at(100, 100, 'unknown') / at(100, 100, 'high') - 0.78) > 1e-9) { fail('an unrecognised confidence does not fall back to low'); bad++; }
  if (Math.abs(at(100, 100, '') / at(100, 100, 'high') - 0.78) > 1e-9) { fail('a missing confidence does not fall back to low'); bad++; }
  // The shape of the curve, not just the weights.
  if (!(at(90, 40, 'high') > at(40, 90, 'high'))) { fail('fit no longer outweighs reach at 0.65/0.35'); bad++; }
  if (!bad) ok('rankOf unchanged: high/medium/low weigh 1 / 0.9 / 0.78, unknown falls back to low, fit still outweighs reach');
}

// ── 2. every span is a verbatim substring ────────────────────────────────
/* The moat is the evidence. A span that is not literally in the posting is
   worse than no span at all: it is a fabricated quote presented as proof. */
{
  let checked = 0, empty = 0, bad = 0;
  CASES.cases.forEach(c => {
    const flags = T.addSpans(T.normFlags(c.recorded.f), c.job.description);
    flags.forEach(f => {
      if (!f.span) { empty++; return; }
      checked++;
      if (c.job.description.indexOf(f.span) === -1) { bad++; fail(`${c.id}/${f.code}: span is not in the posting — ${JSON.stringify(f.span)}`); }
      if (f.span !== f.span.trim()) { bad++; fail(`${c.id}/${f.code}: span has loose whitespace`); }
    });
  });
  if (!bad) ok(`${checked} spans, every one a verbatim substring of its posting (${empty} flags left unquoted rather than guessed)`);
}

/* The failure worth proving is the one that cannot be seen by reading output:
   a fact with no support must come back empty, not attached to the nearest
   sentence. Without this the floor could be set to zero and section 2 would
   still pass every assertion in it. */
{
  const desc = 'We build settlement infrastructure in Go. The team is fully remote across Europe.';
  if (T.bestSentence(desc, 'requires a PhD in astrophysics') !== '') fail('an unsupported fact still produced a quote');
  else if (T.bestSentence(desc, 'fully remote across Europe') === '') fail('a supported fact produced no quote');
  else ok(`bestSentence quotes what the posting supports and nothing else (floor ${T.SPAN_FLOOR})`);
}

// ── 3. flag precision and recall ─────────────────────────────────────────
let tp = 0, fp = 0, fn = 0;
const perCase = [];
CASES.cases.forEach(c => {
  const got = T.normFlags(c.recorded.f).map(f => f.code);
  const want = c.expect.flags;
  const hit = got.filter(x => want.indexOf(x) > -1);
  tp += hit.length;
  fp += got.filter(x => want.indexOf(x) === -1).length;
  fn += want.filter(x => got.indexOf(x) === -1).length;
  perCase.push({ id: c.id, got, want, missed: want.filter(x => got.indexOf(x) === -1), extra: got.filter(x => want.indexOf(x) === -1) });
});
const r3 = n => Math.round(n * 1000) / 1000;
const precision = tp + fp ? r3(tp / (tp + fp)) : 1;
const recall = tp + fn ? r3(tp / (tp + fn)) : 1;

// ── 4. score calibration ─────────────────────────────────────────────────
/* Not "is 88 the right number" -- nobody can label that. Only whether the two
   scores land in the band the case says they must, which is the part a change
   to the prompt can silently break. */
let inBand = 0;
const outOfBand = [];
CASES.cases.forEach(c => {
  const fit = c.recorded.s, reach = c.recorded.re;
  const okFit = fit >= c.expect.fit[0] && fit <= c.expect.fit[1];
  const okReach = reach >= c.expect.reach[0] && reach <= c.expect.reach[1];
  if (okFit && okReach) inBand++;
  else outOfBand.push(`${c.id} (fit ${fit} want ${c.expect.fit.join('-')}, reach ${reach} want ${c.expect.reach.join('-')})`);
});
const calibration = r3(inBand / CASES.cases.length);

// ── 5. facts, and how many of them are evidenced ─────────────────────────
let flagsTotal = 0, withFact = 0, withSpan = 0;
CASES.cases.forEach(c => {
  T.addSpans(T.normFlags(c.recorded.f), c.job.description).forEach(f => {
    flagsTotal++; if (f.fact) withFact++; if (f.span) withSpan++;
  });
});
const factRate = r3(withFact / flagsTotal);
const spanRate = r3(withSpan / flagsTotal);

// ── 6. the merge: Jev fires, DeepSeek explains ───────────────────────────
{
  const ds = T.normFlags([{ code: 'loc', fact: 'Berlin office' }, { code: 'comp', fact: 'thousands apply' }]);
  const jev = { confidence: 'high', flags: [
    { code: 'loc', probability: 0.91 },     // fired, and DeepSeek has a fact
    { code: 'comp', probability: 0.12 },    // DeepSeek raised it, Jev does not agree
    { code: 'rare', probability: 0.77 },    // Jev raises one DeepSeek never mentioned
  ] };
  const out = T.mergeJudgment(ds, jev);
  const codes = out.map(f => f.code).sort().join(',');
  if (codes !== 'loc,rare') fail(`merge kept the wrong flags: ${codes}`);
  else if (out.filter(f => f.code === 'loc')[0].fact !== 'Berlin office') fail('merge lost the fact for a flag both agreed on');
  else if (out.filter(f => f.code === 'rare')[0].fact !== '') fail('merge invented a fact for a flag DeepSeek never mentioned');
  else if (T.mergeJudgment(ds, null).length !== 2) fail('with no judgement the merge should fall through to DeepSeek’s own flags');
  else ok(`merge: Jev decides which flags fire above ${T.FLAG_P}, DeepSeek supplies the fact, neither invents one`);
}

// ── 7. no prose reaches a job row ────────────────────────────────────────
/* 2b's actual acceptance. The prompt is the only place a sentence could be
   asked for, so this reads it rather than trusting that it was removed. */
{
  /* Anchored on the scoring contract's own first line. "Return ONLY a JSON
     object" appears in four prompts in this file, and the first of them --
     profile extraction -- legitimately asks for a "why" per track. */
  const prompt = h.match(/\{"r":\[\{"id"[\s\S]*?One entry per input job\. JSON object only\.`/);
  if (!prompt) fail('could not find the scoring contract in index.html');
  else if (/"why"/.test(prompt[0])) fail('the scoring prompt still asks the model for a "why" sentence');
  else if (!/"fact"/.test(prompt[0])) fail('the scoring prompt no longer asks for a fact per flag');
  else ok('the classifier is asked for flags and facts, and for no prose at all');
}

// ── 8. composing a judgement into numbers ────────────────────────────────
/* Constructed distributions, not recorded ones -- like section 6, this checks
   the arithmetic the app does with an answer, not the answer. The recorded
   cases still carry DeepSeek's numbers, and fit/reach still come from them; the
   composition below is what 2e has to measure against those before the app can
   switch over. Pinning it here means the weights cannot drift unnoticed in the
   meantime, because every one of them is a policy choice that re-ranks lists. */
{
  const dist = o => ({ score: 99, probabilities: o });   // score: deliberately absurd
  let bad = 0;
  const eq = (got, want, what) => { if (got !== want) { fail(`${what}: got ${got}, expected ${want}`); bad++; } };

  // The interpolated float is ignored on purpose: jev-1.13 is documented weak
  // at numeric calibration, so a score of 99 next to a bottom-level
  // distribution must read as the distribution, not as 99.
  eq(T.scoreFromDist(dist({ '0': 1, '1': 0, '2': 0, '3': 0, '4': 0 })), 0, 'all mass on the bottom level');
  eq(T.scoreFromDist(dist({ '0': 0, '1': 0, '2': 0, '3': 0, '4': 1 })), 100, 'all mass on the top level');
  eq(T.scoreFromDist(dist({ '0': 0.5, '1': 0, '2': 0, '3': 0, '4': 0.5 })), 50, 'mass split across the ends');
  eq(T.scoreFromDist(null), null, 'no answer composes to nothing rather than to zero');

  // Capability outweighs targeting, so the one the candidate can do outranks
  // the one they merely want.
  const jv = (cap, tgt) => ({ scores: { fit_capability: dist(cap), fit_targeting: dist(tgt) } });
  const top = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 1 }, bot = { '0': 1, '1': 0, '2': 0, '3': 0, '4': 0 };
  if (!(T.fitFromJudgment(jv(top, bot)) > T.fitFromJudgment(jv(bot, top)))) {
    fail('fit no longer weighs capability above targeting'); bad++;
  }
  eq(T.fitFromJudgment({ scores: {} }), null, 'a judgement with no scores composes to nothing');

  /* Reachability is composed from four nouls rather than asked. Each has a
     direction, and getting one backwards would be invisible in any single
     number -- so the ordering is asserted, not the value. */
  const rj = p => ({ flags: Object.keys(p).map(code => ({ code, probability: p[code] })) });
  const clean = T.reachFromJudgment(rj({ comp: 0, cred: 0, sen_hi: 0, open: 0 }));
  const gated = T.reachFromJudgment(rj({ comp: 1, cred: 1, sen_hi: 1, open: 0 }));
  const openTo = T.reachFromJudgment(rj({ comp: 0, cred: 0, sen_hi: 0, open: 1 }));
  eq(clean, T.REACH_BASE, 'a posting with none of the four obstacles sits at the base');
  if (!(gated < clean)) { fail(`crowding, a credential gate and too high a bar should lower reach (${gated} vs ${clean})`); bad++; }
  if (!(openTo > clean)) { fail(`openness to non-traditional candidates should raise reach (${openTo} vs ${clean})`); bad++; }
  eq(T.reachFromJudgment({ flags: [] }), null, 'no flags composes to nothing rather than to the base');

  /* rankOf's confidence weight: a row with no raw judgement has to keep the
     exact weight it had, or every list in the app quietly reorders. */
  const wOrd = T.confWeight({ ai_confidence: 'medium' });
  const wDist = T.confWeight({ ai_judgment: JSON.stringify({ confidence_probabilities: { high: 0, medium: 1, low: 0 } }) });
  if (Math.abs(wOrd - 0.9) > 1e-9) { fail(`an unjudged row no longer weighs medium at 0.9, got ${wOrd}`); bad++; }
  if (Math.abs(wDist - 0.9) > 1e-9) { fail(`a peaked distribution should agree with the ordinal it replaces, got ${wDist}`); bad++; }
  const wSplit = T.confWeight({ ai_judgment: JSON.stringify({ confidence_probabilities: { high: 0.5, medium: 0, low: 0.5 } }) });
  if (!(wSplit > 0.78 && wSplit < 1)) { fail(`a split distribution should land between low and high, got ${wSplit}`); bad++; }
  if (Math.abs(T.confWeight({ ai_judgment: '{oh no', ai_confidence: 'high' }) - 1) > 1e-9) {
    fail('an unparseable judgement should fall back to the ordinal, not throw'); bad++;
  }

  if (!bad) ok('composition holds: the distribution decides (not the float), capability outweighs targeting, the four reach signs point the right way, and an unjudged row ranks exactly as it did');
}

// ── report ───────────────────────────────────────────────────────────────
const measured = { precision, recall, calibration, factRate, spanRate, cases: CASES.cases.length };

console.log('\nmatcher, against ' + CASES.cases.length + ` labelled postings (--set ${SET}):`);
console.log(`  flag precision   ${precision}   (${tp} right, ${fp} raised that should not have been)`);
console.log(`  flag recall      ${recall}   (${fn} missed)`);
console.log(`  score bands      ${calibration}   (${inBand}/${CASES.cases.length} with both scores in range)`);
console.log(`  flags with fact  ${factRate}`);
console.log(`  facts quoted     ${spanRate}   (the rest left unquoted on purpose)`);
perCase.filter(c => c.missed.length || c.extra.length).forEach(c =>
  console.log(`    ${c.id}: missed [${c.missed.join(' ')}] extra [${c.extra.join(' ')}]`));
outOfBand.forEach(s => console.log(`    ${s}`));

/* A baseline written before the split is a flat `metrics` measured over every
   case, so it is read as the `all` baseline and nothing else. It is not
   silently reused for tune or holdout: those have fewer cases and would
   compare as a phantom improvement. */
const readBase = () => {
  const b = fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) : null;
  if (!b) return null;
  if (b.sets) return b;
  return { ...b, sets: b.metrics ? { all: { metrics: b.metrics, recorded: b.recorded } } : {} };
};

if (process.argv.indexOf('--write-baseline') > -1) {
  const b = readBase() || { sets: {} };
  b.sets[SET] = { metrics: measured, recorded: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify({
    _note: 'Written by scripts/eval-matcher.js --write-baseline [--set all|tune|holdout]. A drop against these fails the check; raising them is the point of working on the matcher. Sets are never compared against each other.',
    sets: b.sets,
  }, null, 2) + '\n');
  console.log(`\nbaseline for --set ${SET} written to scripts/eval/baseline.json`);
} else if (readBase() && readBase().sets[SET]) {
  const entry = readBase().sets[SET];
  const base = entry.metrics;
  console.log(`\nagainst the ${SET} baseline of ${entry.recorded}:`);
  let moved = 0;
  ['precision', 'recall', 'calibration', 'factRate', 'spanRate'].forEach(k => {
    const d = r3(measured[k] - base[k]);
    if (d < -1e-9) { fail(`${k} fell from ${base[k]} to ${measured[k]}`); moved++; }
    else if (d > 1e-9) { console.log(`  ok    ${k} rose from ${base[k]} to ${measured[k]} — update the baseline`); moved++; }
  });
  if (base.cases !== measured.cases) console.log(`  note  the set changed size: ${base.cases} → ${measured.cases}`);
  if (!moved) ok('every metric holds its baseline');
} else {
  console.log(`\nno baseline for --set ${SET} yet — run with --write-baseline --set ${SET} to record one.`);
  if (SET === 'holdout') console.log('  (n=2 quantises every metric to halves: a smoke test against overfitting, not a measurement)');
}

console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASS'));
process.exitCode = failed ? 1 : 0;
