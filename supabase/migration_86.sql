-- ARMUS migration 86: fixes conversations_insert_participant
-- (migration_82.sql), which checks the teacher's own profiles row from
-- inside a WITH CHECK clause - a check that runs under the INSERTing
-- user's own row-level security, not an elevated one.
--
-- profiles_select_own only ever lets someone SELECT their *own* profiles
-- row (migration_70.sql closed off reading anyone else's raw row). It was
-- never relaxed back for an arbitrary teacher_id, so for every ordinary
-- student - the only caller this policy is actually meant to let through -
-- that "exists (select 1 from profiles p where p.id = teacher_id ...)"
-- subquery could never see the teacher's row at all: RLS filters it out
-- before role/status/is_banned are even checked, so the whole policy
-- evaluated to false unconditionally. No student could ever start a new
-- conversation with any teacher - only reopening an existing thread
-- (conversations_select_participant, unaffected) still worked, which is
-- why a first "Mesaj Gönder" silently did nothing (mesajlar.html just
-- showed the regular empty inbox, no error).
--
-- Fixed the same way public.is_admin() already sidesteps this for its own
-- profiles lookup: a SECURITY DEFINER function, so the eligibility check
-- runs with the function owner's full visibility instead of the calling
-- student's.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create or replace function public.is_messageable_teacher(target_teacher_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = target_teacher_id
      and p.role = 'teacher'
      and (public.is_admin() or (p.status = 'approved' and coalesce(p.is_banned, false) = false))
  );
$$;

drop policy if exists "conversations_insert_participant" on conversations;

create policy "conversations_insert_participant"
  on conversations for insert
  with check (
    (auth.uid() = student_id or auth.uid() = teacher_id)
    and exists (select 1 from profiles p where p.id = student_id and p.role = 'student')
    and public.is_messageable_teacher(teacher_id)
  );
