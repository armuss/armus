-- ARMUS migration 66: adds the same shared-secret header from migration 65
-- to the armus-lesson-reminders cron job, which was missed there.
--
-- send-lesson-reminder has "Verify JWT" turned off (required - the cron
-- call carries no Supabase auth token), which means, without this,
-- anyone who guessed a real booking_id (embedded in class.html?booking=<id>
-- links and in confirmation emails, so not exactly secret) could call it
-- directly - claiming reminder_sent early (permanently suppressing the
-- real reminder) or forcing a "starts soon" email for a lesson that's
-- actually days away. This closes that the same way migration 65 did for
-- send-message-notification/send-teacher-status-email/send-review-reminder:
-- the function now rejects any request whose x-armus-trigger-secret
-- header doesn't match the TRIGGER_SECRET secret (Edge Functions ->
-- Manage secrets) - same secret value already used for those three.
--
-- Run this AFTER:
--   1. Setting the TRIGGER_SECRET secret (same value used below, and
--      already set on the other three functions since migration 65) on
--      send-lesson-reminder too.
--   2. Redeploying send-lesson-reminder with its updated code (the
--      header check).
-- Running this migration before the function is redeployed just means
-- its next real trigger gets a harmless 401 until the redeploy catches up.

-- cron.schedule with an existing job name replaces that job's command in
-- place - this isn't a duplicate schedule, it's the same
-- armus-lesson-reminders job (migration_37.sql) updated to send the new
-- header, unchanged otherwise.
select cron.schedule(
  'armus-lesson-reminders',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-lesson-reminder',
    headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
    body := jsonb_build_object('booking_id', b.id)
  )
  from bookings b
  where b.reminder_sent = false
    and b.status = 'confirmed'
    and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone)
        between now() + interval '50 minutes' and now() + interval '70 minutes'
  $$
);
