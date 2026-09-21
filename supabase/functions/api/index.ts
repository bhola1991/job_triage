// Job Triage — the one place the app's own API keys live.
//
// The browser sends its Supabase session; this checks it, takes credits, and
// makes the DeepSeek / Apify / Razorpay call with keys stored as Supabase
// secrets. Nothing secret is ever returned to the browser.
//
// Secrets (supabase secrets set ...):
//   DEEPSEEK_API_KEY, TYPESAFE_API_KEY, APIFY_TOKEN, JSEARCH_API_KEY (RapidAPI), RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
//   optional job sources: ADZUNA_APP_ID, ADZUNA_APP_KEY, JOOBLE_API_KEY, CAREERJET_API_KEY
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";
import { judge } from "../_shared/judge.ts";

// Prices are server-side only; the browser sends just the pack id. paise: ₹1 = 100.
// A credit sells for ₹0.80 (Pro) to ₹0.99 (Starter).
const PACKS: Record<string, { credits: number; paise: number; label: string }> = {
  starter: { credits: 100, paise: 9900, label: "Starter" },
  pro: { credits: 500, paise: 39900, label: "Pro" },
};
// Credits per action. What each costs us, roughly:
//   llm          1 DeepSeek call                                        ~₹0.10-0.30
//   boardSearch  flat: up to 4 JSearch requests (₹0.44 each, pay-as-you-go),
//                Adzuna/Jooble/Careerjet/Remotive/RemoteOK (free),
//                up to 14 Google queries (~₹0.30 each, specialist boards + fallback),
//                5 Apify scrapers, new-since-last-search only, 30 rows and $0.15 max each,
//                plus scoring every new job (~₹0.2-0.4 per call of 12)
//                estimated ~₹25-40 per search; the usage ledger has the real figure.
//                ponytail: 25 credits undercharges that; set once the ledger has ~20 searches.
//   apifyQuery   per Google query, for everything else (HR lookup = 3)  ~₹0.30
const COST = { llm: 1, boardSearch: 25, apifyQuery: 3 };

/* The ceiling on one hosted LLM call, reasoning included. deepseek-v4-pro
   thinks before it answers and those tokens come out of this same number, so
   this is not "how long may the reply be" -- it is the whole budget. It must
   equal TOK_CAP in index.html: the browser sends max_tokens and this clamps it,
   so if this were the smaller of the two every hosted call would be quietly
   trimmed below what the app asked for and the only symptom would be truncated
   JSON. scripts/pipeline-map.js asserts the two agree; keep the name, it is
   read out of this file by that check. */
const LLM_TOK_CAP = 4000;

const secret = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`server is missing the ${k} secret`);
  return v;
};
const admin = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"));

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
class Http extends Error { constructor(public status: number, msg: string) { super(msg); } }

const APIFY = "https://api.apify.com/v2";
// The only actor the app uses. Anything else would let a user run arbitrary
// (and arbitrarily expensive) actors on your Apify account.
const ACTOR = "apify~google-search-scraper";
const MAX_QUERIES = 14;
// How long after a search its yield report is still accepted.
const REPORT_WINDOW_MS = 15 * 60_000;
const MAX_REGISTRY_QUERIES = 8;   // the specialist boards a board search adds to JSearch

/* JSearch reads Google for Jobs, so one request covers LinkedIn, Indeed,
   Glassdoor, Naukri and company sites at once, with full descriptions. One
   request per target title, first page only (~10 jobs each). */
const MAX_TITLES = 4;
async function jsearch(title: string, where: string, country: string, since: number) {
  const q = new URLSearchParams({
    query: where ? `${title} in ${where}` : title,
    page: "1", num_pages: "1",
    date_posted: since <= 1 ? "today" : since <= 3 ? "3days" : since <= 7 ? "week" : "month",
  });
  if (/^[a-z]{2}$/i.test(country)) q.set("country", country.toLowerCase());
  const r = await fetch("https://jsearch.p.rapidapi.com/search?" + q, {
    headers: { "X-RapidAPI-Key": secret("JSEARCH_API_KEY"), "X-RapidAPI-Host": "jsearch.p.rapidapi.com" },
  });
  if (!r.ok) throw new Error(`JSearch ${r.status}: ${(await r.text()).slice(0, 120)}`);
  // deno-lint-ignore no-explicit-any
  return ((await r.json()).data || []).map((x: any): Job => ({
    title: x.job_title || "",
    company: x.employer_name || "",
    url: x.job_apply_link || x.job_google_link || "",
    location: [x.job_city, x.job_state, x.job_country].filter(Boolean).join(", ") + (x.job_is_remote ? " (remote)" : ""),
    description: String(x.job_description || "").slice(0, 4000),
    posted: isoDay(x.job_posted_at_datetime_utc),
    publisher: x.job_publisher || "JSearch",
  }));
}

/* ═══ more job sources ═══
   Every source returns the same Job shape, so the app treats them alike.
   A source whose key isn't set is skipped, not an error: each one is optional.
   All are free; none changes what a search costs the user. */
// publisher: the site the posting is on (shown to the user). origin: which of
// our sources delivered it (for the ledger), e.g. JSearch can deliver a LinkedIn posting.
type Job = { title: string; company: string; url: string; location: string; description: string; posted: string; publisher: string; origin?: string };
// deno-lint-ignore no-explicit-any
type Any = any;
const PER_SOURCE = 50;   // free APIs: take a full page (Adzuna and Jooble cap a page at 50)
const env = (k: string) => Deno.env.get(k) || "";
const countryCode = (c: string) => (/^[a-z]{2}$/i.test(c.trim()) ? c.trim().toLowerCase() : "in");
/* Some sources want their key in the URL rather than a header: Jooble takes it
   as a path segment, Adzuna as query parameters. A failure message that quotes
   the request URL therefore quotes the key, and those messages travel — into
   the board_search response as sourceErrors, into usage_events.note, and into
   the logs. So nothing derived from a request may leave here unredacted. */
const SECRETS_IN_URLS = ["JOOBLE_API_KEY", "ADZUNA_APP_ID", "ADZUNA_APP_KEY"];
const redact = (s: string) => SECRETS_IN_URLS
  .map((k) => env(k))
  .filter((v) => v.length > 3)
  .reduce((acc, v) => acc.split(v).join("<redacted>"), String(s));
// Dates arrive as ISO strings, RFC dates, or epoch seconds/milliseconds (as numbers or digit strings).
const isoDay = (v: unknown) => {
  const s = String(v ?? "").trim();
  const d = /^\d{13}$/.test(s) ? new Date(+s) : /^\d{10}$/.test(s) ? new Date(+s * 1000) : new Date(s);
  return s && !isNaN(+d) ? d.toISOString().slice(0, 10) : "";
};
const plain = (h: unknown) => String(h || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const getJson = async (url: string, init: RequestInit = {}) => {
  // The host is named, never the URL: a transport-level failure (DNS, TLS,
  // reset, proxy) rejects out of fetch with a message that embeds the whole
  // request URL, credentials included.
  const host = new URL(url).hostname;
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
    .catch(() => { throw new Error(`${host}: network error`); });
  if (!r.ok) throw new Error(`${host} ${r.status}: ${redact((await r.text()).slice(0, 100))}`);
  return r.json();
};
const ADZUNA_COUNTRIES = new Set(["gb", "us", "ca", "au", "de", "fr", "es", "it", "nl", "at", "be", "br", "in", "mx", "nz", "pl", "sg", "za"]);

async function adzuna(title: string, where: string, country: string, since: number): Promise<Job[] | null> {
  const cc = country.toLowerCase();
  if (!env("ADZUNA_APP_ID") || !ADZUNA_COUNTRIES.has(cc)) return null;
  const q = new URLSearchParams({ app_id: env("ADZUNA_APP_ID"), app_key: env("ADZUNA_APP_KEY"), what: title,
    results_per_page: String(PER_SOURCE), max_days_old: String(since), sort_by: "date", "content-type": "application/json" });
  if (where && !/^remote$/i.test(where)) q.set("where", where.split(",")[0]);
  const d = await getJson(`https://api.adzuna.com/v1/api/jobs/${cc}/search/1?${q}`);
  return (d.results || []).map((x: Any): Job => ({ title: plain(x.title), company: x.company?.display_name || "",
    url: x.redirect_url || "", location: x.location?.display_name || "", description: plain(x.description),
    posted: isoDay(x.created), publisher: "Adzuna" }));
}

async function jooble(title: string, where: string): Promise<Job[] | null> {
  if (!env("JOOBLE_API_KEY")) return null;
  const d = await getJson(`https://jooble.org/api/${env("JOOBLE_API_KEY")}`, { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keywords: title, location: /^remote$/i.test(where) ? "" : where, page: "1", ResultOnPage: String(PER_SOURCE) }) });
  return (d.jobs || []).map((x: Any): Job => ({ title: plain(x.title), company: x.company || "", url: x.link || "",
    location: x.location || "", description: plain(x.snippet), posted: isoDay(x.updated), publisher: x.source || "Jooble" }));
}

// Careerjet requires the end user's IP and user agent on every call.
async function careerjet(title: string, where: string, country: string, req: Request): Promise<Job[] | null> {
  if (!env("CAREERJET_API_KEY")) return null;
  const q = new URLSearchParams({ keywords: title, locale_code: `en_${(country || "GB").toUpperCase()}`, page_size: String(PER_SOURCE), sort: "date",
    user_ip: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "0.0.0.0",
    user_agent: req.headers.get("user-agent") || "JobTriage" });
  if (where && !/^remote$/i.test(where)) q.set("location", where.split(",")[0]);
  const d = await getJson(`https://search.api.careerjet.net/v4/query?${q}`, { headers: { Authorization: "Basic " + btoa(env("CAREERJET_API_KEY") + ":") } });
  return (d.jobs || []).map((x: Any): Job => ({ title: plain(x.title), company: x.company || "", url: x.url || "",
    location: x.locations || "", description: plain(x.description), posted: isoDay(x.date), publisher: "Careerjet" }));
}

/* Remotive and RemoteOK are free public feeds of remote jobs that ask callers
   not to poll them often. So each feed is fetched whole at most once per
   6 hours per server instance and matched against titles here.
   ponytail: cache is per edge-function instance, not shared; move it to a DB
   table if their rate limits are ever hit. */
const feedCache = new Map<string, { at: number; jobs: Job[] }>();
async function cachedFeed(key: string, load: () => Promise<Job[]>) {
  const hit = feedCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.jobs;
  const jobs = await load();
  feedCache.set(key, { at: Date.now(), jobs });
  return jobs;
}
const remotive = () => cachedFeed("remotive", async () =>
  ((await getJson("https://remotive.com/api/remote-jobs")).jobs || []).map((x: Any): Job => ({ title: plain(x.title),
    company: x.company_name || "", url: x.url || "", location: `${x.candidate_required_location || "Anywhere"} (remote)`,
    description: plain(x.description).slice(0, 4000), posted: isoDay(x.publication_date), publisher: "Remotive" })));
// RemoteOK's terms: link back to them and name them as the source. url and publisher do both.
const remoteok = () => cachedFeed("remoteok", async () =>
  ((await getJson("https://remoteok.com/api", { headers: { "User-Agent": "JobTriage (jobtriage.reachbhola.workers.dev)" } })) as Any[])
    .filter((x) => x && x.position).map((x: Any): Job => ({ title: plain(x.position), company: x.company || "",
      url: x.url || "", location: `${x.location || "Anywhere"} (remote)`, description: plain(x.description).slice(0, 4000),
      posted: isoDay(x.date), publisher: "Remote OK" })));
function titleMatches(jobs: Job[], titles: string[]) {
  const words = [...new Set(titles.join(" ").toLowerCase().split(/[^a-z+#]+/).filter((w) => w.length >= 4))];
  return jobs.filter((j) => words.some((w) => j.title.toLowerCase().includes(w)));
}

/* ═══ Apify scrapers for sites with no API ═══
   LinkedIn, Indeed, Naukri, Instahyre/CutShort/Foundit and Upwork publish no
   job API, so these run Apify Store actors on APIFY_TOKEN. Each is a
   pay-per-result actor, capped twice: maxItems (how many rows) and
   maxTotalChargeUsd (a hard dollar ceiling per run, whatever the actor charges).
   Runs are started here and polled by the browser like the Google run.
   Prices seen on the Apify Store, Sep 2026 (per 1,000 results): Indeed $3,
   India tech boards $4, Naukri from $1 + start fee, Upwork $0.14, LinkedIn not
   published. Actor ids and inputs were read from their Store pages. If one
   changes its input, that source just returns nothing. */
/* Every site runs on every search, so a job posted only on Naukri or Instahyre
   is never missed. What keeps that affordable is asking each one only for what
   is NEW since this user last searched this track (`since`, in days, 1-30),
   newest first, and capping each at SCRAPE_ROWS. A daily searcher pays for a
   day or two of postings per site, not a month. Queries use the track's titles
   plus the CV's hard skills where the site's search supports it, so the rows
   we pay for are relevant ones. */
const SCRAPE_ROWS = 30;
/* A source the track's mode does not centre on still runs, at a quarter of the
   rows. That keeps the property the comment above defends -- a job posted only
   on one site is never missed -- while paying a quarter of the price for the
   sites this track was unlikely to want. Cutting them to zero would buy a
   little more, and would be the first time this app silently stopped looking
   somewhere; a thin read is recoverable, a blind spot is not. */
const PROBE_ROWS = 8;
const MIN_WINDOW_DAYS = 7;
const SCRAPE_MAX_USD = 0.15;
/* mode: the shape of work the TRACK is after (see PORTALS_BY_MODE in the app).
   A track with no mode -- every profile extracted before the field existed --
   runs every scraper at full rows, which is what all of them did before. */
type Mode = "permanent" | "freelance" | "gig";
type Tier = "core" | "probe" | "off";
type Ctx = { titles: string[]; skills: string[]; city: string; cc: string; since: number; mode: string };
const rowsFor = (modes: Partial<Record<Mode, Tier>> | undefined, mode: string) => {
  const t = modes?.[mode as Mode];
  if (!modes || !(mode in (modes as object))) return SCRAPE_ROWS;   // unknown mode: behave as before
  return t === "core" ? SCRAPE_ROWS : t === "probe" ? PROBE_ROWS : 0;
};
const orTerms = (xs: string[]) => xs.length > 1 ? `(${xs.map((x) => `"${x}"`).join(" OR ")})` : xs[0] ? `"${xs[0]}"` : "";
// Round `since` up to the nearest value a site accepts.
const bucket = (since: number, steps: number[]) => steps.find((s) => s >= since) ?? steps[steps.length - 1];
const INDEED_HOST: Record<string, string> = { in: "in.indeed.com", us: "www.indeed.com", gb: "uk.indeed.com" };

/* `modes` is the routing table, and it is meant to be edited from the ledger
   rather than from taste: source_yield reports inr_per_exclusive_50 per source
   per mode, so a probe that keeps returning jobs nothing else found is asking
   to be promoted, and a core that does not is asking to be demoted. */
const SCRAPERS: Record<string, {
  actor: string; label: string; india?: boolean;
  modes: Record<Mode, Tier>;
  input: (c: Ctx, rows: number) => object;
}> = {
  // publishedAt is LinkedIn's own r<seconds> filter (the Store page's example is "r604800").
  // Salaried work's first stop. It carries contract roles too, so freelance
  // probes it rather than skipping it; gig work is not advertised here at all.
  linkedin: { actor: "bebity~linkedin-jobs-scraper", label: "LinkedIn",
    modes: { permanent: "core", freelance: "probe", gig: "off" },
    input: (c, rows) => ({ titles: c.titles, locations: c.city ? [c.city] : [], rows, companyProfile: false,
      publishedAt: `r${bucket(c.since, [1, 7, 30]) * 86400}` }) },
  // A search URL rather than position/location, because only the URL carries
  // Indeed's fromage (days) and sort=date. Titles only: adding skills as a second
  // required term returned nothing for a real niche search.
  // ponytail: startUrls with fromage is untested with this actor; if it returns
  // nothing, switch back to position/location and let the age filter cut old rows.
  // The one portal that carries both ends: salaried posts and the driver,
  // delivery and warehouse listings that are the only advertised gig work.
  indeed: { actor: "misceres~indeed-scraper", label: "Indeed",
    modes: { permanent: "core", freelance: "probe", gig: "core" },
    // Safe to build a host from cc: countryCode() has already constrained it to
    // exactly two ASCII letters, so it cannot carry a dot, slash, @ or colon.
    // ca/au/de/fr etc. genuinely live at <cc>.indeed.com.
    input: (c, rows) => ({ startUrls: [{ url: `https://${INDEED_HOST[c.cc] || `${c.cc}.indeed.com`}/jobs?` + new URLSearchParams({
      q: orTerms(c.titles), l: c.city, sort: "date",
      fromage: String(bucket(c.since, [1, 3, 7, 14])) }) }], maxItemsPerSearch: rows, parseCompanyDetails: false, saveOnlyUniqueItems: true }) },
  // Naukri treats comma-separated keywords as any-of.
  naukri: { actor: "memo23~naukri-scraper", label: "Naukri", india: true,
    modes: { permanent: "core", freelance: "probe", gig: "probe" },
    input: (c, rows) => ({ platform: "naukri", searchQuery: c.titles.slice(0, 3).join(", "), location: c.city, maximumJobs: rows,
      freshnessDays: bucket(c.since, [1, 3, 7, 15, 30]), sortBy: "date" }) },
  // No date filter on this actor: capped rows, and the app's 30-day age filter drops old ones.
  // Salaried tech hiring only: none of the three lists project or task work.
  indiatech: { actor: "seemuapps~india-tech-jobs-scraper", label: "Instahyre / CutShort / Foundit", india: true,
    modes: { permanent: "core", freelance: "off", gig: "off" },
    input: (c, rows) => ({ keywords: c.titles[0], location: c.city, boards: ["instahyre", "cutshort", "foundit"], maxItems: rows }) },
  // Upwork gigs are found by tool/skill more than by job title.
  // Nothing salaried is posted here, and platform gig work is signed up for
  // rather than applied to, so only a freelance track has anything to gain.
  upwork: { actor: "valig~upwork-jobs-scraper", label: "Upwork",
    modes: { permanent: "off", freelance: "core", gig: "off" },
    input: (c, rows) => ({ keywords: c.skills[0] || c.titles[0], sort: "recency", limit: rows }) },
};

/* A scraper that fails to START (actor needs renting, input rejected, Apify
   out of credit) is reported back like any other failed source; before, it
   vanished silently and the search just looked thin. */
/* A FREE search runs only these, the paid sources that matter most per rupee.
   Paid and unlimited searches run every scraper. Sources that cost us nothing
   (Adzuna, Jooble, Careerjet, Remotive, Remote OK, company feeds) run either way;
   JSearch and the Google run cost per request, so free searches skip them. */
const FREE_SCRAPERS = ["linkedin", "indeed", "naukri"];

async function startScrapers(user: string, c: Ctx, only?: string[]) {
  const errors: string[] = [];
  const started = await Promise.all(Object.entries(SCRAPERS)
    .map(([source, s]) => [source, s,
      (!s.india || c.cc === "in") && (!only || only.includes(source)) ? rowsFor(s.modes, c.mode) : 0] as const)
    // rows 0 = wrong country, a site this track's mode has nothing to find on,
    // or a free search. Not an error and not a failed source: it was never asked.
    .filter(([, , rows]) => rows > 0)
    .map(async ([source, s, rows]) => {
      const r = await apify(`/acts/${s.actor}/runs?timeout=300&maxItems=${rows}&maxTotalChargeUsd=${SCRAPE_MAX_USD}`, {
        method: "POST", body: JSON.stringify(s.input(c, rows)),
      }).catch((e) => { errors.push(`${source}: ${(e as Error).message}`); return null; });
      if (!r) return null;
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        const msg = (() => { try { return JSON.parse(body).error?.message; } catch { return ""; } })() || body.slice(0, 140);
        errors.push(`${source}: Apify ${r.status} ${msg}`);
        return null;
      }
      // A 2xx whose body is truncated or not JSON must be reported like any
      // other failed source, not thrown: this runs inside a Promise.all that
      // the caller has already paid for.
      const run = await r.json().then((d) => d?.data).catch(() => null);
      if (!run?.id) { errors.push(`${source}: Apify returned no run`); return null; }
      await admin.from("apify_runs").insert({ run_id: run.id, user_id: user, dataset_id: run.defaultDatasetId, source });
      return { id: run.id, source, label: s.label };
    }));
  if (errors.length) console.error("scraper start failed:", errors);
  return { scrapers: started.filter(Boolean), errors };
}

/* ═══ usage ledger (usage_events in billing.sql) ═══
   ₹ figures are ESTIMATES: units × list price. DeepSeek token counts are exact
   (from its response); only the ₹ per token is a list price. Check these
   against your real bills and update. Logging never fails a request. */
const USD_INR = 88;
const PRICE_USD: Record<string, number> = {
  jsearch: 0.005,          // per request, RapidAPI pay-as-you-go
  google: 0.0035,          // per Google query page (Apify google-search-scraper)
  linkedin: 0.005,         // per row; bebity doesn't publish a price, so this is a cautious guess
  indeed: 0.003, naukri: 0.001, indiatech: 0.004, upwork: 0.00014,   // per row, Apify Store
  adzuna: 0, jooble: 0, careerjet: 0, remotive: 0, remoteok: 0,
};
/* Per tier, because the browser can now ask for either and they are not close:
   flash is ~4x cheaper in, ~7x cheaper on a cache hit, ~3x cheaper out. Pricing
   one at the other's rate would not fail anything -- it would just quietly make
   every ₹ figure in the ledger wrong, which is the number this whole table
   exists to get right. Peak list price, as before: DeepSeek halves these
   off-peak (01:00-04:00 and 06:00-10:00 UTC Mon-Fri are peak), so a real bill
   lands at or under what this records. Verify against yours. */
const DEEPSEEK_USD_PER_M: Record<string, { in: number; in_cached: number; out: number }> = {
  "deepseek-v4-pro": { in: 1.32, in_cached: 0.044, out: 3.96 },   // V4-Pro-0813
  "deepseek-flash":  { in: 0.30, in_cached: 0.006, out: 1.20 },   // V4.1-Flash
};

/* The browser sends a tier name and never a model id -- our key pays for this
   call, so the model is chosen here. An unknown or missing tier is pro: the
   fallback has to be the one that answers well, because the failure mode of
   guessing wrong is a worse score, not an error anyone sees. */
const LLM_MODELS: Record<string, string> = { pro: "deepseek-v4-pro", flash: "deepseek-flash" };
const inr = (usd: number) => Math.round(usd * USD_INR * 1000) / 1000;
async function logUsage(rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const { error } = await admin.from("usage_events").insert(rows);
  if (error) console.error("usage log:", error.message);
}

/* Actors disagree on field names, so take the first one present. */
const pick = (x: Any, ...keys: string[]) => { for (const k of keys) { const v = k.split(".").reduce((o, p) => o?.[p], x); if (v !== undefined && v !== null && v !== "") return v; } return ""; };
function scrapedJob(x: Any, source: string): Job {
  let url = String(pick(x, "jobUrl", "url", "link", "staticUrl", "JdURL", "applyUrl", "externalApplyLink"));
  if (source === "naukri" && url && !/^https?:/.test(url)) url = "https://www.naukri.com/" + url.replace(/^\//, "");
  const loc = pick(x, "location", "locations", "jobLocation", "city", "formattedLocation");
  return {
    title: plain(pick(x, "title", "positionName", "jobTitle", "Designation", "position", "name")),
    company: plain(pick(x, "companyName", "company", "companyDetail.name", "Company.Name", "company_name", "employer")),
    url,
    location: (Array.isArray(loc) ? loc.map((l: Any) => l?.label || l?.name || l).join(", ") : String(loc)) + (source === "upwork" ? " (remote)" : ""),
    description: plain(pick(x, "description", "descriptionText", "jobDescription", "snippet")).slice(0, 4000),
    posted: isoDay(pick(x, "publishedAt", "postedAt", "datePosted", "createdDate", "createdOn", "publishedOn", "date")),
    publisher: SCRAPERS[source].label,
    origin: source,
  };
}

/* Every API source at once. Returns the jobs (deduped by link, each tagged
   with the origin that delivered it), one error line per source that failed,
   and how many requests each origin made, for the ledger. The remote feeds
   are cached, so they carry no date filter; the app's age filter covers them. */
async function searchAll(titles: string[], where: string, country: string, since: number, req: Request, free = false) {
  // A source whose key isn't set resolves to null: skipped, not a request, not logged.
  // JSearch bills per request, so a free search resolves it to null rather than calling it.
  const named: [string, Promise<Job[] | null>][] = [
    ...titles.map((t) => ["jsearch", free ? Promise.resolve(null) : jsearch(t, where, country, since)] as [string, Promise<Job[] | null>]),
    ...titles.map((t) => ["adzuna", adzuna(t, where, country, since)] as [string, Promise<Job[] | null>]),
    ...titles.map((t) => ["jooble", jooble(t, where)] as [string, Promise<Job[] | null>]),
    ...titles.map((t) => ["careerjet", careerjet(t, where, country, req)] as [string, Promise<Job[] | null>]),
    ["remotive", remotive().then((j) => titleMatches(j, titles))],
    ["remoteok", remoteok().then((j) => titleMatches(j, titles))],
  ];
  const settled = await Promise.allSettled(named.map(([, p]) => p));
  const seen = new Set<string>(), jobs: Job[] = [], errors = new Map<string, string>(), requests: Record<string, number> = {};
  settled.forEach((s, i) => {
    const origin = named[i][0];
    if (s.status === "rejected") { errors.set(origin, redact(String((s.reason as Error)?.message || s.reason)).slice(0, 140)); return; }
    if (s.value === null) return;
    requests[origin] = (requests[origin] || 0) + 1;
    for (const j of s.value) {
      const k = j.url.toLowerCase();
      if (!j.title || !j.url || seen.has(k)) continue;
      seen.add(k); jobs.push({ ...j, origin });
    }
  });
  return { jobs, requests, errors: [...errors].map(([src, msg]) => `${src}: ${msg}`) };
}

// What the browser gets back after any spend: enough to redraw the credits button.
type Spent = { used: "free" | "paid" | "unlimited"; balance: number; free_search: number; free_tier: boolean; unlimited?: boolean };
const wallet = (s: Spent) => ({ balance: s.balance, free_search: s.free_search, free_tier: s.free_tier, unlimited: !!s.unlimited });

// spend_llm / spend_search in billing.sql: free pot first, then paid credits.
async function spend(fn: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw error;
  if (!data) throw new Http(402, "NEEDCREDITS");
  return data as Spent;
}
// Our upstream call failed, so it shouldn't cost them: put it back where it came from.
async function refund(user: string, s: Spent, kind: "llm" | "search", n: number) {
  if (s.used === "unlimited") return;          // nothing was taken
  if (s.used === "free") await admin.rpc("refund_free", { p_user: user, p_what: kind });
  else await admin.rpc("add_credits", { p_user: user, p_n: n });
}
async function ownRun(user: string, id: string) {
  const { data } = await admin.from("apify_runs").select("dataset_id").eq("run_id", String(id)).eq("user_id", user).maybeSingle();
  if (!data) throw new Http(404, "run not found");
  return data.dataset_id as string;
}
const apify = (path: string, init: RequestInit = {}) =>
  fetch(APIFY + path, { ...init, headers: { Authorization: "Bearer " + secret("APIFY_TOKEN"), "Content-Type": "application/json" } });

async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const sameString = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth?.user?.id;
    if (!user) throw new Http(401, "sign in first");

    const b = await req.json().catch(() => ({}));
    switch (b.action) {
      case "packs":
        return json({ packs: PACKS, costs: COST });

      // One board search, charged once: JSearch for the big portals, then a
      // Google run over the track's specialist boards. If JSearch brings back
      // nothing (down, bad key, or no matches), the Google run also covers the
      // big portals (`fallback`), so a search never silently shrinks to niche
      // boards alone. The run id is polled by the browser via apify_status/items.
      case "board_search": {
        const lines = (v: unknown) => String(v || "").split("\n").map((q) => q.trim()).filter(Boolean);
        const list = (v: unknown, n: number) => (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).slice(0, n);
        const titles = list(b.titles, MAX_TITLES);
        if (!titles.length) throw new Http(400, "no titles");
        const where = String(b.where || ""), country = String(b.country || "");
        // Days since this user last searched this track (the app sends it); first search = 30.
        // Never narrower than MIN_WINDOW_DAYS: each site is capped at SCRAPE_ROWS
        // anyway, so a 1-day window saved almost nothing and returned almost
        // nothing for niche roles. Jobs already in the list are dropped as seen.
        const since = Math.min(Math.max(Math.ceil(Number(b.since_days) || 30), MIN_WINDOW_DAYS), 30);
        const ctx: Ctx = { titles, skills: list(b.skills, 6), since, mode: String(b.mode || ""),
          // cc lands in the HOST of the Indeed search URL, so it is shape-checked
          // here rather than trusted: anything but two letters would let a caller
          // choose the origin a paid scraper run fetches.
          city: /^remote$/i.test(where) ? "" : where.split(",")[0].trim(), cc: countryCode(country) };
        const s = await spend("spend_search", { p_user: user, p_n: COST.boardSearch, p_board: true });
        try {
          const searchId = crypto.randomUUID();
          const free = s.used === "free";

          const [{ jobs, errors, requests }, { scrapers, errors: scrapeErrors }] = await Promise.all([
            searchAll(titles, where, country, since, req, free),
            startScrapers(user, ctx, free ? FREE_SCRAPERS : undefined),
          ]);
          errors.push(...scrapeErrors);
          if (errors.length) console.error("sources:", errors);
          // A source that failed leaves NO other trace in the ledger: its cost row
          // is only written on success, so silence and "never ran" looked identical.
          // 5 searches ran JSearch and it logged nothing at all, because every call
          // threw. One zero-unit row per failure makes that readable in SQL.
          await logUsage(errors.slice(0, 20).map((e) => ({
            user_id: user, search_id: searchId, kind: "error",
            source: e.split(":")[0].trim().slice(0, 40), units: 0, note: e.slice(0, 300),
          })));
          // Scraper rows are logged when their results are fetched (apify_items), since only then is the count known.
          await logUsage(Object.entries(requests).map(([source, units]) =>
            ({ user_id: user, search_id: searchId, kind: "api", source, units, cost_inr: inr(units * (PRICE_USD[source] || 0)) })));

          // Free searches skip the Google run entirely (specialist boards and fallback): it costs per query.
          const queries = free ? [] : [...(jobs.length ? [] : lines(b.fallback)), ...lines(b.queries).slice(0, MAX_REGISTRY_QUERIES)].slice(0, MAX_QUERIES);
          const run = queries.length
            ? await apify(`/acts/${ACTOR}/runs?timeout=660`, {
                method: "POST",
                body: JSON.stringify({ queries: queries.join("\n"), countryCode: String(b.country || "").toLowerCase(), languageCode: "en", maxPagesPerQuery: 1, resultsPerPage: 10, mobileResults: false }),
              }).then((r) => (r.ok ? r.json() : null)).then((d) => d?.data || null).catch(() => null)
            : null;
          // Nothing came back from anywhere: they got nothing, so they pay nothing.
          if (!jobs.length && !run?.id && !scrapers.length) {
            await refund(user, s, "search", COST.boardSearch);
            throw new Http(502, `Job search is down right now${errors[0] ? ` (${errors[0]})` : ""}. No credits were used — try again shortly.`);
          }
          if (run?.id) {
            await admin.from("apify_runs").insert({ run_id: run.id, user_id: user, dataset_id: run.defaultDatasetId, source: "google" });
            await logUsage([{ user_id: user, search_id: searchId, kind: "api", source: "google", units: queries.length, cost_inr: inr(queries.length * PRICE_USD.google) }]);
          }
          return json({ jobs, runId: run?.id || null, queries, scrapers, searchId, since, free, sourceErrors: errors, ...wallet(s) });
        } catch (e) {
          // Anything that throws after the credit was taken has to put it back.
          // The outer handler collapses a non-Http error into "Server error" and
          // refunds nothing, so an unexpected failure here used to be charged
          // for silently. The Http paths above refund themselves, so they are
          // deliberately left alone.
          if (!(e instanceof Http)) await refund(user, s, "search", COST.boardSearch);
          throw e;
        }
      }

      // The app's per-source yield for one search: found, new, scored 50+, and
      // 50+ that no other source had. Analytics only, so it's taken as reported.
      case "search_report": {
        const sid = String(b.search_id || "");
        if (!/^[0-9a-f-]{36}$/i.test(sid)) throw new Http(400, "bad search id");
        // These numbers feed source_yield.inr_per_exclusive_50, which is the
        // table SCRAPERS[].modes is meant to be edited from -- so a report has
        // to come from a real search of this caller's. This was the one mutating
        // action that spent nothing and proved nothing: any uuid and any figures
        // were accepted, 30 rows at a time, unmetered and unbounded.
        const { data: own } = await admin.from("usage_events")
          .select("created_at").eq("search_id", sid).eq("user_id", user)
          .order("created_at", { ascending: true }).limit(1).maybeSingle();
        if (!own) throw new Http(404, "unknown search");
        if (Date.now() - new Date(own.created_at as string).getTime() > REPORT_WINDOW_MS)
          throw new Http(409, "search too old to report");
        // One report per search: a retry must not double the row count.
        const { count: already } = await admin.from("usage_events")
          .select("id", { count: "exact", head: true }).eq("search_id", sid).eq("kind", "yield");
        if (already) throw new Http(409, "already reported");
        const n = (v: unknown) => Math.min(Math.max(Math.round(Number(v) || 0), 0), 100000);
        const known = new Set([...Object.keys(PRICE_USD)]);
        await logUsage(Object.entries(b.sources || {}).filter(([k]) => known.has(k)).slice(0, 30).map(([source, v]: [string, Any]) => ({
          user_id: user, search_id: sid, kind: "yield", source,
          found: n(v.found), unique_new: n(v.unique_new), kept_50: n(v.kept_50), exclusive_50: n(v.exclusive_50),
        })));
        return json({ ok: true });
      }

      case "llm": {
        const prompt = String(b.prompt || "");
        if (!prompt || prompt.length > 200_000) throw new Http(400, "bad prompt");
        const model = LLM_MODELS[String(b.tier || "pro")] || LLM_MODELS.pro;
        const s = await spend("spend_llm", { p_user: user, p_n: COST.llm });
        try {
          const r = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + secret("DEEPSEEK_API_KEY") },
            body: JSON.stringify({
              model,
              reasoning_effort: "high", thinking: { type: "enabled" },
              max_tokens: Math.min(Number(b.max_tokens) || LLM_TOK_CAP, LLM_TOK_CAP),
              messages: [{ role: "user", content: prompt }],
            }),
          }).catch(() => null);
          // A truncated or non-JSON 200 rejected here, after the credit was
          // taken, and the outer handler refunds nothing -- so it fell through to
          // "Server error" having charged for nothing. Fail soft into the !text
          // branch below, which refunds.
          const d = r && r.ok ? await r.json().catch(() => null) : null;
          const text = (d?.choices?.[0]?.message?.content || "").trim();
          if (!text) {                       // their call failed, so it shouldn't cost them
            await refund(user, s, "llm", COST.llm);
            throw new Http(502, "The model didn't answer. No credit was used — try again.");
          }
          // Hit the ceiling: the reply is real but cut off mid-token, so its JSON
          // will not parse and the caller keeps the batch unscored. That is the
          // same worthless outcome as no answer at all, and it used to be the
          // expensive one -- 200 OK, credit kept, nothing scored, and the only
          // trace a grabJSON throw in the browser. Refund it and say so.
          if (d?.choices?.[0]?.finish_reason === "length") {
            await refund(user, s, "llm", COST.llm);
            throw new Http(502, `The model ran past its ${LLM_TOK_CAP}-token ceiling and the answer was cut off. No credit was used — try again, or score fewer jobs at once.`);
          }
          // DeepSeek reports cached prompt tokens separately; they're what a stable prompt start saves.
          const u = d.usage || {}, cached = u.prompt_cache_hit_tokens || 0, tin = u.prompt_tokens || 0, tout = u.completion_tokens || 0;
          // No price for a model is a gap in the table above, not a reason to fail
          // a call the user already paid a credit for: record the tokens with a
          // null ₹ so the hole is visible in the ledger instead of being filled
          // with another model's rate.
          const px = DEEPSEEK_USD_PER_M[model];
          // source stays "deepseek" so source_yield keeps one row for it rather
          // than one per tier; which model ran goes in note, which is otherwise
          // only written on error rows and is free here. A real `model` column
          // would be cleaner, but adding one means logUsage inserts a column a
          // not-yet-migrated database does not have -- and logUsage swallows its
          // own errors, so the ledger would stop recording llm calls silently.
          await logUsage([{ user_id: user, search_id: /^[0-9a-f-]{36}$/i.test(String(b.search_id)) ? b.search_id : null,
            kind: "llm", source: "deepseek", units: 1, tokens_in: tin, tokens_cached: cached, tokens_out: tout, note: model,
            cost_inr: px ? inr(((tin - cached) * px.in + cached * px.in_cached + tout * px.out) / 1e6) : null }]);
          return json({ text, ...wallet(s) });
        } catch (e) {
          // Anything that throws after the credit was taken has to put it back.
          // The outer handler collapses a non-Http error into "Server error" and
          // refunds nothing, so an unexpected failure here used to be charged
          // for silently. The Http paths above refund themselves, so they are
          // deliberately left alone.
          if (!(e instanceof Http)) await refund(user, s, "llm", COST.llm);
          throw e;
        }
      }

      // One job judged by TypeSafe's System One (Jev): confidence (how much of
      // the posting is actually visible) plus the ten flag codes, each as its
      // own yes/no. This replaces the `c` and `f` fields DeepSeek used to return
      // inside the scoring JSON. Metered like an LLM call: one credit, refunded
      // if Jev fails, with the payload size-capped against abuse.
      case "judge": {
        const posting = (b.posting || {}) as Record<string, unknown>;
        if (!posting.title && !posting.description) throw new Http(400, "no posting");
        if (JSON.stringify({ posting, candidate: b.candidate || {} }).length > 20000) throw new Http(400, "posting too large");
        const s = await spend("spend_llm", { p_user: user, p_n: COST.llm });
        try {
          return json(await judge(posting, b.candidate || {}));
        } catch (e) {
          if (!(e instanceof Http)) await refund(user, s, "llm", COST.llm);
          throw new Http(502, "Judgment call failed. No credit was used.");
        }
      }

      case "apify_start": {
        const p = b.payload || {};
        const queries = String(p.queries || "").split("\n").map((q) => q.trim()).filter(Boolean).slice(0, MAX_QUERIES);
        if (!queries.length) throw new Http(400, "no queries");
        const cost = COST.apifyQuery * queries.length;
        // Board search has its own action (board_search) and the free uses; this is
        // the HR finder and careers-page lookup, which always pay.
        const s = await spend("spend_search", { p_user: user, p_n: cost, p_board: false });
        try {
          const timeout = Math.min(Math.max(Number(b.timeout) || 300, 60), 660);
          const r = await apify(`/acts/${ACTOR}/runs?timeout=${timeout}`, {
            method: "POST",
            body: JSON.stringify({
              queries: queries.join("\n"), countryCode: String(p.countryCode || ""), languageCode: "en",
              maxPagesPerQuery: 1, resultsPerPage: Math.min(Number(p.resultsPerPage) || 10, 10), mobileResults: false,
            }),
          }).catch(() => null);
          const run = r && r.ok ? await r.json().then((d) => d?.data).catch(() => null) : null;
          if (!run?.id) {
            await refund(user, s, "search", cost);
            throw new Http(502, "Search couldn't start. No credits were used.");
          }
          await admin.from("apify_runs").insert({ run_id: run.id, user_id: user, dataset_id: run.defaultDatasetId, source: "google" });
          return json({ id: run.id, ...wallet(s) });
        } catch (e) {
          // Anything that throws after the credit was taken has to put it back.
          // The outer handler collapses a non-Http error into "Server error" and
          // refunds nothing, so an unexpected failure here used to be charged
          // for silently. The Http paths above refund themselves, so they are
          // deliberately left alone.
          if (!(e instanceof Http)) await refund(user, s, "search", cost);
          throw e;
        }
      }

      case "apify_status": {
        await ownRun(user, b.id);
        const r = await apify(`/actor-runs/${encodeURIComponent(b.id)}`);
        return json({ status: ((await r.json()).data || {}).status || "UNKNOWN" });
      }

      case "apify_items": {
        const ds = await ownRun(user, b.id);
        const r = await apify(`/datasets/${encodeURIComponent(ds)}/items?clean=true&format=json`);
        const items = r.ok ? await r.json() : [];
        // A scraper run comes back in the same Job shape as the API sources; a Google run raw.
        if (Object.hasOwn(SCRAPERS, String(b.source))) {
          const rows = items as Any[];
          await logUsage([{ user_id: user, search_id: /^[0-9a-f-]{36}$/i.test(String(b.search_id)) ? b.search_id : null,
            kind: "scrape", source: b.source, units: rows.length, cost_inr: inr(rows.length * (PRICE_USD[b.source] || 0)) }]);
          return json({ items: rows.map((x) => scrapedJob(x, b.source)).filter((j) => j.title && j.url) });
        }
        return json({ items });
      }

      case "apify_abort": {
        await ownRun(user, b.id);
        await apify(`/actor-runs/${encodeURIComponent(b.id)}/abort`, { method: "POST" });
        return json({ ok: true });
      }

      case "order": {
        const pack = PACKS[b.pack];
        if (!pack) throw new Http(400, "unknown pack");
        const keyId = secret("RAZORPAY_KEY_ID");
        const r = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Basic " + btoa(keyId + ":" + secret("RAZORPAY_KEY_SECRET")) },
          body: JSON.stringify({ amount: pack.paise, currency: "INR", receipt: user.slice(0, 36), notes: { user_id: user, pack: b.pack } }),
        });
        const o = await r.json();
        if (!r.ok || !o.id) throw new Http(502, "Couldn't start the payment. Nothing was charged.");
        const { error } = await admin.from("orders").insert({ id: o.id, user_id: user, pack: b.pack, credits: pack.credits, amount: pack.paise });
        if (error) throw error;
        // key_id is Razorpay's publishable id; checkout needs it in the browser.
        return json({ order_id: o.id, amount: pack.paise, currency: "INR", key_id: keyId });
      }

      case "verify": {
        const { order_id, payment_id, signature } = b;
        const expected = await hmacHex(secret("RAZORPAY_KEY_SECRET"), `${order_id}|${payment_id}`);
        if (!sameString(expected, String(signature || ""))) throw new Http(400, "payment signature didn't match");
        const { data: order } = await admin.from("orders").select("user_id").eq("id", String(order_id)).maybeSingle();
        if (order?.user_id !== user) throw new Http(404, "order not found");
        await admin.rpc("mark_order_paid", { p_order: order_id, p_payment: payment_id });
        const { data: c } = await admin.from("credits").select("balance").eq("user_id", user).maybeSingle();
        return json({ balance: c?.balance ?? 0 });
      }
    }
    throw new Http(400, "unknown action");
  } catch (e) {
    const status = e instanceof Http ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: status === 500 ? "Server error" : (e as Error).message }, status);
  }
});
