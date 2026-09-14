-- ARMUS migration 35: make it impossible for two different bookings to
-- exist for the same teacher at the same date+time.
--
-- Nothing enforced this before - armusGetTeacherBusyTimes (booking.html)
-- only checks busy slots once, when the page loads, purely to grey out
-- taken slots in the picker. If two students load the page around the
-- same time and pick the same slot, or one student re-tries a booking
-- after the picker went stale, both create-payment (the credit-covered
-- direct-booking path) and payment-callback (the paid-by-card path)
-- would happily insert a second "confirmed" booking for the exact same
-- teacher/date/time - a real double-booking, with nothing in the
-- database or either Edge Function to stop it.
--
-- A plain UNIQUE constraint can't work here since a teacher legitimately
-- ends up with a cancelled booking and a later confirmed one at the same
-- old slot (reschedule, or someone else re-booking a freed-up slot) - so
-- this is a partial unique index that only applies to non-cancelled rows.
--
-- Tested against a real Postgres instance: a second insert for an
-- already-booked, non-cancelled slot is rejected; different time, a
-- different teacher at the same time, and re-booking a slot that was
-- cancelled all still work correctly.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

create unique index if not exists bookings_teacher_slot_unique
  on bookings (teacher_id, lesson_date, lesson_time)
  where status <> 'cancelled';
