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
  created_at timestamptz not null default now()
);
alter table public.apify_runs enable row level security;

-- Every pot check sits in an UPDATE's WHERE clause, so two parallel calls can't
-- both spend the last credit or free use.
--
-- Both spenders return {used:'free'|'paid', balance, free_search, free_tier} so a
-- failed call can be refunded to the pot it came from, or null when neither
-- pot covers it. A first-time user has no row yet; the insert gives them one.

-- AI call: free while the free tier is on, then paid credits.
create or replace function public.spend_llm(p_user uuid, p_n integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.credits;
begin
  insert into public.credits (user_id) values (p_user) on conflict (user_id) do nothing;
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
