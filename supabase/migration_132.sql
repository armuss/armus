-- migration_132.sql: deleting a message, and a longer edit window.
--
-- Deleting your own message (mesajlar.html and the app, via
-- delete_message below):
--   - a student or teacher: the message stays in the thread as
--     "Bu mesaj silindi"; its text and attachment are cleared, and a
--     copy of what it said goes to message_edit_history (kind 'delete'),
--     which only admins can read - so a complaint can still be looked
--     into, and a report on that message (message_reports) keeps its row.
--   - an admin: the message is removed for good, like it was never sent;
--     if it was the only message in that conversation, the conversation
--     goes too, so it leaves the other person's list.
--
-- Editing: the sender only, as before; now within 15 minutes of sending
-- (was 2), and an admin's own messages at any time. Every earlier
-- version still goes to message_edit_history (kind 'edit').
--
-- Run once in the Supabase SQL Editor; safe to run again.

-- === COLUMNS ============================================================

alter table public.messages add column if not exists deleted_at timestamptz;

alter table public.message_edit_history add column if not exists kind text not null default 'edit';
alter table public.message_edit_history drop constraint if exists message_edit_history_kind_check;
alter table public.message_edit_history add constraint message_edit_history_kind_check
  check (kind in ('edit', 'delete'));

-- a deleted message has neither text nor attachment left
alter table public.messages drop constraint if exists messages_body_or_attachment;
alter table public.messages add constraint messages_body_or_attachment
  check (body <> '' or attachment_url is not null or deleted_at is not null);

-- ...but a new message is never born deleted (that would let an empty
-- message through the check above)
create or replace function public.messages_not_deleted_on_insert()
returns trigger
language plpgsql
as $$
begin
  new.deleted_at := null;
  return new;
end;
$$;

drop trigger if exists messages_not_deleted_on_insert on public.messages;
create trigger messages_not_deleted_on_insert
  before insert on public.messages
  for each row execute procedure public.messages_not_deleted_on_insert();

-- === EDIT AND DELETE RULES ==============================================
-- migration_88.sql's trigger, plus: a deleted message can never change
-- again (or be "undeleted"), deleting is the sender's alone and keeps a
-- copy, and the edit window is 15 minutes (any time for an admin).

create or replace function public.enforce_message_edit_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_admin boolean := coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false);
begin

  if new.sender_id is distinct from old.sender_id
    or new.conversation_id is distinct from old.conversation_id
    or new.created_at is distinct from old.created_at
    or new.corrected_of_id is distinct from old.corrected_of_id
  then
    raise exception 'message_locked: sender_id, conversation_id, created_at, and corrected_of_id cannot be changed after sending';
  end if;

  -- already deleted: only read_at may still change
  if old.deleted_at is not null then
    if new.deleted_at is distinct from old.deleted_at
      or new.body is distinct from old.body
      or new.attachment_url is distinct from old.attachment_url
      or new.attachment_type is distinct from old.attachment_type
      or new.edited_at is distinct from old.edited_at
    then
      raise exception 'message_deleted: a deleted message cannot be changed';
    end if;
    return new;
  end if;

  -- deleting
  if new.deleted_at is not null then
    if auth.uid() <> old.sender_id then
      raise exception 'message_delete_denied: only the sender can delete a message';
    end if;

    insert into message_edit_history (message_id, body, attachment_url, attachment_type, edited_at, kind)
    values (old.id, old.body, old.attachment_url, old.attachment_type, now(), 'delete');

    new.deleted_at := now();
    new.body := '';
    new.attachment_url := null;
    new.attachment_type := null;
    new.edited_at := old.edited_at;
    return new;
  end if;

  -- editing
  if new.body is distinct from old.body
    or new.attachment_url is distinct from old.attachment_url
    or new.attachment_type is distinct from old.attachment_type
  then

    if auth.uid() <> old.sender_id then
      raise exception 'message_edit_denied: only the sender can edit a message';
    end if;

    if not caller_is_admin and old.created_at < now() - interval '15 minutes' then
      raise exception 'message_edit_expired: messages can only be edited within 15 minutes of sending';
    end if;

    insert into message_edit_history (message_id, body, attachment_url, attachment_type, edited_at, kind)
    values (old.id, old.body, old.attachment_url, old.attachment_type, now(), 'edit');

    new.edited_at := now();
  end if;

  return new;
end;
$$;

-- (the trigger itself - messages_enforce_edit_rules - already points at
-- this function by name)

-- === DELETE =============================================================
-- Returns 'deleted' (the "Bu mesaj silindi" placeholder stays),
-- 'removed' (an admin's message, gone for good) or 'not_found'.

create or replace function public.delete_message(p_message_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.messages%rowtype;
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  select * into m from public.messages where id = p_message_id;
  if not found then
    return 'not_found';
  end if;

  if m.sender_id <> me then
    raise exception 'message_delete_denied: only the sender can delete a message';
  end if;

  if coalesce((select p.is_admin from public.profiles p where p.id = me), false) then
    delete from public.messages where id = m.id;
    delete from public.conversations c
    where c.id = m.conversation_id
      and not exists (select 1 from public.messages x where x.conversation_id = c.id);
    return 'removed';
  end if;

  if m.deleted_at is null then
    update public.messages set deleted_at = now() where id = m.id;
  end if;
  return 'deleted';
end;
$$;

revoke all on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;

-- === UNREAD COUNTS ======================================================
-- a message deleted before it was read no longer counts as unread
-- (migration_89.sql's function, otherwise unchanged)

create or replace function public.conversation_previews()
returns table (
  conversation_id uuid,
  last_message_id uuid,
  last_message_body text,
  last_message_attachment_type text,
  last_message_sender_id uuid,
  last_message_created_at timestamptz,
  unread_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id as conversation_id,
    lm.id, lm.body, lm.attachment_type, lm.sender_id, lm.created_at,
    coalesce(uc.unread_count, 0)
  from conversations c
  left join lateral (
    select m.id, m.body, m.attachment_type, m.sender_id, m.created_at
    from messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  left join lateral (
    select count(*) as unread_count
    from messages m2
    where m2.conversation_id = c.id
      and m2.sender_id <> auth.uid()
      and m2.read_at is null
      and m2.deleted_at is null
  ) uc on true
  where c.student_id = auth.uid() or c.teacher_id = auth.uid();
$$;

grant execute on function public.conversation_previews() to anon, authenticated;
