-- Beta testers get their own flag. Written 2026-10-10; run it in the SQL editor.
--
-- Until now "tester" was read off `unlimited`, which also stops every search
-- being charged -- so marking somebody a tester handed them free searches
-- without end. `tester` only decides what the app SHOWS (the corner feedback
-- button and the questions it asks). What a tester can spend is the ordinary
-- free tier: 10 board searches, and the 100 AI credits that go with them.
--
-- Like `unlimited`, no policy lets a user write this column, and the browser
-- reads it through the existing "own credits: select" policy.
alter table public.credits add column if not exists tester boolean not null default false;

-- Make somebody a tester, or stop them being one, from the SQL editor:
--   select public.set_tester('their_username');           -- or their email
--   select public.set_tester('their_username', false);
-- Ticking `tester` on their row in the Table Editor does the same, when the row
-- exists; this also works for an account that has never searched and so has no
-- row yet. Turning it on tops the free tier back up to a full 10 searches; it
-- never takes anything away, and it leaves an unlimited account unlimited.
create or replace function public.set_tester(p_who text, p_on boolean default true)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select user_id into uid from public.usernames where username = lower(p_who);
  if uid is null then select id into uid from auth.users where lower(email) = lower(p_who); end if;
  if uid is null then return 'no account with that username or email'; end if;
  insert into public.credits (user_id) values (uid) on conflict (user_id) do nothing;
  update public.credits set tester = p_on,
         free_search = case when p_on then greatest(free_search, 10)  else free_search end,
         free_llm    = case when p_on then greatest(free_llm, 100)    else free_llm    end,
         free_tier   = case when p_on then true                       else free_tier   end,
         updated_at  = now()
   where user_id = uid;
  return case when p_on then 'tester' else 'not a tester' end;
end $$;
revoke all on function public.set_tester(text, boolean) from public, anon, authenticated;
grant execute on function public.set_tester(text, boolean) to service_role;

-- Everyone who already has an account is a tester.
insert into public.credits (user_id) select id from auth.users on conflict (user_id) do nothing;
update public.credits set tester = true,
       free_search = greatest(free_search, 10), free_llm = greatest(free_llm, 100),
       free_tier = true, updated_at = now();
