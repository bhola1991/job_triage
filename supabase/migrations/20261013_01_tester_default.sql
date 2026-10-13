-- New signups are testers by default, for the length of the beta. 2026-10-13.
--
-- A credits row is created lazily (first search, first top-up) from the column
-- defaults, so the default is the only thing that decides what a new account
-- is. index.html's no-row fallback in loadCredits() says the same thing for the
-- stretch before that row exists. To end the beta: set this back to false and
-- flip that fallback; existing testers keep the flag until set_tester(.., false).
alter table public.credits alter column tester set default true;
