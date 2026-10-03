-- 2026-09-29 — a posting is not dead the first time we fail to see it.
--
-- Liveness here is a set difference, not a fetch: present in yesterday's index
-- and absent from today's was taken as a closure, with a date. verify.js
-- already refuses to close a row whose file or page range it did not read this
-- run -- those guards exist because a ten-byte sitemap and a capped paginated
-- board each produced a wave of false closures -- but a row that clears every
-- guard still closed on ONE absence.
--
-- One absence from one run is a weaker fact than that. schema.sql's own note
-- records the noise floor: 20.8% of the Naukri index vanished across two days
-- on 2026-09-26, with an age gradient saying part of that is expiry and part is
-- the index rotating. A second consecutive absence is cheap -- it costs a day --
-- and it is what separates the two.
--
-- Counts consecutive absences, and only ones we were entitled to count: a run
-- that did not read a row's file leaves the counter alone rather than
-- incrementing it, so 'held' never accrues towards a closure. Reset to 0 the
-- moment the posting is seen again.
--
-- Declared expiry is unaffected and still closes immediately. A board
-- publishing its own dead list is a different kind of fact from an absence,
-- and it has no noise floor under it to wait out.
--
-- APPLIED to kgacahuzaxqkzdcpyboc on 2026-09-29 as migration 20260929110023
-- (job_checks_absent_runs). Verified: public.job_checks.absent_runs int4 not
-- null default 0, with job_checks_absent_runs_check in place, across 429,018
-- rows (exact count; the dashboard's 426,018 is a planner estimate). Adding a column with a constant default is metadata-only on
-- Postgres 17, so this did not rewrite the table.
alter table public.job_checks
  add column if not exists absent_runs int not null default 0;

alter table public.job_checks drop constraint if exists job_checks_absent_runs_check;
alter table public.job_checks add constraint job_checks_absent_runs_check
  check (absent_runs >= 0);
