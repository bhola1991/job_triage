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
