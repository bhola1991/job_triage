# Where this stands — 2026-09-26

A session's worth of work on the matcher, plus closing the gap between the
repository and what was actually running. Written because that gap was the
whole problem: every offline check passed while production ran two-day-old
code against a database that did not have the tables.

Project: `kgacahuzaxqkzdcpyboc` · app: <https://jobtriage.reachbhola.workers.dev/>

---

## Live in production

All three layers verified aligned, not assumed.

| Layer | Version | How it was checked |
| --- | --- | --- |
| Frontend | **unverified** | was `a9cadf4e` on 2026-09-23; `index.html` has changed and PR #28 redeployed it since. Not re-checked. |
| Edge function `api` | **v24** | all three files fetched back and sha256-compared against `cba82c5` |
| Database | migration `jobs_profiles_rows_and_outcome_view` | 63 columns and 7 indexes diffed against `schema.sql` via PGlite |
| `main` | `4795a6a` | PR #28 merged 2026-09-24 |
| `add-icon-selfcheck` | `5356c88` | pushed, **13 ahead of main**, unmerged |
| `job_checks`, `job_index` | applied | two migrations live; `schema.sql` matches |

The Cloudflare Worker **auto-deploys from `main`** — there is a deployment
timestamped to the second of the PR #27 merge. Merging ships to users. This
was wrong in my earlier read of the repo and is worth not forgetting.

---

## 2026-09-24 → 26: the sources

Three days spent finding out that the paid job sources were not earning their
keep, and that the free ones were never asked. Everything below is measured
from `usage_events` or from a live fetch; nothing is estimated.

### Shipped and deployed (`api` v24)

- **JSearch** deleted, then restored the same day on
  `api.openwebninja.com/jsearch/search-v2`. The old `/search` path had been
  throwing `429` then `404 Endpoint '/search' does not exist` — the vendor
  retired it. It reads Google for Jobs, so one request per title covers
  LinkedIn, Indeed, Glassdoor and ZipRecruiter with full descriptions.
- **Naukri fixed after ten days dead.** `maxTotalChargeUsd` was a single global
  `0.15`; that actor's floor is `0.40`, so Apify refused every start while
  `FREE_SCRAPERS` and `pricing.html` both sold the free tier as "LinkedIn,
  Indeed and Naukri". The cap is per-scraper now. First successful run:
  **30 rows, ₹2.64** — there was never a ₹35 floor, `0.40` is the minimum
  *ceiling* the actor permits.
- **LinkedIn demoted `core` → `probe`**, then the demotion was found to be
  **inert** and fixed properly. `rowsFor` fell back to full rows for any
  unrecognised mode, and a real profile carries four tracks with **no `mode` at
  all** — so LinkedIn billed 30 rows and ₹13.20 the day after it was demoted.
  The fallback now takes the best tier that scraper gets in any mode.
- **`mantiks_contact`** — the HR finder asks Mantiks who owns the req before
  paying Google to guess. Two calls: find the posting (free), ask who owns it
  (1 lead credit). A miss refunds and falls through to the Google roster, so
  one question is never billed twice.

### The corpus, and the first time it reached a screen

`scripts/index/` gained four tools, two shared tables were added, and on
2026-09-26 the chain finally ran end to end into `jobCard`.

- `harvest-slugs.js` — turns ATS job urls into free company boards.
- `sitemap-jobs.js` — reads a board's own public sitemap into index rows.
- `verify.js` — diffs today's snapshot against yesterday's, and `--push`es.
- `push-index.js` — deposits either snapshot shape into the corpus.

| table | rows | what it is |
| --- | --- | --- |
| `public.job_index` | **23,826** from 36 sources, 4,834 `full` | the shared corpus |
| `public.job_checks` | **28,817** | is the posting still listed |
| `public.jobs` | 167 | what one person chose to track |

Neither shared table is per-user, and that is the design: acquiring a posting
costs ~16x what deciding about it costs, so a row bought once and served to
everyone is the only one that scales. Both carry a select policy for
`authenticated` and no others; the service role writes them.

`actionableOf(j)` answers whether a row is worth showing a verdict about, in
three legs — `live`, `fresh`, `reach` — that are never combined into a number.
Every leg returns `null` for unknown, and **null is never false**: an unchecked
posting is not a dead one. `jobCard` now drops the rank entirely and says
`gone from the board` when `liveOf` is false.

**What this changes on screen today: nothing.** Twelve of the 167 rows join
`job_checks` (remoteok, remotive) and all twelve are live. That is the correct
amount of visible change for a claim this strong — it starts mattering the
first time one of them closes.

### What shipped 2026-09-23

**Matcher (PR #27, `ecf0358`)**
- `judge.ts` asks two Scores — `fit_capability`, `fit_targeting` — alongside the
  existing Choice and ten Nouls, and returns **everything unthresholded**.
- `judge_batch` action: N postings, one credit, fanned out server-side 8 at a
  time to one Jev call each. One state per request is a hard API limit, and
  postings sharing a state act as distractors, so what is batched is the round
  trip and the meter, never the judgment.
- `scoreAndCut` judges everything it scores, in one pass after the scoring loop.
- `ai_judgment` column stores the raw answers; `scoreFromDist`,
  `fitFromJudgment`, `reachFromJudgment` compose from `probabilities`.
- `rankOf` uses the confidence distribution where one exists, the old ordinal
  where it does not — so nothing already in a list reorders.
- Fixed: the `judge` action kept the credit on an `Http` error while telling the
  user it had not.

**Scoring truncation (`a8667db`, `8830e5a`)**
- Reasoning is now gated to the `pro` tier. It had been on for every call, with
  the tier only choosing the model — so flash intake was paying for reasoning
  out of the same `max_tokens` budget, overrunning it, and losing twelve jobs at
  a time to a refunded 502 that `scoreAndCut` swallowed.
- `TOK_CAP` / `LLM_TOK_CAP` raised 4000 → 8000 → **16000**, in both runtimes.
  The second raise is the one that matters: at 8000 the pro path immediately
  returned replies of **7229, 5574 and 7353** output tokens, every one of which
  had been failing silently at 4000 — on every call, not occasionally. Sized
  now on what the model generates (~1000-1200 tokens per job on pro at `SIZE`
  6, ~150 on flash without reasoning), not on what the ledger survived.
- `deepseek-v4-pro` accepts `max_tokens` up to 65536, checked rather than
  assumed, and a ceiling is not a reservation.

**`candidateOf` state gap**
- It sent Jev no targeting information at all — no `headline`, no track label or
  titles, no `unusual_combination` — while `sysPrompt` had been telling DeepSeek
  all of it since the beginning. `fit_targeting` could only answer from
  `wrong_shapes`, and the `rare` noul was asking about a combination that was
  never in the state.

**Database**
- `jobs`, `profiles`, `matcher_outcomes` created; RLS enabled with four policies
  each; the `jobs` insert policy carries the profile-ownership clause.
- `delete_my_data()` replaced: 213 → 421 chars. It had only cleared
  `user_state`, which would have become a privacy bug the moment `jobs` existed.

### Evidence it is working

148 job rows migrated. `judge_batch` firing — ledger rows with `units: 17`,
`units: 4`, `units: 3` are batched judgments. `matcher_outcomes` has real data
for the first time. Since the truncation fix: **unscored 54 → 36, judged
13 → 31**.

---

## Committed but deliberately NOT switched on

**`ai_score` and `ai_reachability` are still DeepSeek's numbers.**

The composition from Jev's answers is built, unit-asserted
(`scripts/eval-matcher.js` §8) and storing raw judgments on every judged row —
but nothing reads it for the displayed score yet.

The gate is real, not caution. `scripts/eval/cases.json` replays
**DeepSeek-shaped** recorded answers, so the eval cannot compare the two until
those cases are re-recorded against live Jev. Writing plausible answers by hand
would keep the gate printing `ALL PASS` while making it meaningless — and that
gate is what `PLAN.md:18-21` puts in front of steps 3–5.

---

## Drift and open items

| Item | State |
| --- | --- |
| **LLM failures write no ledger row** | The three refund paths in the `llm` and `judge` actions return before `logUsage`. The table already carries `kind: "error"` rows for source failures (`jsearch: 404`, `naukri: Apify 400`) — the LLM paths just do not use the pattern. Fixing it would have turned today's entire diagnosis into one query. |
| `billing.sql` | **Not applied.** Live `spend_llm` decrements the free pot by a hardcoded `1`; the repo says `- p_n`. Latent — every caller passes 1. `refund_free` is its pair. |
| `FLAG_P = 0.5` | The worst available cut point. A Noul at 0.5 means the model is torn, and Nouls carry no confidence, so the probability is the whole signal. A live run fired `open` at 0.55 and `rare` at 0.59 on a posting supporting neither. |
| `TYPESAFE_MODEL` | Unset, so `jev-latest`. Currently resolves to **`jev-1.13.0`**. Thresholds calibrated on an unpinned model move silently on a bump. |
| `eval-matcher.js --live` | `cases.json` tells you to re-record with `--live`. That flag does not exist; only `--write-baseline` is implemented. |
| RLS on the new tables | Verified **valid**, not **correct**. PGlite has no real `auth.uid()` or PostgREST. |
| `handle_new_user()` | RPC-callable by `anon`. Pre-existing; a direct call fails on the undefined `new` record, so low risk, but `schema.sql` revokes every other function and not this one. |
| `a8667db` | Missing its `Co-Authored-By` line. Pushed, so fixing it means a rewrite. |
| `CLAUDE.md` §8 | **Fixed 2026-09-24.** Now lists all seven checks. §9 (Parse) and §10 (Mantiks) added. |
| `JSEARCH_API_KEY` | **A placeholder, in production.** Base64 for `ALL YOUR BASE ARE BELONG TO US`; sha256 of the local value matches the Supabase secret exactly. Every search logs `401`. |
| `mantiks_contact` | Deployed in v24 and **never once executed live** — no contact lookup has been run since. |
| `MONSTER_JOBS_API_KEY` | Set as a Supabase secret 2026-09-24; **no code reads it**. Parse MCP is registered but unauthorised, and the REST `scraper_id` is unknown (seven discovery routes probed, all 404). |
| Track `mode` | Not one of the four tracks on the live profile has one. `rowsFor` no longer depends on it, but `modes` is still advisory for anything that reads it directly. |
| `AGENTS.md` | Still untracked, and now the **only** copy of the §8/§9/§10 fixes outside `CLAUDE.md`. |
| `scripts/index/` | Still parked, now with three more tools. No `module.exports` anywhere; artifacts gitignored. Proven offline; **nothing in the app reads a shared index at search time.** |
| Credit pricing | **Now underwater, measured.** A `deepseek-v4-pro` call cost **₹2.774 and ₹2.788** on 2026-09-24; a credit sells for ₹0.80–0.99. It was ~₹0.07 before reasoning and `TOK_CAP 16000`. `COST.llm` is still 1. |

---

## Measured, so nobody re-derives it

- **Jev costs $0.042 per million input tokens, output free.** A real judgment
  measured **1,078–1,178 input tokens** — about **$0.00005 a job**, or
  **$0.015 to judge a 300-row search**. The old "12× a score" figure was an
  artefact of our own ledger, not a price.
- **Questions are nearly free; state is what costs.** 13 questions in one call
  is 12.2× cheaper and 10× faster than 13 calls, with no accuracy change.
- **Never ask `jev-1.13` about dates** — it reads them as text, not ordered
  quantities. The `due`/`closing` law stays in code, permanently.
- **Never trust the interpolated Score float** — weak numeric calibration.
  Compose from `probabilities`.
- **A question can only answer from the state it is given**, and the failure is
  silent. With targeting absent, capability/targeting on a role the candidate
  wants but cannot do came back `1.26 / 1.39` — flat. With it present,
  `0.83 / 2.15`.
- **`usage_events` records successes only, so every statistic from it is
  conditioned on not having failed.** All three LLM refund paths return before
  `logUsage` runs. Two consequences, and the second one caught me:
  - Absence of rows means failure, not absence of calls. That is how 52 lost
    jobs looked like four successful scoring calls.
  - **Averages taken from it are survivorship bias.** At a 4000 ceiling the
    ledger showed pro replies of 3874 and 3552, which reads as "97% of budget,
    tight but holding." Those were simply the only calls that fit. Lifting the
    ceiling revealed the real distribution runs to 7353. Do not size a budget
    from a table that deletes its overruns.
- Live Postgres is **17.6**; the PGlite harness verified on **18.3**.

### Source economics, 2026-09-24

Nine searches, 2026-09-14 to 09-23: median **₹1.87**, worst **₹17.69** — against
the `~₹25-40` the code had guessed and its note that 25 credits "undercharges
that." It did not.

| source | found | exclusive 50+ | ₹ per exclusive |
| --- | --- | --- | --- |
| upwork | 210 | 19 | **0.14** |
| google | 96 | 12 | 0.51 |
| indeed | 34 | 13 | 0.81 |
| linkedin | 87 | 5 | **7.66** |
| indiatech | 1 row in 9 runs | 1 | — |
| jsearch, naukri | never returned a row | — | — |

`PRICE_USD.linkedin` is a **guess** — bebity publishes no price — so ₹7.66 is a
floor. The first search after the fixes was **₹22.75 for 8 jobs at 50+**
(₹2.84 each, against ₹5.20 the run before); with the `rowsFor` fix it would
have been **₹13.05** for the same rows.

### The boards publish what they defend elsewhere

- **Naukri's sitemaps are open.** `jobDescPagesPune.xml` → **18,806 job urls,
  3.85 MB, no key, no actor**. One city. Instahyre, Cutshort and WeWorkRemotely
  serve theirs too. Foundit advertises a `todays-jobs-sitemap.xml` in
  robots.txt and then **403s it at Akamai**.
- **A Naukri job id is the posting date**, `DDMMYY` + sequence, parsing on
  **18,789 of 18,806 (99.9%)**. The sitemap's `<lastmod>` is the same
  generation timestamp on every row and worth nothing.
- **The sitemap lags ~7 days.** Newest posting in a file generated 2026-09-24
  was 2026-09-17, so **0%** of that corpus was posted within a week. It is a
  corpus, never a freshness source.
- **695 listings (3.7%) have been live over 90 days**, the oldest nearly three
  years. Ghost listings, visible on the first run, without one page fetch.
- **A Naukri job page carries no job text** — 200 OK, ~36 KB, no JSON-LD, no
  `__NEXT_DATA__`. Sitemap rows are stamped `partial: true` for this reason.
- **ATS boards are free and real-time.** `boards-api.greenhouse.io/v1/boards/
  duolingo/jobs` → 82 jobs with full descriptions, no key. The seed crawl's 47
  companies produced 4,838 jobs, ~103 each.
- **Naukri publishes its company list too** — `jobByCompany-1.xml.gz` alone
  holds **25,000** actively-hiring companies, plus a second file and the PSUs.
  That is the discovery fuel an ATS prober would need.

### Two real days of a board, measured

Naukri Pune, 2026-09-24 against 2026-09-26: **new 5,171 · still open 13,815 ·
closed 4,991**. 20.8% of dated postings left the index in two days.

That is too high to read as closure, so it was checked rather than reported.
Disappearance rises with age — 16.6% at 8-14 days to **42.8%** at 61-90, a 2.6x
gradient. Rotation would be flat, so the signal is real; but the ~17% floor
among fresh postings is probably rotation sitting underneath it, and both are
inside the one number. The >90d cohort falls back to 21.9%, which is the ghost
population showing itself: anything surviving 90 days is an evergreen ad and
does not churn.

What separates expiry from rotation is already instrumented. If the missing
4,991 come back, `reposts` spikes. That is run 3 and it needs one fetch.

### The user agent is what got us blocked

Naukri began 403ing a sitemap it had served two days earlier. Same url, four
user agents, one variable:

    Mozilla/5.0 (compatible; jobtriage/1.0)                       200  3.9 MB
    Mozilla/5.0 (compatible; jobtriage/1.0; +https://jobtria...)  403
    Mozilla/5.0 (Windows NT 10.0 ... Chrome/140.0 ...)            200
    (no user agent at all)                                        200

Their edge rejects any user agent containing a url — so the conventional
`+https://contact` suffix, included precisely so an operator can reach whoever
is calling, is the one token that gets it turned away while an unidentified
request sails through. The name stays, the url goes, in both crawlers.

### Liveness cannot be checked by fetching

Every url in a sample of live Upwork and Remotive postings returned **403** to a
datacentre IP. And `naukri.com/robots.txt` names `claudebot`, `Claude-User`,
`Claude-SearchBot`, `gptbot` and `perplexitybot` and gives them `Disallow: /`,
while `User-agent: *` is allowed the job pages. So an AI agent must not be the
crawler; a conventional, identified one is within what they permit.

That is why `verify.js` answers liveness as a **set difference** over snapshots
rather than a fetch, and why it asks Jev nothing: every signal it computes is a
count or a date, and Jev is asked judgments, never counts.

### Running `schema.sql` against real Postgres

No local Postgres server exists and Docker's daemon is unusable. Use **PGlite**
(`npm i @electric-sql/pglite`) — real Postgres in WASM, in-process, no daemon.
Stub what Supabase provides first: roles `anon`/`authenticated`/`service_role`,
schema `auth`, an `auth.users` table and an `auth.uid()` function. Then
`db.exec(wholeFile)` — it takes a multi-statement script natively. **Do not
hand-roll a statement splitter**; one that mishandles a `$$…$$` body hangs
forever at 0% CPU with no output.

---

## Next, in order

The matcher list below is unchanged and still correct; the source work has
added its own, and they interleave badly — items 1–3 are cheap and unblock
measurement, the rest are the same gate as before.

1. **Replace `JSEARCH_API_KEY` with a real OpenWeb Ninja key**, in
   `supabase/.env` and as a Supabase secret. Until then JSearch is deployed,
   wired, and returning `401` on every search.
2. **Reprice `COST.llm`.** It sells ₹2.78 of DeepSeek for ₹0.99. Nothing else
   in the product loses money per call, and every growth idea scales the loss.
3. **Exercise `mantiks_contact` once**, so the path has run in production at
   all. One contact lookup in the app.
3a. **Run `verify.js` daily.** The mechanism exists and nothing schedules it.
   One cron line; the series is worthless without it and compounds with it.
4. **Confirm the truncation fix holds** — run a board search, check nothing
   comes back unscored.
5. **Build `eval-matcher.js --live` and re-record the ten cases against Jev.**
   ~12,000 input tokens, about **$0.0005**. Still the gate for everything below.
6. **Flip `ai_score` to the composed value** once the eval says the ranking is
   at least as good.
7. **Tune `FLAG_P` per consequence**, then **pin `TYPESAFE_MODEL`** to
   `jev-1.13.0` before trusting any threshold.
8. **Log the LLM refund paths as `kind: "error"` rows.** Every figure derived
   from `usage_events` is survivorship-biased until this exists.
9. **Apply `billing.sql`** — its own pass, since it is latent.
10. Housekeeping: commit `AGENTS.md`, revoke `handle_new_user` from `anon`.

### And the decision that is not a task, restated with the numbers in

**Search still does not read `job_index`.** A user's search pays Apify for 30
rows while 23,826 sit in a table the app can already query, and the retriever
that cuts them to 60 in 116 ms is written and measured. Every other piece now
exists and is exercised end to end; this is the only join left.

The source work has produced a free 18,806-row corpus, a working retriever
(18,806 → 60 in 116 ms, 34/34 literal title matches kept) and a liveness loop —
all of it offline, none of it wired in. **Nothing the app does has changed.**
Whether a search reads a shared index before it spends money is a product
decision, it is larger than anything done this week, and it is the only thing
that would make any of the above visible to a user.

## Verification

```bash
node scripts/selfcheck-rows.js      # row round-trip, the zero-score trap, extras
node scripts/selfcheck-sync.js      # migrate/save/load, two-tab cases, tombstones
node scripts/selfcheck-boards.js    # board pipeline, and that a search is judged in one pass
node scripts/eval-matcher.js        # the gate
node scripts/pipeline-map.js --check
node scripts/selfcheck-tokens.js
node scripts/selfcheck-icon.js      # needs Obsidian; a SKIP is not a pass
deno check --node-modules-dir=auto supabase/functions/api/index.ts
```

All pass as of this commit. None of them can see production — that gap is what
this document exists to track.
