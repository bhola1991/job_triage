// Records one live Jev judgment per labelled case into scripts/eval/judgments.json,
// so FLAG_P can be tuned against real probabilities offline and deterministically.
//
// Ten cases at ~1,100 input tokens each is ~$0.0005 at $0.042/M, output free.
//
//   deno run --node-modules-dir=none --env-file=.env.local --allow-env --allow-net --allow-read --allow-write scripts/record-judgments.ts
//
// Why a separate file and not another field in cases.json: that file is the
// hand-written labelled set -- profile, postings, expected flags and score
// bands. This one is machine-recorded and gets replaced wholesale on every
// re-record. Keeping them apart keeps the labels' diff readable, and makes it
// obvious which half a change came from.

import { buildJudge, shapeJudge } from "../supabase/functions/_shared/judge.ts";
import { typesafe } from "../supabase/functions/_shared/api-clients.ts";

const CASES = new URL("./eval/cases.json", import.meta.url);
const OUT = new URL("./eval/judgments.json", import.meta.url);

// deno-lint-ignore no-explicit-any
type Any = any;
const cases = JSON.parse(await Deno.readTextFile(CASES));

/* The same whitelist as candidateOf() in index.html:3013 -- exactly what the
   questions ask about and no more. Recording a richer state than production
   sends would tune the threshold on judgments the app never makes. */
const prof = cases.profile;
const track = (prof.tracks || [])[0] || {};
const candidate = {
  name: prof.name || "", location: prof.location || "",
  seniority: prof.seniority || "", headline: prof.headline || "",
  targeting: track.label || "", target_titles: track.titles || [],
  rare_combination: prof.unusual_combination || "",
  strengths: prof.strengths || [], gaps: prof.gaps || [],
  wrong_shapes: prof.wrong_shapes || [],
};

const out: Record<string, Any> = {};
let tokens = 0;
for (const c of cases.cases as Any[]) {
  const j = c.job;
  const { state, questions } = buildJudge({
    title: String(j.title || ""), company: String(j.company || ""),
    location: String(j.location || ""),
    // judgeInto() in index.html caps the description at 4000 chars.
    description: String(j.description || "").slice(0, 4000),
  }, candidate);
  const r = shapeJudge(await typesafe().systemOne({ state, questions }));
  tokens += r.usage?.input_tokens || 0;
  out[c.id] = r;
  console.log(`${c.id}: ${r.flags.map((f: Any) => `${f.code} ${f.probability.toFixed(2)}`).join("  ")}`);
}

const models = [...new Set(Object.values(out).map((r) => r.model))];
await Deno.writeTextFile(OUT, JSON.stringify({
  _note: "Machine-recorded Jev answers, one per case in cases.json, written by scripts/record-judgments.ts. Committed so the offline check is deterministic. Re-record when the questions in judge.ts, the candidate whitelist, or the pinned model change -- and re-tune the thresholds in index.html afterwards, because a cut point calibrated on one model does not survive a bump.",
  model: models.length === 1 ? models[0] : models,
  recorded: new Date().toISOString().slice(0, 10),
  input_tokens: tokens,
  judgments: out,
}, null, 2) + "\n");

console.log(`\nrecorded ${Object.keys(out).length} judgments on ${models.join(", ")}, ${tokens} input tokens (~$${(tokens * 0.042 / 1e6).toFixed(5)})`);
