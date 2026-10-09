-- ARMUS migration 94: emails a teacher when a student leaves them a
-- review - previously nothing notified the teacher at all (only
-- send-review-reminder.ts existed, which emails the STUDENT asking them
-- to leave a review; nothing on the other end told the teacher one had
-- actually arrived). Same shape as messages_notify_new_message
-- (migration_62.sql): a trigger posts to a new Edge Function,
-- send-review-notification, right after the insert.
--
-- Deploy supabase/functions/send-review-notification alongside this (same
-- RESEND_API_KEY/TRIGGER_SECRET secrets the other email functions already
-- use), and turn its "Verify JWT" off, same as the other trigger-fired
-- functions.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create or replace function public.notify_teacher_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-review-notification',
    headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
    body := jsonb_build_object('review_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists reviews_notify_teacher on reviews;
create trigger reviews_notify_teacher
  after insert on reviews
  for each row execute procedure public.notify_teacher_review();
