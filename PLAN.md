# Job Triage — build brief (steps 1–2 now, 3–5 future)

Self-contained brief. Hand this to an engineer or agent to execute the **now**
scope; the **future** section is saved context, explicitly out of scope for this
brief. Reads with `AUDIT.md`, which records the findings and decisions this plan
is built on.

## Context

Job Triage is a single-user job-search tool: it scrapes job boards, scores every
posting against the user's CV (fit vs reachability, separately), and turns the
result into a ranked, color-coded list. The next goal is to become a two-sided
product — candidates and employers — with "match on the work, not the network"
as the anti-LinkedIn thesis. The immediate blocker is the data model: all of a
user's state lives in one JSON blob, which loses concurrent edits and cannot
support a second side.

The plan is gated. **Do not build the employer side or the marketplace until
the matcher is measurably better on the candidate side.** Steps 1–2 below are
that foundation and that proof; steps 3–5 are parked until step 2 clears a real
bar.

## Non-negotiable constraints

- The app is one file, `index.html`: vanilla ES2020, no build step, no framework,
  no npm dependencies. Do not introduce a bundler or framework to the app.
- Backend is `supabase/functions/api/index.ts` (TypeScript on Deno), a stateless
  broker/meter that holds the service-role key.
- `schema.sql` / `billing.sql` are applied by hand (there is no migrations folder).
- Supabase RLS is the data boundary; the service-role key is only in the edge
  function and every query must stay scoped by `user`.
- `node scripts/pipeline-map.js --check` must stay `ALL PASS` after any change to
  edge-function actions, SQL objects, or `index.html` section banners.
- Both themes must keep working; the `ui-kit` `data-palette="v2"` invariant stays.

## Step 1 — Normalize the data model, add roles and visibility stubs

Replace the single `user_state` blob with per-row tables. Read path stays
in-memory; only the write path changes.

### 1a. Schema (starting point, not final)

```sql
create table profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text, headline text, location text, country text,
  seniority text, years_experience int,
  strengths jsonb default '[]', gaps jsonb default '[]', wrong_shapes jsonb default '[]',
  unusual_combination text, cv_text text, tracks jsonb default '[]',
  role text not null default 'candidate',      -- 'employer' reserved for future
  discoverable boolean not null default false, -- step 1 visibility stub
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  url text, title text, company text, location text, description text,
  posted_lo date, posted_hi date, posted_src text,
  channel text, stage text, status text,
  ai_score int, ai_reachability int, ai_confidence text,
  ai_flags jsonb default '[]', ai_facts jsonb default '[]',
  pitch_sent boolean, follow_up_date date, added date,
  contacts jsonb default '[]', events jsonb default '[]',
  deleted boolean not null default false,     -- soft delete = offline tombstone
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_user_updated on jobs (user_id, updated_at desc);
create index jobs_profile on jobs (profile_id);
```

Enable RLS on both and add the same "own rows" select/insert/update/delete
policies `user_state` already has. Keep `user_state` for non-job keys (theme,
etc.); the `triage:db` blob is what this step retires.

### 1b. Migration / backfill

One-time script that, per user, reads the `triage:db` blob, inserts each profile
into `profiles` and each job into `jobs`, then marks the migration complete.
Run it behind a compatibility window: while migrating, `save()` writes both the
new tables and the old blob so a rollback is possible. Verify row counts match
the blob before deleting the old key.

### 1c. Rewrite `save()` / `load()` in `index.html`

- `load()`: read all rows (`profiles`, `jobs`) for the user, reassemble the
  in-memory `DB` object exactly as today. Read path behavior unchanged.
- `save()`: diff-or-write per row — upsert changed jobs/profiles with their
  `updated_at`, soft-delete removed ones (`deleted = true`). Preserve local-first
  (`putLocal` mirror) and the `CLOUD_DOWN` latch.
- Row granularity fixes the two-tab data loss: two tabs editing different jobs
  write different rows. For the *same* job, accept last-writer-wins per row
  (fine) or compare `updated_at`; decide and record the choice.

### 1d. Acceptance

- A migrated account round-trips: load → edit one job → save → reload → the edit
  persists and no other row changed.
- Two tabs editing different jobs no longer lose either edit.
- `node scripts/pipeline-map.js --check` is `ALL PASS` (new `schema.sql` objects
  are mapped or listed out of scope in `scripts/pipeline-map.spec.js`).

## Step 2 — Matcher v1: Jev for every judgment, DeepSeek for text only

Architecture principle: **Jev (TypeSafe System One) owns every judgment that has
a known answer set — nouls, choices, scores.** DeepSeek owns **only** text
generation: profile extraction, assessment prose, drafts, and date extraction.
Every decision with a finite set of possible answers is a structured TypeSafe
call, never an LLM text-generation call.

### What is already on TypeSafe

`supabase/functions/_shared/judge.ts` already sends one `systemOne` request per
job containing:

- **confidence** → Choice `high | medium | low`
- **10 flag codes** → one Noul each (`fit`, `sen_hi`, `sen_lo`, `cred`, `shape`,
  `loc`, `thin`, `comp`, `open`, `rare`)
- **two fit scores** → `fit_capability` and `fit_targeting`, Score, 5 levels each

This is called from the `judge` edge-function action for a rescore and from
`judge_batch` for a whole search, and consumed by `judgeInto()`, `judgeMany()`
and `mergeJudgment()` in `index.html`.

### What Jev must never be asked

From TypeSafe's own published limitations for `jev-1.13`, both of which this
app would otherwise walk straight into:

- **Dates.** *"jev-1.13 reads dates as text, not as ordered quantities. Asking
  which of two dates comes first, how far apart they are, or whether one falls
  inside a window is unreliable."* So the posted-date window stays on DeepSeek
  (§2b), and the whole `due` / `closing` deadline law stays in ordinary code.
  This is permanent, not a staging decision.
- **Numbers between levels.** *"jev-1.13's score levels are weak in numerical
  calibration. It will not be able to help you reconstruct the exact number by
  interpolating."* So the interpolated `score` float a Score answer carries is
  **not** the number to use. Compose from `probabilities`, which is the
  calibrated part — `scoreFromDist()` in `index.html` does exactly this, and the
  eval asserts a deliberately absurd float is ignored.

Counting is a third: `years_experience` is read from the profile, never counted
out of a posting by the model.

### 2a. Move fit and reachability scoring from DeepSeek to TypeSafe

Today `sysPrompt()` asks DeepSeek for `s` (0–100 fit) and `re` (0–100
reachability) inside a batch-scored JSON prompt. These are ordered-scale
judgments with known level definitions — exactly what TypeSafe **Score** is for.

**Add the Score questions to the existing `judge.ts` request**, so all judgments
about one job travel in a single `systemOne` call. Two corrections to the
obvious version of this, both now built:

**Fit is two questions, not one.** "What they can do and are targeting" is two
judgments welded together, and TypeSafe's guidance is one narrow coherent
judgment per question. A candidate who can clearly do a job they are trying to
move away from is a different row from one reaching for a job they cannot yet
do, and a single number cannot say which. So: `fit_capability` and
`fit_targeting`, five levels each, combined in code by `FIT_W` (0.6 / 0.4 —
capability weighs more, because a role someone can do but is not aiming at is
still an application they could win, while the reverse is a wish).

**Reachability is not a question at all.** Asking it would mean one Score about
company prestige, credential demands, the seniority bar and openness to
outsiders all at once — four things Jev is *already* being asked separately as
`comp`, `cred`, `sen_hi` and `open`, whose probabilities were being thrown away
at the `FLAG_P` threshold. So it is composed from those four
(`reachFromJudgment`, weights in `REACH_W`): no extra question, no extra token,
and a weighting that can be argued with later for free.

That is the general principle this step is really about. **Store the raw
judgment; derive everything else in code.** `ai_judgment` on the job row holds
every probability unthresholded, so changing a weight, a threshold or the
ranking re-ranks a list that has already been judged **without spending a
credit** — the evidence has not changed, only what we do with it.

**The response shape changes:**

```json
{
  "confidence": "high",
  "confidence_score": 0.78,
  "confidence_probabilities": { "high": 0.8, "medium": 0.15, "low": 0.05 },
  "scores": {
    "fit_capability": { "score": 3.4, "probabilities": {"3": 0.6, "4": 0.4}, "confidence": 0.7 },
    "fit_targeting":  { "score": 1.2, "probabilities": {"1": 0.8, "2": 0.2}, "confidence": 0.6 }
  },
  "flags": [ { "code": "loc", "probability": 0.91 }, { "code": "comp", "probability": 0.12 } ]
}
```

Note `flags` carries **all ten**, not the ones that fired. Nothing is
thresholded server-side; the browser owns the policy and can change it for free.

**Why this is better than DeepSeek 0–100:**
- Each level is defined in natural language, not a bare number — "strong" has the
  same meaning across every job, not whatever the model felt that batch.
- Probabilities per level: if the model is torn between "workable" and "strong",
  the whole distribution is available, not a single number hiding the
  uncertainty. This matters more than it looks, because the interpolated float
  is the one part that cannot be trusted (see *What Jev must never be asked*).
- Confidence per score: separate from the posting-visibility confidence, this says
  how sure the model is about *this* judgment. Low confidence on fit
  + high fit score = "looks great but we're guessing" — actionable in a way that
  a bare 72 is not. Per TypeSafe, confidence is distribution concentration and
  **not** a licence to act, so it gates and escalates; it does not rank.
- All questions run in parallel in the same request. This is the cost story:
  TypeSafe's own measurement is **13 questions in one call at 12.2× cheaper and
  10× faster than 13 calls, with no accuracy change**, because the state
  dominates the tokens and is sent once. Adding fit to the existing twelve
  questions is very nearly free.

### 2b. Update `scoreBatch` to split DeepSeek and TypeSafe roles

`scoreBatch()` today asks DeepSeek for everything in one prompt. After this
change:

1. **DeepSeek retains only text extraction** from the scoring prompt:
   - `f` (flags): the `fact` field per flag — "on-site Berlin, no remote" — a
     10-word extract of what in THIS posting makes each flag true. This is
     text generation (summarising a sentence from the description), not a
     judgment.
   - `p` (posted date window): date extraction from posting text. This is
     information extraction, not classification.

   Remove `s`, `re`, `c`, and the flag codes themselves from the DeepSeek prompt.
   The prompt shrinks and the reply shrinks — output tokens are ~4× the cost of
   input, and dropping three fields per job from a 12-job batch saves materially.

2. **TypeSafe handles all structured judgments** for each job in the batch:
   - Fit → Score (5 levels)
   - Reachability → Score (5 levels)
   - Confidence → Choice `high | medium | low` (already done)
   - 10 flag codes → Noul each (already done)

   These are already in `judge.ts`; after adding fit + reach, the only change is
   calling it for every job in the batch rather than only during rescore.

3. **The merge in `scoreBatch` becomes:**
   ```
   For each job in the batch:
     TypeSafe → fit score, reach score, confidence, which flags are true
     DeepSeek → the fact (extract) for each true flag, posted date window
     Browser  → the quoted span for each fact (bestSentence, already local)
   ```

**Cost for `scoreAndCut` (bulk search scoring) — settled, not deferred.**

This used to say "measure it first, and if Jev per row exceeds the savings keep
the bulk path on DeepSeek." The published price sheet answers it without running
anything: **$0.042 per million input tokens, output free.** A judge state is a
posting capped at 4,000 chars plus the candidate object — roughly 1,200 tokens,
so about **$0.00005 per job, or $0.015 to judge a 300-row search.** DeepSeek runs
that path with `reasoning_effort: "high"` and thinking enabled, and pays for
output tokens. Jev wins the bulk path outright.

What made judging a search expensive was never Jev; it was **one credit per
`judge` call**. So the batching is in the right place now: `judge_batch` takes up
to `MAX_JUDGE_BATCH` postings, fans out server-side to one Jev call each (one
state per request is a hard API limit, and postings sharing a state would act as
distractors for each other), and **meters once**. A 300-row search is six charges
rather than three hundred — fewer than the 25 the DeepSeek scoring already costs.

`scoreAndCut` therefore judges everything it scored, in one pass **after** the
scoring loop rather than inside it, so a search pays per `JUDGE_BATCH` and not per
batch of `SCORE_BATCH`. A judgment that fails costs the flags, never the scoring
already paid for.

### 2c. Move `assessTrack` classifiers to TypeSafe

`assessTrack()` asks DeepSeek for a whole JSON object. Two fields have a known,
fixed answer set:

| Field | Values | TypeSafe type |
|-------|--------|---------------|
| `difficulty` | `easy / moderate / moonshot` | **Choice** |
| `mode` | `permanent / freelance / gig` | **Choice** |

**Add a new server action `assess_judge`** (or add to the existing `judge`
action) that sends these as a single `systemOne` request:

```ts
const assessQuestions = {
  difficulty: choice(
    "How realistic is it for `candidate` to get this kind of role?",
    {
      easy: "They could get this now. An unsurprising application given their profile.",
      moderate: "A real step across. Winnable, but competing against more direct experience.",
      moonshot: "An unusual hire. Worth well-aimed attempts, not a campaign.",
    }
  ),
  mode: choice(
    "What is the employment shape of this kind of role?",
    {
      permanent: "A salaried position at one employer.",
      freelance: "Project or contract work, potentially with several clients.",
      gig: "Platform task work, paid per task or delivery.",
    }
  ),
};
```

DeepSeek's prompt for `assessTrack` keeps only the text-generation fields:
`label`, `why`, `verdict`, `transfers`, `missing`, `bridge`, `titles`, `boards`.
The `difficulty` and `mode` fields are removed from the prompt and taken from
the TypeSafe response instead.

**Sequence:**
1. Fire TypeSafe (`assess_judge`) and DeepSeek (`assessTrack` minus
   difficulty/mode) in parallel — they are independent.
2. Merge: take `difficulty` and `mode` from TypeSafe, everything else from
   DeepSeek.

This saves DeepSeek output tokens (two fewer fields to generate) and makes the
classifiers deterministic: `difficulty` currently varies between runs because
DeepSeek sometimes calls the same role "moderate" or "moonshot" depending on its
mood. TypeSafe returns calibrated probabilities, so the app can threshold
consistently.

### 2d. Evidence extraction (the hard part)

For each fired flag, extract a supporting fact and a quoted span from
`posting.description` — by **selecting, not generating**. Split the description
into candidate sentences in code, then ask a Jev Noul/Choice over those
candidates: "which sentence supports `loc`?" The model picks an existing span;
it never writes new text. If no candidate clears the probability floor, leave
`span` empty.

The moat is the evidence, so an empty or wrong `span` is worse than no `span`.
Acceptance must assert spans actually come from the description.

**Note:** `bestSentence()` in `index.html` already does sentence-level span
matching from facts using token overlap — zero-cost, in the browser, with spans
that are substrings of the posting by construction. Jev-based span selection is
the v2 of this: more accurate, but costs per call. **Ship `bestSentence` as the
default; add Jev span selection as an upgrade path measured in 2e.**

### 2e. Eval set + feedback loop

- Build a small labeled set: (profile, job) → expected flags/scores. Measure
  flag precision/recall and fit/reach calibration against it. **Done** —
  `scripts/eval/cases.json`, ten cases, with `scripts/eval/baseline.json` as the
  floor a drop fails against.
- **This is the gate, and it is the one thing still open.** `ai_score` and
  `ai_reachability` are still DeepSeek's `s` and `re`. The composition from
  Jev's answers is built and unit-asserted (`scripts/eval-matcher.js` §8), and
  the raw judgment is stored on every judged row — but nothing switches over
  until the eval says the composed ranking is at least as good.
  That needs the cases **re-recorded against a live Jev run**, which is the one
  step here that costs money and cannot be faked: writing plausible-looking
  `recorded` answers by hand would make this gate meaningless while still
  printing ALL PASS. Re-record, compare, then flip.
- **Specifically measure TypeSafe Score accuracy vs DeepSeek 0–100** on the
  eval set. The five-level Score loses granularity, but gains calibrated
  probabilities. If the composite `rankOf` ranking is at least as good, TypeSafe
  wins. If not, the eval tells you which level definitions to tighten.
- **The cost question is closed** — see 2b. Nothing left to measure there.
- **Then tune the thresholds on this data, not on intuition.** `FLAG_P` is
  still 0.5, which is the worst available cut point: a Noul at 0.5 means the
  model is genuinely torn, and Nouls carry no separate confidence, so the
  probability is the whole signal. TypeSafe's guidance is to set thresholds per
  consequence — a false `loc` hides a good job, a false `open` is harmless — so
  these should not all be one number. Because the raw probabilities are stored,
  re-thresholding costs nothing to try.
- Add a lightweight outcome hook: when a user acts on a job (applied / rejected /
  ignored), log the outcome so the matcher can be tuned later. This is the loop
  that proves "genuinely better than LinkedIn."

### 2f. Remove the sentence from the classifier

Delete the `why` string from the scoring prompt output. Replace `ai_reason` with
`ai_flags` + `ai_facts`. Keep a UI-only template that renders a sentence from
the flags if the detail view still wants one; the model never returns prose.

### 2g. Acceptance

- Matcher returns structured output; no prose in the classifier.
- Fit is two TypeSafe Scores (5 ordered levels each) with probabilities ✅,
  composed into `ai_score` in code — **built, not yet switched on** (2e).
- Reachability is composed in code from four Nouls already being asked ✅,
  likewise not yet switched on.
- The raw judgment is stored per row, unthresholded, so every weight and
  threshold above can be changed without spending a credit ✅.
- Confidence is a TypeSafe Choice (already done) ✅, and `rankOf` uses its whole
  distribution where one exists, falling back to the ordinal where it does not ✅.
- All 10 flags are TypeSafe Nouls (already done) ✅.
- A whole search is judged, batched and metered per `JUDGE_BATCH` ✅.
- `assessTrack` difficulty and mode are TypeSafe Choices.
- DeepSeek prompts contain only text generation: facts, dates, assessment prose.
- Every new TypeSafe call is in `_shared/judge.ts` or a new `_shared/assess.ts`,
  never in `index.html` (the TypeSafe key stays server-side).
- Flags carry `fact` + `span`, and every `span` is a verbatim substring of the
  description.
- The eval set exists with a recorded baseline metric.
- `rankOf` ranking quality is at least as good as before (the eval gate).
- `node scripts/pipeline-map.js --check` is `ALL PASS`.

## Summary of what goes where after step 2

| Judgment | Answer set | Today | After |
|----------|------------|-------|-------|
| Fit score | 5 ordered levels ×2 | DeepSeek `s` 0–100 | **2 TypeSafe Scores**, weighted in code |
| Reachability | 4 yes/no signals | DeepSeek `re` 0–100 | **composed in code** from Nouls already asked |
| Confidence | `high / medium / low` | **TypeSafe Choice** ✅ | **TypeSafe Choice** ✅ |
| 10 flag codes | yes/no each | **TypeSafe Noul** ✅ | **TypeSafe Noul** ✅ |
| Flag facts | free-text extract | DeepSeek | DeepSeek (text gen) |
| Posted date | date window | DeepSeek | DeepSeek (extraction) |
| Track difficulty | `easy / moderate / moonshot` | DeepSeek | **TypeSafe Choice** |
| Track mode | `permanent / freelance / gig` | DeepSeek | **TypeSafe Choice** |
| Track label/verdict/titles/etc. | free text | DeepSeek | DeepSeek (text gen) |
| Profile extraction | free text | DeepSeek | DeepSeek (text gen) |
| Draft/outreach prose | free text | DeepSeek | DeepSeek (text gen) |

**Rule: if the output is one of a known set, it is a TypeSafe call. If the output
is text a human reads, it is a DeepSeek call. No exceptions.**

## Definition of done (steps 1–2)

- Data model normalized; the `triage:db` blob is retired or in a documented
  compatibility fallback.
- Roles + visibility fields exist (stubs are fine; employer behavior is not).
- Matcher returns structured, evidenced results with no prose.
- Every judgment with a finite answer set is a TypeSafe primitive (Score, Choice,
  or Noul), never an LLM text-generation call.
- Eval set + baseline metric committed.
- All selfchecks green: `pipeline-map --check`, `selfcheck-tokens.js`, and
  `cd ui-kit && npm run build && npm run selfcheck` if `ui-kit` is touched.

## FUTURE plan (saved — not in scope for this brief)

### Step 3 — First-party candidate acquisition + search layer

- Move off scraping as the primary supply: candidate signup + profile extraction
  is already in the app; make it the growth path. Scraping is a legal/strategic
  time bomb against LinkedIn (see `AUDIT.md`).
- Add search (Postgres FTS or `pgvector`): matching scores a known pair, search
  finds the pairs. The employer side needs this.

### Step 4 — Employer client + billing + trust

- A second React app on `ui-kit`: org/company profile, structured job posting
  (must-have / nice-to-have / honest gaps), candidate search (inverted matcher),
  and "request intro / apply" instead of a full inbox.
- Employer billing: per-post / per-reveal credits (Razorpay already wired), plus
  a refund/dispute policy for reveals.
- Trust & safety: employer/candidate verification, moderation, anti-scrape on
  reveals. Do not ship billing without this.

### Step 5 — Launch one vertical

- Win permanent tech in India first (current proof point), then freelance, then
  gig. The three `mode` values already exist; they are different data shapes,
  not labels.

## Decisions to revisit

- Per-row conflict policy (last-writer-wins vs `updated_at` guard) — decide in 1c.
- Whether the five-level TypeSafe Score for fit/reach holds ranking quality vs
  DeepSeek's 0–100 — the 2e eval gate decides; if not, tighten level definitions
  or add more levels before falling back to numeric.
- ~~Whether `scoreAndCut` (bulk search path) calls Jev per-row or stays on
  DeepSeek~~ — **closed.** It judges everything it scores, through `judge_batch`,
  metered per `JUDGE_BATCH` rather than per row. The published price
  ($0.042/M input, output free) made the measurement unnecessary.
- **What a judgment should cost in credits — open, and deliberately so.**
  `COST.llm` is one credit for a `judge` call of one job and for a `judge_batch`
  of fifty, which is defensible as "one hosted model call" but is not a
  considered price. The true cost of judging a 300-row search is about $0.015.
  Repricing is a billing decision, not a matcher one; nothing above depends on it.
- Whether the UI keeps a templated sentence or shows flags as pills only — 2f.
- Whether Jev-based span selection (2d) is worth the cost over `bestSentence()`'s
  free token-overlap approach — measure in 2e.
