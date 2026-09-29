-- ARMUS migration 83: pins a review's student_name to the reviewer's own
-- real profiles.name.
--
-- reviews_insert_own_student already verified booking/teacher/student
-- ownership, but student_name was plain client-supplied text with
-- nothing tying it to the reviewer's real identity - a student could
-- submit a review under any name at all, including a real other
-- person's name. masked_reviews (migration_67.sql) shows that name
-- unmasked to the reviewed teacher, and short_display_name(student_name)
-- derives the public name everyone else sees - so a spoofed name let a
-- student impersonate someone else in a review a teacher (and everyone
-- browsing teachers.html) would see as genuine.
--
-- Same integrity pattern as disputes_insert_own /
-- attendance_reports_insert_own_student, which already cross-check
-- their own client-supplied identity fields against the real booking.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

drop policy if exists "reviews_insert_own_student" on reviews;

create policy "reviews_insert_own_student"
  on reviews for insert
  with check (
    auth.uid() = student_id
    and student_name = (select p.name from profiles p where p.id = auth.uid())
    and exists (
      select 1 from bookings b
      where b.id = booking_id
        and b.student_id = auth.uid()
        and b.teacher_id = reviews.teacher_id
        and b.status <> 'cancelled'
        and b.lesson_date <= (now() at time zone b.teacher_timezone)::date
    )
  );
