-- Job Triage — credits and payments.
-- Run once in the Supabase SQL editor, after schema.sql.
--
-- The browser can READ its own balance and orders, and nothing else. Every
-- write goes through the edge functions, which run as service_role, so a user
-- can't top up their own balance from DevTools.

create table if not exists public.credits (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  balance    integer     not null default 0 check (balance >= 0),
  -- Free tier: 5 job board searches, with AI scoring free while it lasts.
  free_search integer    not null default 5 check (free_search >= 0),
  free_tier  boolean     not null default true,     -- off once a board search is attempted with none left
  -- ponytail: ceiling on free AI calls. Each search = up to 7 CV-check calls
  -- (one per source batch) + 2 scoring calls, so 5 searches = ~45; the rest is
  -- room for drafts. Without it, CSV imports would score free forever.
  free_llm   integer     not null default 60 check (free_llm >= 0),
  updated_at timestamptz not null default now()
);
alter table public.credits enable row level security;
drop policy if exists "own credits: select" on public.credits;
create policy "own credits: select" on public.credits
  for select using (auth.uid() = user_id);

create table if not exists public.orders (
  id         text        primary key,                 -- Razorpay order id
  user_id    uuid        not null references auth.users(id) on delete cascade,
  pack       text        not null,
  credits    integer     not null check (credits > 0),
  amount     integer     not null,                    -- paise
  status     text        not null default 'created' check (status in ('created','paid')),
  payment_id text,
  created_at timestamptz not null default now()
);
alter table public.orders enable row level security;
drop policy if exists "own orders: select" on public.orders;
create policy "own orders: select" on public.orders
  for select using (auth.uid() = user_id);

-- Which Apify runs belong to whom, so one user can't poll or read another
-- user's run (its dataset is that user's search results). Server-only.
create table if not exists public.apify_runs (
  run_id     text        primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  dataset_id text        not null,
  -- Which scraper this run belongs to. A run only writes its cost row when the
  -- browser fetches its results, so one that fails or outlives the 5-minute poll
  -- leaves no trace at all; without this column such a run cannot even be named.
  -- Seen live: 23 runs started, 16 returned results, and nothing said which 7 went.
  source     text,
  created_at timestamptz not null default now()
);
alter table public.apify_runs add column if not exists source text;
alter table public.apify_runs enable row level security;

-- Every pot check sits in an UPDATE's WHERE clause, so two parallel calls can't
-- both spend the last credit or free use.
--
-- Both spenders return {used:'free'|'paid', balance, free_search, free_tier} so a
-- failed call can be refunded to the pot it came from, or null when neither
-- pot covers it. A first-time user has no row yet; the insert gives them one.

-- Unlimited accounts (the owner, testers): never charged, nothing counted down.
-- There is no policy that lets a user write this column, so it can only be
-- switched on here in the SQL editor:
--   update public.credits set unlimited = true
--    where user_id = (select user_id from public.usernames where username = 'soumyadip1991');
alter table public.credits add column if not exists unlimited boolean not null default false;

-- AI call: free while the free tier is on, then paid credits.
create or replace function public.spend_llm(p_user uuid, p_n integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.credits;
begin
  insert into public.credits (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into r from public.credits where user_id = p_user and unlimited;
  if found then return jsonb_build_object('used','unlimited','balance',r.balance,'free_search',r.free_search,'free_tier',r.free_tier,'unlimited',true); end if;
  update public.credits set free_llm = free_llm - 1, updated_at = now()
   where user_id = p_user and free_tier and free_llm > 0 returning * into r;
  if found then return jsonb_build_object('used','free','balance',r.balance,'free_search',r.free_search,'free_tier',r.free_tier); end if;
  update public.credits set balance = balance - p_n, updated_at = now()
   where user_id = p_user and balance >= p_n returning * into r;
  if found then return jsonb_build_object('used','paid','balance',r.balance,'free_search',r.free_search,'free_tier',r.free_tier); end if;
  return null;
end $$;

-- Apify run. p_board = job board search, the only kind with free uses; the
-- contact finder passes false and always pays.
create or replace function public.spend_search(p_user uuid, p_n integer, p_board boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.credits;
begin
  insert into public.credits (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into r from public.credits where user_id = p_user and unlimited;
  if found then return jsonb_build_object('used','unlimited','balance',r.balance,'free_search',r.free_search,'free_tier',r.free_tier,'unlimited',true); end if;
  if p_board then
    update public.credits set free_search = free_search - 1, updated_at = now()
     where user_id = p_user and free_search > 0 returning * into r;
    if found then return jsonb_build_object('used','free','balance',r.balance,'free_search',r.free_search,'free_tier',r.free_tier); end if;
    -- 16th board search: the free tier, free scoring included, is over.
    update public.credits set free_tier = false where user_id = p_user;
  end if;
  update public.credits set balance = balance - p_n, updated_at = now()
   where user_id = p_user and balance >= p_n returning * into r;
  if found then return jsonb_build_object('used','paid','balance',r.balance,'free_search',r.free_search,'free_tier',r.free_tier); end if;
  return null;
end $$;

create or replace function public.refund_free(p_user uuid, p_what text)
returns void language sql security definer set search_path = public as $$
  update public.credits
     set free_llm    = free_llm    + (p_what = 'llm')::int,
         free_search = free_search + (p_what = 'search')::int,
         updated_at  = now()
   where user_id = p_user;
$$;

create or replace function public.add_credits(p_user uuid, p_n integer)
returns integer language sql security definer set search_path = public as $$
  insert into public.credits (user_id, balance) values (p_user, p_n)
  on conflict (user_id) do update
    set balance = public.credits.balance + excluded.balance, updated_at = now()
  returning balance;
$$;

-- Credits an order exactly once. Both the checkout callback and the Razorpay
-- webhook call this; whichever arrives second finds status = 'paid' and does
-- nothing, so a paid order can never be credited twice.
create or replace function public.mark_order_paid(p_order text, p_payment text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_credits integer;
begin
  update public.orders set status = 'paid', payment_id = p_payment
   where id = p_order and status = 'created'
  returning user_id, credits into v_user, v_credits;
  if not found then return false; end if;
  perform public.add_credits(v_user, v_credits);
  return true;
end $$;

revoke all on function public.spend_llm(uuid, integer)      from public, anon, authenticated;
revoke all on function public.spend_search(uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.refund_free(uuid, text)       from public, anon, authenticated;
grant execute on function public.spend_llm(uuid, integer)   to service_role;
grant execute on function public.spend_search(uuid, integer, boolean) to service_role;
grant execute on function public.refund_free(uuid, text)    to service_role;
revoke all on function public.add_credits(uuid, integer)    from public, anon, authenticated;
revoke all on function public.mark_order_paid(text, text)   from public, anon, authenticated;
grant execute on function public.add_credits(uuid, integer)   to service_role;
grant execute on function public.mark_order_paid(text, text)  to service_role;

-- For databases created before the default above changed (safe to re-run).
alter table public.credits alter column free_llm set default 60;

-- ─────────────────────────────────────────────────────────────────────────────
-- Usage ledger: what every search actually costs, and what each source yields.
--
-- The server writes one row per paid call (kind llm/api/scrape) and one 'yield'
-- row per source per search, reported by the app: how many jobs it found, how
-- many were new, how many scored 50+, and how many of those no other source in
-- that search had (exclusive_50). Costs are ESTIMATES from list prices in the
-- api function (DeepSeek tokens are exact; ₹ is tokens × list price).
--
-- Nobody reads this from the browser: RLS on, no policies. Read it in the SQL
-- editor:   select * from source_yield order by inr_per_exclusive_50 desc nulls last;
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.usage_events (
  id            bigserial   primary key,
  user_id       uuid        references auth.users(id) on delete set null,
  search_id     uuid,
  -- 'error': a source that failed. Cost rows are only written on success, so a
  -- source that throws every time is indistinguishable from one that was never
  -- called -- which is exactly how JSearch ran 0 of 20 expected requests without
  -- leaving a single row. A zero-unit row per failure makes silence visible.
  kind          text        not null check (kind in ('llm','api','scrape','yield','error')),
  source        text        not null,
  units         integer     not null default 0,     -- requests, rows billed, or calls
  tokens_in     integer,
  tokens_cached integer,                            -- DeepSeek prompt cache hits
  tokens_out    integer,
  cost_inr      numeric(10,3),
  found         integer,
  unique_new    integer,
  kept_50       integer,
  exclusive_50  integer,
  note          text,                                -- error rows: what failed
  created_at    timestamptz not null default now()
);
-- Safe to re-run on a database created before these existed.
alter table public.usage_events add column if not exists note text;
alter table public.usage_events drop constraint if exists usage_events_kind_check;
alter table public.usage_events add constraint usage_events_kind_check
  check (kind in ('llm','api','scrape','yield','error'));
alter table public.usage_events enable row level security;
create index if not exists usage_events_source_time on public.usage_events (source, created_at);
create index if not exists usage_events_search on public.usage_events (search_id);

-- Per source, all time. security_invoker keeps the table's RLS in force for
-- anyone who isn't the owner, and the revoke keeps the view out of the API.
create or replace view public.source_yield with (security_invoker = on) as
select source,
       count(distinct search_id) filter (where kind = 'yield')              as searches,
       sum(found)                                                           as found,
       sum(unique_new)                                                      as unique_new,
       sum(kept_50)                                                         as kept_50,
       sum(exclusive_50)                                                    as exclusive_50,
       round(sum(cost_inr) filter (where kind in ('api','scrape')), 2)      as cost_inr,
       round(sum(cost_inr) filter (where kind in ('api','scrape'))
             / nullif(sum(exclusive_50), 0), 2)                             as inr_per_exclusive_50
  from public.usage_events
 group by source;

-- Which sources are failing, and how often. Empty is the healthy state; a row
-- here is a source that cost a search something and returned nothing.
create or replace view public.source_errors with (security_invoker = on) as
select source, count(*) as failures, max(created_at) as last_seen,
       (array_agg(note order by created_at desc))[1] as latest
  from public.usage_events where kind = 'error'
 group by source order by failures desc;

-- Per search: total cost and where it went.
create or replace view public.search_cost with (security_invoker = on) as
select search_id, min(created_at) as at,
       round(sum(cost_inr) filter (where kind = 'scrape'), 2) as scrape_inr,
       round(sum(cost_inr) filter (where kind = 'api'), 2)    as api_inr,
       round(sum(cost_inr) filter (where kind = 'llm'), 2)    as llm_inr,
       round(sum(cost_inr), 2)                                as total_inr,
       sum(tokens_in) as tokens_in, sum(tokens_cached) as tokens_cached, sum(tokens_out) as tokens_out,
       sum(kept_50) as kept_50
  from public.usage_events
 where search_id is not null
 group by search_id;

revoke all on public.usage_events, public.source_yield, public.search_cost, public.source_errors from anon, authenticated;
