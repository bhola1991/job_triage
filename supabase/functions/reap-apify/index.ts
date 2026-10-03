// Job Triage — abort Apify runs that outlived the browser watching them.
//
// A run is started by `api` and polled by the browser. When the tab is closed,
// the network drops, or the poll simply gives up, nobody aborts it: the actor
// keeps running on our Apify account and keeps billing until its own timeout.
// The evidence it happens is already in the record -- billing.sql:48-49 notes
// 23 runs started, 16 returning results, and nothing anywhere saying which
// seven went missing or what they cost.
//
// So: anything still running fifteen minutes after it was started is orphaned
// by definition. The longest timeout `api` asks for is 660 seconds (eleven
// minutes) and the scrapers ask for 300, so fifteen minutes cannot catch a run
// that is still legitimately working.
//
// Service role throughout, and no caller JWT. This runs on a schedule for
// everybody at once, and apify_runs is a server-only table -- row-level
// security is on with no policies at all, so there is no user-scoped client
// that could read another person's run even if one existed to use.
//
// Secrets: APIFY_TOKEN (the same one `api` uses).
//   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// Deploy it normally -- WITH jwt verification, which is the default and is half
// the door. See supabase/migrations/20260929_03_orphan_abort.sql for the
// pg_cron side, which presents the service-role key as its bearer token.

import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const APIFY = "https://api.apify.com/v2";

/* Old enough to be orphaned rather than slow. See the note above: this is
   comfortably past every timeout `api` asks Apify for. */
const ORPHAN_MINUTES = 15;
/* A ceiling per pass, so a backlog cannot turn one scheduled run into hundreds
   of Apify calls. What is left over is caught by the next pass. */
const MAX_PER_PASS = 50;

/* Apify's own run statuses. READY means queued and not started; both of these
   are states an abort is meaningful in, and everything else (SUCCEEDED,
   FAILED, ABORTED, TIMED-OUT) has already stopped costing anything. */
const ALIVE = new Set(["RUNNING", "READY"]);

const apify = (path: string, init: RequestInit = {}) =>
  fetch(APIFY + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + Deno.env.get("APIFY_TOKEN"),
      "Content-Type": "application/json",
    },
  });

Deno.serve(async (req) => {
  /* Two locks, and they fail differently, which is the point of having both.

     The platform's own jwt verification is the first: this function is deployed
     WITHOUT --no-verify-jwt, so anything not signed by this project's jwt secret
     is rejected before a line of this runs.

     That alone is not enough, because the anon key is also a valid jwt for this
     project and so is every signed-in user's token. This function aborts other
     people's Apify runs; a logged-in stranger must not be able to call it. So
     the second lock is that the bearer token has to BE the service-role key.

     Compared against the env var rather than by reading the token's `role`
     claim. A claim check is only as good as the signature check in front of it,
     and would quietly become forgeable the day somebody redeployed this with
     --no-verify-jwt. This comparison does not care how it was deployed.

     Constant-time, borrowed from the Razorpay signature check in api/index.ts:
     a timing oracle on a credential this powerful is not worth the saved line. */
  const sameString = (a: string, b: string) => {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  };
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return new Response("server is missing SUPABASE_SERVICE_ROLE_KEY", { status: 500 });
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  if (!sameString(bearer, key)) return new Response("no", { status: 401 });

  const cutoff = new Date(Date.now() - ORPHAN_MINUTES * 60_000).toISOString();

  /* aborted_at is what makes this idempotent. Without it every pass would
     re-abort the same finished run and write another error row, and the orphan
     rate -- the number this exists to make visible -- would be the schedule's
     frequency rather than anything about Apify. */
  const { data: runs, error } = await admin
    .from("apify_runs")
    .select("run_id, user_id, source, created_at")
    .lt("created_at", cutoff)
    .is("aborted_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_PASS);

  if (error) {
    console.error("reap: could not read apify_runs:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let aborted = 0, settled = 0, failed = 0;

  for (const run of runs ?? []) {
    const id = String(run.run_id);
    try {
      const r = await apify(`/actor-runs/${encodeURIComponent(id)}`);
      const status = String(((await r.json())?.data || {}).status || "UNKNOWN");

      if (!ALIVE.has(status)) {
        /* Already over. Stamp it anyway: the row has been dealt with, and
           leaving it unstamped means looking it up again every pass forever. */
        await admin.from("apify_runs").update({ aborted_at: new Date().toISOString() }).eq("run_id", id);
        settled++;
        continue;
      }

      await apify(`/actor-runs/${encodeURIComponent(id)}/abort`, { method: "POST" });
      await admin.from("apify_runs").update({ aborted_at: new Date().toISOString() }).eq("run_id", id);

      /* One row per abort, in the ledger that already exists for exactly this:
         'error' is the kind for a source that cost something and returned
         nothing, and `note` is where that kind puts its reason
         (billing.sql:184-197). units 0 because nothing was delivered -- the
         whole point of the row is that a run vanished without one.
         `source` is not null on this table, so the run's own source carries it
         and 'apify' covers a row written before that column existed. */
      await admin.from("usage_events").insert({
        user_id: run.user_id,
        search_id: null,
        kind: "error",
        source: String(run.source || "apify").slice(0, 40),
        units: 0,
        note: `orphan_abort: run ${id} still ${status} after ${ORPHAN_MINUTES} minutes`.slice(0, 300),
      });
      aborted++;
    } catch (e) {
      /* One unreachable run must not stop the rest of the pass. Left unstamped
         on purpose so the next pass tries it again. */
      failed++;
      console.error(`reap: ${id}:`, (e as Error).message);
    }
  }

  const out = { checked: (runs ?? []).length, aborted, settled, failed };
  console.log("reap:", JSON.stringify(out));
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
