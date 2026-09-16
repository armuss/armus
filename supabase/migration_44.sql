-- ARMUS migration 44: reviews_insert_own_student was missing a check
-- entirely (not even a scoping mistake like migration_42.sql's - the
-- comparison was just never there), letting a student post a review
-- against a teacher they never actually had a lesson with.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

-- The policy only ever verified that the BOOKING named by booking_id
-- belongs to the reviewing student and has already happened - it never
-- checked that the teacher_id being written into the new review row is
-- who that booking was actually with. In practice: any student with
-- even a single real completed booking (with ANY teacher) could submit
-- a review naming a completely different, uninvolved teacher as
-- teacher_id - a fake 1-star (or fake 5-star) rating with zero real
-- basis, publicly visible on that teacher's profile page, and no way
-- for that teacher to have caused it. Verified against a real local
-- Postgres instance: reproduced the exploit first (a student's one real
-- booking with teacher A let them post a review against unrelated
-- teacher B), then confirmed this fix (requiring
-- "b.teacher_id = reviews.teacher_id", qualified the same way
-- migration_42.sql's attendance_reports fix was, since a bare
-- "teacher_id" here would again resolve to the innermost "bookings b"
-- row instead of the new review row) blocks it while a genuine
-- same-booking-same-teacher review still succeeds.
drop policy if exists "reviews_insert_own_student" on reviews;
create policy "reviews_insert_own_student"
  on reviews for insert
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from bookings b
      where b.id = booking_id
        and b.student_id = auth.uid()
        and b.teacher_id = reviews.teacher_id
        and b.lesson_date <= (now() at time zone b.teacher_timezone)::date
    )
  );
