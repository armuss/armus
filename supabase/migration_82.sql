-- ARMUS migration 82: conversations_insert_participant only ever checked
-- p.role = 'teacher' on the teacher_id side - not p.status = 'approved',
-- not is_banned. A brand-new self-registered account
-- (register.html?role=teacher, status starts null, no application/admin
-- review yet), an admin-rejected one (status = 'rejected'), or a banned
-- one could all still open an unsolicited conversation with any real
-- student by id and message them - completely bypassing marketplace
-- visibility and admin review/the ban system.
--
-- An admin is exempted from the new check: admin.html legitimately
-- messages a still-pending applicant straight from the review screen
-- ("Öğretmene Mesaj" buttons across the applications/disputes panels),
-- so that path has to stay open.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

drop policy if exists "conversations_insert_participant" on conversations;

create policy "conversations_insert_participant"
  on conversations for insert
  with check (
    (auth.uid() = student_id or auth.uid() = teacher_id)
    and exists (select 1 from profiles p where p.id = student_id and p.role = 'student')
    and exists (
      select 1 from profiles p
      where p.id = teacher_id
        and p.role = 'teacher'
        and (public.is_admin() or (p.status = 'approved' and coalesce(p.is_banned, false) = false))
    )
  );
