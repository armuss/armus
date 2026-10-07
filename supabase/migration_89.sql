-- ARMUS migration 89: armusGetConversations (messages.js) used to fetch
-- EVERY message in EVERY conversation a user has ever had - no filter,
-- no limit - just to compute each conversation's preview (last message)
-- and unread count for the nav bell/conversation list. That ran on
-- essentially every page load (armusRenderGnavBell, auth.js), so a
-- student with months of chat history downloaded their entire message
-- archive, in full, just to render an unread badge.
--
-- conversation_previews() computes the same two things (last message,
-- unread count) per conversation directly in the database via a lateral
-- join, instead of pulling every row to the client to compute them
-- there. security invoker (the default) - it relies on the normal
-- conversations_select_participant/messages_select_participant RLS
-- policies plus its own explicit WHERE, so a caller only ever sees their
-- own conversations, same as before.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create index if not exists messages_conversation_id_created_at_idx
  on messages (conversation_id, created_at desc);

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
  ) uc on true
  where c.student_id = auth.uid() or c.teacher_id = auth.uid();
$$;

grant execute on function public.conversation_previews() to anon, authenticated;
