-- ARMUS migration 80: locks the rest of a teacher's application fields
-- once approved, not just title/price/availability/bio/weekly_availability.
--
-- enforce_teacher_profile_lock (schema.sql) already locked those five
-- "live" fields behind pending_changes + admin approval once
-- old.status = 'approved', but left every other field apply-teacher.html
-- writes - subject_taught, phone, has_certificate/certificate_name/
-- certificate_years/certificate_file_url/certificate_file_name,
-- has_education/university/degree_type/graduation_year/specialization,
-- video_url, photo_url, country, languages, age_confirmed - completely
-- unlocked. armusUpdateOwnProfile (auth.js) has no field allowlist, so an
-- approved teacher could rewrite any of these with a bare client update:
-- swap in a different certificate_file_url or claim a different
-- university/degree than the one an admin actually reviewed and approved
-- on, with zero admin visibility - the exact trust-critical data
-- admin.html's approval screen exists to review.
--
-- No UI writes any of these fields for an already-approved teacher (only
-- apply-teacher.html does, and it always pairs them with status:
-- 'pending', which the existing status_lock check still allows), so this
-- locks them outright rather than routing them through pending_changes.
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
