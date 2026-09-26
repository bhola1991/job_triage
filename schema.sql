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


-- ===========================================================================
-- Per-row storage: profiles and jobs
-- ===========================================================================
--
-- Everything above stores a user's whole world in one text blob under the
-- 'triage:db' key. A save is a full rewrite of that blob, so two tabs that
-- both save lose whichever finished first -- and it is never the tab that was
-- wrong, just the slower one. Searching in one tab while editing in another is
-- the ordinary way to use this app, so that is not a rare race.
--
-- These two tables take the blob apart. A job is a row, so two tabs editing
-- two different jobs write two different rows and neither is lost. Within one
-- row the policy is last-writer-wins, which is the honest trade: the loser is
-- one field of one job rather than every job added since the other tab loaded.
--
-- The blob does not disappear when these arrive. 'triage:db' is written
-- alongside the rows until 'triage:migrated' is set for that user, so a
-- rollback is a one-line change rather than a restore.

create table if not exists public.profiles (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  -- The app's own profile key ('p_mdx1k2' -- index.html mints it from the
  -- clock). It is what DB.profiles is keyed by and what DB.current points at,
  -- so it has to survive the round trip; a uuid the app never sees could not
  -- rebuild either. Unique per user, not globally: two people importing the
  -- same backup would otherwise collide.
  local_id   text        not null,
  name text, headline text, location text, country text,
  -- Google's countryCode wants "in", not "India" and not "IN". The app
  -- normalises to two lower-case letters and searches with it, so it is its
  -- own column rather than something parsed back out of `country`.
  country_code text,
  seniority text, years_experience int,
  domains      jsonb not null default '[]',
  strengths    jsonb not null default '[]',
  hard_skills  jsonb not null default '[]',
  gaps         jsonb not null default '[]',
  wrong_shapes jsonb not null default '[]',
  unusual_combination text,
  -- The CV as typed or extracted. This is the most personal column in the
  -- database and the reason row-level security below is not optional.
  cv_text    text,
  tracks     jsonb not null default '[]',
  -- Which track is selected right now: an id from tracks[], not an index.
  track      text,
  -- The app writes plain 'YYYY-MM-DD' strings and shows them unparsed.
  created    text,
  -- Anything a typed column above could not hold without changing it. The app
  -- is one HTML file with no validation layer: years_experience is asked for
  -- as a number but arrives from a language model, and a CSV import copies
  -- whatever was in the cell. Dropping those on the way into an int column
  -- would be a silent, permanent edit to somebody's data. They come here
  -- instead, verbatim, and are laid back over the row on read.
  extras     jsonb not null default '{}',
  role       text        not null default 'candidate',   -- 'employer' reserved
  discoverable boolean   not null default false,         -- visibility stub
  deleted    boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_id)
);

create table if not exists public.jobs (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  profile_id uuid        not null references public.profiles(id) on delete cascade,
  -- keyOf() in index.html: 'u:<lowercased url>', or 't:title|company|location'
  -- when there is no url. This is already what "have I seen this job before"
  -- means to the app, so it is the natural key here too -- a second identity
  -- scheme would let the same posting exist twice, once per definition.
  job_key    text        not null,
  url text, title text, company text, location text, description text,
  -- Provenance of the posting date. posted is the midpoint of lo..hi and the
  -- only one sorted on; posted_src says whether a feed stated it, a listing
  -- was parsed, or a model guessed.
  posted date, posted_lo date, posted_hi date, posted_src text,
  channel text, stage text, status text,
  date_applied date, follow_up_date date, last_touch date,
  pitch_sent text, notes text, source text, query text,
  -- Which door this row came in through. Written by jsearchRow() but missing
  -- from the app's own COLS list, so it survives the blob and is dropped by a
  -- CSV round trip. Carried here because losing it silently would be worse.
  origin text,
  ai_score int, ai_reachability int, ai_confidence text,
  -- Comma-joined long flag names, as the app writes them today. This becomes
  -- jsonb in step 2, when the flags gain facts and evidence spans and the
  -- shape actually changes. Changing it here as well would mean migrating the
  -- column twice.
  ai_flags text,
  -- Jev's answers for this posting, whole and unthresholded: every flag's
  -- probability, both fit score distributions, and the visibility choice.
  -- The app derives fit, reachability and the rank weight from this in the
  -- browser, so re-weighting any of them is free -- the evidence has not
  -- changed, only what we do with it. text rather than jsonb for the same
  -- reason as ai_flags above: both are JSON held in a string by the app, and
  -- migrating them together once is better than migrating one of them twice.
  ai_judgment text,
  ai_reason text,
  -- See profiles.extras. On a job this earns its keep at the CSV door, which
  -- copies cells in untouched: a date_applied of "12/03/2025" is not a date
  -- to Postgres, and follow_up_date is legitimately in the future, so the
  -- app's own date parser cannot be used to rescue it either.
  extras   jsonb not null default '{}',
  contacts jsonb not null default '[]',
  events   jsonb not null default '[]',
  added    text,
  -- A tombstone, not a row that vanishes. A tab that has been offline still
  -- holds a job somebody else deleted; without this it would helpfully add it
  -- back on its next save.
  deleted    boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, job_key)
);

create index if not exists jobs_user_updated on public.jobs (user_id, updated_at desc);
create index if not exists jobs_profile      on public.jobs (profile_id);
create index if not exists profiles_user     on public.profiles (user_id);

-- Same four policies as user_state above, for the same reason: the anon key is
-- public, so without them anyone could read every CV in the table. All four
-- verbs, because the write path upserts (insert AND update) and soft-deletes.
alter table public.profiles enable row level security;

drop policy if exists "own rows: select" on public.profiles;
create policy "own rows: select" on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists "own rows: insert" on public.profiles;
create policy "own rows: insert" on public.profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists "own rows: update" on public.profiles;
create policy "own rows: update" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows: delete" on public.profiles;
create policy "own rows: delete" on public.profiles
  for delete using (auth.uid() = user_id);

alter table public.jobs enable row level security;

drop policy if exists "own rows: select" on public.jobs;
create policy "own rows: select" on public.jobs
  for select using (auth.uid() = user_id);

-- The insert check carries a second clause the others do not need: a job must
-- point at a profile the same person owns. user_id alone would let a caller
-- file their own job under somebody else's profile_id -- not a read of another
-- user's data, but a write into their list, which is worse.
drop policy if exists "own rows: insert" on public.jobs;
create policy "own rows: insert" on public.jobs
  for insert with check (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p
                 where p.id = profile_id and p.user_id = auth.uid())
  );

drop policy if exists "own rows: update" on public.jobs;
create policy "own rows: update" on public.jobs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows: delete" on public.jobs;
create policy "own rows: delete" on public.jobs
  for delete using (auth.uid() = user_id);

-- "Delete my data" has to reach the new tables too. The cascade from
-- auth.users only fires when the ACCOUNT goes; this function is the other
-- case, where someone empties their data and keeps the login. Until these two
-- lines existed it emptied the blob and left every job row in place, which
-- would have been the worst possible version of a privacy control: it reports
-- success and the data is still there.
create or replace function public.delete_my_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.jobs       where user_id = auth.uid();
  delete from public.profiles   where user_id = auth.uid();
  delete from public.user_state where user_id = auth.uid();
end $$;

revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;


-- ---------------------------------------------------------------------------
-- The outcome loop
-- ---------------------------------------------------------------------------
--
-- "Log the outcome when someone acts on a job" needs no log. The outcome was
-- always recorded -- stage is new/sent/live/closed and setStage stamps the
-- dates -- it just had nowhere to meet the prediction, because the prediction
-- lived inside a JSON blob that no query could reach into.
--
-- Now they are columns on the same row, so the loop closes with a view and no
-- new writes, no second ledger and no further copy of anybody's data. What it
-- answers is the question the matcher has to be judged on: of the jobs where
-- we raised a given flag, how many did this person actually act on, and how
-- many came back?
--
-- security_invoker means it runs as the caller, so row-level security on jobs
-- scopes it to one person's own rows -- the same arrangement the usage views
-- in billing.sql use. Tombstoned rows are counted on purpose: a job someone
-- deleted is an outcome, and quite an informative one.

create or replace view public.matcher_outcomes with (security_invoker = on) as
select
  fl.el ->> 'code'                                             as flag,
  count(*)                                                     as judged,
  count(*) filter (where j.stage in ('sent', 'live', 'closed')) as applied,
  count(*) filter (where j.stage = 'live')                     as replied,
  count(*) filter (where j.deleted)                            as discarded,
  round(avg(j.ai_score), 1)                                    as avg_fit,
  round(avg(j.ai_reachability), 1)                             as avg_reach
from public.jobs j
cross join lateral jsonb_array_elements(
  -- ai_flags is text: a JSON array since the flags gained facts, a comma-
  -- joined list of long names before that. Only the first shape is readable
  -- here, and the older rows simply do not contribute.
  case when left(btrim(coalesce(j.ai_flags, '')), 1) = '['
       then j.ai_flags::jsonb
       else '[]'::jsonb end
) as fl(el)
group by 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- job_checks — is this posting still real?
--
-- The one table here that is NOT per-user, and that is the point. Whether a
-- posting is still listed is a fact about the posting, not about anyone's copy
-- of it: `jobs` is unique on (profile_id, job_key), so the same role held by
-- ten people would otherwise be checked ten times to learn one thing. Checked
-- once, read by everyone — the same argument scripts/index/README.md makes for
-- acquiring a row once and serving it to everyone.
--
-- Liveness is a set difference, never a fetch. Every job url sampled on
-- 2026-09-25 returned 403 to a datacentre IP, and naukri.com/robots.txt names
-- claudebot, gptbot and perplexitybot and disallows them the whole site. But
-- the boards publish their complete current index daily to be crawled, so
-- membership answers the question: present today and absent tomorrow is a
-- closure, with a date. scripts/index/verify.js computes exactly these columns.
--
-- One row per posting, carrying the derived facts rather than one row per
-- observation. A full event log is 18,806 rows a day for one city; these
-- counters are what the render and the suspect rules actually read, and a
-- job_check_events table can be added the day something needs the history.
create table if not exists public.job_checks (
  -- keyOf() in index.html, same identity scheme as public.jobs.job_key.
  job_key    text        primary key,
  -- Which index this was last seen in, so a run that covered only Pune can
  -- never be read as closing Mumbai. verify.js enforces the same rule.
  source     text        not null,
  first_seen date        not null,
  last_seen  date        not null,
  runs       integer     not null default 1 check (runs >= 0),
  -- Taken down and listed again. A role advertised four times is either hard
  -- to fill or was never being filled; either way it is not what it appears.
  reposts    integer     not null default 0 check (reposts >= 0),
  -- Null means still listed. Set on the first run that covered its source and
  -- did not find it.
  closed_on  date,
  checked_at timestamptz not null default now()
);

create index if not exists job_checks_source_seen on public.job_checks (source, last_seen desc);
create index if not exists job_checks_open        on public.job_checks (closed_on) where closed_on is null;

-- Readable by every signed-in user, writable by nobody through the API.
-- There is no user_id to scope by and nothing personal in the table: a job_key
-- is a url or a title/company/location triple. The writer is verify.js through
-- the service role, which bypasses RLS -- so select is the only policy, and its
-- absence for the other verbs is the deny.
alter table public.job_checks enable row level security;

drop policy if exists "shared: select" on public.job_checks;
create policy "shared: select" on public.job_checks
  for select to authenticated using (true);
