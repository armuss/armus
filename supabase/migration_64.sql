-- ARMUS migration 64: "leave a review" email, sent to the student a bit
-- after their lesson ends.
--
-- Same shape as the existing armus-lesson-reminders cron (schema.sql) -
-- runs every 10 minutes, matches any lesson that ended 10-40 minutes ago
-- (ARMUS_LESSON_MINUTES = 50, bookings.js) and hasn't had this email sent
-- yet, calls send-review-reminder (a new Edge Function - deploy it too,
-- see its own file, and turn its "Verify JWT" off).
--
-- Run this once in the Supabase SQL Editor, after send-review-reminder
-- is deployed.

alter table bookings add column if not exists review_email_sent boolean not null default false;

select cron.schedule(
  'armus-review-reminders',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-review-reminder',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('booking_id', b.id)
  )
  from bookings b
  where b.review_email_sent = false
    and b.status = 'confirmed'
    and ((b.lesson_date + b.lesson_time::time + interval '50 minutes') at time zone b.teacher_timezone)
        between now() - interval '40 minutes' and now() - interval '10 minutes'
  $$
);
