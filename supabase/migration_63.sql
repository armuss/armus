-- ARMUS migration 63: email a teacher applicant when admin.html approves
-- or rejects their application.
--
-- Fires on any profiles UPDATE whose status actually changes (covers
-- both the single approve/reject buttons AND the bulk action in
-- admin.html - both just do a plain profiles.update, so a DB-level
-- trigger is the one place that catches both without duplicating logic
-- in two client code paths) - calls send-teacher-status-email (a new
-- Edge Function - deploy it too, see its own file).
--
-- IMPORTANT: after deploying send-teacher-status-email, go to its
-- Settings and turn OFF "Verify JWT" - this trigger's HTTP call carries
-- no Supabase auth token, same as payment-callback / send-lesson-reminder.
--
-- Run this once in the Supabase SQL Editor, after send-teacher-status-email
-- is deployed (deploy the function first, or the next approve/reject
-- will hit a 404 - harmless, just a missed email, but avoidable).

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
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object('profile_id', new.id, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_notify_teacher_status_change on profiles;

create trigger profiles_notify_teacher_status_change
  after update on profiles
  for each row
  when (old.status is distinct from new.status)
  execute procedure public.notify_teacher_status_change();
