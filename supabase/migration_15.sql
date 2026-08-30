-- Migration 15: let conversation partners see each other's name/photo.
--
-- profiles_select_public_or_own only lets someone read a profile row if
-- it's their own, or an approved teacher's (for the public marketplace).
-- A student's own profile row has no "approved" status at all, so when
-- a teacher's message inbox tries to look up the name/photo of a
-- student they're chatting with, RLS silently returns nothing for that
-- row and the UI falls back to a generic "Kullanıcı" label. This adds a
-- policy letting each side of a conversation read the other's profile.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

drop policy if exists "profiles_select_conversation_partner" on profiles;

create policy "profiles_select_conversation_partner"
  on profiles for select
  using (
    exists (
      select 1 from conversations c
      where (c.student_id = auth.uid() and c.teacher_id = profiles.id)
         or (c.teacher_id = auth.uid() and c.student_id = profiles.id)
    )
  );
