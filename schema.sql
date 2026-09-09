-- Job Triage — database schema.
-- Paste this whole file into the Supabase SQL editor and run it once.
--
-- One table, because the app's storage layer is a key/value shim (put/get) and
-- mapping it 1:1 keeps the entire rest of the app unchanged. Each row is one
-- key for one user. The 'v' column holds the app's own JSON, which for the
-- 'triage:db' key includes the CV text and every job — so this table is
-- personal data, and everything below exists to keep one user's rows
-- unreachable from any other user's session.

create table if not exists public.user_state (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  k          text        not null,
  v          text        not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, k)
);

-- Row-level security is the whole security model here. The anon key is public,
-- so without these policies anyone could read every row. With them, the only
-- rows any session can see are the ones whose user_id matches the JWT.
alter table public.user_state enable row level security;

drop policy if exists "own rows: select" on public.user_state;
create policy "own rows: select" on public.user_state
  for select using (auth.uid() = user_id);

drop policy if exists "own rows: insert" on public.user_state;
create policy "own rows: insert" on public.user_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "own rows: update" on public.user_state;
create policy "own rows: update" on public.user_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows: delete" on public.user_state;
create policy "own rows: delete" on public.user_state
  for delete using (auth.uid() = user_id);

-- 'on delete cascade' above means deleting the auth user removes their rows.
-- This function lets a signed-in person erase their own data without deleting
-- the account, which is the more common request and is required to be easy.
create or replace function public.delete_my_data()
returns void language sql security definer set search_path = public as $$
  delete from public.user_state where user_id = auth.uid();
$$;

revoke all on function public.delete_my_data() from public;
grant execute on function public.delete_my_data() to authenticated;
