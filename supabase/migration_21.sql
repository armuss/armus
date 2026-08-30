-- Migration 21: in-class extras (class.html) - lesson progress timer,
-- post-lesson quick review/note popup, and mid-class vocab pinning.
--
-- Two RLS changes are needed to support these:
--
-- 1. reviews_insert_own_student previously required lesson_date <
--    current_date, i.e. "some day before today" - written back when a
--    booking's "completion" was just its date passing (see
--    armusIsBookingPast in reviews.js). Now that a live classroom exists
--    (class.html), a student leaving today's lesson should be able to
--    rate it immediately rather than waiting until tomorrow. Loosened to
--    lesson_date <= current_date (same day allowed) rather than adding a
--    precise end-of-lesson timestamp check, so a student who leaves a
--    few minutes early isn't blocked from rating just because the
--    scheduled 50 minutes hasn't fully elapsed yet.
--
-- 2. vocab_entries only allowed a student to manage their own words
--    (auth.uid() = student_id). The in-class "pin this word" widget
--    lets either side add a word to the *student's* vault mid-lesson,
--    so a teacher needs insert access too - scoped to students they
--    actually share a booking with, same trust boundary already used
--    for lifting the contact-sharing restriction in messages.js
--    (armusHasBookingWithOtherParty).
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

drop policy if exists "reviews_insert_own_student" on reviews;

create policy "reviews_insert_own_student"
  on reviews for insert
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from bookings b
      where b.id = booking_id
        and b.student_id = auth.uid()
        and b.lesson_date <= current_date
    )
  );

create policy "vocab_entries_insert_teacher"
  on vocab_entries for insert
  with check (
    exists (
      select 1 from bookings b
      where b.teacher_id = auth.uid()::text
        and b.student_id = vocab_entries.student_id
    )
  );
