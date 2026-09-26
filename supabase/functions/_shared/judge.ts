// Every judgment about one posting that has a known answer set, in one request.
// DeepSeek keeps only what it is actually better at: the `fact` extract per flag,
// the posted-date window, and prose. Fit and reachability used to come back as
// DeepSeek's `s` and `re`; they are composed in the browser now, from the answers
// below.
//
// One noul per flag rather than a single multi-label choice: several flags can
// be true at once, and each needs its own probability so the caller can keep
// its own threshold instead of trusting one here.
//
// Two scores rather than one "fit", because the old single question asked two
// things at once -- whether the person can do the work, and whether it is the
// work they want. A candidate who can clearly do a job they are trying to move
// away from is a different row from one who is reaching for a job they cannot
// yet do, and one number cannot say which is which.
//
// Reachability is deliberately NOT a question here. It would ask about
// competition, credential gates, the seniority bar and openness to outsiders --
// all four of which are already asked below as nouls. It is composed from those
// probabilities in the browser instead, so changing its weighting never costs
// another call.
//
// Nothing here is thresholded. The raw probabilities go back to the caller,
// which owns the policy; re-thresholding is then free.

import { choice, noul, score } from "npm:@typesafe-ai/sdk@0.6.0";
import { typesafe } from "./api-clients.ts";

// Mirrors FLAG_CODES in index.html.
export const JUDGE_FLAG_CODES = [
  "fit", "sen_hi", "sen_lo", "cred", "shape", "loc", "thin", "comp", "open", "rare",
] as const;

// Mirrors JUDGE_SCORE_DIMS in index.html.
export const JUDGE_SCORE_DIMS = ["fit_capability", "fit_targeting"] as const;

// Jev reads scoping words and negations at face value, so every level below
// states what IS true of a posting at that level rather than what is missing.
const CAPABILITY_LEVELS = [
  "The work the posting describes sits in a different discipline or domain from everything in the candidate's background.",
  "The posting and the candidate share some tools or vocabulary, while the day-to-day work described is unfamiliar to them.",
  "The candidate has done adjacent work, and could cover the posting's core duties after a ramp-up period.",
  "The candidate has done this kind of work directly, and could cover the posting's core duties today.",
  "The posting's core work is the candidate's strongest demonstrated area, including the parts most people find hard.",
] as const;

const TARGETING_LEVELS = [
  "The posting is an example of a role shape the candidate listed as one to rule out.",
  "The posting sits outside the direction the candidate describes for themselves, among shapes they stayed silent about.",
  "The posting is compatible with the candidate's stated direction, as one of many roles that would be.",
  "The posting matches the direction the candidate states they are looking for.",
  "The posting matches the candidate's stated target closely, down to the seniority and the kind of company they name.",
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

      fit_capability: score(
        "Judge how much of the work described in `posting` the person in `candidate` has already shown they can do. Judge the work itself rather than the job title, and set aside how likely they are to win the process.",
        CAPABILITY_LEVELS,
      ),
      fit_targeting: score(
        "Judge how closely the role in `posting` matches the kind of work the person in `candidate` says they are looking for, reading their stated targets, their strengths, and the role shapes they ruled out.",
        TARGETING_LEVELS,
      ),

      fit:    noul("Does `posting` describe work that is a strong fit for `candidate` — the work they can do and are targeting?"),
      sen_hi: noul("Is the role's seniority bar above what `candidate` can claim?"),
      sen_lo: noul("Is the role's seniority bar below `candidate`'s level?"),
      cred:   noul("Is the role gated by a hard credential `candidate` is not shown to hold?"),
      shape:  noul("Is this one of the role shapes `candidate` was told to rule out?"),
      loc:    noul("Does the role's location make `candidate` ineligible (no remote allowance where it matters)?"),
      /* The abstention. Reworded 2026-09-26; three things were wrong with
         "is there too little data here to judge fit or reachability?".
         "Here" does not say which part of the state. "Too little data" invites
         a reading about LENGTH, when the thing that matters is whether the
         decisive facts are present — a two-line posting naming the stack and
         the level is answerable, a thousand words of culture copy is not.
         And it is framed as an absence, while this file's own rule is that Jev
         reads scoping words and negations at face value, so a question should
         assert what IS true of the posting.
         Reachability is dropped from the wording on purpose: it composes from
         comp, cred, sen_hi and open, which are their own questions and can each
         be low-information independently. One question, one claim; the host
         decides what a high probability suppresses. */
      thin:   noul("Does `posting` leave the actual work and its requirements unstated, so that any judgement of fit would be a guess?"),
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
    // Every code, every time. The caller thresholds; this does not.
    flags: JUDGE_FLAG_CODES.map((code) => ({ code, probability: r.answers[code].noul })),
    // The interpolated `score` float is carried, but jev-1.13 is weak at numeric
    // calibration, so `probabilities` is the field to compose from.
    scores: Object.fromEntries(JUDGE_SCORE_DIMS.map((dim) => [dim, {
      score: r.answers[dim].score,
      probabilities: r.answers[dim].probabilities,
      confidence: r.answers[dim].confidence,
    }])),
    usage: r.usage,
  };
}

/** One posting, judged. Used by the `judge` edge-function action. */
export async function judge(posting: unknown, candidate: unknown) {
  const { state, questions } = buildJudge(posting, candidate);
  return shapeJudge(await typesafe().systemOne({ state, questions }));
}
