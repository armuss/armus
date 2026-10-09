-- ARMUS migration 92: lets an approved teacher update which languages
-- they teach in and their subject, through the same pending_changes +
-- admin-approval path title/price/availability/bio already use - instead
-- of the flat "application_locked" wall enforce_teacher_profile_lock
-- (migration_80.sql) put them behind, alongside certificate/education
-- fields. Those stay flatly locked (they're verified credentials an
-- admin checked a document for), but subject_taught/languages are
-- self-declared marketing copy exactly like bio/title - the only reason
-- they'd ended up flatly locked was that they came from the same
-- application-form section as the credential fields, not a deliberate
-- decision that they can never be edited. Today there is literally no
-- way for an approved teacher to ever fix a typo in their teaching
-- languages or change subject, short of asking support to do a raw DB
-- edit - and teachers.html's language filter (added after this lock) now
-- depends on `languages` actually reflecting what a teacher teaches.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create or replace function public.enforce_teacher_profile_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  -- set by the attendance-report system (migration_41.sql) right before
  -- it writes hidden_from_new_students/hidden_until/is_banned on behalf
  -- of whichever student's report or admin's resolution triggered it -
  -- lets that one trusted, server-side write through without needing to
  -- be an admin itself
  if coalesce(current_setting('armus.attendance_system_update', true), '') = 'on' then
    return new;
  end if;

  -- set only by mark_email_verified() (migration_77.sql) - never by a
  -- plain client update
  if coalesce(current_setting('armus.email_verification_update', true), '') = 'on' then
    return new;
  end if;

  -- migration_81.sql: is_banned is the "account closed" state (10
  -- confirmed no-shows, migration_41.sql) - dashboard.html showed a
  -- closed-account banner over it, but the rest of the page (is_online,
  -- pending_changes, availability_dates) stayed fully writable, since
  -- nothing here actually stopped a banned teacher's own updates. A
  -- banned profile can only be written by an admin from here on.
  if old.is_banned then
    raise exception 'banned_lock: banned accounts cannot update their profile';
  end if;

  if new.is_admin is distinct from old.is_admin then
    raise exception 'admin_lock: is_admin can only be changed by an admin';
  end if;

  -- role is set once, at signup (handle_new_user, from the auth metadata
  -- armusSignUp passes in) and never written again by any legitimate app
  -- code path - apply-teacher.html only ever sets status/title/price/etc,
  -- never role. Without this lock, a plain student could self-promote to
  -- role = 'teacher' with a bare client update, which lets them pass
  -- conversations_insert_participant's role checks and fabricate a
  -- conversation naming any real student as the other party - masking
  -- as a fake teacher to talk to a student who'd normally never see
  -- them in the marketplace.
  if new.role is distinct from old.role then
    raise exception 'role_lock: role can only be changed by an admin';
  end if;

  -- set once at signup from auth.users.email (handle_new_user) and never
  -- legitimately written again (migration_77.sql) - an unlocked
  -- profiles.email let a teacher redirect their own booking/message
  -- notification emails (create-payment, send-message-notification, ...
  -- all read this column, not auth.users.email) to an inbox they don't
  -- own.
  if new.email is distinct from old.email then
    raise exception 'email_lock: email can only be changed by an admin';
  end if;

  -- only mark_email_verified() (service-role only, migration_77.sql) may
  -- flip this - a plain client setting it directly would skip
  -- verify-email-code's entire verification flow.
  if new.email_verified is distinct from old.email_verified then
    raise exception 'email_verified_lock: email_verified can only be set by the verification system';
  end if;

  if new.status is distinct from old.status and new.status is distinct from 'pending' then
    raise exception 'status_lock: only an admin can approve or reject an application';
  end if;

  if new.hidden_from_new_students is distinct from old.hidden_from_new_students
    or new.hidden_reason is distinct from old.hidden_reason
    or new.hidden_at is distinct from old.hidden_at
    or new.hidden_until is distinct from old.hidden_until
    or new.is_banned is distinct from old.is_banned
    or new.banned_at is distinct from old.banned_at
  then
    raise exception 'attendance_lock: these fields can only be changed by the attendance-report system or an admin';
  end if;

  -- migration_92.sql: subject_taught/languages moved here from the
  -- flatly-locked credential block below - same admin-approval gate as
  -- title/price/availability/bio, not an unrestricted write.
  if old.status = 'approved' and (
    new.title is distinct from old.title
    or new.price is distinct from old.price
    or new.availability is distinct from old.availability
    or new.bio is distinct from old.bio
    or new.weekly_availability is distinct from old.weekly_availability
    or new.subject_taught is distinct from old.subject_taught
    or new.languages is distinct from old.languages
  ) then
    raise exception 'profile_locked: approved profile fields can only change through pending_changes + admin approval';
  end if;

  -- migration_80.sql: the rest of apply-teacher.html's application fields
  -- were never locked here at all, unlike title/price/bio/availability/
  -- weekly_availability just above - armusUpdateOwnProfile has no field
  -- allowlist (auth.js), so once approved a teacher could still rewrite
  -- their own certificate/education info with a bare client update,
  -- completely bypassing the pending_changes + admin review flow those
  -- other fields go through. That's the trust-critical, document-verified
  -- data admin.html's approval screen actually reviewed - a teacher could
  -- silently swap in a fake certificate_file_url or claim a different
  -- university after being approved on the strength of the real one, with
  -- no admin ever seeing the change. No UI writes any of these fields for
  -- an already-approved teacher, so flatly locking them (no pending_changes
  -- escape hatch) matches current behavior.
  if old.status = 'approved' and (
    new.country is distinct from old.country
    or new.phone is distinct from old.phone
    or new.age_confirmed is distinct from old.age_confirmed
    or new.photo_url is distinct from old.photo_url
    or new.has_certificate is distinct from old.has_certificate
    or new.certificate_name is distinct from old.certificate_name
    or new.certificate_years is distinct from old.certificate_years
    or new.certificate_file_url is distinct from old.certificate_file_url
    or new.certificate_file_name is distinct from old.certificate_file_name
    or new.has_education is distinct from old.has_education
    or new.university is distinct from old.university
    or new.degree_type is distinct from old.degree_type
    or new.graduation_year is distinct from old.graduation_year
    or new.specialization is distinct from old.specialization
    or new.video_url is distinct from old.video_url
  ) then
    raise exception 'application_locked: approved teachers cannot edit application details directly - contact support to update them';
  end if;

  -- pending_changes is itself just a jsonb blob a teacher writes to their
  -- own row, and admin.html's approval handler spreads its contents
  -- straight into the profile on approve (minus submitted_at) - without
  -- this check a non-admin could smuggle keys like is_admin or status into
  -- it that the review UI never renders, so an admin approving what looks
  -- like a harmless bio/price edit would silently apply them too
  if new.pending_changes is distinct from old.pending_changes and new.pending_changes is not null then
    if exists (
      select 1 from jsonb_object_keys(new.pending_changes) as k
      where k not in ('submitted_at', 'title', 'price', 'availability', 'bio', 'weekly_availability', 'subject_taught', 'languages')
    ) then
      raise exception 'pending_changes_lock: pending_changes may only contain submitted_at, title, price, availability, bio, weekly_availability, subject_taught, or languages';
    end if;
  end if;

  return new;
end;
$$;
