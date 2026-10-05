-- 2026-09-29 — record which model scored each job.
--
-- Board-search intake scores on deepseek-flash (index.html scoreAndCut, one
-- credit a batch); the Score button rescores on deepseek-v4-pro (runScoring,
-- three). Both wrote ai_score, so one list held two populations of numbers that
-- are not comparable with each other -- and nothing recorded which was which,
-- so the comparison could not even be undone after the fact.
--
-- Nullable, with no backfill. Every row written before today was scored by one
-- tier or the other and we cannot now say which; guessing would put a fact in
-- the column where an honest blank belongs. Null reads as "scored before this
-- was recorded", which is exactly true.
--
-- APPLIED to kgacahuzaxqkzdcpyboc on 2026-09-29 as migration 20260929110011
-- (jobs_score_tier). Verified: public.jobs.score_tier text null, with
-- jobs_score_tier_check in place. 232 rows, all null -- no backfill.
alter table public.jobs
  add column if not exists score_tier text;

-- Dropped first so the file is re-runnable, the same way billing.sql re-states
-- usage_events_kind_check rather than assuming the old one is absent.
alter table public.jobs drop constraint if exists jobs_score_tier_check;
alter table public.jobs add constraint jobs_score_tier_check
  check (score_tier is null or score_tier in ('flash', 'pro'));

-- ── SUPERSEDED, 2026-10-06 ────────────────────────────────────────────────
-- This file is recorded so the repo matches the live database, not because the
-- column is in use. It is not.
--
-- The commit that wrote score_tier ('flash' / 'pro', set in scoreBatch) never
-- reached main. The same problem was solved there by `ai_model`, which records
-- the model id itself -- 'deepseek-flash', 'deepseek-v4-pro' -- and is strictly
-- better: it survives a tier being renamed or a third being added, and it can
-- be joined against usage_events.note, which also records the model per call.
-- A row scored on the user's own key carries null, where the model is their
-- choice and not ours to record.
--
-- So score_tier is live in production, constrained, and empty: verified
-- 2026-10-06, 0 of 418 rows carry a value, and nothing in the repo writes one.
-- Dropping it is the real cleanup. Left in place rather than dropped here
-- because dropping a production column is not a thing to do inside a file
-- whose job is to describe what already happened.
