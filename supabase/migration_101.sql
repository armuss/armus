-- migration_101.sql: Preply-style "Block" button enhancements.
--
-- blocked_students (migration_96.sql) only ever did one thing: refuse a
-- brand NEW booking between the pair (enforce_teacher_block trigger on
-- bookings). Three gaps vs. Preply's own block feature, closed here:
--
--   1. No reason was ever collected - just a bare teacher_id/student_id
--      row. Preply's own "Block" button requires picking one (Harassment,
--      bypassing payments, spam/scam, not a good fit, other).
--   2. Lessons the pair already had booked before the block were left
--      completely untouched - a blocked student could still show up to
--      (or the teacher still had to run) an already-confirmed lesson.
--   3. Messaging was never checked anywhere - conversations_insert_participant
--      and messages_insert_own (schema.sql) have no idea blocked_students
--      exists. A blocked student could still open a new conversation or
--      keep messaging in an old one, and had no way to even find out they
--      were blocked (blocked_students_select_own, migration_96.sql, only
--      ever let the TEACHER read their own block list).
--
-- The auto-cancel of the pair's existing FUTURE lessons (gap 2) is
-- intentionally NOT done here as a trigger - it's handled client-side by
-- teacher-blocks.js's armusBlockStudent, which calls the existing
-- cancel-booking Edge Function once per future booking so it goes
-- through that function's own tested claim/credit/email logic instead of
-- a second copy of it in SQL.

alter table blocked_students add column if not exists reason text
  check (reason in ('harassment', 'payment_bypass', 'scam', 'dont_want_to_teach', 'other'));
alter table blocked_students add column if not exists reason_note text;

-- Internal helper (used by the two RLS policies below, and by
-- am_i_blocked_by right after it) - never exposed as its own RPC, since
-- it would let anyone probe whether some OTHER student is blocked by a
-- given teacher.
create or replace function public.is_pair_blocked(p_teacher_id uuid, p_student_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from blocked_students bs
    where bs.teacher_id = p_teacher_id and bs.student_id = p_student_id
  );
$$;

-- The student-facing half of gap 3 - mesajlar.html calls this so a
-- blocked student can be shown a clear notice instead of their message
-- just silently failing against messages_insert_own below. Deliberately
-- takes no student_id argument - always checks the CALLER (auth.uid()),
-- so one student can never use this to learn whether some OTHER student
-- is blocked.
create or replace function public.am_i_blocked_by(p_teacher_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_pair_blocked(p_teacher_id, auth.uid());
$$;

drop policy if exists "conversations_insert_participant" on conversations;
create policy "conversations_insert_participant"
  on conversations for insert
  with check (
    (auth.uid() = student_id or auth.uid() = teacher_id)
    and public.is_messageable_teacher(teacher_id)
    and not public.is_pair_blocked(teacher_id, student_id)
    and (
      (auth.uid() = student_id and exists (select 1 from profiles p where p.id = student_id and p.role = 'student'))
      or (auth.uid() = teacher_id and public.teacher_may_contact_student(student_id, teacher_id))
    )
  );

drop policy if exists "messages_insert_own" on messages;
create policy "messages_insert_own"
  on messages for insert
  with check (
    sender_id = auth.uid()
    and coalesce((select is_banned from profiles where id = auth.uid()), false) = false
    and exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
        and not public.is_pair_blocked(c.teacher_id, c.student_id)
    )
    and public.messages_under_rate_limit()
  );
