-- Fixes a message-forgery hole in the chat system. messages_update_participant
-- is deliberately broad (both sides of a conversation need to update
-- read_at), but nothing narrowed WHICH columns each side could actually
-- change beyond that - enforce_message_edit_rules only ever guarded body
-- edits (sender-only, within 2 minutes). Via a direct API call (bypassing
-- messages.js, which only ever sends body or read_at), either participant
-- could rewrite sender_id, attachment_url, attachment_type, created_at, or
-- corrected_of_id on ANY message in the conversation with no restriction
-- at all - most seriously, spoofing sender_id to make a message look like
-- the OTHER person wrote it.
--
-- Verified against a local Postgres instance: a conversation participant
-- who was never the sender of a message could reassign its sender_id to
-- themselves (or the other party); after this fix the same update is
-- rejected while marking a message read still works normally.

create or replace function public.enforce_message_edit_rules()
returns trigger
language plpgsql
as $$
begin

  if new.sender_id is distinct from old.sender_id
    or new.conversation_id is distinct from old.conversation_id
    or new.created_at is distinct from old.created_at
    or new.corrected_of_id is distinct from old.corrected_of_id
  then
    raise exception 'message_locked: sender_id, conversation_id, created_at, and corrected_of_id cannot be changed after sending';
  end if;

  if new.body is distinct from old.body
    or new.attachment_url is distinct from old.attachment_url
    or new.attachment_type is distinct from old.attachment_type
  then

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
