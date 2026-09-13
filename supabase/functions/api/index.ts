// Job Triage — the one place the app's own API keys live.
//
// The browser sends its Supabase session; this checks it, takes credits, and
// makes the DeepSeek / Apify / Razorpay call with keys stored as Supabase
// secrets. Nothing secret is ever returned to the browser.
//
// Secrets (supabase secrets set ...):
//   DEEPSEEK_API_KEY, APIFY_TOKEN, JSEARCH_API_KEY (RapidAPI), RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

// Prices are server-side only; the browser sends just the pack id. paise: ₹1 = 100.
// A credit sells for ₹0.80 (Pro) to ₹0.99 (Starter).
const PACKS: Record<string, { credits: number; paise: number; label: string }> = {
  starter: { credits: 100, paise: 9900, label: "Starter" },
  pro: { credits: 500, paise: 39900, label: "Pro" },
};
// Credits per action. What each costs us, roughly:
//   llm          1 DeepSeek call                                        ~₹0.10-0.30
//   boardSearch  flat: up to 4 JSearch requests (₹0.44 each, pay-as-you-go)
//                + up to 8 specialist-board Google queries (~₹0.30 each) up to ~₹4.20
//   apifyQuery   per Google query, for everything else (HR lookup = 3)  ~₹0.30
const COST = { llm: 1, boardSearch: 10, apifyQuery: 3 };

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
const MAX_REGISTRY_QUERIES = 8;   // the specialist boards a board search adds to JSearch

/* JSearch reads Google for Jobs, so one request covers LinkedIn, Indeed,
   Glassdoor, Naukri and company sites at once, with full descriptions. One
   request per target title, first page only (~10 jobs each). */
const MAX_TITLES = 4;
async function jsearch(title: string, where: string, country: string) {
  const q = new URLSearchParams({
    query: where ? `${title} in ${where}` : title,
    page: "1", num_pages: "1", date_posted: "month",
  });
  if (/^[a-z]{2}$/i.test(country)) q.set("country", country.toLowerCase());
  const r = await fetch("https://jsearch.p.rapidapi.com/search?" + q, {
    headers: { "X-RapidAPI-Key": secret("JSEARCH_API_KEY"), "X-RapidAPI-Host": "jsearch.p.rapidapi.com" },
  });
  if (!r.ok) throw new Error(`JSearch ${r.status}`);
  // deno-lint-ignore no-explicit-any
  return ((await r.json()).data || []).map((x: any) => ({
    title: x.job_title || "",
    company: x.employer_name || "",
    url: x.job_apply_link || x.job_google_link || "",
    location: [x.job_city, x.job_state, x.job_country].filter(Boolean).join(", ") + (x.job_is_remote ? " (remote)" : ""),
    description: String(x.job_description || "").slice(0, 4000),
    posted: String(x.job_posted_at_datetime_utc || "").slice(0, 10),
    publisher: x.job_publisher || "JSearch",
  }));
}

// What the browser gets back after any spend: enough to redraw the credits button.
type Spent = { used: "free" | "paid"; balance: number; free_search: number; free_tier: boolean };
const wallet = (s: Spent) => ({ balance: s.balance, free_search: s.free_search, free_tier: s.free_tier });

// spend_llm / spend_search in billing.sql: free pot first, then paid credits.
async function spend(fn: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw error;
  if (!data) throw new Http(402, "NEEDCREDITS");
  return data as Spent;
}
// Our upstream call failed, so it shouldn't cost them: put it back where it came from.
async function refund(user: string, s: Spent, kind: "llm" | "search", n: number) {
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

      // One board search = JSearch for the big portals + a Google run over the
      // track's specialist boards, charged once. The Google run is returned as
      // a run id for the browser to poll with apify_status / apify_items.
      case "board_search": {
        const titles = (Array.isArray(b.titles) ? b.titles : []).map(String).filter(Boolean).slice(0, MAX_TITLES);
        if (!titles.length) throw new Http(400, "no titles");
        const queries = String(b.queries || "").split("\n").map((q) => q.trim()).filter(Boolean).slice(0, MAX_REGISTRY_QUERIES);
        const s = await spend("spend_search", { p_user: user, p_n: COST.boardSearch, p_board: true });

        const [found, run] = await Promise.all([
          Promise.allSettled(titles.map((t) => jsearch(t, String(b.where || ""), String(b.country || "")))),
          queries.length
            ? apify(`/acts/${ACTOR}/runs?timeout=660`, {
                method: "POST",
                body: JSON.stringify({ queries: queries.join("\n"), languageCode: "en", maxPagesPerQuery: 1, resultsPerPage: 10, mobileResults: false }),
              }).then((r) => (r.ok ? r.json() : null)).then((d) => d?.data || null).catch(() => null)
            : Promise.resolve(null),
        ]);
        const jobs = found.flatMap((f) => (f.status === "fulfilled" ? f.value : []));
        const jsearchDown = found.every((f) => f.status === "rejected");
        if (jsearchDown) console.error("jsearch:", found.map((f) => f.status === "rejected" && String(f.reason)));
        // Nothing came back from anywhere: they got nothing, so they pay nothing.
        if (jsearchDown && !run?.id) {
          await refund(user, s, "search", COST.boardSearch);
          throw new Http(502, "Job search is down right now. No credits were used — try again shortly.");
        }
        if (run?.id) await admin.from("apify_runs").insert({ run_id: run.id, user_id: user, dataset_id: run.defaultDatasetId });
        return json({ jobs, runId: run?.id || null, partial: jsearchDown, ...wallet(s) });
      }

      case "llm": {
        const prompt = String(b.prompt || "");
        if (!prompt || prompt.length > 200_000) throw new Http(400, "bad prompt");
        const s = await spend("spend_llm", { p_user: user, p_n: COST.llm });
        const r = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + secret("DEEPSEEK_API_KEY") },
          body: JSON.stringify({
            model: "deepseek-chat", temperature: 0.2,
            max_tokens: Math.min(Number(b.max_tokens) || 1400, 4000),
            messages: [{ role: "user", content: prompt }],
          }),
        }).catch(() => null);
        const text = r && r.ok ? ((await r.json()).choices?.[0]?.message?.content || "").trim() : "";
        if (!text) {                       // their call failed, so it shouldn't cost them
          await refund(user, s, "llm", COST.llm);
          throw new Http(502, "The model didn't answer. No credit was used — try again.");
        }
        return json({ text, ...wallet(s) });
      }

      case "apify_start": {
        const p = b.payload || {};
        const queries = String(p.queries || "").split("\n").map((q) => q.trim()).filter(Boolean).slice(0, MAX_QUERIES);
        if (!queries.length) throw new Http(400, "no queries");
        const cost = COST.apifyQuery * queries.length;
        // Board search has its own action (board_search) and the free uses; this is
        // the HR finder and careers-page lookup, which always pay.
        const s = await spend("spend_search", { p_user: user, p_n: cost, p_board: false });
        const timeout = Math.min(Math.max(Number(b.timeout) || 300, 60), 660);
        const r = await apify(`/acts/${ACTOR}/runs?timeout=${timeout}`, {
          method: "POST",
          body: JSON.stringify({
            queries: queries.join("\n"), countryCode: String(p.countryCode || ""), languageCode: "en",
            maxPagesPerQuery: 1, resultsPerPage: Math.min(Number(p.resultsPerPage) || 10, 10), mobileResults: false,
          }),
        }).catch(() => null);
        const run = r && r.ok ? (await r.json()).data : null;
        if (!run?.id) {
          await refund(user, s, "search", cost);
          throw new Http(502, "Search couldn't start. No credits were used.");
        }
        await admin.from("apify_runs").insert({ run_id: run.id, user_id: user, dataset_id: run.defaultDatasetId });
        return json({ id: run.id, ...wallet(s) });
      }

      case "apify_status": {
        await ownRun(user, b.id);
        const r = await apify(`/actor-runs/${encodeURIComponent(b.id)}`);
        return json({ status: ((await r.json()).data || {}).status || "UNKNOWN" });
      }

      case "apify_items": {
        const ds = await ownRun(user, b.id);
        const r = await apify(`/datasets/${encodeURIComponent(ds)}/items?clean=true&format=json`);
        return json({ items: r.ok ? await r.json() : [] });
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
