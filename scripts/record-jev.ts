// Record Jev's answers for the eval cases, so the gate can measure the
// composed score instead of only DeepSeek's.
//
//   deno run --node-modules-dir=none --env-file=.env.local \
//            --allow-env --allow-net --allow-read --allow-write scripts/record-jev.ts
//
//   --dry     call Jev and print, write nothing
//   --case X  just the one case id
//
// Why this exists
// ---------------
// scripts/eval/cases.json carries a model answer captured once and committed,
// which is what makes the eval a regression gate rather than a live test: the
// numbers move only when this repo changes. But every recorded answer in it is
// DEEPSEEK-shaped -- `s`, `re`, `c`, `f` -- so the eval can measure DeepSeek's
// fit and reachability against the hand-written labels and cannot measure the
// composition from Jev's probabilities at all. Section 8 of eval-matcher.js
// says so in as many words: the composition is pinned against CONSTRUCTED
// distributions, "what 2e has to measure against those before the app can
// switch over".
//
// That gap is the whole reason ai_score is still DeepSeek's number. The
// composition is written (fitFromJudgment, reachFromJudgment, scoreFromDist),
// unit-asserted, and called by nothing but the eval -- and flipping the app to
// it without re-recording would leave the gate printing ALL PASS while
// measuring the wrong model. So: record Jev once, commit it, and let the eval
// compare the two on the same ten cases and the same labels.
//
// It imports judge.ts rather than restating the questions. Those questions are
// the experiment -- a second copy would drift from the one the edge function
// asks, and the eval would then measure a model nobody is running.
//
// Ten cases, ~1,100 input tokens each, output free: about $0.0005 the pass.
import { judge } from "../supabase/functions/_shared/judge.ts";

const CASES = new URL("./eval/cases.json", import.meta.url).pathname;
const args = Deno.args;
const DRY = args.includes("--dry");
const ONE = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;

const file = JSON.parse(await Deno.readTextFile(CASES));
const profile = file.profile;
const cases = file.cases as Array<Record<string, any>>;

/* The candidate shape has to be the one the app sends, or the recording
   measures a state nobody is judged against. candidateOf in index.html sends
   the profile fields plus the track label and titles; the cases file holds a
   profile in that shape already, which is why this does not rebuild it. */
const candidateOf = (p: Record<string, unknown>) => ({
  name: p.name, location: p.location, country: p.country, seniority: p.seniority,
  years_experience: p.years_experience, headline: p.headline,
  domains: p.domains, strengths: p.strengths, hard_skills: p.hard_skills,
  gaps: p.gaps, wrong_shapes: p.wrong_shapes,
  unusual_combination: p.unusual_combination,
});

let done = 0, failed = 0;
for (const c of cases) {
  if (ONE && c.id !== ONE) continue;
  const posting = {
    title: c.job.title, company: c.job.company,
    location: c.job.location, description: c.job.description,
  };
  try {
    const jv = await judge(posting, candidateOf(profile));
    const fit = jv.scores.fit_capability, tgt = jv.scores.fit_targeting;
    console.log(`${c.id.padEnd(22)} conf ${String(jv.confidence).padEnd(6)} ` +
      `cap ${fit.score.toFixed(2)} tgt ${tgt.score.toFixed(2)}  ` +
      `flags>0.5: ${jv.flags.filter((f) => f.probability > 0.5).map((f) => f.code).join(",") || "-"}`);
    if (!DRY) {
      // Beside `recorded`, never over it: the DeepSeek answer is still what
      // sections 1-7 replay, and losing it would turn a regression gate into a
      // rewrite of its own baseline.
      c.recorded_jev = {
        model: jv.model,
        confidence: jv.confidence,
        confidence_probabilities: jv.confidence_probabilities,
        flags: jv.flags,
        scores: jv.scores,
      };
    }
    done++;
  } catch (e) {
    console.error(`${c.id.padEnd(22)} FAILED: ${(e as Error).message.slice(0, 120)}`);
    failed++;
  }
}

if (!DRY && done) {
  file._note_jev = "recorded_jev captured by scripts/record-jev.ts. Re-record when the " +
    "questions in supabase/functions/_shared/judge.ts change, and commit the diff: the " +
    "move in the eval's metrics is then the questions' effect, isolated.";
  await Deno.writeTextFile(CASES, JSON.stringify(file, null, 2) + "\n");
  console.log(`\nrecorded ${done} case(s) into scripts/eval/cases.json`);
} else if (DRY) {
  console.log(`\n--dry: nothing written (${done} judged, ${failed} failed)`);
}
if (failed) Deno.exit(1);
