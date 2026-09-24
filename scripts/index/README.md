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
    harvest-slugs.js grow that list from job URLs you already paid for
    sitemap-jobs.js  read a board's own public sitemap into index rows
    verify.js        diff today's snapshot against yesterday's: what is still real
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
is not. `harvest-slugs.js --verify` exists for the same reason at the other end:
a slug that does not resolve is not a discovery, it is a future 404, so it is
dropped before the list grows.

## Growing the crawl list

    node scripts/index/harvest-slugs.js <file...> [--verify] [--write]

A paid row is not only a job. For anyone on an ATS it is a **company slug**, and
a slug is that company's whole board, free, for as long as they keep hiring —
~103 jobs each, on this seed list. So paid search is worth more as a discovery
channel for free feeds than as a source of rows, and this turns one into the
other. Input can be any JSON or JSONL with URLs in it; an app backup export
works as-is.

**Measured 2026-09-24, and the result was a negative one.** Run against all 167
job rows in the live database it found **two** ATS URLs, both Ashby, one company.
The reason is upstream: 135 of those 167 came from Upwork, LinkedIn and Indeed,
and a portal links to itself, never to the employer's own board. The harvester
is only as good as its input, so the next move is to make the Google run query
ATS hosts on purpose (`site:boards.greenhouse.io`, `jobs.lever.co`,
`jobs.ashbyhq.com`) rather than hoping a portal mentions one.

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

## The door the boards hold open

Measured 2026-09-25.

Every board needs Google for Jobs traffic, and Google requires a sitemap listing
every job page. So boards publish their **complete index**, publicly and on
purpose, for crawlers — while the search endpoint we have been paying Apify to
squeeze through is the surface they defend.

    node scripts/index/sitemap-jobs.js https://www.naukri.com/sitemap/sitemap.xml --list
    node scripts/index/sitemap-jobs.js https://www.naukri.com/sitemap/jobDescPagesPune.xml

| board | sitemap | result |
| --- | --- | --- |
| **Naukri** | `jobDescPagesPune.xml` | **200 — 18,806 job urls, 3.85 MB** |
| Instahyre | `sitemap-jobs.xml` (paginated) | 200 |
| Cutshort | `sitemap_index.xml` | 200 |
| WeWorkRemotely | `remote-jobs.rss` | 200, full job content |
| Foundit | advertises `todays-jobs-sitemap.xml` | **403** — Akamai, Googlebot only |

18,806 jobs for one city, free. A paid LinkedIn pull is 30 rows for ₹13.20.

All 18,806 Pune slugs matched one grammar, so it is parsed rather than guessed:

    job-listings-<title><company><city…>-<a>-to-<b>-years-<id>

Title, company, city and experience, before fetching anything. Company comes out
of about **58%** of slugs — nothing in a slug marks where a company name begins,
so the split is refused when it would eat the job title, and the words stay in
`title`. That costs nothing: stage one matches titles by substring, so a title
carrying an extra word still matches and a title missing one does not.

### The funnel, end to end, at zero acquisition cost

    node scripts/index/sitemap-jobs.js <pune sitemap> --out pune.jsonl
    node scripts/index/retrieve.js --index pune.jsonl --titles "Operations Manager" \
         --skills "operations,process,vendor,supply chain" --top 60

    index 18806 jobs · 116ms · two channels
    candidates 60: 34 title · 26 bm25 · 0 vector
    literal title matches kept: 34/34
    scoring cost: whole index ₹313.43 · this pool ₹1.00

Acquisition ₹0, stage one ₹0, and the pool that reaches the scorer costs ₹1.00
against ₹313.43 for the whole index. The recall property from 2026-09-15 holds
on a corpus 4× larger than the seed crawl.

### The posting date was in the url all along

A Naukri job id is `DDMMYY` + a sequence, and it parses on **18,789 of 18,806
(99.9%)**. That matters because the two obvious alternatives are worthless: the
sitemap's `<lastmod>` is the same generation timestamp on every row, and the
sitemap *lags* — the newest posting in a file generated 2026-09-24 was
2026-09-17, a **seven-day delay**.

So the sitemap is not a freshness source, and nothing will make it one. What the
id buys is an age filter on the **first run**, with no diffing and no waiting:

    node scripts/index/sitemap-jobs.js <sitemap> --max-age 30

    posting date recovered from the id: 18789 (99.9%)
    age: newest 8d · median 23d · oldest 1023d
    over 90 days and still listed: 695 (3.7%)
    --max-age 30: dropped 5373, kept 13433

**695 postings (3.7%) have been listed over 90 days**, the oldest nearly three
years. That is the ghost-listing problem, measured on day one, for free, without
a single page fetch — and it is the argument for two lanes rather than one: the
paid scrapers are a bad corpus but a good *freshness* signal, while this is a
bad freshness signal but an excellent corpus.

Any six digits parse as some date, so the read is bounded at three years;
anything older is called undated rather than ancient, because a sequence number
that happens to look like 2021 is likelier than a five-year-old live listing.

### What is NOT solved

A Naukri job page is a client-rendered shell: 200 OK, ~36 KB, **no job text** —
no JSON-LD, no `__NEXT_DATA__`. So these rows carry no description, and every
one is stamped `partial: true` rather than pretending otherwise. The sitemap
gives a free, complete, filterable shortlist; fetching the ~60 survivors is a
separate problem. Buying 60 rows you have already chosen is a different trade
from buying 30 at random, which is the entire point.

## Is it still real?

    node scripts/index/verify.js <snapshot.jsonl…> [--store f.json] [--report]

Liveness is **not a fetch**. Measured 2026-09-25: every url in a sample of live
Upwork and Remotive postings returned **403** to a datacentre IP, and Naukri's
robots.txt names `claudebot`, `gptbot` and `perplexitybot` and disallows them
the whole site. Asking each page "are you still open?" does not work and cannot
be made to work.

But the boards publish their complete current index every day, to be crawled.
So membership answers it with no page fetch at all:

| | |
| --- | --- |
| in today's snapshot, not yesterday's | new |
| in both | still open, `runs++` |
| in yesterday's, gone today | **closed**, and the date is known |
| gone, then back | **reposted** |

Proven on the 18,806-row Pune snapshot: 500 postings removed were reported
`closed 500`; 50 of them returned and were reported `reposted 50`; a source the
run did not cover is left strictly alone, so a partial run can never be read as
a mass closure.

### Suspects, not verdicts

`verify.js` never asks Jev anything. Every signal it computes is a count or a
date, and the house rule is that Jev is asked judgments, never dates or counts.
So it marks what is **suspect** — continuously advertised ≥ 60 days, or taken
down and reposted ≥ 3 times — and writes those rows out. That is the residue
worth paying a judgment on. Everything else is left alone.

A posting open 115 days is not evidence of fraud; it is evidence that it is not
an opening anyone is filling, which is the thing a job seeker is never told.
