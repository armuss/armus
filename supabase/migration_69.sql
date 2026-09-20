-- ARMUS migration 69: rate-limits sending a chat message to 120/hour per
-- sender.
--
-- Every messages insert fires a real Resend email via the
-- messages_notify_new_message trigger (migration_62.sql) with no
-- debounce of its own - unlike every other email-triggering action in
-- this schema (create-payment: 30/hr, send-verification-email: 8/day +
-- a 45s cooldown), sending a message had no cap at all. A scripted
-- account could loop this insert to flood a specific person's inbox
-- (targeted harassment) or burn through ARMUS's shared Resend send
-- quota. 120/hour is far above any real conversation's pace.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

drop policy if exists "messages_insert_own" on messages;

create policy "messages_insert_own"
  on messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
    )
    and (
      select count(*) from messages m2
      where m2.sender_id = auth.uid()
        and m2.created_at > now() - interval '1 hour'
    ) < 120
  );
