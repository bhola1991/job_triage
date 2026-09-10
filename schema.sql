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

-- ─────────────────────────────────────────────────────────────────────────────
-- Usernames.
--
-- People sign in with a username, not an email. Supabase authenticates on the
-- email address, so the username has to be resolved to one BEFORE anybody is
-- signed in. That is what login_email() below is for, and it is the one place
-- in this schema that deliberately hands data to an anonymous caller.
--
-- The trade: someone who guesses a username learns the email address on that
-- account. The alternative is to authenticate against a synthetic address like
-- <username>@example.invalid, which leaks nothing but breaks Supabase's own
-- password-reset email, since that is sent to whatever the auth address is.
-- Reset mattering more than username privacy is the call being made here. If
-- that is the wrong call for you, the fix is an edge function holding the
-- service_role key, and this function goes away.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.usernames (
  username   text        primary key,
  user_id    uuid        not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Lowercase only, so "Soumyadip" and "soumyadip" cannot both be taken.
  constraint username_shape check (username ~ '^[a-z0-9_]{3,20}$')
);

alter table public.usernames enable row level security;

-- Nobody reads this table directly. Every path that needs it goes through one
-- of the security definer functions below, which is what keeps the mapping
-- from being enumerable a row at a time.
drop policy if exists "own row: select" on public.usernames;
create policy "own row: select" on public.usernames
  for select using (auth.uid() = user_id);

-- Claiming happens in a trigger rather than from the browser. Sign-up with
-- email confirmation switched on returns no session, so there is no
-- authenticated moment in which the client could insert its own row, and a
-- username that only gets claimed at first sign-in cannot be signed in with.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- '->> is not null' rather than the '?' operator: some SQL clients treat a
  -- bare ? as a bind placeholder and mangle the function body on the way in.
  if new.raw_user_meta_data->>'username' is not null then
    insert into public.usernames (username, user_id)
    values (lower(new.raw_user_meta_data->>'username'), new.id);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Checked before sign-up so a taken name is a field error rather than a failed
-- account creation. Returns only a boolean: it confirms a name is spoken for,
-- which the sign-up form would reveal anyway by refusing it.
create or replace function public.username_available(p_username text)
returns boolean language sql security definer set search_path = public stable as $$
  select not exists (select 1 from public.usernames where username = lower(p_username));
$$;

-- The pre-auth lookup described at the top of this section.
create or replace function public.login_email(p_username text)
returns text language sql security definer set search_path = public stable as $$
  select u.email
    from auth.users u
    join public.usernames n on n.user_id = u.id
   where n.username = lower(p_username);
$$;

revoke all on function public.username_available(text) from public;
revoke all on function public.login_email(text)        from public;
-- anon, because both run before anyone has signed in.
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.login_email(text)        to anon, authenticated;

-- Accounts made before usernames existed have no row above, and so no name to
-- sign in with. They sign in with their email instead, and the app then makes
-- them pick a name once. This is what that picking calls.
--
-- The trigger cannot do this job: it fires on insert into auth.users, and
-- these users were inserted long ago.
create or replace function public.claim_username(p_username text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  -- One name per account, and no changing it here. Letting a name be swapped
  -- would orphan whatever the old one is written down in.
  if exists (select 1 from public.usernames where user_id = auth.uid()) then
    raise exception 'this account already has a username';
  end if;
  -- Shape and uniqueness are the table's job; a violation here surfaces to the
  -- caller as an error rather than being re-checked in two places.
  insert into public.usernames (username, user_id)
  values (lower(p_username), auth.uid());
end $$;

revoke all on function public.claim_username(text) from public;
grant execute on function public.claim_username(text) to authenticated;

-- Whether this account has finished the step above. Read at sign-in, because
-- user_metadata can be stale on a session minted before the name was claimed.
create or replace function public.my_username()
returns text language sql security definer set search_path = public stable as $$
  select username from public.usernames where user_id = auth.uid();
$$;

revoke all on function public.my_username() from public;
grant execute on function public.my_username() to authenticated;

-- ---------------------------------------------------------------------------
-- Lock the signed-in-only functions to signed-in callers.
--
-- "revoke all ... from public" above does not do it on Supabase. Supabase
-- grants EXECUTE on functions in the public schema to `anon` and
-- `authenticated` through default privileges, so the grant to `anon` is direct
-- rather than inherited from PUBLIC, and revoking PUBLIC leaves it in place.
--
-- Checked against a live project with nothing but the anon key: an anonymous
-- caller could execute delete_my_data() and my_username(). Neither leaked or
-- destroyed anything, because both key off auth.uid() and that is null with no
-- session -- but delete_my_data() is SECURITY DEFINER, so it runs as its owner
-- and bypasses row-level security. It is one careless edit to its WHERE clause
-- away from letting an anonymous caller empty the table. It should not be
-- reachable at all.
--
-- login_email() and username_available() stay callable by anon on purpose:
-- sign-in has to resolve a username before anybody has a session.
-- ---------------------------------------------------------------------------

revoke all on function public.my_username()          from anon;
revoke all on function public.claim_username(text)   from anon;
revoke all on function public.delete_my_data()       from anon;

-- Belt as well as braces: check the caller rather than trusting the WHERE
-- clause to be harmless when auth.uid() is null. claim_username() already does
-- this, which is the only reason an anonymous call to it failed cleanly.
create or replace function public.delete_my_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.user_state where user_id = auth.uid();
end $$;

revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
