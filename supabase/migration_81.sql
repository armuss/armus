-- ARMUS migration 81: a banned teacher's dashboard stayed fully
-- functional - is_online, pending_changes, availability_dates were all
-- still writable, and they could still send new messages to any student
-- they already had a conversation with. dashboard.html only ever showed
-- an informational "hesabın kapatıldı" banner on top of the real,
-- unrestricted panel - nothing server-side actually stopped a banned
-- account (is_banned, migration_41.sql - set after 10 confirmed
-- no-shows) from acting like a normal approved teacher.
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

  if coalesce(current_setting('armus.attendance_system_update', true), '') = 'on' then
    return new;
  end if;

  if coalesce(current_setting('armus.email_verification_update', true), '') = 'on' then
    return new;
  end if;

  -- is_banned is the "account closed" state (10 confirmed no-shows,
  -- migration_41.sql) - a banned profile can only be written by an admin
  -- from here on.
  if old.is_banned then
    raise exception 'banned_lock: banned accounts cannot update their profile';
  end if;

  if new.is_admin is distinct from old.is_admin then
    raise exception 'admin_lock: is_admin can only be changed by an admin';
  end if;

  if new.role is distinct from old.role then
    raise exception 'role_lock: role can only be changed by an admin';
  end if;

  if new.email is distinct from old.email then
    raise exception 'email_lock: email can only be changed by an admin';
  end if;

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

  if old.status = 'approved' and (
    new.title is distinct from old.title
    or new.price is distinct from old.price
    or new.availability is distinct from old.availability
    or new.bio is distinct from old.bio
    or new.weekly_availability is distinct from old.weekly_availability
  ) then
    raise exception 'profile_locked: approved profile fields can only change through pending_changes + admin approval';
  end if;

  if old.status = 'approved' and (
    new.country is distinct from old.country
    or new.subject_taught is distinct from old.subject_taught
    or new.languages is distinct from old.languages
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

  if new.pending_changes is distinct from old.pending_changes and new.pending_changes is not null then
    if exists (
      select 1 from jsonb_object_keys(new.pending_changes) as k
      where k not in ('submitted_at', 'title', 'price', 'availability', 'bio', 'weekly_availability')
    ) then
      raise exception 'pending_changes_lock: pending_changes may only contain submitted_at, title, price, availability, bio, or weekly_availability';
    end if;
  end if;

  return new;
end;
$$;

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
    )
    and (
      select count(*) from messages m2
      where m2.sender_id = auth.uid()
        and m2.created_at > now() - interval '1 hour'
    ) < 120
  );
