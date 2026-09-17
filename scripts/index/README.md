# The shared job index — proof of the funnel

`index.html` searches per user: every person who searches pays to acquire their
own rows. That cannot reach "all the jobs everywhere", because acquisition is
the dominant cost and it scales with headcount.

From the price notes in `supabase/functions/api/index.ts`:

| per row | cost |
| --- | --- |
| **acquiring** a job (Indeed scraper, $3/1000) | **₹0.264** |
| **judging** it (LLM, 12 per call) | **₹0.017** |

**Reading a job costs ~16× what deciding about it costs.** So the row you buy
once and serve to everyone is the only version that scales. That is the index.

## What is here

    sources.json    the crawl list — ATS boards and free feeds, all keyless
    ingest.js       crawl once, centrally, into one JSONL store
    embed.mjs       give every indexed job a meaning-vector (channel C)
    retrieve.js     stage one: cut the index to a few hundred candidates, free

Run:

    node scripts/index/ingest.js          # writes scripts/index/index.jsonl
    node scripts/index/retrieve.js --titles "Platform Engineer,SRE" --skills "go,aws"

`index.jsonl` and `candidates.jsonl` are build output and are gitignored.

## Measured, 2026-09-15

**Acquisition can be free.** 4,838 real jobs from 38 sources, no API key and no
cost: an ATS feed is the same JSON the company's own careers page loads. Only
LinkedIn, Indeed and Naukri need paid scraping. The ₹0.264/row figure is the
ceiling, not the average — most of an index costs nothing to acquire.

9 of 47 sources 404'd (companies change ATS or slug). A failed source is
reported and skipped: a thin index is recoverable, a crawl that dies on one 404
is not.

**The whole index cannot be LLM-scored per user.** 4,838 jobs is ₹80 per person
per refresh; 100k would be ₹1,667. Hence stage one.

**BM25 alone was not safe to put in front of the scorer.** Its top 200 held only
**47%** of the jobs whose titles literally name the target role. Raising the
title weight from 3 to 20 moved that by one point — the term mass in long
descriptions dominates whatever you do to the title, so it is not a tuning
problem:

| candidate pool | recall | cost/user |
| --- | --- | --- |
| top 200 | 47% | ₹3.33 |
| top 400 | 69% | ₹6.67 |
| top 800 | 85% | ₹13.33 |
| top 1600 | 98% | ₹26.67 |

**Hybrid retrieval fixes it at no extra cost.** Channel A takes every literal
title match outright; channel B fills the rest of the pool by BM25, which is
what finds the roles named something else. Recall on that set goes 47% → 100%
at the same 200 candidates, and BM25 still supplies 138 of the 200 — including
roles a title match would miss.

## Measured against a real profile's already-scored jobs

`validate.js` takes a Backup & transfer export, mixes its scored jobs into the
index, and retrieves as production would. Run on a real 4-track profile whose
63 jobs the scorer had already rated 5-88:

| candidates per track | pool | kept of the 40 rated 65+ | let in of the 4 rated <=20 | cost |
| --- | --- | --- | --- | --- |
| 60 | 230 | **28 (70%)** | **0** | ₹3.83 |
| 150 | 535 | 29 (73%) | 0 | ₹8.92 |
| 400 | 1322 | 31 (78%) | 2 | ₹22.03 |

60 per track is the knee. Widening six-fold buys three more good jobs and
starts letting noise back in; scoring the whole index would be ₹81.68 a head.

**Retrieve per track, then union.** Merging all four tracks' titles into one
query collapsed recall to 1/40 — "Operations Manager" and "Video Editor" and
"Founder" in one bag match nothing well. This mirrors how the app already
searches, one track at a time.

## Channel C: embeddings — measured, and smaller than I claimed

`embed.mjs` gives every indexed job a 384-dim vector (`Xenova/all-MiniLM-L6-v2`,
local, no API key). 4,838 jobs in 87s, 7.4 MB. It runs at crawl time, once,
shared by everyone; per user the only new work is embedding their track titles.

**The first integration was wrong.** Interleaving vector picks with BM25 picks
at a fixed pool size made recall *worse* — 70% → 68% — because every vector pick
displaced a BM25 pick that was already earning its place. Embeddings exist to
reach what word overlap cannot see, so they must widen the net, not re-cut it.

Additive, they help — modestly:

| channels | pool | kept of 40 | cost |
| --- | --- | --- | --- |
| BM25 60/track | 230 | 28 (70%) | ₹3.83 |
| + vector 30/track | 338 | **29 (73%)** | **₹5.63** |
| + vector 60/track | 435 | 29 (73%) | ₹7.25 |
| BM25 150/track, no vector | 535 | 29 (73%) | ₹8.92 |

**The honest read: embeddings buy the same recall for 37% less money**
(₹5.63 vs ₹8.92 at 73%), not more recall. An earlier version of this file
claimed they were worth ~30% recall. That was a guess, and measuring it showed
it was wrong: about 3 points, and it plateaus.

## Why recall stalls near 73% — it is not the retriever

All 40 jobs the scorer rated 65+ came from **board search**: LinkedIn, Indeed,
Upwork, Naukri, Google. This index holds ATS feeds (Greenhouse/Lever/Ashby) plus
three remote feeds. Most of those good jobs have no analogue in it at all — they
are freelance gigs and India-market content roles; the index is global-tech
company postings.

So the ceiling measured here is a **coverage** ceiling, not a retrieval one.
Judging the three channels properly needs an index containing the kind of work
the profile actually wants. That is a `sources.json` problem, and it comes
before any further retrieval tuning.

## What is NOT proven

The recall figure uses "the title literally contains a target title" as ground
truth. Channel A finds those by construction, so **that number cannot validate
channel A** — it only shows the known failure mode is closed. Whether the BM25
half surfaces the right *non-obvious* roles needs ground truth from the real
scorer, which needs an API key. That is the next measurement, and it is the one
that decides the pool size.

Also unmeasured here: freshness (how often to re-crawl), storage at scale
(37.3 MB for 4,838 jobs ≈ 770 MB per 100k), and whether serving candidates from
a server changes the privacy promise in README.md — today a local-mode user's
CV never leaves the browser, and scoring index candidates client-side with the
user's own key is what would keep that true.
