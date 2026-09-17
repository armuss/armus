-- Fixes conversations_insert_participant, which never actually checked
-- that a conversation is "a student and a real teacher" (this table's
-- own header comment) - only that the caller is one of the two named
-- parties. Any authenticated user could set teacher_id (or student_id)
-- to ANY other profile's id, real teacher or not, and the fabricated
-- conversation would show up as an unsolicited thread in that other
-- person's inbox (mesajlar.html) - including student-to-student, which
-- messages.js's own armusGetOrCreateConversation (mesajlar.html?teacher=<id>)
-- never guarded against either.
--
-- Verified against a local Postgres instance: a student naming another
-- student as teacher_id is now rejected, a real student-to-teacher
-- conversation still succeeds.

drop policy if exists "conversations_insert_participant" on conversations;

create policy "conversations_insert_participant"
  on conversations for insert
  with check (
    (auth.uid() = student_id or auth.uid() = teacher_id)
    and exists (select 1 from profiles p where p.id = student_id and p.role = 'student')
    and exists (select 1 from profiles p where p.id = teacher_id and p.role = 'teacher')
  );
