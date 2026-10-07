-- ARMUS migration 88: lets an admin read conversations/messages (for
-- dispute investigation - admin.html had no way to see either before
-- this, only the two participants could, via conversations_select_
-- participant/messages_select_participant), and keeps every earlier
-- version of an edited message instead of silently discarding it on
-- each edit (messages_enforce_edit_rules, migration_20.sql, only ever
-- overwrote body in place and stamped edited_at - the text it replaced
-- was gone for good, even to an admin, even though editing itself stays
-- limited to the sender within 2 minutes of sending, same as before).
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create policy "conversations_select_admin_all"
  on conversations for select
  using (public.is_admin());

create policy "messages_select_admin_all"
  on messages for select
  using (public.is_admin());

-- one row per edit, holding what the message looked like right before
-- that edit overwrote it - never the current text (that's still just
-- messages.body). Admin-only: a participant doesn't need their own
-- edit trail surfaced back at them, only an admin investigating a
-- complaint does.
create table message_edit_history (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  body text not null default '',
  attachment_url text,
  attachment_type text,
  edited_at timestamptz not null default now()
);

alter table message_edit_history enable row level security;

create policy "message_edit_history_select_admin"
  on message_edit_history for select
  using (public.is_admin());

-- same function as migration_20.sql, now also archiving the pre-edit
-- row into message_edit_history above, and marked security definer so
-- that insert runs with this function's own privileges rather than
-- needing a client-facing insert policy on message_edit_history for
-- every participant (nobody but an admin should ever write into or
-- read it directly - this trigger is the only path in).
create or replace function public.enforce_message_edit_rules()
returns trigger
language plpgsql
security definer
set search_path = public
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

    insert into message_edit_history (message_id, body, attachment_url, attachment_type, edited_at)
    values (old.id, old.body, old.attachment_url, old.attachment_type, now());

    new.edited_at := now();
  end if;

  return new;
end;
$$;
