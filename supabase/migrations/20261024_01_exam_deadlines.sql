-- Exam closing dates, read once for everyone (exam_refresh in the edge function,
-- every 4 days from .github/workflows/exams.yml). See schema.sql.
create table if not exists public.exam_deadlines (
  key         text        primary key,
  body        text        not null,
  title       text        not null,
  state       text        not null check (state in ('open', 'closed')),
  closes      date,
  quote       text        not null,
  source_url  text        not null,
  checked_on  date        not null default current_date
);
create index if not exists exam_deadlines_body on public.exam_deadlines (body, checked_on desc);
alter table public.exam_deadlines enable row level security;
drop policy if exists "shared: select" on public.exam_deadlines;
create policy "shared: select" on public.exam_deadlines for select to authenticated using (true);
