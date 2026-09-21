// The scoring prompt's `c` (confidence) and `f` (flag) fields, moved off
// DeepSeek onto a typed TypeSafe judgment. DeepSeek still returns fit (s),
// reach (re), the one-line why, and the posted-date window; this returns the
// parts that are a yes/no or one-of-a-set call rather than free text.
//
// One noul per flag rather than a single multi-label choice: several flags can
// be true at once, and each needs its own probability so the caller can keep
// its own threshold instead of trusting one here.

import { choice, noul } from "npm:@typesafe-ai/sdk@0.6.0";
import { typesafe } from "./api-clients.ts";

// Mirrors FLAG_CODES in index.html.
export const JUDGE_FLAG_CODES = [
  "fit", "sen_hi", "sen_lo", "cred", "shape", "loc", "thin", "comp", "open", "rare",
] as const;

export function buildJudge(posting: unknown, candidate: unknown) {
  return {
    // Plain JSON at runtime (the browser sends objects); `as any` sidesteps the
    // SDK's JsonValue index signature, which `unknown` cannot satisfy.
    state: { posting, candidate } as any,
    questions: {
      // c in the old prompt: how much of the posting is actually visible.
      confidence: choice("How much of the posting in `posting` is actually visible?",
        { high: "a real, full job description", medium: "a short snippet", low: "title and company only" }),
      fit:    noul("Does `posting` describe work that is a strong fit for `candidate` — the work they can do and are targeting?"),
      sen_hi: noul("Is the role's seniority bar above what `candidate` can claim?"),
      sen_lo: noul("Is the role's seniority bar below `candidate`'s level?"),
      cred:   noul("Is the role gated by a hard credential `candidate` is not shown to hold?"),
      shape:  noul("Is this one of the role shapes `candidate` was told to rule out?"),
      loc:    noul("Does the role's location make `candidate` ineligible (no remote allowance where it matters)?"),
      thin:   noul("Is there too little data here to judge fit or reachability?"),
      comp:   noul("Is competition for this role unusually high?"),
      open:   noul("Is this role friendly to non-traditional candidates?"),
      rare:   noul("Does this role reward `candidate`'s rare combination of skills?"),
    },
  };
}

export function shapeJudge(r: any) {
  return {
    model: r.model,
    confidence: r.answers.confidence.choice,
    confidence_score: r.answers.confidence.confidence,
    confidence_probabilities: r.answers.confidence.probabilities,
    flags: JUDGE_FLAG_CODES.map((code) => ({ code, probability: r.answers[code].noul })),
    usage: r.usage,
  };
}

/** One posting, judged. Used by the `judge` edge-function action. */
export async function judge(posting: unknown, candidate: unknown) {
  const { state, questions } = buildJudge(posting, candidate);
  return shapeJudge(await typesafe().systemOne({ state, questions }));
}
