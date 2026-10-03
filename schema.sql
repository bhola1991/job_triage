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
  -- Which model produced ai_score. usage_events.note already recorded the model
  -- per CALL and this table recorded the score per JOB, with nothing joining
  -- them -- so comparing deepseek-v4-pro against deepseek-flash, a 4.9x price
  -- difference, could not be done from the data being collected. Null for a row
  -- scored on the user's own key, where the model is their choice to make.
  ai_model text,
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
  -- How we know, because the two ways are not equally good. 'inferred' means it
  -- was in yesterday's snapshot and not today's, and that signal carries real
  -- noise: 20.8% of the Naukri index vanished in two days on 2026-09-26, with an
  -- age gradient (16.6% at 8-14 days rising to 42.8% at 61-90) saying part is
  -- expiry and part is the index rotating. 'declared' means the board published
  -- it as dead -- Naukri ships sitemap-expired-jd-pages.xml -- and has no such
  -- floor under it. A render that says "gone from the board" should be able to
  -- tell knowing from guessing.
  closed_src text        check (closed_src is null or closed_src in ('declared', 'inferred')),
  checked_at timestamptz not null default now()
);

create index if not exists job_checks_source_seen on public.job_checks (source, last_seen desc);
-- No index on (closed_on) where closed_on is null. There was one; it took
-- 3,360 kB and pg_stat_user_indexes recorded ZERO scans over the life of the
-- table, because nothing looks a posting up by "still open" -- search_index
-- reaches job_checks through the primary key on the join, and prune_index wants
-- the opposite predicate, which job_checks_closed_src already covers.
create index if not exists job_checks_closed_src  on public.job_checks (closed_src) where closed_on is not null;

-- Readable by every signed-in user, writable by nobody through the API.
-- There is no user_id to scope by and nothing personal in the table: a job_key
-- is a url or a title/company/location triple. The writer is verify.js through
-- the service role, which bypasses RLS -- so select is the only policy, and its
-- absence for the other verbs is the deny.
alter table public.job_checks enable row level security;

drop policy if exists "shared: select" on public.job_checks;
create policy "shared: select" on public.job_checks
  for select to authenticated using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- job_index — the shared corpus
--
-- Shared, like job_checks and for the same reason: acquiring a posting costs
-- ~16x what deciding about it costs (scripts/index/README.md), so the row you
-- buy once and serve to everyone is the only one that scales. public.jobs stays
-- per-user and is what someone has CHOSEN to track; this is everything known.
--
-- Two tiers, and the distinction is load-bearing rather than cosmetic:
--   full  an ATS board, RSS or JSON feed. Carries a real description, so it can
--         be judged and scored.
--   thin  a board sitemap. Title, company, city, experience and a date, and NO
--         description -- a Naukri job page is a client-rendered shell. A thin
--         row is a candidate for a shortlist, never an answer, and nothing
--         should ask Jev to judge fit from one.
--
-- description is capped at 4,000 characters, which is the cap scrapedJob() and
-- the JSearch mapper already apply. Uncapped, the measured median is 7,319 and
-- the max 36,121; 4,840 crawled jobs are 37 MB on disk, so a six-figure corpus
-- would not fit the database it lives in. The index is a filter, not a document
-- store: whatever needs the full text can fetch it for the few rows that reach
-- a person.
create table if not exists public.job_index (
  -- keyOf() in index.html, the same identity public.jobs and public.job_checks
  -- use, so all three join without a translation layer.
  job_key       text        primary key,
  source        text        not null,
  -- There is no url column, deliberately. job_key is 'u:' || lower(url) for
  -- every row in the corpus -- checked across all 353,604 of them -- so a url
  -- column is a second copy of the primary key, and that key is already the
  -- single largest consumer of space here (74 MB of index on its own). Dropping
  -- it returned 81 MB and took the database from 90% of its tier to 74%.
  -- Readers rebuild it: substring(job_key from 3). The rebuild is lowercased,
  -- which is safe: 99 rows differ in case and every one of them differs only
  -- inside the hostname, where DNS does not care.
  title         text        not null,
  company       text,
  location      text,
  posted        date,
  description   text,
  tier          text        not null default 'thin' check (tier in ('full', 'thin')),
  -- Naukri slugs carry a range; most sources carry neither.
  exp_min       integer,
  exp_max       integer,
  -- The site the posting is on, which is not the source that delivered it:
  -- the Google run can hand us a LinkedIn posting.
  publisher     text,
  first_indexed date        not null default current_date,
  updated_at    timestamptz not null default now(),
  -- The same role is posted to five boards under five urls, so job_key cannot
  -- group them. Generated rather than written: a dedup key computed by each
  -- caller is a dedup key that disagrees with itself. Title and company only --
  -- adding location would split Bengaluru from Bangalore and undo the grouping.
  dedup_key     text generated always as (
    lower(regexp_replace(coalesce(title, '') || '|' || coalesce(company, ''), '[^a-zA-Z0-9|]', '', 'g'))
  ) stored
);

-- No index on (dedup_key), deliberately, and this one is worth explaining
-- because the column is load-bearing while the index was not. search_index
-- collapses duplicates with `distinct on (dedup_key)` over a CTE that has
-- ALREADY been cut to a few hundred candidates, and sorts that in memory; no
-- query anywhere looks a row up BY dedup_key, and there is not one WHERE clause
-- on it in this file, the edge function or scripts/index/. It cost 39 MB -- 7%
-- of a 500 MB tier -- for one recorded scan in the table's lifetime.
create index if not exists job_index_source  on public.job_index (source, posted desc nulls last);
create index if not exists job_index_posted  on public.job_index (posted desc nulls last) where tier = 'full';

-- Shared and non-personal, so the same policy shape as job_checks: readable by
-- any signed-in user, written only by the service role, and the absence of the
-- other three policies is the deny.
alter table public.job_index enable row level security;

drop policy if exists "shared: select" on public.job_index;
create policy "shared: select" on public.job_index
  for select to authenticated using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- prune_index — keep the corpus steady-state instead of monotonic
--
-- A board's LIVE inventory does not grow. Naukri carries ~350k postings and
-- takes in ~10,088 a day while a comparable number expire, so a corpus that
-- deletes what is dead sits at a constant size forever. Only the graveyard
-- grows, and the graveyard is what would have filled a 500 MB tier in about
-- two weeks: measured 2026-09-27, a job costs ~607 bytes in job_index and
-- ~443 in job_checks, so ten days of intake is ~128 MB against ~131 MB free.
--
-- What is NEVER pruned, and it is the only rule that matters here: a posting
-- someone is tracking. public.jobs is a person's own list, and the day they
-- open a row to find out what happened is exactly the day this would have
-- deleted the answer. The closure history of a tracked job is the most
-- valuable row in the table, not the most expendable.
--
-- Closed rows only. A posting with no closed_on has not been shown to be dead,
-- and 'not checked' must never be read as 'gone' -- the same rule liveOf
-- follows in the app, where null is never false.
create or replace function public.prune_index(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_index integer; v_checks integer;
begin
  with gone as (
    select c.job_key
      from public.job_checks c
     where c.closed_on is not null
       and c.closed_on < current_date - greatest(p_days, 7)
       and not exists (select 1 from public.jobs j where j.job_key = c.job_key)
  ),
  di as (delete from public.job_index  i using gone g where i.job_key = g.job_key returning 1),
  dc as (delete from public.job_checks c using gone g where c.job_key = g.job_key returning 1)
  select (select count(*) from di), (select count(*) from dc) into v_index, v_checks;
  return jsonb_build_object('index_deleted', v_index, 'checks_deleted', v_checks,
                            'older_than_days', greatest(p_days, 7));
end $$;

-- Service role only: this deletes, and nothing reachable from the browser
-- should be able to.
revoke all on function public.prune_index(integer) from public, anon, authenticated;
grant execute on function public.prune_index(integer) to service_role;

-- Title search over the corpus. ILIKE '%…%' across 353,604 rows took 5.6
-- seconds -- it scanned 128,942 and filtered every one -- so titles are
-- indexed. 'simple' and not 'english' on purpose: the english configuration
-- stems, so "Engineering Manager" and "Engineer" would collapse into the same
-- token, and they are different jobs. It also drops stopwords, which would
-- quietly delete the "of" in "Head of Data".
-- GIN over the expression rather than a stored column: nothing reads the
-- vector, only the index needs it, and a column would add ~30 MB of heap.
create index if not exists job_index_title_fts
  on public.job_index using gin (to_tsvector('simple', title));

-- The corpus, searched. This is what makes 353,604 free postings reachable by
-- a person instead of sitting in a table nothing queries.
--
-- Three channels, strictest first, each filling only what the one above left:
--
--   phrase   "Operations Manager", those words in that order.
--   words    every word of one title, any order.
--   partial  any word, ranked by ts_rank. Last resort.
--
-- The third exists because two were all-or-nothing. Measured against four real
-- tracks: phrase gave 60, 60 and 58 rows for Operations Manager, Content
-- Strategist and Agri-Tech Founder -- and ZERO for AI Systems Builder, whose
-- titles exist nowhere in the corpus as those exact consecutive words. It
-- failed hardest on the emerging roles where titles vary most. Adding `words`
-- took that track to 5; the corpus holds 386 titles with ai+developer and
-- 1,923 with ai+engineer, so requiring every word of a four-word title is
-- barely looser than requiring the phrase. `partial` takes it to 60.
--
-- This is the design scripts/index/retrieve.js already validated -- literal
-- matches taken outright, a weaker channel filling the pool, 47% -> 100%
-- recall -- and only the literal half had been implemented.
--
-- The third channel is only PAID FOR when needed. Running it unconditionally
-- cost 3.47 seconds on a track phrase matching answered in 49 ms, because
-- "Operations Manager" widens to operations|manager|supply|chain|... and that
-- is most of the corpus. So a cheap probe counts the strict hits, stopping at
-- the limit, and only widens if they cannot fill the page.
--
-- Two more things were measured rather than reasoned about:
--
-- Narrow BEFORE joining job_checks. Match, join, sort, limit took 5.6 seconds,
-- because ~1,949 title matches each cost a 1.4 ms lookup into a 151 MB table.
-- Cutting to the final candidates first takes it to 25 ms.
--
-- Dedup on dedup_key. Without it the first version returned nine copies of one
-- posting -- a recruiter listing the same role in nine cities -- while the
-- second requested title returned nothing, because the flood took every slot.
-- The collapsed count comes back so the caller can say "also in 8 other
-- cities" instead of hiding them.
--
-- LEFT join, so `closed_on is null` admits rows never checked. Same rule
-- liveOf follows in the app: unchecked is not dead, and hiding unverified rows
-- would hide most of the corpus.
--
-- ts_rank is not BM25 -- no idf, so "developer" and "llm" weigh alike -- which
-- is why partial ranks last rather than being blended into a single score.
create or replace function public.search_index(
  p_titles text[], p_days integer default 30, p_limit integer default 60)
returns table (job_key text, title text, company text, location text,
               posted date, tier text, source text, closed_on date,
               duplicates integer, channel text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_phrase tsquery; v_words tsquery; v_any tsquery; v_filter tsquery; t text; w text;
  v_lim integer := least(greatest(coalesce(p_limit, 60), 1), 200);
  v_since date := current_date - greatest(coalesce(p_days, 30), 1);
  v_strict integer;
begin
  foreach t in array coalesce(p_titles, '{}'::text[]) loop
    if length(btrim(t)) > 0 then
      v_phrase := case when v_phrase is null then phraseto_tsquery('simple', t)
                       else v_phrase || phraseto_tsquery('simple', t) end;
      v_words  := case when v_words  is null then plainto_tsquery('simple', t)
                       else v_words  || plainto_tsquery('simple', t) end;
      -- Split rather than string surgery on a tsquery, so a title containing
      -- an operator stays data.
      foreach w in array regexp_split_to_array(lower(btrim(t)), '[^a-z0-9+#]+') loop
        if length(w) >= 2 then
          v_any := case when v_any is null then plainto_tsquery('simple', w)
                        else v_any || plainto_tsquery('simple', w) end;
        end if;
      end loop;
    end if;
  end loop;
  if v_phrase is null or v_any is null then return; end if;

  select count(*) into v_strict from (
    select 1 from public.job_index i
     where i.posted >= v_since and to_tsvector('simple', i.title) @@ v_words
     limit v_lim) probe;

  v_filter := case when v_strict >= v_lim then v_words else v_any end;

  return query
  with cand as (
    select i.job_key, i.title, i.company, i.location, i.posted, i.tier, i.source, i.dedup_key,
           case when to_tsvector('simple', i.title) @@ v_phrase then 0
                when to_tsvector('simple', i.title) @@ v_words  then 1
                else 2 end as chan,
           ts_rank(to_tsvector('simple', i.title), v_any) as rank
      from public.job_index i
     where i.posted >= v_since
       and to_tsvector('simple', i.title) @@ v_filter
  ),
  one as (
    -- Which copy of a job survives the collapse. `chan` leads, so relevance
    -- still decides: promoting a full row that only matched `partial` over a
    -- thin one that matched the phrase would demote the whole group in the
    -- outer ranking, which is a worse trade than a missing description.
    -- Within one channel a dedup_key means the SAME job -- the key is
    -- normalised title+company -- so there the row carrying a real description
    -- wins, because a thin row can be shortlisted and never judged. Latent
    -- until the board_search deposit lands: as of 2026-10-03 no dedup group
    -- holds both tiers, and every one of them will once searches start
    -- depositing a full copy of a posting the crawler already has thin.
    select distinct on (dedup_key) *, count(*) over (partition by dedup_key) as dupes
    -- cand.tier, qualified: `tier` on its own is also an OUT column of this
    -- function's RETURNS TABLE, and plpgsql rejects the reference as ambiguous.
      from cand order by dedup_key, chan, (cand.tier = 'full') desc, posted desc nulls last
  ),
  hit as (
    select * from one
     order by chan, case when chan = 2 then -rank else 0 end, posted desc
     limit v_lim * 4
  )
  select h.job_key, h.title, h.company, h.location, h.posted, h.tier, h.source,
         c.closed_on, h.dupes::integer,
         (array['phrase','words','partial'])[h.chan + 1]
    from hit h
    left join public.job_checks c on c.job_key = h.job_key
   where c.closed_on is null
   order by h.chan, case when h.chan = 2 then -h.rank else 0 end, h.posted desc
   limit v_lim;
end $$;

revoke all on function public.search_index(text[], integer, integer) from public, anon;
grant execute on function public.search_index(text[], integer, integer) to authenticated, service_role;
