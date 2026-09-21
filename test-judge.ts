// Smoke test: one TypeSafe System One judgment against a real-looking job.
// Prints no key material.
//
//   deno run --node-modules-dir=none --env-file=.env.local --allow-env --allow-net test-judge.ts

import { buildJudge, JUDGE_FLAG_CODES } from "./supabase/functions/_shared/judge.ts";
import { typesafe } from "./supabase/functions/_shared/api-clients.ts";

const posting = {
  title: "Senior Backend Engineer",
  company: "Acme",
  location: "Remote",
  description: "Build and run Go services on Postgres. Own the full lifecycle. Fully remote; apply by Friday.",
};
const candidate = {
  name: "Alex",
  location: "India",
  seniority: "Senior",
  strengths: ["Go", "Postgres", "distributed systems"],
  gaps: ["no Kubernetes", "no public-facing product"],
  wrong_shapes: ["front-end only", "people management"],
};

const { state, questions } = buildJudge(posting, candidate);
const r = await typesafe().systemOne({ state, questions });

console.log("model:", r.model);
console.log("confidence:", r.answers.confidence.choice, JSON.stringify(r.answers.confidence.probabilities));
for (const code of JUDGE_FLAG_CODES) {
  console.log(`flag ${code}: ${r.answers[code].noul.toFixed(3)}`);
}
console.log("usage:", JSON.stringify(r.usage));
