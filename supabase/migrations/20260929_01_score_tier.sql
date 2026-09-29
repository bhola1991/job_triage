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
-- NOT APPLIED by the branch that added it. Run it in the SQL editor.
alter table public.jobs
  add column if not exists score_tier text;

-- Dropped first so the file is re-runnable, the same way billing.sql re-states
-- usage_events_kind_check rather than assuming the old one is absent.
alter table public.jobs drop constraint if exists jobs_score_tier_check;
alter table public.jobs add constraint jobs_score_tier_check
  check (score_tier is null or score_tier in ('flash', 'pro'));
