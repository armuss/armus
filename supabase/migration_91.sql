-- ARMUS migration 91: teacher_review_stats - a server-side per-teacher
-- rating/review-count aggregate for the marketplace grid, replacing a
-- full masked_reviews.select("*") that downloaded every review on the
-- entire platform (every review's full comment and reviewer name, for
-- every teacher) just to average two numbers per teacher card. Mirrors
-- teacher_marketplace_stats (migration_48.sql) exactly - same reasoning,
-- same security-definer/stable shape, same anon+authenticated grant. A
-- teacher's own profile page keeps fetching that one teacher's real
-- reviews (where the actual text/name are shown) - this is only for the
-- listing grid, which never shows that.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create or replace function public.teacher_review_stats()
returns table (teacher_id text, avg_rating numeric, review_count bigint)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.teacher_id,
    round(avg(r.stars)::numeric, 1) as avg_rating,
    count(*) as review_count
  from reviews r
  group by r.teacher_id;
$$;

grant execute on function public.teacher_review_stats() to anon, authenticated;
