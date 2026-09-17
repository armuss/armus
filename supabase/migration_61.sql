-- ARMUS migration 61: reviews_insert_own_student must also require the
-- booking wasn't cancelled.
--
-- Without this, a student could book a lesson, cancel it (even with a
-- full credit refund via cancel-booking, so at no real cost), wait for
-- that lesson's date to pass, and still post a review for a lesson that
-- never happened - reachable straight from my-lessons.html's normal
-- "rate this lesson" prompt (it shows for any past booking regardless of
-- cancellation). A free way to fake-boost a friend's rating, or leave a
-- baseless bad review on a competitor's profile.
--
-- Run this once in the Supabase SQL Editor.

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
        and b.status <> 'cancelled'
        and b.lesson_date <= (now() at time zone b.teacher_timezone)::date
    )
  );
