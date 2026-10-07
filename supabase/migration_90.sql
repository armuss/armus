-- ARMUS migration 90: two security fixes.
--
-- 1) Changing your email in Settings only ever updated auth.users.email
-- (via Supabase Auth's own updateUser({email}) flow, after the user
-- confirms it). profiles.email - the column every email-sending code
-- path in this app actually reads (create-payment, payment-callback,
-- cancel-booking, send-lesson-reminder, send-review-reminder,
-- send-message-notification, send-teacher-status-email) - never
-- followed, and enforce_teacher_profile_lock's email_lock explicitly
-- blocks a direct client write to it. So from the moment someone
-- confirmed a new email, every booking/cancellation/reminder/message
-- notification for that account silently kept going to the old,
-- abandoned address forever, with no self-service or admin-UI fix.
--
-- sync_profile_email mirrors handle_new_user (this file's own sibling
-- trigger on auth.users, already established) and mark_email_verified's
-- bypass pattern (armus.email_verification_update) to update
-- profiles.email the moment Auth's own email changes, instead of
-- leaving the two permanently out of sync.
--
-- 2) conversations_insert_participant (migration_82/86.sql) constrained
-- which TEACHER could originate a conversation (approved, non-banned,
-- or admin) but placed no constraint at all on WHICH student a teacher
-- could name - any approved teacher who knew (or guessed) a student's
-- UUID could open an unsolicited conversation in that student's inbox
-- with zero prior relationship. teacher_may_contact_student requires an
-- actual booking between that exact student/teacher pair (or admin)
-- before a teacher-initiated conversation is allowed; a student
-- starting a new conversation with an eligible teacher - the normal,
-- intended "message a teacher for the first time" flow - is untouched.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

-- ---- 1) profiles.email sync ----------------------------------------

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    perform set_config('armus.email_verification_update', 'on', true);
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute procedure public.sync_profile_email();

-- ---- 2) conversations_insert_participant: real relationship required
--         before a teacher (not a student) can start a new thread ----

create or replace function public.teacher_may_contact_student(target_student_id uuid, acting_teacher_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = target_student_id and p.role = 'student'
  )
  and (
    public.is_admin()
    or exists (
      select 1 from bookings b
      where b.student_id = target_student_id
        and b.teacher_id = acting_teacher_id::text
    )
  );
$$;

drop policy if exists "conversations_insert_participant" on conversations;

create policy "conversations_insert_participant"
  on conversations for insert
  with check (
    (auth.uid() = student_id or auth.uid() = teacher_id)
    and public.is_messageable_teacher(teacher_id)
    and (
      (auth.uid() = student_id and exists (select 1 from profiles p where p.id = student_id and p.role = 'student'))
      or (auth.uid() = teacher_id and public.teacher_may_contact_student(student_id, teacher_id))
    )
  );
