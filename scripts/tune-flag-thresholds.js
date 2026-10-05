// Flag-threshold sweep: node scripts/tune-flag-thresholds.js [--set tune|holdout|all] [--at 0.5]
//
// index.html keeps ONE cut point for every flag -- FLAG_P -- and
// the comment there is honest about what it is: "Jev returns a number per flag
// precisely so the caller can keep its own threshold rather than trusting one
// chosen elsewhere; this is ours." Ours was chosen by eye. This measures it.
//
// It reads scripts/eval/judgments.json, which holds one raw Jev judgement per
// case, so the sweep costs nothing and gives the same answer every run. Nothing
// here calls a model, and nothing here edits index.html: it prints what the
// labels support and leaves the decision, which is a product decision about
// consequences, to a person.
//
// WHY THIS NEEDED THIRTY CASES AND A SECOND LABEL FIELD. A threshold sweep needs
// negatives, and `expect.flags` has none: it lists the one or two codes a case
// was built to exercise, so every other code reads as absent rather than false.
// Sweeping against it measured the labelling, not the model -- `open` scored
// 0.17 precision on 2026-09-28 almost entirely that way. `expect.codes` carries
// one entry per code, true or false, and OMITS the codes a posting does not
// determine. Omitted is not negative; it is skipped.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/eval/cases.json'), 'utf8'));
const JUDGED = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/eval/judgments.json'), 'utf8'));

const arg = (f, dflt) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : dflt; };
const SET = arg('--set', 'tune');
/* The cut to report against is READ FROM index.html, not defaulted. It used to
   default to 0.5 while printing "the shipped cut is FLAG_P = 0.5 ... (index.html)",
   and the shipped value had since moved to 0.8 -- so the one tool meant to inform
   whether the cut is right was describing a cut nobody ships. Sliced the way every
   other script here reads a constant out of the app. */
const SHIPPED_FLAG_P = (() => {
  const m = /const FLAG_P = ([0-9.]+)/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  if (!m) throw new Error('could not find FLAG_P in index.html');
  return m[1];
})();
const AT = Number(arg('--at', SHIPPED_FLAG_P));

/* The floor for saying anything at all. Three of each is not a lot, but it is
   the point below which a "best" threshold is just the gap between two numbers
   and would move on the next case added. Below it this prints the counts and no
   recommendation, which is the useful output: it names the code that needs more
   labelled postings. */
const MIN_PER_CLASS = 3;

const CODES = ['fit', 'sen_hi', 'sen_lo', 'cred', 'shape', 'loc', 'thin', 'comp', 'open', 'rare'];

const cases = CASES.cases.filter(c => SET === 'all' || c.set === SET);
const missing = cases.filter(c => !JUDGED.judgments[c.id]);
if (missing.length) {
  console.error(`no judgement for: ${missing.map(c => c.id).join(', ')}`);
  console.error('run: deno run --node-modules-dir=none --env-file=.env.local --allow-env --allow-net --allow-read --allow-write scripts/record-eval.ts --jev');
  process.exit(1);
}

// probability per (case, code), paired with the label where there is one.
const points = {};
CODES.forEach(code => { points[code] = []; });
cases.forEach(c => {
  const jv = JUDGED.judgments[c.id];
  const labels = (c.expect && c.expect.codes) || {};
  const p = {};
  jv.flags.forEach(f => { p[f.code] = Number(f.probability); });
  CODES.forEach(code => {
    if (!(code in labels)) return;            // omitted: the posting does not determine it
    points[code].push({ id: c.id, p: p[code], want: !!labels[code] });
  });
});

const r2 = n => Math.round(n * 100) / 100;
const r3 = n => Math.round(n * 1000) / 1000;

function scoreAt(pts, t) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  pts.forEach(x => {
    const got = x.p >= t;
    if (x.want && got) tp++; else if (!x.want && got) fp++; else if (x.want && !got) fn++; else tn++;
  });
  const prec = tp + fp ? tp / (tp + fp) : 1;
  const rec = tp + fn ? tp / (tp + fn) : 1;
  const f1 = prec + rec ? 2 * prec * rec / (prec + rec) : 0;
  return { tp, fp, fn, tn, prec, rec, f1 };
}

console.log(`flag thresholds, against ${cases.length} labelled postings (--set ${SET}), Jev ${JUDGED.model} recorded ${JUDGED.recorded}`);
console.log(`the shipped cut is FLAG_P = ${AT} for every code (index.html)\n`);
console.log(`${'code'.padEnd(7)} ${'n+'.padStart(3)} ${'n-'.padStart(3)}  ${('P@' + AT).padStart(6)} ${('R@' + AT).padStart(6)}   ${'best'.padStart(6)} ${'P'.padStart(5)} ${'R'.padStart(5)}   separation`);

const recommendations = [];
CODES.forEach(code => {
  const pts = points[code];
  const pos = pts.filter(x => x.want), neg = pts.filter(x => !x.want);
  const now = scoreAt(pts, AT);
  const head = `${code.padEnd(7)} ${String(pos.length).padStart(3)} ${String(neg.length).padStart(3)}  ${r2(now.prec).toFixed(2).padStart(6)} ${r2(now.rec).toFixed(2).padStart(6)}`;

  if (pos.length < MIN_PER_CLASS || neg.length < MIN_PER_CLASS) {
    console.log(`${head}   ${'—'.padStart(6)} ${'—'.padStart(5)} ${'—'.padStart(5)}   too few labelled cases to tune`);
    return;
  }

  /* Candidate cuts are the midpoints between adjacent observed probabilities:
     any threshold strictly inside a gap classifies this set identically, so
     there is nothing to gain from a finer grid, and the midpoint is the point
     in that gap furthest from the data. */
  const sorted = [...new Set(pts.map(x => x.p))].sort((a, b) => a - b);
  const cuts = [];
  for (let i = 0; i < sorted.length - 1; i++) cuts.push((sorted[i] + sorted[i + 1]) / 2);
  cuts.push(sorted[sorted.length - 1] + 1e-6);

  let best = null;
  cuts.forEach(t => {
    const s = scoreAt(pts, t);
    // Ties go to the lower cut: it keeps recall, and a missed flag is the more
    // expensive error on every code here except the two cosmetic ones.
    if (!best || s.f1 > best.s.f1 + 1e-9) best = { t, s };
  });

  const maxNeg = Math.max(...neg.map(x => x.p));
  const minPos = Math.min(...pos.map(x => x.p));
  const sep = minPos > maxNeg
    ? `clean: negatives end ${r2(maxNeg)}, positives start ${r2(minPos)}`
    : `overlapping: a negative reaches ${r2(maxNeg)}, a positive sits at ${r2(minPos)}`;

  console.log(`${head}   ${r2(best.t).toFixed(2).padStart(6)} ${r2(best.s.prec).toFixed(2).padStart(5)} ${r2(best.s.rec).toFixed(2).padStart(5)}   ${sep}`);
  if (Math.abs(best.t - AT) > 0.05 && best.s.f1 > now.f1 + 1e-9) {
    recommendations.push({ code, from: AT, to: r2(best.t), f1From: r3(now.f1), f1To: r3(best.s.f1), clean: minPos > maxNeg, n: pts.length });
  }
});

console.log('');
if (!recommendations.length) {
  console.log('nothing to change: no code does better at another cut than it does at the shipped one.');
} else {
  console.log('codes where another cut scores better on this set:');
  recommendations.forEach(r => {
    console.log(`  ${r.code.padEnd(7)} ${r.from} → ${r.to}   F1 ${r.f1From} → ${r.f1To}   ${r.clean ? 'classes separate cleanly' : 'classes overlap, so this cut is a trade not a fix'} (n=${r.n})`);
  });
  console.log('\nThis is a measurement, not a patch. FLAG_P is one number for ten codes, so acting on any');
  console.log('of these means deciding whether the flag threshold becomes per-code -- and that is a');
  console.log('product call about which error costs more, which no F1 score can make. Check a cut on');
  console.log('--set holdout before believing it.');
}
