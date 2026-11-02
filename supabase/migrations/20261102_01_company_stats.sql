-- Company hiring signals, read once for everyone (2026-11-02). See schema.sql.
-- Facts about a company's hiring that the index already holds -- roles open,
-- new this week and month, how long they stay up, the same role posted more
-- than once -- grouped by company. Rebuilt after every nightly crawl
-- (refresh_company_stats, called by scripts/index/refresh.sh); the app reads
-- it through company_stats_for() with the company names it already has.

-- One spelling per company: "Zeta Suite Pvt. Ltd." and "zeta suite" meet here.
create or replace function public.company_key(name text) returns text
language sql immutable parallel safe as $$
  select nullif(regexp_replace(lower(regexp_replace(coalesce(name, ''),
    '\m(private|pvt|limited|ltd|llp|inc|llc|gmbh|pte|corp|co)\M\.?', '', 'gi')), '[^a-z0-9]+', '', 'g'), '')
$$;

create table if not exists public.company_stats (
  company_key   text primary key,
  name          text not null,          -- the spelling seen most often
  open_roles    int  not null,          -- in the index and not closed at its source
  new_7d        int  not null,          -- first indexed in the last 7 days
  new_30d       int  not null,
  days_open     int,                    -- median days the open roles have been up (crawled ones only)
  repeat_titles int  not null,          -- titles posted more than once: several openings, or re-posted
  repeated      text[] not null default '{}',  -- those titles (lower-cased, up to 20), so a row can say it of itself
  cities        text[] not null default '{}',
  titles        text[] not null default '{}',
  is_agency     boolean not null default false,  -- by name: a recruiter or staffing firm, not the employer
  updated_at    timestamptz not null default now()
);
alter table public.company_stats enable row level security;
drop policy if exists "shared: select" on public.company_stats;
create policy "shared: select" on public.company_stats for select to authenticated using (true);

create or replace function public.refresh_company_stats() returns int
language plpgsql security definer set search_path = public set statement_timeout = '180s' as $$
declare done_rows int;
begin
  delete from company_stats where true;
  insert into company_stats (company_key, name, open_roles, new_7d, new_30d, days_open, repeat_titles, repeated, cities, titles, is_agency)
  with j as materialized (
    select company_key(i.company) ck, i.company, lower(trim(i.title)) t, nullif(trim(i.location), '') loc,
           i.first_indexed, c.first_seen, c.closed_on
    from job_index i left join job_checks c using (job_key)
    where coalesce(i.company, '') <> '' and length(company_key(i.company)) >= 2
  ),
  base as (
    select ck, mode() within group (order by company) name,
      count(*) filter (where closed_on is null) open_roles,
      count(*) filter (where first_indexed > now() - interval '7 days') new_7d,
      count(*) filter (where first_indexed > now() - interval '30 days') new_30d,
      (percentile_disc(0.5) within group (order by current_date - first_seen)
        filter (where closed_on is null and first_seen is not null))::int days_open
    from j group by ck having count(*) filter (where closed_on is null) > 0
  ),
  tt as (select ck, t, count(*) n, row_number() over (partition by ck order by count(*) desc, t) r from j group by ck, t),
  ll as (select ck, loc, row_number() over (partition by ck order by count(*) desc, loc) r from j where loc is not null group by ck, loc),
  rep as (select ck, count(*) filter (where n > 1) repeat_titles, (array_agg(t order by n desc, t) filter (where n > 1))[1:20] repeated,
             array_agg(t order by r) filter (where r <= 3) titles from tt group by ck),
  locs as (select ck, array_agg(loc order by r) filter (where r <= 3) cities from ll group by ck)
  select b.ck, b.name, b.open_roles, b.new_7d, b.new_30d, b.days_open,
    coalesce(rep.repeat_titles, 0), coalesce(rep.repeated, '{}'), coalesce(locs.cities, '{}'), coalesce(rep.titles, '{}'),
    -- ponytail: a name rule. It misses an agency with a plain name and would flag
    -- an employer called "Talent..."; good enough to say "may be an agency".
    b.name ~* '(recruit|staffing|manpower|talent|placement|headhunt|executive search|hr (advisory|solutions|services|consult)|outsourc|employment|personnel|workforce)'
  from base b left join rep using (ck) left join locs using (ck);
  get diagnostics done_rows = row_count;
  return done_rows;
end $$;
revoke all on function public.refresh_company_stats() from public, anon, authenticated;
grant execute on function public.refresh_company_stats() to service_role;

-- The app's read: the names it has, as it has them, up to 300 at a time.
create or replace function public.company_stats_for(names text[]) returns setof public.company_stats
language sql stable security invoker set search_path = public as $$
  select s.* from company_stats s
  where s.company_key in (select company_key(x) from unnest(names[1:300]) x)
$$;
revoke all on function public.company_stats_for(text[]) from public, anon;
grant execute on function public.company_stats_for(text[]) to authenticated;
