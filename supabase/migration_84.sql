-- ARMUS migration 84: adds two pending_payments statuses so
-- payment-callback can tell apart its different "payment succeeded but
-- no real booking was created" outcomes, instead of flattening them all
-- into the same ambiguous 'paid_no_booking'.
--
-- 'slot_taken'   - another student booked the exact same slot first
--                  (bookings_teacher_slot_unique); this buyer's charge
--                  was converted into a lesson credit automatically.
-- 'time_passed'  - the charge succeeded but by the time it was confirmed
--                  (payment delays, 3D-Secure) the lesson's own start
--                  time had already passed; same credit-conversion.
--
-- Both are fully resolved, self-service outcomes (nothing for support to
-- fix) - unlike 'paid_no_booking', which still means a genuine write
-- failure that needs manual follow-up. Splitting them out lets
-- payment-callback's duplicate-callback handling (iyzico retries, two
-- tabs landing on the same redirect) route a repeat request to the
-- right page instead of defaulting to "payment failed" for a payment
-- that actually succeeded.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

alter table pending_payments drop constraint if exists pending_payments_status_check;

alter table pending_payments add constraint pending_payments_status_check
  check (status in ('pending', 'processing', 'succeeded', 'failed', 'paid_no_booking', 'slot_taken', 'time_passed'));
