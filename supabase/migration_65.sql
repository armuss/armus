-- ARMUS migration 65: adds a shared-secret header to the three trigger/cron
-- calls added in migrations 62-64 (messages_notify_new_message,
-- profiles_notify_teacher_status_change, armus-review-reminders).
--
-- Those three target Edge Functions all have "Verify JWT" turned off
-- (required - the trigger/cron call carries no Supabase auth token), which
-- means, without this, anyone who guessed a real message_id/profile_id/
-- booking_id could call them directly and force a spoofed or duplicate
-- email. This header closes that: each function now rejects any request
-- whose x-armus-trigger-secret header doesn't match the TRIGGER_SECRET
-- secret (Edge Functions -> Manage secrets).
--
-- Run this AFTER:
--   1. Setting the TRIGGER_SECRET secret (same value used below) on
--      send-message-notification, send-teacher-status-email and
--      send-review-reminder.
--   2. Redeploying those three functions with their updated code (the
--      header check).
-- Running this migration before the functions are redeployed just means
-- their next real trigger gets a harmless 401 until the redeploy catches up.

create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-message-notification',
    headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
    body := jsonb_build_object('message_id', new.id)
  );
  return new;
end;
$$;

create or replace function public.notify_teacher_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('approved', 'rejected') then
    perform net.http_post(
      url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-teacher-status-email',
      headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
      body := jsonb_build_object('profile_id', new.id, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

-- cron.schedule with an existing job name replaces that job's command in
-- place - this isn't a duplicate schedule, it's the same
-- armus-review-reminders job updated to send the new header.
select cron.schedule(
  'armus-review-reminders',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-review-reminder',
    headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
    body := jsonb_build_object('booking_id', b.id)
  )
  from bookings b
  where b.review_email_sent = false
    and b.status = 'confirmed'
    and ((b.lesson_date + b.lesson_time::time + interval '50 minutes') at time zone b.teacher_timezone)
        between now() - interval '40 minutes' and now() - interval '10 minutes'
  $$
);
