-- Migration 20: message editing - own messages only, within 2 minutes.
--
-- The existing messages_update_participant policy (used so a recipient
-- can mark a message read) technically allowed EITHER participant to
-- update ANY field on ANY message in the conversation, including body -
-- meaning a teacher could in practice edit a student's message text
-- (surfaced in the UI as the "Düzelt Beni" correction feature, since
-- removed). This locks body edits down properly: only the original
-- sender, only within 2 minutes of sending, enforced with a trigger
-- (RLS alone can't express "this column only, this condition only, one
-- role" cleanly) - read_at updates by the other participant are
-- untouched and keep working exactly as before.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

alter table messages add column if not exists edited_at timestamptz;

create or replace function public.enforce_message_edit_rules()
returns trigger
language plpgsql
as $$
begin

  if new.body is distinct from old.body then

    if auth.uid() <> old.sender_id then
      raise exception 'message_edit_denied: only the sender can edit a message';
    end if;

    if old.created_at < now() - interval '2 minutes' then
      raise exception 'message_edit_expired: messages can only be edited within 2 minutes of sending';
    end if;

    new.edited_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists messages_enforce_edit_rules on messages;

create trigger messages_enforce_edit_rules
  before update on messages
  for each row execute procedure public.enforce_message_edit_rules();
