# Job Triage

A single-file web app that reads a CV, works out which career directions are realistically open to that person, then finds and ranks jobs against them.

**[Try it →](https://jobtriage.reachbhola.workers.dev/)** · no signup, nothing leaves your browser
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

### One search path, reaching the portals and the field's own registries

One charged search reaches three kinds of source at once. **Free job APIs** (Adzuna, Jooble, Careerjet, Remotive, Remote OK) are asked directly, one query per target title. **Sites with no public API** — LinkedIn, Indeed, Naukri, Instahyre/CutShort/Foundit and Upwork — are read by five Apify Store scrapers, each asked only for what is *new* since this track's last search and capped in both rows and dollars. Everything else, including the field's own registries, is one Google `site:` query each through a single Apify actor.

The scrapers are routed from the cost ledger rather than from taste. Each one is `core`, `probe` or `off` per track mode, where a probe gets a quarter of the rows: enough that a job posted on one site only is never missed, cheap enough that a site this track was unlikely to want is not paid for at full price. `source_yield` reports rupees per exclusive 50+ job per source, and that number is what promotes or demotes a scraper — LinkedIn was demoted to a probe on 2026-09-24 for costing ₹7.66 per exclusive find against Indeed's ₹0.81.

Above all of that sits **JSearch**, which reads Google for Jobs and so covers LinkedIn, Indeed, Glassdoor, ZipRecruiter, Monster and the rest in one request per title, with the full posting text rather than a two-line snippet. It is the cheapest row in the whole search and the reason the LinkedIn scraper is only a probe: the same postings, read from Google rather than from a site that does not want to be read. It does not cover Naukri, which is why Naukri stays a scraper.

That uniformity is what makes the list long enough to be useful. A fixed baseline of general portals always goes in (LinkedIn, Upwork, Indeed, Glassdoor, Wellfound, ZipRecruiter), because that's where most advertised work sits whoever you are. On top of it, profile extraction returns **which registries this person's field actually posts on** — a linguist gets `linguistlist.org` and `academicjobsonline.org`, an engineer gets `ycombinator.com` and `ashbyhq.com`. The specialist registries are what make a niche search work at all, so they're *added* to the portals rather than made to compete with them for slots.

Location binds to the portals and only the portals, as `(<place> OR remote)`. A portal lists every job on earth and is useless until narrowed; a field registry lists forty and needs all of them, so a city term there removes more than it filters. The `OR remote` is load-bearing — a remote posting names the employer's city or no city at all, never the reader's, so requiring the city bare would drop every remote role. Google is additionally pinned to the profile's country, so its ranking matches where the person can actually work.

---

## Running it

Open `index.html`. That's the whole install.

Scoring needs an API key — DeepSeek by default (cheap; a few hundred jobs costs pennies), or Anthropic. Paste it once and it's stored in your browser.

An Apify token is optional, and only needed for board search and finding contacts. ATS pulls work without it.

Apify bills per unit of work, so the app is built to ask for as little as it can: board search is one Google page per query and fourteen queries a run, each scraper is capped at 30 rows (8 as a probe) and $0.15, and contact lookup is a single search run (about a cent) whose results are reused for a week. There is no deeper, per-profile fallback: if search finds nobody public, it says so instead of spending more.

What a search actually costs is measured, not guessed — every source writes a row to `usage_events`, and `search_cost` adds them up. Over the first nine searches a board search ran **₹0.36 to ₹17.69, median ₹1.87**, against the 25 credits it charges. Typical use runs a few dollars a month.

Nothing is uploaded and there's no account. Data lives in browser storage, so use **Backup & transfer** to keep a copy.

## Turning on accounts

Accounts are **off** until `config.js` is filled in. Unconfigured, the app behaves exactly as described above — no server, no login, data in the browser. That fallback is deliberate: a missing config must never break the app.

To switch it on:

1. Create a project at [supabase.com](https://supabase.com) (the free tier is enough to start).
2. Open the SQL editor and run [`schema.sql`](schema.sql) once. It creates one table and the row-level-security policies that keep each account's rows unreachable from any other session.
3. In **Settings → API**, copy the project URL and the `anon` / public key into `config.js`.
4. Commit and push. The next load will ask people to sign in.

The `anon` key belongs in the browser — that is what it is for, and every table is protected by row-level security, so the key alone grants nothing without a session. The **`service_role` key bypasses row-level security and must never appear in `config.js`, in this repository, or anywhere a browser can reach.**

What syncs: profiles, CVs, jobs, scores, notes, contacts and history. What does not: **API keys**, which stay in the browser they were typed into. Uploading someone's DeepSeek and Apify credentials would add real liability and buy nothing.

Running it with accounts on makes you a data controller for other people's CVs. [`privacy.html`](privacy.html), [`terms.html`](terms.html) and [`refund.html`](refund.html) are a starting point, not legal advice, and keep the in-app **Delete everything in my account** working.

## Installing it as an app

`manifest.json` and `sw.js` make it installable — home-screen icon, no browser chrome, opens offline. Nothing to configure; it works as soon as the site is served over HTTPS, which the deployment already does. The service worker is network-first, so a deploy reaches people immediately instead of being shadowed by a cached copy.

## Architecture notes

- One HTML file. No build step, no dependencies, no backend.
- Storage goes through a `put`/`get` shim so the whole thing can move to a hosted database without touching the rest of the code.
- Multi-source ingestion with defensive field extraction against upstream schema drift, URL-first deduplication, and visible failure logging — a source that returns nothing says so rather than silently returning an empty list.
- Confidence is tracked separately from score, so a title-only row is discounted in ranking rather than trusted equally.
- Pipeline stages are `new / sent / live / closed`. "Due" is derived from the follow-up date rather than stored, so no row needs rewriting on a timer to stay accurate.
- New jobs are **scored automatically** as they arrive, from every source. It never opens the key dialog on its own — a modal appearing unprompted after a search is startling — and it refuses above 60 unscored at once, because a large CSV import silently starting a long paid run is a decision, not a convenience. Switchable off in the Score panel.
- **Work Today** is the daily home: everything scored at fit 65+ and reachability 45+ that you haven't actioned, split into "do these first" and "worth a shot". It deliberately ignores the map's drag-selection — a box drawn yesterday silently shortening the list tomorrow is the kind of invisible state that makes a tool untrustworthy.
- **Trim to top 50** bins scored roles you never acted on that rank below the top 50. Anything applied to, contacted, or logged against is kept whatever it scored — that history is the only record it exists, and no score justifies deleting it. Unscored rows are kept too, since "not top 50" is not a judgement you can make about something never judged.
- Posting age is stored as a window (`posted_lo` / `posted_hi`) with its provenance, not a single date. ATS feeds state a real one; a search snippet often carries "5 days ago"; only what none of those answered is estimated by the model, which returns a range or nothing rather than a date it can't defend. The **Freshest** tab sorts on it, and rows with no date are listed apart rather than treated as old.

## Known limits

- Only Greenhouse, Lever and Ashby have usable public feeds. Companies on Workday or a hand-built careers page have to be added manually.
- Browsers can't query Google or the job portals directly, hence Apify.
- Roles filled purely by referral are invisible to any tool. The app can point at those companies; it can't find a job that doesn't exist yet.

## Licence

MIT.
