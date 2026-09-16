-- Fixes the marketplace's "completed lessons" / "students taught" stats,
-- which used to be computed client-side from a plain bookings.select("*")
-- - but bookings_select_participant only ever returns rows the CALLER is
-- a participant in (or an admin). An anonymous visitor (no auth.uid() at
-- all) got zero bookings back for every teacher; a signed-in student got
-- counted only their own bookings with each teacher, not that teacher's
-- real totals. The public marketplace's core trust signal was wrong for
-- nearly all traffic.
--
-- This aggregates server-side (security definer, bypasses RLS) and
-- returns only per-teacher COUNTS - no student identity, no individual
-- booking rows - so it's safe to expose to anyone, same trust boundary
-- as reviews_select_all.

create or replace function public.teacher_marketplace_stats()
returns table (teacher_id text, completed_count bigint, student_count bigint)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.teacher_id,
    count(*) filter (
      where b.lesson_date < (now() at time zone b.teacher_timezone)::date
    ) as completed_count,
    count(distinct b.student_id) as student_count
  from bookings b
  where b.status <> 'cancelled'
  group by b.teacher_id;
$$;

grant execute on function public.teacher_marketplace_stats() to anon, authenticated;
