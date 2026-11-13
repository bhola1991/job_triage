-- Retire the Naukri sitemap from the liveness series (2026-11-13).
--
-- Naukri's terms forbid crawling it. #59 took it out of the app; this takes it
-- out of the nightly crawl's leftovers. Its rows never reached job_index (they
-- are title-only, and push-index.js refuses thin rows), but job_checks held
-- 731,715 of them out of 802,000. Nothing reads a check whose posting is not in
-- the index -- except a person's own list, so the 230 Naukri jobs someone is
-- tracking keep theirs, the same rule prune_index follows.
set statement_timeout = 0;

delete from public.job_checks c
 where c.source = 'naukri-sitemap'
   and not exists (select 1 from public.jobs j where j.job_key = c.job_key);

-- scripts/heartbeat.js asks for the newest row (order by updated_at desc
-- limit 1), and from 2026-11-11 that scan ran into the statement timeout.
create index if not exists job_index_updated on public.job_index (updated_at desc);
