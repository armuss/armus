-- migration_105.sql: Preply-style "Cancelled and Paid".
--
-- The free-cancellation window moves from 4 to 12 hours (cancel-booking's
-- FREE_CANCEL_HOURS). A student who cancels inside it gets nothing back,
-- and - new - the teacher is paid for that reserved time exactly as if
-- the lesson had happened, instead of the money just staying with ARMUS.
-- This column is what marks such a booking, so dashboard.html/admin.html
-- can count it toward the teacher's earnings (a regular lesson only - a
-- late-cancelled trial follows the existing trial rule, its fee stays with
-- ARMUS). Only cancel-booking (service role) ever writes it; bookings has
-- no client-facing update policy at all.
--
-- Not backfilled on purpose: late cancellations from before this change
-- happened under the old policy, where the teacher wasn't paid, and
-- retroactively adding them to teachers' balances would change payouts
-- that may already have been withdrawn.

alter table bookings add column if not exists late_cancel boolean not null default false;
