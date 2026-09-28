/* What cut point should a Jev noul clear before the app shows its flag?
 *
 * Offline: reads the labels in eval/cases.json and the recorded probabilities in
 * eval/judgments.json. No key, no network, deterministic.
 *
 *   node scripts/tune-flag-threshold.js
 *
 * Reports, per flag, the probabilities seen on the cases whose labels say it
 * should fire and on those that say it should not, and the widest gap between
 * the two. A cut placed in the middle of a wide gap is the one least likely to
 * move under a re-record; a flag whose two sets overlap has no safe cut and is
 * reported as such rather than fitted to.
 *
 * n=10. This sizes a cut point, it does not validate one -- with a handful of
 * positives per flag the honest output is a gap and its width, not a decimal.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'eval');
const CASES = JSON.parse(fs.readFileSync(path.join(dir, 'cases.json'), 'utf8'));
const REC = JSON.parse(fs.readFileSync(path.join(dir, 'judgments.json'), 'utf8'));

const CODES = Object.keys(REC.judgments[CASES.cases[0].id] ? {} : {});
const codes = REC.judgments[CASES.cases[0].id].flags.map(f => f.code);

const r2 = n => Math.round(n * 100) / 100;
const rows = [];
codes.forEach(code => {
  const pos = [], neg = [];
  CASES.cases.forEach(c => {
    const j = REC.judgments[c.id];
    if (!j) return;
    const p = j.flags.find(f => f.code === code).probability;
    (c.expect.flags.indexOf(code) > -1 ? pos : neg).push({ id: c.id, p });
  });
  const loPos = pos.length ? Math.min(...pos.map(x => x.p)) : null;
  const hiNeg = neg.length ? Math.max(...neg.map(x => x.p)) : null;
  rows.push({ code, pos, neg, loPos, hiNeg, gap: loPos !== null && hiNeg !== null ? r2(loPos - hiNeg) : null });
});

console.log(`judgments recorded ${REC.recorded} on ${REC.model}\n`);
console.log('flag      n+  lowest true   highest false   gap    a cut inside the gap');
rows.forEach(r => {
  const gap = r.gap;
  const mid = r.loPos !== null && r.hiNeg !== null && gap > 0 ? r2((r.loPos + r.hiNeg) / 2) : null;
  const verdict = r.pos.length === 0 ? 'no positive case — cannot size'
    : gap === null ? 'no negative case — cannot size'
    : gap > 0 ? `${mid}  (any cut in ${r.hiNeg}–${r.loPos})`
    : 'OVERLAP — no cut separates these';
  console.log(
    `${r.code.padEnd(9)} ${String(r.pos.length).padEnd(3)} ` +
    `${(r.loPos === null ? '-' : r.loPos.toFixed(2)).padEnd(13)} ` +
    `${(r.hiNeg === null ? '-' : r.hiNeg.toFixed(2)).padEnd(15)} ` +
    `${(gap === null ? '-' : gap.toFixed(2)).padEnd(6)} ${verdict}`,
  );
});

// ── what a single global cut would do ────────────────────────────────────
console.log('\nglobal cut   true fired   false fired   missed');
const all = [];
rows.forEach(r => {
  r.pos.forEach(x => all.push({ code: r.code, id: x.id, p: x.p, want: true }));
  r.neg.forEach(x => all.push({ code: r.code, id: x.id, p: x.p, want: false }));
});
const totalPos = all.filter(a => a.want).length;
for (let t = 0.3; t <= 0.95001; t += 0.05) {
  const tp = all.filter(a => a.want && a.p >= t).length;
  const fp = all.filter(a => !a.want && a.p >= t).length;
  console.log(`   ${t.toFixed(2)}        ${String(tp).padEnd(12)} ${String(fp).padEnd(13)} ${totalPos - tp}`);
}

// The false positives a 0.5 cut lets through, named, since those are the chips
// a user actually sees on a row.
console.log('\nfalse flags at 0.50, highest first:');
all.filter(a => !a.want && a.p >= 0.5).sort((a, b) => b.p - a.p)
  .forEach(a => console.log(`   ${a.p.toFixed(2)}  ${a.code.padEnd(7)} on ${a.id}`));
