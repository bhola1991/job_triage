-- 2026-10-08 — what the person WANTS, asked rather than inferred.
--
-- The app knew what someone can do and what they cannot, and had no
-- representation of what they want. The field that looks like preference is
-- not: every wrong_shapes entry on the live profiles is a capability
-- judgement read off the CV ("Broadcast editor: no broadcast credits shown",
-- "Film director: only assistant direction"), and gaps restates the same
-- facts. So "cannot" and "will not" were indistinguishable. See INTAKE.md.
--
-- All four are NULLABLE with no backfill. Two live profiles and every CSV
-- import predate them, and the app defaults them on read (coerceProfile) to
-- values that mean "behave exactly as before": intent 'browsing', strict 2,
-- and limits that exclude nothing.

alter table public.profiles add column if not exists intent   text;
alter table public.profiles add column if not exists strict   int;
alter table public.profiles add column if not exists exemplar text;

-- '{}' and not 'null': the gates read this object, and an empty object
-- normalises to the permissive default while a null would make every reader
-- test for it first. limits.relocate / onsite_ok are phrased as what the
-- person CAN do, so true excludes nothing — a default of false would have
-- hidden every job outside their city for every pre-existing profile.
alter table public.profiles add column if not exists limits jsonb not null default '{}';

-- Deliberately NO check constraint on intent or strict. The app clamps both on
-- the way in and on the way out (intentOf / strictOf), and a CSV import is
-- allowed to carry a value this version has never heard of into extras rather
-- than being rejected at the door — which is the same choice ai_flags and
-- score_tier made. A constraint here would turn a tolerable import into a 400.
