-- ARMUS migration 62: email notification when a new chat message arrives.
--
-- A trigger on messages fires send-message-notification (a new Edge
-- Function - deploy it too, see its own file) for whichever participant
-- did NOT send the message. Demo teachers are never a real participant
-- in conversations (messages.js/schema.sql comment), so both
-- conversations.student_id/teacher_id always reference a real profile
-- with a real email - no isUuid-style guard needed here.
--
-- IMPORTANT: after deploying send-message-notification, go to its
-- Settings and turn OFF "Verify JWT" - this trigger's HTTP call carries
-- no Supabase auth token, same as payment-callback / send-lesson-reminder.
--
-- Run this once in the Supabase SQL Editor, after send-message-notification
-- is deployed (the trigger starts firing immediately once created, so
-- deploy the function first or the very first message after running this
-- will hit a 404).

create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-message-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('message_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists messages_notify_new_message on messages;

create trigger messages_notify_new_message
  after insert on messages
  for each row execute procedure public.notify_new_message();
