-- 2026-09-29 — reap Apify runs the browser stopped watching.
--
-- A run is started by the `api` edge function and polled by the browser. Close
-- the tab, lose the network, or simply outlast the poll, and nothing aborts it:
-- the actor keeps running on our Apify account and keeps billing until its own
-- timeout. billing.sql:48-49 already records the shape of it -- 23 runs
-- started, 16 returning results, and nothing anywhere naming the seven that
-- went or saying what they cost.
--
-- Two parts: a column that makes the reaper idempotent, and the schedule.
--
-- PARTLY APPLIED, and the split is deliberate.
--
-- Part 1 (the column and its index) was applied to kgacahuzaxqkzdcpyboc on
-- 2026-09-29 as migration 20260929110038 (apify_runs_aborted_at). Re-verified
-- against the live catalogue on 2026-10-04: public.apify_runs.aborted_at is
-- present. It is inert on its own -- no writer sets it until the reaper is
-- deployed -- and harmless.
--
-- Part 2 (the schedule) is NOT applied, because on this project it still could
-- not work and would fail loudly every five minutes if forced. Re-checked
-- 2026-10-04:
--   * pg_cron and pg_net are both NOT INSTALLED, and there is no `cron` schema.
--   * the reap-apify edge function is not deployed.
--   * `vault` exists, but the entries this reads (project_url,
--     service_role_key) do not, so net.http_post would be handed a null url on
--     every tick.
-- Apply it only after those three are true. This is the one file here that
-- makes the database call out to the internet on a timer, so read it first.

-- ── 1. the column ───────────────────────────────────────────────────────────
--
-- Without this the reaper has no memory. apify_runs carries created_at and
-- nothing else about a run's fate, so every pass would re-abort the same
-- finished runs and write another error row each time -- and the orphan rate,
-- which is the number this whole thing exists to make visible, would just be
-- the cron's frequency. Stamped whether the run was aborted or found already
-- over, because both mean "dealt with".
alter table public.apify_runs
  add column if not exists aborted_at timestamptz;

-- The reaper's own query: oldest first, unstamped only. Partial, because the
-- stamped rows are the overwhelming majority in steady state and none of them
-- is ever looked at again.
create index if not exists apify_runs_unreaped
  on public.apify_runs (created_at)
  where aborted_at is null;


-- ── 2. the schedule ─────────────────────────────────────────────────────────
--
-- This project has no scheduler at all: no cron on the machine (it is not
-- installed), no pg_cron, no GitHub Actions, no Cloudflare cron triggers.
-- STATUS.md has carried "nothing schedules verify.js" as an open gap for
-- exactly this reason. So the scheduling lives here, in the one place that is
-- always running.
--
-- Requires, once, in the SQL editor or the dashboard:
--   create extension if not exists pg_cron  with schema extensions;
--   create extension if not exists pg_net   with schema extensions;
--
-- And the function deployed the ordinary way -- WITH jwt verification, which is
-- the default, so the platform rejects anything not signed by this project
-- before the function runs at all:
--   supabase functions deploy reap-apify
--
-- The schedule authenticates as the service role. There is no bespoke secret to
-- invent, rotate or leak: the credential is one the project already has, and
-- the function checks the bearer token IS that key rather than merely reading a
-- `role` claim -- because a claim is only as trustworthy as the signature check
-- in front of it, and that check is a deploy flag away from being switched off.
--
-- Vault rather than inline, and here it matters more than usual: cron.job is a
-- readable table, and this is the key that bypasses every RLS policy in the
-- database. It must never be pasted into a job definition, a log line or a
-- migration file.
--   select vault.create_secret('<the service_role key>', 'service_role_key');
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--
-- Find the key under Project Settings -> API -> service_role. Rotating it means
-- updating this vault entry too, or the schedule starts getting 401s.
--
-- Every five minutes, not every fifteen. The reaper only acts on runs already
-- fifteen minutes old, so the schedule decides how long an orphan burns AFTER
-- it qualifies, not whether it is caught; five minutes bounds the waste at
-- twenty minutes total and costs one cheap query when there is nothing to do.
--
-- Unschedule first so the file is re-runnable, the same way every policy in
-- schema.sql is dropped before it is created.
select cron.unschedule('reap-apify')
 where exists (select 1 from cron.job where jobname = 'reap-apify');

select cron.schedule(
  'reap-apify',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/reap-apify',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body    := '{}'::jsonb,
    -- Longer than one pass can take: 50 runs, two Apify calls each, is the
    -- worst case and it is nowhere near this. A timeout here abandons the
    -- response, not the aborts already made.
    timeout_milliseconds := 55000
  );
  $cron$
);

-- To check it afterwards:
--   select jobname, schedule, active from cron.job where jobname = 'reap-apify';
--   select * from cron.job_run_details where jobid =
--     (select jobid from cron.job where jobname = 'reap-apify')
--    order by start_time desc limit 10;
--   select * from public.source_errors;          -- orphan_abort rows land here
--
-- A 401 in job_run_details means the vault copy of the key and the project's
-- real one have drifted apart -- re-create the service_role_key entry.
--
-- To stop it:
--   select cron.unschedule('reap-apify');
