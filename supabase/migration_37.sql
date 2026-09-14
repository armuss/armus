-- ARMUS migration 37: real per-person timezones, replacing the "every
-- lesson_date/lesson_time string is UTC" bug that migration 34-36's
-- security audit turned up (cron reminders firing ~2 hours after the
-- lesson had already started, and cancel-booking's 4-hour free-cancel
-- window being skewed by 3 hours).
--
-- lesson_date/lesson_time are, and stay, plain wall-clock strings with
-- no zone of their own - they mean whatever the TEACHER's calendar grid
-- meant when they set their availability, in the teacher's own local
-- time. What was missing was ever recording which zone that was.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

-- Which IANA zone this person is currently in - auto-detected
-- client-side (Intl.DateTimeFormat().resolvedOptions().timeZone, see
-- auth.js armusGetSession) and kept fresh on every login/session check.
-- Used to format lesson-time notifications (send-lesson-reminder) in
-- each recipient's own current time.
alter table profiles add column if not exists timezone text not null default 'Europe/Istanbul';

-- A snapshot of the teacher's profiles.timezone at the moment this
-- booking was created (see create-payment/payment-callback) - demo
-- teachers (teachers-data.js, no profile row) always get the default.
-- Snapshotted rather than looked up live so a teacher changing their
-- timezone later never reinterprets a past booking's already-fixed
-- wall-clock time. This is what lets cancel-booking and the reminder
-- cron below compute the real UTC instant of a lesson correctly.
alter table bookings add column if not exists teacher_timezone text not null default 'Europe/Istanbul';

-- Re-declares the armus-lesson-reminders cron job (cron.schedule updates
-- an existing job in place when called again with the same name) - the
-- only change is treating (lesson_date + lesson_time) as wall-clock time
-- IN THE TEACHER'S OWN ZONE via "at time zone", instead of implicitly
-- UTC, which is what made reminders go out ~2 hours after the lesson for
-- every Europe/Istanbul (UTC+3) teacher.
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
    and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone)
        between now() + interval '50 minutes' and now() + interval '70 minutes'
  $$
);
