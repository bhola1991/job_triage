# Where this stands — 2026-10-04

Six days in which the corpus stopped being a thing that sat in a table and
became the cheapest source in the product, and in which four bugs were found by
looking at the ledger rather than at the code. Every number below was measured;
where something is unmeasured it says so.

All three layers verified against `cf3b267` rather than assumed.

Project: `kgacahuzaxqkzdcpyboc` · app: <https://jobtriage.reachbhola.workers.dev/>

---

## Live in production

| Layer | Version | How it was checked |
| --- | --- | --- |
| Frontend | **`cf3b267`** | live page fetched and sha256-compared: `bf3ba60e10f8` both sides. The Worker took ~30s from the push. |
| Edge function `api` | **v37** | all three files fetched back and compared — `index.ts` `b7ddded6…`, `judge.ts` `679d9b4d…`, `api-clients.ts` `e7d47522…`. All match. |
| Database | `ai_model` added to `public.jobs`; `search_index` carries the tier preference | columns and function body read back from the live catalogue |
| `main` | `cf3b267` | pushed, clean, `origin/main..main` empty |
| Supabase plan | **Pro** (`tier_pro`) | bought 2026-10-03. 8 GB against the 500 MB the free tier gave. |

### The corpus, as it actually sits

| | 2026-09-28 | now |
| --- | --- | --- |
| `job_index` | 347,092 | **364,345** |
| of which `full` (judgeable) | 8,082 | **22,962** |
| distinct sources | ~40 | **309** |
| ATS boards crawled | 44 | **324** |
| `job_checks` | 429,018 | 429,018 (76,857 closed) |
| `public.jobs` | 228 | 402 |
| database | 541 MB | 564 MB (of 8 GB) |

A `full` row carries a real description and can be judged. A `thin` row cannot,
and that distinction now has a settled answer behind it (below).

---

## The harness

```bash
node scripts/selfcheck-rows.js      # row round-trip, the zero-score trap, extras
node scripts/selfcheck-sync.js      # migrate/save/load, two-tab cases, tombstones
node scripts/selfcheck-boards.js    # board pipeline, and that a search is judged in one pass
node scripts/eval-matcher.js        # the gate, now with Jev measured beside DeepSeek
node scripts/pipeline-map.js --check
node scripts/selfcheck-tokens.js
node scripts/selfcheck-icon.js      # needs Obsidian; a SKIP is not a pass
deno check --node-modules-dir=auto supabase/functions/api/index.ts
cd ui-kit && npm run build && npm run selfcheck   # 17/17
```

All pass as of `cf3b267`, **checked by exit code**. That qualifier is new and it
is there because piping a check into `tail` hid a crash twice in one day: the
pipeline-map spec was committed with a syntax error because `node … | tail -1`
reports the pipe's success, not node's. Check `$?`, not the last line.

New tools, none of them gates:

| script | what it answers |
| --- | --- |
| `scripts/record-jev.ts` | records Jev's answers for the eval cases (Deno; needs `TYPESAFE_API_KEY`) |
| `scripts/record-deepseek.js` | scores the eval cases on a named tier and measures it (`DEEPSEEK_API_KEY`, from the **shell**, not `.env.local`) |
| `scripts/compare-tiers.js` | top-K overlap between two models' rankings, from `ai_model` |
| `scripts/index/probe-ats.js` | guesses a company's ATS board from its name, per region |
| `scripts/check-jsearch-overlap.js` | whether a source returns postings we already hold |

---

## Four bugs the ledger found

### An emoji cut in half cost 500 rows a batch

A push died at row 14,000 of 18,503 with `400 PGRST102 Empty or invalid json`
and `process.exit(1)` discarded the remaining 4,503. It looked like a truncated
connection, so retry and a halving fallback went in — and it failed at exactly
the same row, three retries and a split later. Bisecting against the live
endpoint found one Ashby posting that fails alone.

Its description ends `"corsi di lingua con Preply - \ud83c"`. Character 3,999 of
4,000 is the **high surrogate of an emoji**: `slice()` counts UTF-16 code units,
so the cap landed between a surrogate pair. `JSON.stringify` emits a lone
surrogate happily — it is legal JSON syntax — but a lone surrogate has **no
UTF-8 encoding**, so the bytes on the wire are not the JSON that was serialised
and PostgREST rejects all 500 rows rather than the one at fault.

Not one bad row: any description whose cut falls inside an emoji does it, and
job ads are full of them. Seven sites had it, including `depositIndex`, which
was deployed that morning and writes to the corpus on every search. All now go
through a `cut()` that drops a trailing unpaired surrogate.

### Failures wrote no ledger row, so absence meant failure

A real search logged 8 `yield` rows, 5 `api`, 4 `scrape`, 1 `error` — and not
one `llm` or `judge` row. Scoring produced nothing and there was no way to tell
from the data whether it had failed or had never been attempted.

The logging now lives **inside `refund()`**, not at the thirteen call sites,
because a path that refunds and forgets to log is the bug. `why` is a required
parameter for the same reason, and that choice paid immediately: the compiler
found all seven search and contact sites that would otherwise have stayed quiet.

Consequence worth keeping: every average ever taken from `usage_events` before
this was survivorship bias. At a 4,000-token ceiling the ledger showed pro
replies of 3,874 and 3,552 — "97% of budget, holding" — when those were simply
the only calls that fit.

### A rescore judged once per job, at one credit each

One run logged **168 `judge` calls** — 168 credits, about 2.5 Starter packs —
against 30 DeepSeek calls beside them. `judge_batch` takes 50 postings for one
credit, so `runScoring` now collects what it scored and judges the lot once,
which is what `scoreAndCut` has done since `ecf0358`. **168 credits became 4.**

### `kept_50` is zero whenever scoring is deferred

Yield rows were written at 18:15:18; scoring ran 18:33–19:07. The browser
reports yield *before* anything is scored, so `kept_50: 0` is a timing artefact
and not a matcher result — the jobs table has 164 rows at 50+, 94 at 65+, 41 at
75+. **Still unfixed**, and it matters because
`source_yield.inr_per_exclusive_50` is the metric sources are judged by.

---

## The thin rows: a settled answer

340,907 of the corpus rows are `thin` — title, company, city and an experience
range parsed out of a Naukri sitemap slug, no description, so they can be
shortlisted and never judged. Three independent routes to a description were
tried and all three are shut:

| route | result |
| --- | --- |
| Naukri's job API | `406 recaptcha required` |
| Naukri's job page | 200, ~36 KB, no job text — a client-rendered shell |
| Google for Jobs, via JSearch | **0 of 40** rows carry a naukri.com url |

The third is the new one, and the cause was already in this repo's own
measurements, unjoined: a Naukri job page carries **no JSON-LD**, and Google for
Jobs requires `JobPosting` structured data to ingest a posting. Naukri is not in
Google for Jobs; its sitemaps are SEO, not the Google feed `sitemap-jobs.js`
assumes.

So a thin row is a **lead** — title, company, city, date, and a url a human can
click, which works because the reCAPTCHA stops our server and not a browser.
Whether 340,907 of those earn their storage is a product call, not a technical
one; there is no engineering left to try. Decided on 2026-10-03 to keep them.

A fetch cannot settle liveness either: probing 12 closed and 12 open postings
returned 200 at ~35 KB for both, indistinguishable.

---

## What the corpus gained instead

- **Workable's own aggregate.** `jobs.workable.com/api/v1/jobs` reports
  **170,321 postings**, keyless, descriptions averaging ~4,200 characters. 21x
  the full rows the corpus held. Queried per title because `location` is
  honoured — `data engineer` + `India` returned 184, every row in a real Indian
  city, which is the region the slug prober measures at 0%. Page size caps at
  **ten** whatever `limit` says; 50 and 100 return an empty array, which would
  read as a dead source rather than a capped one.
- **The flywheel.** `job_index` was written by one thing, the offline crawler. A
  user spent 25 credits, the rows went to their own `public.jobs`, and the
  shared corpus learned nothing. Now `board_search` and `apify_items` both
  deposit — two points, because the API sources land inside the search and the
  scrapers finish on a later request. Full rows upsert; thin rows insert only
  when absent, so a short search snippet can never overwrite a crawler row that
  had a real description.
- **The ATS prober,** per region, because the hit rate is the whole question:

  | list | hit rate | jobs/board |
  | --- | --- | --- |
  | arbeitnow (Germany/EU) | **54.3%** (163/300) | ~86 |
  | himalayas (US remote) | 19.5% (126/647) | ~108 |
  | mycareersfuture (SG) | 0% | — |
  | naukri-sitemap (India) | 0% | — |

  India at 0% means **0% on six American platforms**, not 0% on an ATS. Keka,
  Darwinbox, Zoho Recruit and Freshteam were probed and none of the guessed
  endpoint patterns exposed a keyless board — `zohorecruit` and `darwinbox`
  returned identical-size HTML for all ten test slugs, i.e. a catch-all page.
  Unpromising with those patterns rather than settled; finding the real ones
  needs a browser on an Indian careers page.
- **`apply.workable.com` is not crawled per company.** It caps per **day**:
  429 with `Retry-After: 85902`, 23.9 hours, tripped by one probe and two
  crawls in an afternoon. Eight boards against a 24-hour window is not a crawl.
  Costs nothing — the aggregate is a different host with no such limit.
- **LinkedIn's scraper is gone.** ₹7.66 per exclusive 50+ posting against ₹0.81
  for Indeed and ₹0.14 for Upwork, and ₹0.44/row was a guess because bebity
  publishes no price. It was kept for 5 jobs nothing else found; JSearch now
  returns LinkedIn as its **largest** publisher, 13 of 40 rows, with
  descriptions. `pricing.html` still promises LinkedIn and is still truthful.

---

## The matcher: measured, and deliberately not flipped

`ai_score` is **still DeepSeek's number**, and now for a stated reason rather
than a missing test.

`scripts/record-jev.ts` captures Jev's answers to the ten eval cases beside the
DeepSeek ones; section 9 of the eval replays both against the same hand-written
bands. On the same ten labels:

| | DeepSeek | Jev (ungated) | Jev (gated) |
| --- | --- | --- | --- |
| calibration | 1.000 | 0.400 | **0.800** |
| flag precision | 1.000 | 0.483 | 0.483 |
| flag recall | 1.000 | 0.933 | 0.933 |

The gating was a real hole. `fitFromJudgment` composed capability and targeting
and nothing else, so `loc-onsite-berlin` composed to **fit 92 against a label of
0–35** — a posting in the wrong city with no remote allowance, which Jev had
flagged `loc` at 0.95 right beside it. Two codes now gate, and which two was
measured:

- **`loc`** — eligibility. Fit scales by `(1 - strength)`.
- **`thin`** — abstention, not disqualification. Pulled toward the middle,
  symmetrically, because "cannot tell" is honest in both directions.

**`cred` deliberately does not gate**, and that one is counter-intuitive enough
to write down: `cred-degree` carries `cred` at 0.96 and its label wants fit
55–95. A credential gate does not stop someone doing the work, it stops them
clearing the filter — reachability, where `cred` already carries −0.30.

The gate floors at `FLAG_P` rather than scaling from zero, because the first
version let `rare-combination`'s `loc` of 0.06 and `thin` of 0.14 — noise —
take its fit from 88 to 73 and out of band. A probability the app would not
raise as a flag must not move a score.

**Three reasons it is still not flipped:**

1. Two cases remain out of band by 4 and 3 points, in **opposite** directions —
   `sen-lo-junior` fit 69 wanting ≤65 with `sen_lo` 0.97, `sen-hi-principal`
   fit 27 wanting ≥30 with `sen_hi` 0.96. No seniority term fixes both, and
   chasing 3 points on ten cases is fitting noise.
2. **The holdout is contaminated.** The split is 8 tune / 2 holdout, and
   `cred-degree` is one of the two — it is the case that taught me not to gate
   `cred`. It passes before and after, but it was looked at while designing, so
   it should not be quoted as a clean result.
3. DeepSeek's 1.000 is **not independent evidence**. Ten labels and ten recorded
   DeepSeek answers were plausibly authored together, while Jev's 0.800 was
   measured against labels it never saw.

More cases and an uncontaminated holdout come before the flip.

### Flash replaced pro, on a measurement

Same ten postings, one request each, through the app's own `sysPrompt`:

| | flash | pro |
| --- | --- | --- |
| calibration | **0.900** | **0.900** |
| flag recall | 0.867 | 0.867 |
| flag precision | 0.684 | 0.765 |
| ₹ per posting | **0.171** | 0.475 |

Identical on the score, identical on recall. Pro's only edge is flag precision
and **it does not reach a user**: `mergeJudgment` discards DeepSeek's flag set
outright whenever a judgement exists and keeps only its `fact` strings, so
Jev's probabilities decide which flags appear on every judged row. Pro was
being paid 2.8x a posting for a field that is overwritten.

Both scoring paths are now flash. The default for prose a user reads — a
direction verdict, an outreach draft — stays pro, and was **not** measured: only
structured scoring against a fixed rubric was.

### Why DeepSeek is still in the loop at all

Jev cannot replace all of it, and the reasons are in the notes:

- **Dates** — never ask `jev-1.13` about dates; it reads them as text, not
  ordered quantities. The posted-date window stays DeepSeek's.
- **Evidence quotes** — Jev returns a probability, not a sentence. The flag
  *facts* come from DeepSeek prose, with spans matched in the browser.
- **The raw Score float** — weakly calibrated, which is why the composition
  reads `probabilities` instead.

---

## Drift and open items

| Item | State |
| --- | --- |
| **Nothing schedules `refresh.sh`** | Units written and validated at `~/.config/systemd/user/jobtriage-refresh.{service,timer}`, still **disabled**. `cron` is not installed and there are no systemd user timers. The closure logic is sound and the push now survives a bad chunk, so the remaining question was never the code. |
| **`kept_50` reads 0 on deferred scoring** | The browser reports yield before scoring finishes, so `source_yield.inr_per_exclusive_50` is wrong for any such search. Unfixed. |
| **`ai_model` is recorded but empty** | 0 of 402 rows carry it: every scored row predates the column. It also answers "which tier built this list", **not** an A/B — a row holds one `ai_model` and one `ai_score`, the last to write them, so scoring twice reads as whichever went second. A real comparison wants both readings kept (a `score_trials` table), which is the same instrumentation `eval-matcher --live` needs. |
| **`judge` action has no caller** | `judgeInto` and `judgeJob` are reachable from no button since `cf3b267`. Annotated rather than deleted: `judgeJob` holds the only `hosted('judge')` call site and `pipeline-map` asserts those map 1:1 onto the actions, so deleting them means retiring the action too — a deliberate change to a deployed endpoint. |
| **`matcher_outcomes` has 10 rows** | The ground truth. Ten rows cannot separate two rankers, which is why every model comparison above is agreement rather than correctness. |
| `FLAG_P = 0.5` | Now measured, not suspected: Jev's flag precision is **0.483** at this cut point, with `open` and `rare` firing on six cases of ten. Those flags are already live through `mergeJudgment`. |
| `TYPESAFE_MODEL` | Unset, so `jev-latest`, currently resolving to `jev-1.13.0`. Thresholds calibrated on an unpinned model move silently on a bump. |
| Three SmartRecruiters boards | Return exactly 100 rows, which is a page cap — there is more behind them unread. |
| `MONSTER_JOBS_API_KEY` | Set as a secret; no code reads it. Parse MCP registered but unauthorised. Measure it against JSearch, which reaches Foundit free. |
| `mantiks_contact` | Deployed and **never once executed live**. |
| RLS on the shared tables | `job_index` and `job_checks` are `select` to `authenticated` with no other policy — shared by design, which is the point of the corpus. **`public.jobs` and `public.profiles` have never been exercised against a real `auth.uid()` through PostgREST**, and that is the thing to verify before 20–30 users, not the corpus. |
| `handle_new_user()` | Still RPC-callable by `anon`. |
| `a8667db` | Missing its `Co-Authored-By`. Pushed, so fixing it means a rewrite. |

---

## Measured, so nobody re-derives it

- **A lone surrogate has no UTF-8 encoding.** `JSON.stringify` will emit one
  and the HTTP body will then not be the JSON you serialised. Truncate text
  with something that refuses to split a surrogate pair.
- **PostgREST says "Empty or invalid json" when a body arrives malformed**, and
  rejects the whole batch rather than the offending row. A reproducible failure
  at the same row is the data; a moving one is the wire.
- **Jev costs $0.042 per million input tokens, output free** — ~1,100 input
  tokens a judgment, about $0.00005 a job.
- **96% of a pro scoring call is output tokens.** ₹74.30 over 30 calls was
  ₹2.88 of input and ₹71.42 of output. The prompt cache works: 61% of input
  was cached.
- **DeepSeek flash vs pro, per posting: ₹0.171 vs ₹0.475.** Same calibration.
- **Questions are nearly free; state is what costs.** 13 questions in one call
  is 12.2x cheaper and 10x faster than 13 calls.
- **A question can only answer from the state it is given**, and the failure is
  silent.
- **`usage_events` recorded successes only** until `0801b10`. Averages taken
  from it before that are survivorship bias.
- **Naukri job ids are the posting date**, `DDMMYY` + sequence, parsing on
  99.9% of sitemap rows.
- **Naukri's sitemaps carry no JSON-LD**, so Google for Jobs cannot ingest them.
- **The user agent is what got us blocked**: Naukri's edge 403s any UA
  containing a url, so the conventional `+https://contact` suffix is the one
  token that gets it turned away.
- **`pgrep obsidian` finds nothing while Obsidian runs** — the Arch package runs
  as `electron43`. And `window.mermaid` does not exist until a diagram has
  rendered once, so `--render-check` on a cold app reports a missing parser that
  is really a cold start.
- **Check a harness by exit code.** `node check.js | tail -1` reports the pipe.
- Live Postgres is **17.6**; the PGlite harness verified on **18.3**.

---

## Next, in order

1. **Schedule `refresh.sh`.** One timer, already written and validated. The
   corpus decays daily without it and `index_search` now reads what it produces.
2. **Verify RLS on `public.jobs` and `public.profiles` with two real accounts**
   — prove through PostgREST that user A cannot read user B's pipeline. This is
   the one thing that gates letting people in, and PGlite cannot test it.
3. **Fix `kept_50`.** Report yield after scoring, or the source economics the
   whole acquisition strategy rests on stay wrong.
4. **Write more eval cases with a clean holdout**, from the 22,962 judgeable
   rows now available. Everything about the matcher is blocked behind ten cases.
5. **Build `score_trials`** so a model comparison is possible at all, then
   answer whether pro is ever worth it for prose.
6. Then: retire the `judge` action, pin `TYPESAFE_MODEL`, tune `FLAG_P` per
   consequence, read the SmartRecruiters pages behind the 100-row cap.

### The decision that is not a task

The corpus is no longer the open question — it has 22,962 judgeable rows, 309
sources, a flywheel that grows it on every paid search, and a settled answer on
the 340,907 rows that cannot be improved. What has not moved is **who it is
for**: `public.jobs` holds 402 rows and `matcher_outcomes` holds 10, so every
quality claim in this document is agreement between models rather than evidence
about whether anyone got a job. Ten outcomes is the smallest number in here and
the only one that would make the rest mean anything.
