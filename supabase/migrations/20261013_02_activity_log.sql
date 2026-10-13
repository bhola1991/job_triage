-- ---------------------------------------------------------------------------
-- Beta activity log (2026-10-13)
-- ---------------------------------------------------------------------------
-- What a tester DID that leaves no other trace. Jobs, searches, scoring, mail
-- and feedback already record themselves; what was invisible was everything
-- before and between them -- that someone came back, which screen they got
-- stuck on in onboarding, which jobs they opened and walked away from, and
-- errors that only ever happened in their browser.
--
-- Written only for accounts flagged `tester` (index.html: track()), and it
-- holds actions, never content: a kind, and a few small facts about it.
--
-- Insert-only from the app. There is no select policy on purpose -- nothing in
-- the product reads this back -- so the one reader is scripts/insights.js with
-- the service role, the same arrangement as public.feedback.
create table if not exists public.activity (
  id       bigint generated always as identity primary key,
  user_id  uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  at       timestamptz not null default now(),
  kind     text        not null check (char_length(kind) between 1 and 40),
  detail   jsonb       not null default '{}' check (pg_column_size(detail) < 2000)
);
alter table public.activity enable row level security;
drop policy if exists "own rows: insert" on public.activity;
create policy "own rows: insert" on public.activity
  for insert to authenticated with check (auth.uid() = user_id);
create index if not exists activity_user_at on public.activity (user_id, at desc);

-- "Delete everything in my account" has to reach this too, or it reports
-- success and leaves a record of what the person did.
create or replace function public.delete_my_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.jobs       where user_id = auth.uid();
  delete from public.profiles   where user_id = auth.uid();
  delete from public.user_state where user_id = auth.uid();
  delete from public.activity   where user_id = auth.uid();
end $$;
revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
