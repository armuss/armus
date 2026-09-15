-- ARMUS migration 40: two follow-ups from another audit pass.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

-- 1. disputes_insert_own only checked auth.uid() = reporter_id - nothing
--    stopped a client from attaching someone ELSE's real booking_id (as
--    "evidence") and naming an arbitrary other_party_name, tampering
--    directly with the API (my-lessons.html's own dispute form always
--    passes the reporter's own real booking, so this only matters
--    against a bypassed client). A fabricated dispute that looks tied to
--    a real booking and names a real, uninvolved teacher/student could
--    mislead an admin reviewing it. Now, when a booking_id is given, the
--    reporter must actually be a participant in that booking (general
--    disputes with no booking_id at all are still allowed, unchanged).
drop policy if exists "disputes_insert_own" on disputes;
create policy "disputes_insert_own"
  on disputes for insert
  with check (
    auth.uid() = reporter_id
    and (
      booking_id is null
      or exists (
        select 1 from bookings b
        where b.id = booking_id
          and (b.student_id = auth.uid() or b.teacher_id = auth.uid()::text)
      )
    )
  );

-- 2. reviews_insert_own_student compared the booking's lesson_date
--    against current_date, which is evaluated in the database's own
--    session timezone (UTC on Supabase) - the same "wall-clock date
--    treated as UTC" gap migration_37.sql closed elsewhere. A lesson
--    already underway in the teacher's own timezone (e.g. just after
--    midnight in Europe/Istanbul, still "yesterday" in UTC) would
--    incorrectly still block the student from leaving a review. Compares
--    against today's date in the booking's own teacher_timezone instead.
drop policy if exists "reviews_insert_own_student" on reviews;
create policy "reviews_insert_own_student"
  on reviews for insert
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from bookings b
      where b.id = booking_id
        and b.student_id = auth.uid()
        and b.lesson_date <= (now() at time zone b.teacher_timezone)::date
    )
  );
