-- 2026-10-06 - search_index returns the description it already has.
--
-- index_search in the edge function hard-coded description: "" for EVERY row
-- it returned, under a comment about THIN rows -- but it applied to the ~30,000
-- `full` rows too, which carry 2-4 KB of real text. So the free index path read
-- a description out of job_index and threw it away, and almost everything it
-- returned arrived flagged `thin` ("no description available") and scored at
-- low confidence from title and company alone.
--
-- Measured on the first external profile (Ujan Ganguly, 2026-10-05): all 16
-- rows were tier=full in the corpus with 1,665-4,000 chars each, and 13 reached
-- the user with zero. The three that survived were Ashby boards, rescued
-- client-side by fromAts(). 13 of 16 carried the `thin` flag; 13 of 16 scored
-- at confidence `low`.
--
-- DROP first: the return type gains a column and Postgres refuses to change
-- the signature of an existing function through CREATE OR REPLACE.
drop function if exists public.search_index(text[], integer, integer);

create or replace function public.search_index(
  p_titles text[], p_days integer default 30, p_limit integer default 60)
returns table (job_key text, title text, company text, location text,
               posted date, tier text, source text, closed_on date,
               duplicates integer, channel text,
               -- Added 2026-10-06. It was missing, and index_search in the edge
               -- function therefore returned description: "" for EVERY row --
               -- including the 30,000-odd `full` ones that carry 2-4 KB of real
               -- text. The free index path was reading a description out of this
               -- table and throwing it away, so almost everything it returned
               -- came back flagged `thin` ("no description available") and scored
               -- at low confidence off title and company alone. Measured on the
               -- first external profile: 16 of 16 rows full in the corpus, 13 of
               -- them delivered empty. The three that survived were Ashby boards
               -- rescued client-side by fromAts().
               description text)
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
           i.description,
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
         (array['phrase','words','partial'])[h.chan + 1],
         h.description
    from hit h
    left join public.job_checks c on c.job_key = h.job_key
   where c.closed_on is null
   order by h.chan, case when h.chan = 2 then -h.rank else 0 end, h.posted desc
   limit v_lim;
end $$;

revoke all on function public.search_index(text[], integer, integer) from public, anon;
grant execute on function public.search_index(text[], integer, integer) to authenticated, service_role;
