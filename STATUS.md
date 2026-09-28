# Where this stands — 2026-09-28

The corpus reached the product. `1dc8426` made a search read 353,604
already-paid-for rows before it spends anything, which is the one join the
2026-09-26 edition of this file ended by calling "the only thing that would
make any of the above visible to a user." It is wired, deployed and answering.

Also: the gap this document exists to track is, today, closed. All three
layers were compared byte-for-byte against `38b1bbe` rather than assumed —
including the frontend, which has been carrying an **unverified** row since
2026-09-23.

Project: `kgacahuzaxqkzdcpyboc` · app: <https://jobtriage.reachbhola.workers.dev/>

---

## Live in production

| Layer | Version | How it was checked |
| --- | --- | --- |
| Frontend | **`38b1bbe`** | live page fetched and sha256-compared against local `index.html`: `b787a13e…` both sides, 319,431 bytes. Identical. |
| Edge function `api` | **v27** | all three files fetched back and sha256-compared against `38b1bbe` — `index.ts` `221d4168…`, `judge.ts` `679d9b4d…`, `api-clients.ts` `e7d47522…`. All three match. |
| Database | `job_index` / `job_checks` current | columns diffed against `schema.sql` (the dropped `url` is gone), `search_index` and `prune_index` both present, 9 indexes including the `simple` GIN on `title` |
| `main` | `38b1bbe` | clean, fully pushed; `origin/main..main` empty |
| `add-icon-selfcheck` | merged | PR #29 (`9b112ed`), 2026-09-26. No longer divergent. |

The Cloudflare Worker **auto-deploys from `main`** — merging ships to users.
The edge function does not; it is deployed by hand, and v27 landing on 09-27
is what makes the table above true rather than hopeful.

### The corpus, as it actually sits

| table | rows | note |
| --- | --- | --- |
| `public.job_index` | **353,604** | 4,834 `full`, the rest `thin` |
| `public.job_checks` | **358,541** | 4,937 closed |
| `public.jobs` | **228** | what people chose to track (167 on 09-26) |
| database | **379 MB** | of the 500 MB tier — 76% |

| source | rows | full |
| --- | --- | --- |
| naukri-sitemap | 348,764 | 0 |
| ashby:openai | 830 | 830 |
| greenhouse:anthropic | 619 | 619 |
| lever:palantir | 321 | 321 |
| arbeitnow | 250 | 250 |
| …31 more ATS boards | ~2,800 | all full |

---

## 2026-09-27: the corpus reached the product

### `index_search` — a search now starts with sixty free rows

It runs **before** `board_search` and does not replace it: outside Naukri's
latest-jd feed the corpus lags about a week, so the paid path still covers the
freshest rows and the sources with no free index. It is free because the rows
were acquired once and are served to everyone, so there is no vendor call to
meter. `PRICE_USD` gains `index: 0` — listed rather than omitted, so
`search_report` accepts it and `source_yield` can rank the free corpus against
the sources that cost money. That comparison is the whole argument.

Two things in the query were measured rather than reasoned about, and both were
wrong on the first attempt:

- **`ILIKE` over 353,604 rows took 5.6 seconds.** A GIN index on
  `to_tsvector('simple', title)` fixes the scan — `simple` and not `english`
  because stemming merges *Engineering Manager* with *Engineer*, and they are
  different jobs. The index alone still only reached 3.6s, because ~1,949
  matches each cost a 1.4ms lookup into a 151 MB `job_checks`. Narrowing to the
  final candidates **before** that join takes it to **25ms** — same rows, same
  indexes, **217×**.
- **Then it was fast and useless.** The first results were nine copies of one
  posting — a recruiter listing the same role in nine cities — while the second
  requested title returned nothing, because the flood took every slot.
  `dedup_key` already existed for this and the query was not using it. One row
  per title+company now, with the collapsed count returned so the caller can say
  "also in 8 other cities" instead of hiding them.

The join is `LEFT` and admits rows with no check at all, the same rule `liveOf`
follows in the app: **unchecked is not dead**. Hiding unverified rows would hide
most of the corpus.

### Three channels, and only paying for the third

The first live search returned nothing from the corpus. The ledger said why:
the track was *AI Systems Builder*, whose titles are "AI Systems Developer",
"No-Code Developer", "LLM Application Developer" — `phraseto_tsquery` demands
those words in that order and the corpus has none of them. The other three
tracks returned 60, 60 and 58 rows from the same function on the same data. So
it was all-or-nothing, and it failed hardest on emerging roles, where titles
vary most — the worst possible place for a strict matcher.

| channel | rule |
| --- | --- |
| `phrase` | those words in that order |
| `words` | every word of one title, any order |
| `partial` | any word, ranked by `ts_rank` |

`words` alone took the AI track from 0 to 5; `partial` takes it to 60, on
target ("ai developer agentic workflow automation", "ai agent developer ai
automation"). **The third channel is only paid for when needed, and that is not
a refinement**: running all three unconditionally cost **3.47 seconds** on a
track phrase matching had answered in 49 ms, because "Operations Manager"
widens to `operations|manager|supply|chain` and that is most of the corpus — a
70× regression on the common case to fix the rare one. A cheap probe counts
strict hits with a `LIMIT` so the scan exits early, and only widens if they
cannot fill the page.

End to end over HTTP: ops **0.64s** warm, founder 0.52s, content 1.10s, the
widened AI path 3.78s — against a paid search that takes about two minutes and
produces its rows *after*, not before.

`ts_rank` is not BM25: no idf, so "developer" and "llm" weigh alike. That is the
known weakness of the third channel and the reason it ranks last.

### The 57,581 false closures

The first unattended `refresh.sh` run reported 57,581 closures in a day. Most
were wrong, and the failure is worth keeping written down because it is silent
and expensive.

Naukri served `sitemap-latest-jd-pages-1.xml.gz` as **ten bytes** mid-
regeneration. The crawler skipped it and said so; `verify.js` never heard, saw
25,000 postings missing from its snapshot, and recorded them closed. Those jobs
are alive. False closures propagate: the app shows "gone from the board" on a
live role, and `prune_index` deletes it thirty days later.

**A count-based floor would not have caught it.** Every Naukri file carries the
same source tag, so nineteen files minus one still reads as 348,764 → 325,251,
or 93% — comfortably inside noise. The signal was never in the totals.

So closure is **coverage-aware** instead of statistical. `sitemap-jobs.js`
stamps each row with the file it came from, and `verify.js` will only close a
row whose own file was read this run. Everything else is reported `held`,
because absence from a file nobody opened is not evidence of anything. It is
the rule already in place one level up — verifying Pune must never close Mumbai
— applied per file rather than per board.

The part tag protects rows that carry one, and the rows already in the store did
not, so `sitemap-jobs.js` also writes a **sidecar** next to every snapshot
listing the parts it read and the ones it could not. When anything failed, no
untagged row is closable that run. The sidecar is written even on a clean run,
because an absent file would be ambiguous between "nothing failed" and "old
crawler". Measured against the same broken file:

    before   closed 57,581   held      0
    after    closed      0   held 58,385

Same input, opposite outcome, and the second one is right.

**Backfill status, measured today:** the local store holds 396,244 jobs, of
which **325,251 (82%) now carry a part tag** and 70,993 do not. Closed is 4,937,
matching production exactly. One more clean full run closes the remainder.

### `prune_index(30)`, so the cron has no expiry date

A board's live inventory does not grow — Naukri holds ~350k postings and takes
in ~10,088 a day while a comparable number expire. Only the graveyard grows, and
the graveyard is what fills the tier: a job costs ~607 bytes in `job_index` and
~443 in `job_checks`, so ten days of intake is ~128 MB. A cron without this has
about two weeks in it, and fails in the worst way — push errors stop
`refresh.sh` on `set -e`, so ingestion and verification stop on the same day.

Three rules, all asserted against real Postgres before it was applied: a posting
someone **tracks** is never touched; only `closed_on` rows go, because "not
checked" must never read as "gone"; `p_days` floors at 7 so a fat-fingered 0
cannot wipe the week's work. The live call returns 0 deletions today because
nothing has been closed for a month yet, which is the correct answer rather than
a no-op.

### Two keyless boards, one command, and the `url` column

`scripts/index/sources-catalogue.csv` is committed: **42 channels, 26 free**. Of
those needing no key and no registration, two answered and are wired —
**Himalayas** (96,023 postings, remote-first) and **MyCareersFuture** (91,026,
Singapore government). Bundesagentur 403s even with the client key bundesAPI
documents, and UK Find a job wants registration; both are left in the catalogue
with what actually happened, which is more useful than a list of what ought to
work.

Page size is the source's choice — Himalayas caps at 20 a page whatever `limit`
says, so 96k would be 4,800 requests. The caps exist for space, not politeness:
these are `full` rows carrying descriptions, and 187k of them at the 4,000-char
cap is roughly 750 MB against a 500 MB database.

`refresh.sh` is the whole pass in five steps — Naukri's cities, Naukri's expired
list, the ATS boards and keyless APIs, deposit, verify. Shell rather than node
because each step is already a program with its own flags.

Two bugs found by *running* it rather than reading it: `ingest.js` had been a
**syntax error since `a19d84c`** — a comment sat inside an object literal and ate
the closing brace, and nothing caught it because no check compiles `ingest.js`.
And `refresh.sh`'s first draft passed a `--push` that `push-index.js` does not
have.

The **`url` column was dropped**: `job_key` is `'u:' || lower(url)` for every row
— checked across all 353,604 — so it was a second copy of the primary key, and
that key is already the largest consumer of space here. Dropping it returned
**81 MB** and took the database from 90% of its tier to 74%. Readers rebuild it
with `substring(job_key from 3)`; the rebuild is lowercased, which is safe
because 99 rows differ in case and every one differs only inside the hostname.

---

## 2026-09-24 → 26: the sources

Three days spent finding out that the paid job sources were not earning their
keep, and that the free ones were never asked.

### Shipped and deployed

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
- **The two models priced apart** (`6f0019a`). One price for two models that
  differ 4× was the actual defect, not the price being low. Measured over 38
  calls, 2026-09-22..26: `deepseek-v4-pro` median ₹1.368 / mean ₹1.680 / p90
  ₹2.750; `deepseek-flash` median ₹0.291 / mean ₹0.425 / p90 ₹1.038. A credit
  sells for ₹0.798–0.99, so flash at one credit already carries ~47% margin and
  does not move; **pro goes to three** — ₹2.39–2.97 against a mean of ₹1.68, the
  same 30–43% band `boardSearch` runs at. Not four: that would be 90% margin on
  the median. `COST.llm` stays 1 and is now only the Jev actions.

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
  had been failing silently at 4000 — on every call, not occasionally.
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

This is unchanged since 2026-09-23 and is the largest remaining piece of work.

---

## Drift and open items

| Item | State |
| --- | --- |
| **Nothing schedules `verify.js`** | The mechanism exists, `refresh.sh` runs the whole pass, and no cron runs it. `crontab` is **not installed** on this machine and there are no systemd user timers. The closure series is worthless without a daily run and compounds with one. Now the highest-leverage cheap item, because `index_search` reads what it produces. |
| **Database at 379 MB of 500 MB** | 76% of the tier. `prune_index` exists and deletes nothing yet — nothing has been closed thirty days. The two new boards would add `full` rows, which are the expensive kind. |
| **Himalayas / MyCareersFuture never run against production** | Wired in `8adb40f`; neither source appears in `job_index`. Deployed, unexercised. |
| **Part-tag backfill incomplete** | 70,993 of 396,244 store rows still carry no part, so the coverage guard cannot protect them. One clean full run closes it. |
| **LLM failures write no ledger row** | The three refund paths in the `llm` and `judge` actions return before `logUsage`. The table carries `kind: "error"` rows for source failures — the LLM paths just do not use the pattern. There is exactly one `kind: "error"` site in the edge function, and it is not one of these. |
| `FLAG_P = 0.5` | The worst available cut point. A Noul at 0.5 means the model is torn, and Nouls carry no confidence, so the probability is the whole signal. A live run fired `open` at 0.55 and `rare` at 0.59 on a posting supporting neither. |
| `TYPESAFE_MODEL` | Unset, so `jev-latest`. Currently resolves to **`jev-1.13.0`**. Thresholds calibrated on an unpinned model move silently on a bump. |
| `eval-matcher.js --live` | `cases.json` tells you to re-record with `--live`. That flag does not exist; only `--write-baseline` is implemented. |
| RLS on the new tables | Verified **valid**, not **correct**. PGlite has no real `auth.uid()` or PostgREST. |
| `handle_new_user()` | RPC-callable by `anon`. Pre-existing; a direct call fails on the undefined `new` record, so low risk, but `schema.sql` revokes every other function and not this one. |
| `a8667db` | Missing its `Co-Authored-By` line. Pushed, so fixing it means a rewrite. |
| `JSEARCH_API_KEY` | **A placeholder, in production.** Base64 for `ALL YOUR BASE ARE BELONG TO US`. Every search logs `401`. Not re-verified today; no commit since has touched it. |
| `mantiks_contact` | Deployed and **never once executed live** — no contact lookup has been run since. |
| `MONSTER_JOBS_API_KEY` | Set as a Supabase secret 2026-09-24; **no code reads it**. Parse MCP is registered but unauthorised, and the REST `scraper_id` is unknown (seven discovery routes probed, all 404). |
| Track `mode` | Not one of the four tracks on the live profile has one. `rowsFor` no longer depends on it, but `modes` is still advisory for anything that reads it directly. |
| `ts_rank` is not BM25 | No idf in the `partial` channel, so "developer" and "llm" weigh alike. Known weakness, ranked last for that reason. |

### Resolved since 2026-09-26

| Item | Resolution |
| --- | --- |
| Frontend version unverified | **Verified today** — live page sha256-identical to local `index.html`. |
| Credit pricing underwater | **Fixed** (`6f0019a`): pro at three credits, flash at one, both measured. |
| `billing.sql` not applied | **Applied** — live `spend_llm` and `refund_free` both reference `p_n`. |
| `AGENTS.md` untracked | **Committed** (`a7e6e02`), along with `AUDIT.md`, `PLAN.md` and this file. |
| `add-icon-selfcheck` unmerged | **Merged** as PR #29. |
| `CLAUDE.md` §8 incomplete | Fixed 2026-09-24; §9 (Parse) and §10 (Mantiks) added. |
| Search does not read `job_index` | **Done** (`1dc8426`, `38b1bbe`) — the subject of this edition. |

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
  conditioned on not having failed.** Two consequences, and the second one
  caught me:
  - Absence of rows means failure, not absence of calls. That is how 52 lost
    jobs looked like four successful scoring calls.
  - **Averages taken from it are survivorship bias.** At a 4000 ceiling the
    ledger showed pro replies of 3874 and 3552, which reads as "97% of budget,
    tight but holding." Those were simply the only calls that fit. Lifting the
    ceiling revealed the real distribution runs to 7353. Do not size a budget
    from a table that deletes its overruns.
- **Narrow before you join.** The corpus query went 5.6s → 3.6s (GIN) → 25ms by
  cutting to final candidates before touching `job_checks`. The index was the
  smaller half of the win.
- **Stemming is not free.** `to_tsvector('english')` merges *Engineering
  Manager* with *Engineer*. `simple` is the right config for job titles.
- **A strict matcher fails hardest where titles vary most.** Phrase-only
  retrieval returned 60/60/58 on three tracks and **0** on the emerging-role
  one. Widening unconditionally is a 70× regression on the common case, so the
  wide channel has to be probed for, not always run.
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
| **index** | — | — | **0** |

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

### Two real days of a board, measured

Naukri Pune, 2026-09-24 against 2026-09-26: **new 5,171 · still open 13,815 ·
closed 4,991**. 20.8% of dated postings left the index in two days.

That is too high to read as closure, so it was checked rather than reported.
Disappearance rises with age — 16.6% at 8-14 days to **42.8%** at 61-90, a 2.6×
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

1. **Schedule `refresh.sh` daily.** One cron line. Everything downstream —
   closure, `prune_index`, and now `index_search`'s freshness — is worth nothing
   without it, and `cron` is not even installed on this machine.
2. **Watch the 379 MB.** The tier is 500 MB, `prune_index` starts deleting only
   once something has been closed thirty days, and the two new boards add `full`
   rows. Decide the cap before the cron finds it.
3. **Run the two new boards once**, so Himalayas and MyCareersFuture have
   executed in production at all.
4. **One clean full run to finish the part-tag backfill** — 70,993 rows still
   unprotected by the coverage guard.
5. **Replace `JSEARCH_API_KEY` with a real OpenWeb Ninja key**, in
   `supabase/.env` and as a Supabase secret. Until then JSearch is deployed,
   wired, and returning `401` on every search.
6. **Exercise `mantiks_contact` once.** One contact lookup in the app.
7. **Confirm the truncation fix holds** — run a board search, check nothing
   comes back unscored.
8. **Build `eval-matcher.js --live` and re-record the ten cases against Jev.**
   ~12,000 input tokens, about **$0.0005**. Still the gate for everything below.
9. **Flip `ai_score` to the composed value** once the eval says the ranking is
   at least as good.
10. **Tune `FLAG_P` per consequence**, then **pin `TYPESAFE_MODEL`** to
    `jev-1.13.0` before trusting any threshold.
11. **Log the LLM refund paths as `kind: "error"` rows.** Every figure derived
    from `usage_events` is survivorship-biased until this exists.
12. Housekeeping: revoke `handle_new_user` from `anon`.

### The decision that is not a task, restated

Last edition this slot held "search still does not read `job_index`." It does
now. What replaces it is smaller and sharper: **the corpus is a week stale
except on Naukri's latest-jd feed, and nothing refreshes it on a schedule.**
`index_search` puts sixty free rows on screen before a spinner, which is real
and shipped — but its value decays daily without item 1, and item 1 is one line
of cron. The product question is no longer whether to build the thing; it is
whether anyone runs it.

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
cd ui-kit && npm run build && npm run selfcheck   # 17/17
```

**All pass as of `38b1bbe`, with no skips** — including the two that usually
skip. That has not been true before, so the two Obsidian gotchas behind it are
worth writing down, because both cost time today:

- **`pgrep obsidian` finds nothing even when Obsidian is running.** The Arch
  package runs as `electron43`, so the process name is `electron`. Check with
  `pgrep -f obsidian` or look for `app.asar`. Concluding "Obsidian is not
  running" from the bare `pgrep` is wrong.
- **`window.mermaid` does not exist until a mermaid block has rendered once.**
  Obsidian loads it lazily, so a freshly launched app answers
  `--render-check` with `Obsidian exposes no mermaid parser` — which looks like
  a missing feature and is really a cold start. Open any note holding a diagram
  first; then all 7 parse and the deliberately broken control is rejected.

`node scripts/pipeline-map.js` (no `--check`) wrote 8 notes to
`/home/bhola/Work/notes/Job Triage Pipeline`: 89 of 89 anchors resolve, 24
constants read from source, 14/14 edge-function actions, 14/14 `hosted()` call
sites, 14/14 `schema.sql` objects, 9/9 `billing.sql` objects, 38/38 section
banners.

Unlike every previous edition, the checks above are **not** the only evidence:
the three production layers were compared against source today and match. That
gap is what this document exists to track, and right now it is closed.
