# Where this stands — 2026-10-08

Six days in which the corpus stopped being a thing that sat in a table and
became the cheapest source in the product, and in which four bugs were found by
looking at the ledger rather than at the code. Every number below was measured;
where something is unmeasured it says so.

Then seven commits were merged off a branch nobody had looked at, and the
discovery that matters most in this edition is in **Work happening in
parallel** below: there are SIX worktrees on this repo, and two of them already
do the things the previous edition listed as blocking.

All three layers are verified against `main` as it stands, by sha256 and not by
assumption — which is the one thing this document exists to do.

Project: `kgacahuzaxqkzdcpyboc` · app: <https://jobtriage.reachbhola.workers.dev/>

---

## 2026-10-06 to 10-08: a silent outage, and three false public claims

### The nightly refresh had stopped, and nothing said so

Found on 2026-10-08 while checking a number before writing it into this file.
`job_index.last_touched` was 2026-10-07, not today.

`push-index.js` was 17 hours 33 minutes into `do_epoll_wait` with **zero CPU**
and three open sockets, waiting on a request that neither completed nor failed.
`fetch` has no default timeout, so there was nothing to reject — and the careful
retry-then-halve loop directly below the call could not fire, because it only
runs when `send` returns an error.

The damage was not one lost push. `refresh.sh` waits on that process, so the
systemd service stayed `activating` for a day, and **a timer will not schedule
its next run while its service is still active**. So one dead socket silently
cancelled every following night. The state while this was true: timer
`enabled`, timer `active`, previous run `Result=success`, no error in the
journal, and a corpus quietly frozen. The last journal line was the payload
summary printed just before the first send.

Fixed: 120s per chunk in `push-index.js`, with a `TimeoutError` reported as
"no answer in 120s" rather than `fetch`'s bare "This operation was aborted",
which names no limit and would have been just as silent. `verify.js` (both
PostgREST calls) and `corpus-urls.js` had the same exposure, at 60s.
`ingest.js`, `harvest-slugs.js`, `probe-ats.js` and `sitemap-jobs.js` already
had timeouts and were never at risk.

Stopping the service let `Persistent=true` catch the missed 04:00 at once; the
catch-up ran 2026-10-08 04:39 and **finished in 8 minutes 37 seconds** — the
hung run had been going 17 hours 33 minutes without completing. It took the
corpus 30,647 -> **34,801**, touched 19,146 rows, and brought the newest posting
date to today. Liveness saw 602,720 postings known, 465,441 currently listed,
22,396 reposted, 323 expired by their board. The timer is now scheduled again:
next run Fri 2026-10-09 04:20 IST.

One wrinkle if you check this yourself: the database is **UTC** and the machine
is IST, so just after a 04:39 IST run `max(updated_at)::date` still reads
*yesterday* while `count(*) filter (where updated_at::date = current_date)` is
19,146. Compare dates in one timezone or the freshness check lies in the
reassuring direction.

**The general lesson, which applies past this bug:** "the timer is enabled" is
not "the pipeline is running". The check that would have caught this is whether
`job_index` was touched today, and nothing performs it.

### Three public claims were false, and one was a disclosure

| Page | Claimed | Reality |
| --- | --- | --- |
| `pricing.html` | LinkedIn, twice | the actor was **deleted 2026-10-03** on legal grounds |
| `pricing.html` | Glassdoor, beside Indeed | only via the Google *fallback*, which runs when every API source came back empty and **never on a free search** |
| `pricing.html` | "AI scoring or drafting … 1 credit" | drafting is the **pro** tier at **3** — a real charge understated 3× |
| `pricing.html` | "up to 6 jobs per request" | the search path batches **12** |
| `privacy.html` | Apify "runs the searches on LinkedIn, …" | a **disclosure** naming a scraper that no longer exists, and omitting Workable, which does receive search terms |

The edge function had carried the comment `// linkedin is gone (see SCRAPERS).
pricing.html must not promise it.` since 2026-10-03. A note is not a check, and
the page promised it for five more days.

`selfcheck-worker.js` now asserts the page against the code: every price against
`COST`/`LLM_COST`, that LinkedIn and Glassdoor are not advertised, and that every
scraper `privacy.html` names resolves to a live `SCRAPERS` key. The in-app
credits dialog had all of this right the whole time; only the public pages were
stale, which is the direction that matters least internally and most legally.

**Two of my own checks were wrong before they were right**, and both passed
while being useless — worth recording as the failure mode to expect:
- the pricing row regex crossed `</tr>` and parsed two tables as one row, so it
  matched nothing and reported `ALL PASS`;
- the privacy check searched the whole edge function for "linkedin", which still
  appears **20 times** in the comments recording its deletion, so re-adding the
  claim passed. It now parses the `SCRAPERS` declaration itself, anchored on the
  `}> = {` that closes the type annotation — a plainer `[^=]*` dies on the
  `=> object` inside it.

Mutation-testing caught both. Running a new check and seeing it pass proves
nothing.

### The free index search was discarding the descriptions it had

`index_search` hard-coded `description: ""` for every row, under a comment about
*thin* rows — but it applied to all of them, including the ~30,000 `full` ones
holding 2–4 KB of text. And `search_index` did not return the column at all, so
there were two halves to fix.

Exposed by the **first external profile** (2026-10-05, a video editor in Delhi,
a track the corpus was never curated for): 16 jobs, all `tier=full` in the
corpus with 1,665–4,000 characters each, **13 delivered with zero**. 13 of 16
flagged `thin`; 13 of 16 scored at confidence `low`. The matcher was working
from title, company and location — and still returned an 85, which is a model
being confident on no evidence, exactly what the thin gate exists to damp.

The three rows that survived were Ashby boards, rescued client-side by
`fromAts()`. That is why this looked fine on the owner's own ATS-heavy list and
only broke for someone else: it bites rows from `himalayas`, `arbeitnow` and
`workable`, which are 43% of the corpus and most of what a non-ATS track
returns.

After: 60 of 60 rows for his titles come back with a description, averaging
**3,372 characters**.

### Sending a model less of the person — verified live 2026-10-08

Both changed paths were checked against the real vendors, not just the harness.

**TypeSafe**, same posting judged with and without the name (`test-judge.ts`,
`jev-1.13.0`): confidence `medium` 0.89 both ways, `fit` **0.870 both ways**,
`fit_capability` 3.16 → 3.13, `open` 0.55 → 0.50, 1088 → 1080 input tokens.
**No flag changes which side of `FLAG_P` 0.8 it falls on**, so the flags a user
sees are identical. The name was crossing the wire on every judged posting and
moving nothing.

**DeepSeek**, one extraction from a redacted CV and one name-free scoring call
(₹0.826 total):

| | |
| --- | --- |
| headline | "Senior payments engineer with Go/Postgres settlement and reconciliation depth" |
| strengths | the 4M-transactions system, the team of 12, the 40% disputes cut |
| gaps | "No Kubernetes experience at scale", plus one it inferred |
| seniority · country_code | `senior` · `in` |
| scoring | fit **95**, reachability 60, flags `fit`,`rare`, not truncated |

The useful detail: `country_code` came back `in` **without the +91 phone
number**, which would have been the easy tell — it read Bengaluru, Pune and
Jadavpur. Redaction removed the contactable identifiers without blinding the
extraction, which was the thing worth being unsure about. Every quantity in the
prose survived. `fit` and `rare` are the two documented structural extras that
fire on almost any well-matched posting (§9 of `eval-matcher.js`), so that is
known behaviour rather than a new problem.

The name is still inferred from the CV body on that one extraction call, exactly
as the privacy policy now says. It cannot be stripped before it has been
extracted without being circular.

**Found while trying to run this:** the DeepSeek account answered `402
Insufficient Balance`, so scoring and drafting were dead in production and
nothing surfaced it — the ledger's last DeepSeek row was 2026-10-05 and nothing
had attempted a call since. Topped up, then verified. A balance that runs out
looks exactly like a feature nobody used.

### Also landed

- **`reflagJudged`**, cherry-picked from a branch that never merged. `FLAG_P`
  had moved to 0.8 while `ai_flags` still held whatever cleared the *old* cut,
  and nothing re-read it. Dry-run against the live rows: **283 of 315 judged
  rows changed, 930 flags → 226, 704 false chips removed, nothing added** —
  "a raised cut can only remove" proven on real data rather than fixtures. Free:
  the probabilities were already in `ai_judgment`.
- **`tcKey`** — one shared title+company identity key. `boardFilter` guarded only
  a *bracketed* company, so an **empty** one produced `tc:<title>|`, which
  matches every unattributed posting sharing that title. Latent: 29 of 30,372
  rows blank, no two sharing a title.
- **`score_tier`** recorded as a migration and documented as **dead** — live and
  constrained in production, 0 of 418 rows carrying a value, superseded by
  `ai_model`. Dropping it is the remaining cleanup.
- **Eight branches deleted**, tips recorded below. Two of them
  (`pipeline-fixes`, `feat/free-tier-2`) still carried the LinkedIn scraper — a
  stale branch holding code removed on legal grounds is a loaded gun.
- **`AGENTS.md` collapsed from 651 lines to a pointer.** It was a hand-maintained
  copy of `CLAUDE.md`, already 36 lines adrift, and its only unique content — a
  section on `.Codex/settings.json` — described a path that has never existed
  (`.codex/config.toml`, lowercase, TOML, untracked). Two copies of the project's
  law, one silently wrong, in a repo whose own rule is that a hand-transcribed
  value drifts.
- **`CLAUDE.md` counts corrected**: `index.html` was described as ~4,670 lines at
  6,748, and `components.css` as 163 at 176. §7 also omitted `scripts/index/`
  entirely — the crawler that produces 99.8% of the corpus — and
  `supabase/migrations/`.

### I broke production for two minutes doing it

Deploying the description fix, I called the Supabase MCP `deploy_edge_function`
with `"content": "PLACEHOLDER"` as a stand-in and **it deployed**. That shipped
as v39, the function failed to boot, and every cloud action answered **500**. It
also dropped `_shared/judge.ts` and `api-clients.ts`, because that tool replaces
the whole file set.

Recovered with `npx supabase functions deploy` from disk — the CLI was already
authenticated and linked — rather than retyping 1,384 lines of payment and
scoring code into a tool call. Then verified by diffing all three deployed files
against the working tree: byte-identical. Live at **v40**.

**Never use the MCP deploy tool for this function.** Use the CLI; it reads from
disk and carries the `_shared/` files.

---

## Live in production

| Layer | Version | How it was checked |
| --- | --- | --- |
| Frontend | **`9384809`** | live page fetched and sha256-compared: `a1d00154fd53` both sides. (`cf3b267` verified the same way earlier at `bf3ba60e10f8`; the Worker takes ~30s from a push.) |
| Edge function `api` | **v38** | deployed 2026-10-04 and all three files compared back — `index.ts` `7abbfda9…`, `judge.ts` `679d9b4d…`, `api-clients.ts` `e7d47522…`. All match. This closed a real drift: v37 was behind by `af74459`, which is behaviour and not a comment. |
| Database | `ai_model` added to `public.jobs`; `search_index` carries the tier preference | columns and function body read back from the live catalogue |
| `main` | **`9384809`** | pushed, clean, `origin/main..main` empty |
| Supabase plan | **Pro** (`tier_pro`) | bought 2026-10-03. 8 GB against the 500 MB the free tier gave. |

### The corpus, as it actually sits

| | 2026-09-28 | now |
| --- | --- | --- |
| `job_index` | 347,092 | **34,801** — every row judgeable (2026-10-08) |
| of which `full` | 8,082 | **34,801** (thin: 341,383 -> **0**) |
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
node scripts/selfcheck-reply.js     # inbound-mail decisions; offline, no model, no network
node scripts/selfcheck-worker.js    # the Worker's public write routes, and pricing.html vs the code
node scripts/eval-matcher.js        # the gate, now with Jev measured beside DeepSeek
node scripts/pipeline-map.js --check
node scripts/selfcheck-tokens.js
node scripts/selfcheck-icon.js      # needs Obsidian; a SKIP is not a pass
deno check --node-modules-dir=auto supabase/functions/api/index.ts
cd ui-kit && npm run build && npm run selfcheck   # 17/17
```

Not a gate, but run it when the cut moves:

```bash
node scripts/tune-flag-thresholds.js   # per-code FLAG_P sweep; reads the SHIPPED cut from index.html
```

**The operations half of that gap is now closed.** `node scripts/heartbeat.js`
asks the live system four questions the offline checks cannot: is `job_index`
still being written to (within 26h, compared as an instant rather than a date,
because the database is UTC and the crawl machine is IST); does DeepSeek report
`is_available` with a balance over $1 (its `/user/balance` endpoint is free, so
this answers "would scoring work" without spending anything to find out); does
Mantiks still have credits; and is the refresh unit **stuck** rather than
finished. It writes one `usage_events` row (`kind='error'`, `source='heartbeat'`)
on failure so an outage has a queryable history, writes nothing when healthy,
and treats a missing credential as a loud `SKIP` — never a pass. `refresh.sh`
runs it last and exits non-zero on a problem, so systemd records
`Result=exit-code` instead of `success`.

Three of its four checks were wrong before they were right, which is the pattern
of this whole week:
- the stuck-unit check read systemd's default timestamp, `Thu 2026-10-08
  04:48:15 IST`, which `Date.parse` returns **NaN** for — so `isFinite(ageH)`
  was false, the stuck branch never ran, and a hung unit would have been
  reported as merely `activating`. It now uses `--timestamp=unix` with a
  day-name-stripping fallback, and an **unreadable** timestamp on an
  `activating` unit now FAILS, because not knowing how long it has been running
  is not evidence that it is fine;
- `StateChangeTimestampMonotonic` was tried first and disagreed with
  `/proc/uptime` by **49 hours** on a laptop that suspends;
- run from inside `refresh.sh` the check saw its own unit as `activating` and
  would have called a long crawl a hang, so the nightly invocation passes
  `--in-refresh` and skips that one question.

**What is still not covered:** nothing renders a page. That is why 13 of 16
missing descriptions reached a real user while every check was green.

All pass as of `cf3b267`, **checked by exit code**. That qualifier is new and it
is there because piping a check into `tail` hid a crash twice in one day: the
pipeline-map spec was committed with a syntax error because `node … | tail -1`
reports the pipe's success, not node's. Check `$?`, not the last line.

Seven commits came off `pipeline-fixes` on 2026-10-04 and are on `main`:
the `refund_free` revoke record (production was already fixed — verified by
reading the ACL), the Apify reaper and its service-role auth, **two consecutive
absences before a posting closes**, the harvest loop that reads `job_index`
rather than files, the service-role narrowing, `BLOB_SUNSET_DAYS = 14`, and the
free-pass split so corpus rows land before 25 credits are committed.

Resolving those turned up two things worth keeping. `FLASH_INTAKE_CUT` arrived
undefined because it belongs to a commit I had duplicated, and its whole reason
— that the search path scores on flash and the Score button on pro, so one
constant could not be a law over both — had been **removed** by moving both
paths to flash; `MIN_FIT` is correct again. And the map described the old
`runBoards` and passed anyway, for the third time in a day: `pipeline-map`
verifies anchors and coverage and **never the arrows**.

New tools, none of them gates:

| script | what it answers |
| --- | --- |
| `scripts/record-eval.ts` | records what `scripts/eval/` commits — `--deepseek` fills `recorded`, `--jev` writes `judgments.json`. Live, needs keys. |
| `scripts/tune-flag-thresholds.js` | `FLAG_P` sweep per code, offline against `judgments.json`. A measurement, not a gate. |
| `scripts/record-deepseek.js` | scores the eval cases on a named tier and measures it (`DEEPSEEK_API_KEY`, from the **shell**, not `.env.local`) |
| `scripts/compare-tiers.js` | top-K overlap between two models' rankings, from `ai_model` |
| `scripts/index/probe-ats.js` | guesses a company's ATS board from its name, per region |
| `scripts/check-jsearch-overlap.js` | whether a source returns postings we already hold |

---

## Branches: what was deleted, and the hash to get it back

Eight branches were deleted on 2026-10-06. **The commits are not gone** — a
tip hash is all that is needed, and they are recorded here precisely so that
deleting a branch is a tidy-up rather than a loss:

```
git fetch origin <hash>          # or: git log <hash>   while it is still local
```

| Branch | Tip | Why it went |
| --- | --- | --- |
| `pipeline-fixes` | `c063abc` | Fully landed by effect. Its last gap, `20260929_01_score_tier.sql`, closed in `6e8e2fc`. Its edge function was then purely *older* than main's — still carrying the LinkedIn scraper and the 4-arg `refund()` without `why`. |
| `feat/free-tier-2` | `be80c88` | A free tier of 2 searches on **LinkedIn**, Indeed and Naukri. LinkedIn was removed deliberately; this contradicts that call. |
| `jev-pin-and-threshold` | `6cc19a6` | Fully landed. `FLAG_P` and the Jev pin were already in; the last commit was cherry-picked in `8562937`. |
| `worktree-apply-first-steps-1-2` | `c7682ba` | Merged in `b8021bb` — the apply-first redesign. |
| `worktree-grow-eval-set` | `66d40c6` | Fully landed. Merging it would only have *deleted* 18 lines of newer `CLAUDE.md`. |
| `test/live-url` | `2b9f3b7` | Fully landed, including the "GitHub Pages" wording. |
| `ponytail/cut-v2` | `aba3071` | Superseded. Row-click-to-expand was replaced by the decision pane (`SEL_JOB`); main has no `OPEN_JOB` left. |
| `ponytail/cut-duplication` | `598d113` | 203 commits behind and written before the redesign rewrote the file it de-duplicates. Its Google Fonts removal already landed. Re-do the dedup against today's `index.html` if it is still wanted. |

**Two of those were worth deleting for a reason beyond tidiness.**
`pipeline-fixes` and `feat/free-tier-2` both still carried the LinkedIn
scraper and `FREE_SCRAPERS = ["linkedin", …]`. A stale branch holding code
removed on legal grounds is a loaded gun, not an archive: one careless
conflict resolution puts it back.

### Still standing

`claude/inspiring-brahmagupta-k0b4l7` (`8235557`) — **kept, and not merged.**
One commit, 139 behind, conflicting in `index.html` and the edge function, and
its edge function also still carries LinkedIn. It holds two things:

- **Rejection memory, which is the money.** The search window is floored at 7
  days but `p.jobs` keeps only what scores `MIN_FIT` or better, so every
  posting judged and dropped comes back the next day and is re-filtered,
  re-pulled from its ATS feed and **re-scored**. A daily searcher buys the same
  verdict up to seven times — which is exactly the usage pattern a beta
  produces. Worth re-implementing fresh against today's file, in its own
  session: it adds persisted state to the sync blob, with pruning keyed to
  `MAX_AGE_DAYS`.
- **A dedup collision, now fixed separately** — see `tcKey` below. That half
  no longer needs the branch.

Its remaining third — pruning freshness steps the 7-day floor made unreachable,
and correcting stale comments — the commit itself calls "no behaviour change".
Not worth the conflict churn.

### The collision that half of it was fixing

`boardFilter` and the yield counter each had their own spelling of the same
second identity key, and they disagreed. `boardFilter` rejected only a
**bracketed** company (the suggested-company placeholder), so a posting whose
company was the **empty string** got the key `tc:<title>|` — which matches
every unattributed posting sharing that title, so the first one through would
drop the rest as duplicates. `idsOf` guarded falsiness as well and produced no
second key at all.

Fixed 2026-10-06 as one shared `tcKey()` both call sites use, rather than two
patches that could drift apart again. Latent rather than harmful so far: **29
of 30,372 corpus rows carry a blank company and no two of them share a
title** — but it was one syndicated blank-company posting away from silently
eating real jobs. `selfcheck-boards.js` now asserts it, and the assertions were
mutation-tested: restoring the old guard fails three of them.

### Seven local branches were left alone

`add-google-signin`, `add-icon-selfcheck`, `contact-debug-logging`,
`fix-contact-recipient`, `test/panel-fixes`, `worktree-contact-api` and the
local copy of `worktree-apply-first-steps-1-2` are all **zero commits ahead of
`main`** — already merged, carrying nothing. Clutter, not risk, and not deleted
without being asked.

---

## The beta is gated behind an account, and the README says it is not

Found 2026-10-05 by checking the live site as a new visitor.

```js
// index.html:6051
function render(){
  if(CLOUD && RECOVER && USER) return renderRecover();
  if(CLOUD && !USER)           return renderAuth();   // <- everything stops here
  ...
}
```

`CLOUD` is `!!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase)`,
and the deployed `config.js` carries both. So **a new visitor sees the
sign-in / create-account screen and nothing else** — not the app, not the
queue, not board search. The README's promise, *"no signup, nothing leaves
your browser"*, describes the UNCONFIGURED fallback, which is not what is
deployed.

This corrects a wrong diagnosis made earlier the same day: that a signed-out
visitor clicking board search would be asked for an Apify key. They never get
that far. `runBoards`'s `NEEDAPIFY` path only fires when `CLOUD` is false — a
copy of the file with an empty `config.js` — so it is unreachable in
production.

It is a product decision, not a bug, and it is the first thing a beta tester
meets. The two ways out are not equivalent:

- **Own it.** Say "sign in to search — it is free, 5 searches and 60 scoring
  calls" on the auth screen, so the wall reads as a step rather than a refusal.
  Cheap, honest, keeps credit accounting intact.
- **Let the app run signed out** and gate only what costs money. Matches the
  README, and means `free_search`/`free_llm` have no row to decrement against —
  so it needs an anonymous identity or a per-IP allowance before it is safe.

Verified at the same time, so nobody re-derives it:

| | |
| --- | --- |
| `job_index` | **34,801 rows, every one judgeable**, 20,667 posted in the last 7 days, 33,465 in the last 30, newest posted today (2026-10-08, after the catch-up run). The line here used to read "newest posted today, so the nightly timer is running" — see the hang below for why that inference does not follow |
| `config.js` | live and correct in production |
| caching | `max-age=0, must-revalidate`; the service worker is network-first. No stale-shell bug |
| new account | `free_search = 5`, `free_llm = 60`, `balance = 0` |
| `index_search` | returns `401 {"error":"sign in first"}` to the anon key — confirmed directly |

### The redesign does not exist anywhere

The dashboard/homepage split and the left-hand hover emoji menu were never
built. Searched for them across **all 30 local and remote branches**, in
`design/` (untouched since 2026-09-18), and in the worktrees; `test/panel-fixes`
has nothing ahead of `main`. The Figma account is reachable but its files
cannot be enumerated without a file URL, so if a design was made there it needs
to be handed over as a link. Nothing was invented in its place.

---

## Reply detection: the channel is chosen, nothing is deployed

`matcher_outcomes` reports **8 applied, 0 replied of 402**. That zero is not a
product failure, it is a measurement failure: `stage = 'live'` is the only
record in this project that a human ever answered an application, and it is
written by the person remembering to press a button. Until it has data, every
quality claim about the matcher is agreement between models rather than
evidence that anybody got a job.

**There is no `replied` column.** `replied` is a count in the
`matcher_outcomes` view, derived from `stage = 'live'`. Anyone going looking
for a column to automate will not find one — the automation writes
`jobs.stage`.

### Why forwarding and not a mailbox

The obvious build is Gmail's API with `gmail.readonly`, a cron job, and a
stored refresh token. It was rejected on two counts, the second of which is the
real one:

- Google classes `gmail.readonly` as a **restricted** scope. Unverified apps
  are capped at 100 test users, and getting past that needs a third-party
  security assessment. A 20–30 person beta survives the cap; a launch does not,
  and the assessment is months and real money.
- It means holding a credential that can read a person's entire mail — in a
  repo whose CV parser runs in the browser specifically so that nothing is
  uploaded. The posture is the product.

So the user forwards instead. One Gmail filter, set once, sends recruiter mail
to a per-profile address `r.<inbox_token>@<domain>`. We hold no credential and
can read nothing that was not routed to us; the token is both the routing key
and the capability, so it is secret, random, and revocable by rotation.
Cloudflare Email Routing already fronts this app, so the receiving end is a
second export on the Worker that is already deployed, not new infrastructure.

After that one setup step nothing is manual, which was the point: new
information arrives through an automation channel.

### An ATS acknowledgement is not a reply

This is the correctness decision the whole design turns on. "Thank you for
applying to Acme" from `no-reply@greenhouse.io` is a receipt a machine sent
itself. Counting it as `live` would fill the ground truth with noise in exactly
the way that makes it worthless. Three outcomes, three different writes:

| classified | stage |
| --- | --- |
| `ack` — a receipt | **unchanged**; confirms `date_applied` |
| `reject` — a no | `closed` |
| `human` — a person wants something | `live` — the only thing that counts as a reply |

`human` is deliberately narrow. Any bulk-mail header (`List-Unsubscribe`,
`List-Id`, `Auto-Submitted`, `Precedence: bulk`) or a do-not-reply sender box
**vetoes** it outright, however much the text reads like a person. A missed
reply costs the user one click; a false one silently corrupts the only evidence
this project has.

### What is built, and what is not

`src/reply-match.mjs` — the whole decision, pure, no network and no model. One
copy, imported by both the Worker and the check. It matches a mail to a job by
thread (`In-Reply-To`, strongest, hooked but not yet fed), then sender domain
against the posting host or company, then by looking for a company name **we
already hold** inside the subject and body — containment rather than
extraction, because a parser that pulls a company *out* of "Thank you for
applying to X" can invent an X that matches the wrong row. Two rows that
normalise alike, or no confident match, return `store-unmatched` and write
nothing.

`scripts/selfcheck-reply.js` — 35 assertions, offline, in the §8 harness. The
fixtures are mostly near-misses on purpose. It was mutation-tested rather than
trusted: removing the bulk-header veto, and resolving an ambiguous company to
the first match, each produce a **false `live`**, and each is caught.

`schema.sql` carries `profiles.inbox_token`, `public.inbound_mail` (owner-read,
service-role-write, so a person can contest what the automation concluded but
cannot forge a reply into their own ground truth) and the `jobs.sent_message_id`
threading hook. The whole file still applies cleanly to real Postgres — checked
on PGlite, PG 18.3.

### Built end to end, and shipped dark

Domain chosen: **`jobtriage.app`**, addresses `r.<token>@jobtriage.app`.

- `src/index.js` gained the `email()` export. Mail to an address that is *not*
  a live token is **forwarded, never stored** — Email Routing has no wildcard
  rule, so the catch-all means this Worker sees every address on the domain and
  has to hand back what is not ours. A token nobody holds is dropped. A write
  that fails is logged and swallowed rather than bounced, because `setReject()`
  tells the *sender* their mail was refused, which is a lie when the fault is
  ours. Stage patches are guarded on the stage they were decided against, so a
  redelivery cannot walk a row forward twice.
- `src/mime-lite.mjs` — enough MIME to classify a mail, hand-written. The
  normal answer is `postal-mime` from npm, but this repo has no root
  `package.json` on purpose, and adding one so a Worker can read a Subject line
  is the wrong trade. Handles folded headers, one level of multipart, base64
  and quoted-printable; does not handle RFC 2047 subjects or nested
  multiparts. Degrading is cheap: the classifier reads the subject, which
  arrives from `message.headers` without any of it, and a body that fails to
  decode comes back `unclear` and writes nothing.
- Gmail's forwarding handshake is handled. Gmail will not forward until a code
  it mails to the *forwarding address* is entered back — and it mails that code
  here, where the person cannot read it, so without this the setup instructions
  dead-end. Recognised narrowly, by sender **and** shape; a spoofed one from
  any other domain is refused.
- The app gained a Replies panel: issue an address, copy it, the Gmail filter
  to paste, the confirmation code when it arrives, a log of what the automation
  concluded, and rotation. The log exists because `inbound_mail` is owner-read
  — you can see and contest every call it made.
- The migration **is applied to production**, and RLS was verified live in a
  rolled-back transaction: the owner sees their own rows, another user sees
  **0**, and there is **no insert policy at all**, so a user cannot forge a
  reply into their own ground truth. `profiles` is own-rows on all four verbs,
  so a token cannot leak sideways.
- `selfcheck-reply.js` is now 51 assertions and covers MIME and a raw email
  straight through to a decision. Mutation-tested again: removing header
  unfolding, decoding quoted-printable per character instead of per byte, and
  dropping the sender check on the Gmail code are each caught.
- `selfcheck-rows.js` pins one invariant that would have broken this quietly:
  `saveRows()` upserts a whole profile row, PostgREST only SETs the columns a
  body names, so `inbox_token` survives exactly as long as `profileRow()` keeps
  not naming it. If it ever does, every profile save nulls the address and
  inbound mail starts landing on an unknown token — which looks like
  "forwarding stopped working" and has nothing to do with forwarding.

### The one thing blocking it: the domain does not exist

`jobtriage.app` is **NXDOMAIN** — checked against both Cloudflare's and
Google's resolvers, with the `.app` TLD authority answering. It is not
registered. The app is served from `jobtriage.reachbhola.workers.dev`.

So the feature is committed **off**. `INBOX_LIVE = false` in `index.html`, and
the panel says plainly that the domain is not receiving mail rather than
issuing an address that would silently swallow everything sent to it. The
Replies button is not even created while it is off. This matters because
**pushes to `main` auto-deploy** — shipping it on would have published a dead
address to real beta users.

Three steps flip it, all outside this repo, in order:

1. Register `jobtriage.app` and put it on Cloudflare.
2. Enable Email Routing, catch-all → the `jobtriage` Worker. **Check for
   existing MX records first** — enabling it repoints the whole domain's mail.
3. `wrangler secret put SUPABASE_URL` and `wrangler secret put
   SUPABASE_SERVICE_ROLE_KEY`, so the Worker can resolve a token to a profile.

Then `INBOX_LIVE = true`, which is a one-line commit.

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

**Removed 2026-10-04 — see the section after this one.** What follows is why
they could never be improved, which is the reason they went.

340,907 of the corpus rows were `thin` — title, company, city and an experience
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
Whether 340,907 of those earned their storage was a product call, not a
technical one; there was no engineering left to try. Kept on 2026-10-03,
**deleted on 2026-10-04** once the question was put properly: someone uploading
a CV is owed a score, and a thin row is scored from four words of slug.

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

The eval set is **31 cases, 25 tune / 6 holdout** since 2026-10-05, with one raw
Jev judgement per case committed to `scripts/eval/judgments.json` so the
threshold sweep runs offline. The figures below were taken on the TEN-case set
that preceded it and have not been re-measured against the thirty-one — which is
the first thing to do before anyone argues about the flip again. On those ten
labels:

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

## Only rows that can be scored, and RLS verified

Two things settled on 2026-10-04, both of which had been open for a while as
opinions rather than measurements.

### The corpus holds 34,801 rows and every one of them is judgeable

`job_index` went 364,345 -> 22,962 and has since grown to **34,801**; the 341,383 thin rows are gone and
`push-index.js` refuses more. The argument that decided it was not storage —
564 MB of 8 GB on Pro — and not accumulation either. It was this: `live.add`
sends every index row through `scoreAndCut`, so a thin row **is** scored, on
four words of slug, with `thin` raised and confidence low. The eval set puts
that at fit 55 from a title alone. Measured on a real video-editor search, that
was **52 of 60 rows** carrying a guessed number beside 8 carrying an informed
one — and the colour law cannot tell them apart, because a guessed 62 and a real
62 render identically. Someone uploading a CV to be told what to apply for is
owed the second kind.

Accumulation was the one worth checking before deleting, and it is unaffected:

| indexed | full added | thin added |
| --- | --- | --- |
| 2026-09-26 | 2,941 | 291,274 |
| 2026-09-28 | 3,245 | 49,632 |
| 2026-10-03 | **16,776** | **477** |

Thin rows were a plateau, not a curve — a board's live inventory does not grow,
so mirroring it once is all there is. Full rows are accelerating because every
ATS board found adds ~100 permanently and `f219f3d` harvests new boards out of
what searches deposit.

**Kept on purpose:** all 429,018 `job_checks` rows (107 of the 402 tracked jobs
join them — that is how a row says "gone from the board"), the Naukri sitemap
crawl and its expired list (`verify.js` needs the snapshots for tracked-job
liveness, and the expired list is the only source of a DECLARED closure), and
the `thin` tier itself, which is still a true thing a source can produce.

**One casualty, found and fixed the same day:** SmartRecruiters' listing carries
no description either, so the same gate took all 21 of its boards to zero. That
gate is right for Naukri, whose text is unobtainable, and wrong for
SmartRecruiters, which publishes it one request per posting away. Now fetched in
two hops: 640 rows, **639 of them full**, averaging 4,907 characters.
`companyDescription` is dropped deliberately — identical across a company's
postings, and it would spend the 4,000-character budget the qualifications need.

### RLS is verified, not just valid

Previously recorded here as "verified **valid**, not **correct**", because PGlite
has no real `auth.uid()`. Exercised against production on 2026-10-04, every test
inside a rolled-back transaction:

| as | jobs | profiles | user_state | job_index |
| --- | --- | --- | --- | --- |
| the real owner | 402 | 1 | — | — |
| **a different user** | **0** | **0** | **0** | **34,801** |
| anon, through PostgREST with the key from `config.js` | `[]` | `[]` | `[]` | — |

The anon row is the end-to-end one: the real key, the real path a browser takes,
and empty results rather than errors — correctly filtered rather than
accidentally blocked. `job_index` staying visible to the stranger is the design
working and not a leak: postings are shared, pipelines are not.

Writes, which inspection cannot settle:

| attempt | result |
| --- | --- |
| see another user's `profile_id` | invisible |
| insert a job onto someone else's profile | **blocked** — `new row violates row-level security policy` |
| update a stranger's rows | **0 rows** |
| delete a stranger's rows | **0 rows** |

The third is the one worth having: `jobs`' insert policy requires owning the
profile being attached to, and it held even when the attacker was handed the
victim's profile id directly rather than having to guess it.

**Two limits, stated rather than glossed.** The write tests used a simulated JWT
(`set local request.jwt.claims`) rather than a signed token through PostgREST,
because creating real users means side effects in production auth. And
`relforcerowsecurity` is false, so the table owner still bypasses RLS — that is
`postgres` and `service_role`, which is intended, and `af74459` is what narrowed
this function's use of it.

So the thing that gated letting 20–30 people in is cleared.

---

## Work happening in parallel, which nobody was tracking

This is the largest gap in the project and it is not technical.

A second Claude Code session has been alive on this machine for **5 days 12
hours** (2h09 of CPU, last commit 25 hours ago, now idle at a prompt). It wrote
the `pipeline-fixes` branch from a nine-task brief. Seven of its thirteen
commits are now on `main`; **two of them I had already rebuilt from scratch**
on 2026-10-04 without looking at the branch — `ai_model` against its
`score_tier`, and the rescore batching — and I wrote both up as new findings.

There are **six worktrees**, not one:

| worktree / branch | head | what it holds |
| --- | --- | --- |
| `pipeline-fixes` | `c063abc` | 13 commits; 7 merged, 2 duplicated by me, 4 remaining |
| ~~`worktree-grow-eval-set`~~ | merged | the 31-case eval set and its tooling. **Kept**; branch deleted. |
| ~~`jev-pin-and-threshold`~~ | salvaged | `FLAG_P` 0.8 and the `jev-1.13.0` pin were taken; its third copy of the measurement tooling was not. Branch deleted. |
| `worktree-apply-first-steps-1-2` | `d70916f` | locked. Puts the posting in the row's filled button. |
| `add-google-signin` | `bfeb3e7` | nothing ahead of main |
| ~~`worktree-pipeline-map-flywheel`~~ | dropped | a second `depositIndex`, superseded by `cfa6a92`. Branch deleted. |

The two in bold are the exact items the first pass of this document listed as
blocking: *"more cases and an uncontaminated holdout come before the flip"* and
*"`FLAG_P = 0.5`, the worst available cut point"*. Both were solved on branches
while being described here as open.

**RESOLVED 2026-10-05.** Three independent implementations of the same
measurement existed — `record-jev.ts` plus eval section 9 on main,
`record-eval.ts` plus `tune-flag-thresholds.js` on `grow-eval-set`,
`record-judgments.ts` plus `tune-flag-threshold.js` on `jev-pin-and-threshold`
— each writing a different `scripts/eval/judgments.json`.

`grow-eval-set` won on the only axis that mattered: **31 cases against 10**, and
25 tune / 6 holdout where the old split was 8 and 2. Cases are the scarce thing;
tooling is not. `cases.json` was taken wholesale rather than merged, because
mine carried `recorded_jev` on ten cases and theirs carries `judgments.json` for
thirty-one, and half of each would measure nothing. `record-jev.ts` and section
9 are deleted, and all three branches are gone.

So the next piece of work on the matcher was not more measurement but a choice,
and it has been made. Three worktrees remain: `pipeline-fixes` with four
commits (three of them docs), `add-google-signin` with nothing ahead of main,
and `apply-first-steps-1-2` with one.

**How this was missed:** `git branch -a` ran in the first command of the
2026-09-28 session and the branch names were in its output. They were not read.
After `pipeline-fixes` turned up, the check was not widened to the rest.

---

## Drift and open items

| Item | State |
| --- | --- |
| **The reaper is inert** | `reap-apify` is committed with its migration and deployed nowhere. It needs `pg_cron` and `pg_net` installed (neither is), the function deployed, and two vault entries that do not exist. Re-verified 2026-10-04. Worth finishing: `billing.sql` records **23 Apify runs started against 16 returning**, so seven billed with nothing naming them. |
| **The first scheduled run crashed** | Fixed the same morning: `fs.readFileSync(0, 'utf8')` in `harvest-slugs.js` SEGFAULTS on a large pipe — 23,057 urls, status 134, core dumped, 1.8 GB peak. The same input from a file was fine, which made it look like data. Two red herrings: the journal named `corpus-urls.js` first with `Exit 1`, but that was only EPIPE from its consumer dying, and the 1.8 GB reads like OOM when it is a one-shot read of a pipe Node cannot size. Chunked `readSync` now, verified through the real pipe. |
| ~~Nothing schedules `refresh.sh`~~ | **Scheduled.** Timer enabled, `loginctl enable-linger` done, so it fires whether or not anyone is logged in. `Persistent=true` caught the first missed 04:00 and ran it at 08:39. |
| **`kept_50` reads 0 on deferred scoring** | The browser reports yield before scoring finishes, so `source_yield.inr_per_exclusive_50` is wrong for any such search. Unfixed. |
| **`ai_model` is recorded but empty** | 0 of 402 rows carry it: every scored row predates the column. It also answers "which tier built this list", **not** an A/B — a row holds one `ai_model` and one `ai_score`, the last to write them, so scoring twice reads as whichever went second. A real comparison wants both readings kept (a `score_trials` table), which is the same instrumentation `eval-matcher --live` needs. |
| **`judge` action has no caller** | `judgeInto` and `judgeJob` are reachable from no button since `cf3b267`. Annotated rather than deleted: `judgeJob` holds the only `hosted('judge')` call site and `pipeline-map` asserts those map 1:1 onto the actions, so deleting them means retiring the action too — a deliberate change to a deployed endpoint. |
| **`matcher_outcomes` has 10 rows** | The ground truth. Ten rows cannot separate two rankers, which is why every model comparison above is agreement rather than correctness. |
| ~~Old rows kept the old cut~~ | **Fixed 2026-10-06**, cherry-picked from `jev-pin-and-threshold`. `ai_flags` stores the flags that cleared the cut *at judge time* and nothing re-read it, so raising `FLAG_P` to 0.8 left every row already in an account showing the false chips the new cut exists to remove. `reflagJudged()` re-thresholds them from the probabilities already in `ai_judgment` on the next load — no Jev call, no credit, no DeepSeek call, because the evidence is on the row. Keyed on the cut it last applied (`triage:flagcut`), so tuning the number again re-runs it rather than needing anyone to remember it exists. `eval-matcher.js` §10 asserts the destructive properties: never invents a flag, never loses a fact or quote on one it keeps, leaves an unjudged row alone, idempotent. |
| The 0.8 cut costs recall, measured | New §9 prices it: at 0.8 precision is **1.00 for eight of ten codes** while recall falls to `fit` 0.71, `comp` 0.67, `open` 0.60. Five labelled flags sit below the cut, and §9 now **reports** those and **fails** only on an extra — a flag that fires wrongly puts a false chip on a row, one that does not fire only leaves the row quieter. The asymmetry is deliberate. `cred` on `sen-hi-principal` answers **0.29**, so no cut recovers it: widening the question is the fix. |
| ~~`FLAG_P = 0.5`~~ | **Now 0.8**, salvaged 2026-10-05. The 0.5 measured 0.483 flag precision with `open` and `rare` firing on six cases of ten. Swept per code by `tune-flag-thresholds.js`. Two flags are not fixable at any cut: `fit` answers the question it was asked while the labels name the flag worth showing, and `rare` is weakly true of nearly every posting this profile sees. |
| ~~`TYPESAFE_MODEL`~~ | **Pinned to `jev-1.13.0`**, salvaged the same day. Pinning is what makes `FLAG_P` mean anything: the cut is calibrated against probabilities recorded from one model, and on another the same 0.8 means something else with nothing erroring. The env var still overrides, so trying a newer Jev needs no deploy. |
| Three SmartRecruiters boards | Return exactly 100 rows, which is a page cap — there is more behind them unread. |
| `MONSTER_JOBS_API_KEY` | Set as a secret; no code reads it. Parse MCP registered but unauthorised. Measure it against JSearch, which reaches Foundit free. |
| `mantiks_contact` | Deployed and **never once executed live**. |
| RLS | **Verified 2026-10-04, read the section below.** Was "valid, not correct"; it is now correct. |
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
- **`fs.readFileSync(0, 'utf8')` segfaults on a large pipe.** It is the obvious
  spelling for "read all of stdin" and it killed the first scheduled crawl. Read
  stdin in chunks. And when a shell pipeline fails, the process the log names
  first may only be the one that got EPIPE when its consumer died.
- Live Postgres is **17.6**; the PGlite harness verified on **18.3**.

---

## Next, in order

**Intake is specified but not built.** `INTAKE.md` is the brief: five fields
(`intent`, `strict`, `limits`, `exemplar`, and asking `mode` instead of
inferring it), where each one is consumed, and what not to do. The finding
behind it is that the app has no representation of what a person *wants* —
every one of the live profile's `wrong_shapes` is a capability judgement
("Broadcast editor: no broadcast credits shown"), not a preference, and `gaps`
restates the same six facts. It deliberately excludes personality profiling,
and step 4 of it is gated on `replied` having data, because with 15 applied and
0 replied nothing can currently tell whether an intake change helped.


0. ~~Decide which eval implementation survives~~ — done 2026-10-05,
   `grow-eval-set` kept, the other two deleted, `FLAG_P` and the model pin
   salvaged out of one of them first.
1. **Schedule `refresh.sh`.** One timer, already written and validated. The
   corpus decays daily without it and `index_search` now reads what it produces.
1a. ~~Deploy the edge function~~ — done 2026-10-04, v38.
2. ~~Verify RLS on `public.jobs` and `public.profiles`~~ — done 2026-10-04.
3. **Fix `kept_50`.** Report yield after scoring, or the source economics the
   whole acquisition strategy rests on stay wrong.
4. **Write more eval cases with a clean holdout**, from the 34,801 judgeable
   rows now available. Everything about the matcher is blocked behind ten cases.
5. **Build `score_trials`** so a model comparison is possible at all, then
   answer whether pro is ever worth it for prose.
6. Then: retire the `judge` action, pin `TYPESAFE_MODEL`, tune `FLAG_P` per
   consequence, read the SmartRecruiters pages behind the 100-row cap.

### The decision that is not a task

The corpus is no longer the open question — 34,801 rows, every one of them
judgeable, 308 sources, a flywheel that grows it on every paid search, and the
341,383 rows that could never be scored are gone. RLS is verified. The nightly
crawl is scheduled. What has not moved is **who it is
for**: `public.jobs` holds 402 rows and `matcher_outcomes` holds 10, so every
quality claim in this document is agreement between models rather than evidence
about whether anyone got a job. Ten outcomes is the smallest number in here and
the only one that would make the rest mean anything.
