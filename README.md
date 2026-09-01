# Job Triage

A single-file web app that reads a CV, works out which career directions are realistically open to that person, then finds and ranks jobs against them.

**[Try it →](https://bhola1991.github.io/job_triage/)** · no signup, nothing leaves your browser
---

## The problem

Job boards rank by relevance. That sounds correct and is quietly harmful. Relevance and winnability are different things, and collapsing them into one number sends people — especially anyone changing direction — to a queue of jobs they have no realistic chance at. Months disappear that way.

Two related problems sit underneath it:

- **Every profession advertises somewhere different**, and for most people that place is not LinkedIn. Academic posts live on field registries; startup roles on YC, Lever and Ashby.
- **The best openings are frequently never posted.** They're filled through referral before anyone writes an ad, so no amount of searching will surface them.

## What it does

1. Reads a CV and extracts structured facts — including, deliberately, what the person **cannot** honestly claim.
2. Generates career directions and rates each one easy, moderate, or moonshot against that specific background. You can also name a direction yourself and get an assessment of it.
3. Suggests companies worth approaching, then checks which are actually hiring.
4. Scores every job on **two separate axes** and plots them on a map you drag-select.
5. Tracks live conversations and overdue follow-ups, not just applications sent.

---

## Three decisions I'd defend

### Fit and reachability are separate scores

The core idea. A forward-deployed role at a famous AI lab might be **88 on fit, 8 on reachability**. A similar role at a company nobody's heard of scores **70 and 60**. Ranked by fit, you burn a week on the first. Ranked by both, the second sorts above it — which is the right answer.

Keeping them separate has a second benefit: the person's gaps (no relevant degree, no big-tech background) lower reachability and **never** lower fit. Conflating the two buries every good match behind a credential the job may not actually require. The scoring prompt says this explicitly, because a model left to itself will merge them.

Final rank is a weighted geometric mean, not an average, so a job that's excellent on one axis and terrible on the other sinks rather than landing mid-table.

### Read ATS feeds, don't scrape

Most companies' careers pages are a shell over Greenhouse, Lever or Ashby, and all three publish jobs as public JSON. No key, no token, no proxy.

Scrapers parse career-page HTML and break whenever someone redesigns a site. These feeds are the same data the careers page itself loads. They're complete, live, free, and they don't break. They also solve the confidence problem — a search snippet gives two lines, an ATS feed gives the entire job description, so those rows score high-confidence instead of `thin_data`.

Company names are enough. It tries the slug forms companies actually use, then falls back to a search if none hit.

### Search sources come from the profile, not a fixed list

Hardcoding job boards means hardcoding an assumption about who's using the tool. Instead, profile extraction returns **which boards this person's field actually posts on**, and search builds `site:` queries against those. A linguist gets `linguistlist.org` and `academicjobsonline.org`. An engineer gets `ycombinator.com` and `ashbyhq.com`. Same code, no special-casing.

---

## Running it

Open `index.html`. That's the whole install.

Scoring needs an API key — DeepSeek by default (cheap; a few hundred jobs costs pennies), or Anthropic. Paste it once and it's stored in your browser.

An Apify token is optional, and only needed for LinkedIn and Google-based board search. ATS pulls work without it.

Nothing is uploaded and there's no account. Data lives in browser storage, so use **Backup & transfer** to keep a copy.

## Architecture notes

- One HTML file. No build step, no dependencies, no backend.
- Storage goes through a `put`/`get` shim so the whole thing can move to a hosted database without touching the rest of the code.
- Multi-source ingestion with defensive field extraction against upstream schema drift, URL-first deduplication, and visible failure logging — a source that returns nothing says so rather than silently returning an empty list.
- Confidence is tracked separately from score, so a title-only row is discounted in ranking rather than trusted equally.
- Pipeline stages are `new / sent / live / closed`. "Due" is derived from the follow-up date rather than stored, so no row needs rewriting on a timer to stay accurate.

## Known limits

- Only Greenhouse, Lever and Ashby have usable public feeds. Companies on Workday or a hand-built careers page have to be added manually.
- Browsers can't scrape LinkedIn directly, hence Apify.
- Roles filled purely by referral are invisible to any tool. The app can point at those companies; it can't find a job that doesn't exist yet.

## Licence

MIT.
