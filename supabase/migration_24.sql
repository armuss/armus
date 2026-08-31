-- Migration 24: booking cancellation with iyzico refunds.
--
-- Cancelling used to mean a hard delete (admin panel only, from before
-- real payments existed - see armusAdminCancelBooking in admin.html).
-- Now that a cancellation can mean real money needs to go back to the
-- student, bookings are soft-cancelled (status flips instead of the row
-- disappearing) and the cancel-booking Edge Function does the actual
-- iyzico refund before flipping it - the direct client-side delete is no
-- longer used anywhere, so its RLS policy is dropped too.
--
-- Policy: a student cancelling >= 4 hours before the lesson gets a full
-- refund; less than 4 hours (or a teacher/admin cancelling any time
-- before the lesson) - teacher/admin cancellations always refund in
-- full since it's not the student's doing, a late student cancellation
-- does not. See cancel-booking/index.ts for the actual logic.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run,
-- then deploy the cancel-booking Edge Function and redeploy
-- payment-callback with its updated code (see their file headers).

alter table bookings add column if not exists status text not null default 'confirmed' check (status in ('confirmed', 'cancelled'));
alter table bookings add column if not exists cancelled_at timestamptz;
alter table bookings add column if not exists cancelled_by text check (cancelled_by in ('student', 'teacher', 'admin'));
alter table bookings add column if not exists refunded boolean not null default false;

-- needed so a later cancellation can refund the original charge
alter table pending_payments add column if not exists iyzico_payment_id text;
alter table pending_payments add column if not exists iyzico_payment_transaction_id text;

drop policy if exists "bookings_delete_admin" on bookings;

-- re-schedule armus-lesson-reminders (this updates the existing job,
-- same name) so a cancelled booking never gets a reminder email
select cron.schedule(
  'armus-lesson-reminders',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-lesson-reminder',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('booking_id', b.id)
  )
  from bookings b
  where b.reminder_sent = false
    and b.status = 'confirmed'
    and (b.lesson_date + b.lesson_time::time) between now() + interval '50 minutes' and now() + interval '70 minutes'
  $$
);
