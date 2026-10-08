// Smoke test: one TypeSafe System One judgment against a real-looking job.
// Prints no key material.
//
//   deno run --node-modules-dir=none --env-file=.env.local --allow-env --allow-net test-judge.ts

import { buildJudge, JUDGE_FLAG_CODES, JUDGE_SCORE_DIMS } from "./supabase/functions/_shared/judge.ts";
import { typesafe } from "./supabase/functions/_shared/api-clients.ts";

const posting = {
  title: "Senior Backend Engineer",
  company: "Acme",
  location: "Remote",
  description: "Build and run Go services on Postgres. Own the full lifecycle. Fully remote; apply by Friday.",
};
/* No name, because candidateOf() in index.html no longer sends one -- the
   fixture has to match what the app really posts or this smoke test proves
   something nobody ships. Removed 2026-10-08, after reading DeepSeek's and
   TypeSafe's retention terms: a name moves none of these judgements, so it
   was crossing the wire on every judged posting for nothing. */
const candidate = {
  location: "India",
  seniority: "Senior",
  strengths: ["Go", "Postgres", "distributed systems"],
  gaps: ["no Kubernetes", "no public-facing product"],
  wrong_shapes: ["front-end only", "people management"],
};

/* The intake's optional "paste one job you'd apply to today". Supplied here so
   the smoke test exercises fit_exemplar, which is only asked when it is
   non-empty -- run it with `const exemplar = "";` to see the two-score shape
   that every profile without one gets. */
const exemplar = `Platform Engineer, Zephyr Labs, Remote (India).
Own the deployment and observability story for a small Go/Postgres backend.
No front-end work, no line management. IC role reporting to the CTO.`;

const { state, questions } = buildJudge(posting, candidate, exemplar);
const r = await typesafe().systemOne({ state, questions });

console.log("model:", r.model);
console.log("confidence:", r.answers.confidence.choice, JSON.stringify(r.answers.confidence.probabilities));
// The distribution, not just the float: the float is the part index.html
// deliberately ignores, so printing it alone would hide what is composed from.
for (const dim of JUDGE_SCORE_DIMS) {
  const a = r.answers[dim];
  // fit_exemplar is absent unless an exemplar was supplied, which is the same
  // check shapeJudge makes -- not defensiveness, the documented shape.
  if (!a) { console.log(`score ${dim}: not asked`); continue; }
  console.log(`score ${dim}: ${a.score.toFixed(2)} conf ${a.confidence.toFixed(2)} ${JSON.stringify(a.probabilities)}`);
}
for (const code of JUDGE_FLAG_CODES) {
  console.log(`flag ${code}: ${r.answers[code].noul.toFixed(3)}`);
}
console.log("usage:", JSON.stringify(r.usage));
