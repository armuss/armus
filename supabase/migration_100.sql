-- ARMUS migration 100: a Preply-style escalating penalty ladder
-- specifically for TRIAL-lesson no-shows - a brand-new student's first
-- impression. migration_41.sql's existing attendance system already
-- hides a teacher from new students on any upheld no-show and escalates
-- flat thresholds regardless of booking type (3-in-30-days -> hidden
-- from EVERYONE 14 days, 10-lifetime -> permanent ban) - that stays
-- exactly as it is, as the harsher backstop. This adds a SEPARATE,
-- finer-grained, per-occurrence ladder that only counts upheld TRIAL
-- no-shows and, same as the rest of this system, only ever hides the
-- teacher from NEW students (existing students are never affected) -
-- mirrors Preply's own "Guidelines for first lessons" (1st/2nd/3rd/4th/
-- 5th miss), simplified to fit ARMUS (no tutorial/course content to
-- require watching - "tier 1/2" substitute a one-click policy
-- acknowledgment instead):
--   1st upheld trial no-show: hidden until the teacher acknowledges
--     (no time gate at all - available to clear immediately).
--   2nd: hidden >= 7 days AND until acknowledged (whichever is later).
--   3rd: hidden 14 days, then a self-service "make visible" action.
--   4th: hidden 30 days, then self-service.
--   5th and beyond: hidden 730 days (~2 years), then self-service.
-- Getting re-shown is never automatic past tier 1 - the teacher must
-- act (self_unhide_from_new_students() below), same as Preply's "Make
-- visible" button.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

alter table profiles add column if not exists trial_noshow_count integer not null default 0;
alter table profiles add column if not exists trial_hidden_tier integer not null default 0;
alter table profiles add column if not exists trial_unhide_eligible_at timestamptz;
alter table profiles add column if not exists trial_unhide_requires_ack boolean not null default false;

-- same lock shape as hidden_from_new_students/hidden_until/is_banned
-- just above - without this, armusUpdateOwnProfile (which has no field
-- allowlist) would let a teacher directly rewrite trial_unhide_eligible_at
-- to a past date and trial_unhide_requires_ack to false, then call
-- self_unhide_from_new_students() and skip the wait entirely. The
-- *_count/_tier columns are metadata rather than the enforcement switch
-- itself (hidden_from_new_students stays the real gate, and that was
-- already locked) but are included here too so a teacher can never
-- make their own record quietly understate its history.
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
    or new.trial_noshow_count is distinct from old.trial_noshow_count
    or new.trial_hidden_tier is distinct from old.trial_hidden_tier
    or new.trial_unhide_eligible_at is distinct from old.trial_unhide_eligible_at
    or new.trial_unhide_requires_ack is distinct from old.trial_unhide_requires_ack
  then
    raise exception 'attendance_lock: these fields can only be changed by the attendance-report system or an admin';
  end if;

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

-- extends handle_attendance_report_resolution (migration_41.sql) with
-- the new trial-specific ladder, additive to the existing no_show/late
-- branches which are left completely unchanged.
create or replace function public.handle_attendance_report_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total_no_shows integer;
  recent_no_shows integer;
  report_teacher_tz text;
  month_start_local timestamptz;
  month_end_local timestamptz;
  month_lesson_count integer;
  month_late_count integer;
  booking_type text;
  new_trial_count integer;
  new_tier integer;
  unhide_at timestamptz;
  requires_ack boolean;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  perform set_config('armus.attendance_system_update', 'on', true);

  if new.status = 'dismissed' then
    if not exists (
      select 1 from attendance_reports
      where teacher_id = new.teacher_id and status in ('open', 'explained', 'upheld') and id <> new.id
    ) then
      update profiles
      set hidden_from_new_students = false, hidden_reason = null, hidden_at = null
      where id::text = new.teacher_id and coalesce(hidden_until, now()) <= now();
    end if;
    return new;
  end if;

  if new.status = 'upheld' then

    if new.type = 'no_show' then

      select count(*) into total_no_shows
      from attendance_reports
      where teacher_id = new.teacher_id and type = 'no_show' and status = 'upheld';

      if total_no_shows >= 10 then
        update profiles set is_banned = true, banned_at = now() where id::text = new.teacher_id;
      else
        select count(*) into recent_no_shows
        from attendance_reports
        where teacher_id = new.teacher_id and type = 'no_show' and status = 'upheld'
          and created_at >= now() - interval '30 days';

        if recent_no_shows >= 3 then
          update profiles
          set hidden_until = greatest(coalesce(hidden_until, now()), now() + interval '14 days')
          where id::text = new.teacher_id;
        end if;
      end if;

      -- migration_100.sql: the trial-specific ladder - counts LIFETIME
      -- upheld trial no-shows and escalates per occurrence, independent
      -- of (and in addition to) the flat thresholds just above.
      select b.type into booking_type from bookings b where b.id = new.booking_id;

      if booking_type = 'trial' then
        update profiles
        set trial_noshow_count = trial_noshow_count + 1
        where id::text = new.teacher_id
        returning trial_noshow_count into new_trial_count;

        if new_trial_count is not null then
          new_tier := least(new_trial_count, 5);

          unhide_at := case new_tier
            when 1 then now()
            when 2 then now() + interval '7 days'
            when 3 then now() + interval '14 days'
            when 4 then now() + interval '30 days'
            else now() + interval '730 days'
          end;
          requires_ack := new_tier <= 2;

          update profiles
          set hidden_from_new_students = true,
              hidden_reason = 'trial_no_show',
              hidden_at = now(),
              trial_hidden_tier = new_tier,
              trial_unhide_eligible_at = unhide_at,
              trial_unhide_requires_ack = requires_ack
          where id::text = new.teacher_id
            and coalesce(is_banned, false) = false;
        end if;
      end if;

    elsif new.type = 'late' then

      select b.teacher_timezone into report_teacher_tz
      from bookings b where b.id = new.booking_id;
      report_teacher_tz := coalesce(report_teacher_tz, 'Europe/Istanbul');

      month_start_local := date_trunc('month', new.created_at at time zone report_teacher_tz) at time zone report_teacher_tz;
      month_end_local := month_start_local + interval '1 month';

      select count(*) into month_lesson_count
      from bookings b
      where b.teacher_id = new.teacher_id
        and b.status <> 'cancelled'
        and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone) >= month_start_local
        and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone) < month_end_local
        and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone) <= now();

      select count(*) into month_late_count
      from attendance_reports
      where teacher_id = new.teacher_id and type = 'late' and status = 'upheld'
        and created_at >= month_start_local and created_at < month_end_local;

      if month_lesson_count > 0 and (month_late_count::numeric / month_lesson_count) > 0.05 then
        update profiles
        set hidden_until = greatest(coalesce(hidden_until, now()), now() + interval '30 days')
        where id::text = new.teacher_id;
      end if;

    end if;

  end if;

  return new;
end;
$$;

-- the teacher's own self-service "make visible" action (Preply's "Make
-- visible" button) - returns 'ok' on success, 'not_eligible' if the
-- wait isn't over yet, 'ack_required' if tier 1/2 needs p_ack=true
-- first, or 'no_action' if this teacher isn't currently in a
-- trial-no-show hide at all. SECURITY DEFINER + the trusted session
-- flag so it can clear hidden_from_new_students despite
-- enforce_teacher_profile_lock, but it only ever touches auth.uid()'s
-- OWN row and only the trial-ladder fields - never is_banned/hidden_until
-- (the harsher, non-self-service tiers).
create or replace function public.self_unhide_from_new_students(p_ack boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  select * into t from profiles where id = auth.uid();
  if t is null then
    return 'no_action';
  end if;

  if t.hidden_reason is distinct from 'trial_no_show' or t.trial_hidden_tier = 0 then
    return 'no_action';
  end if;

  if t.trial_unhide_eligible_at is null or now() < t.trial_unhide_eligible_at then
    return 'not_eligible';
  end if;

  if t.trial_unhide_requires_ack and not p_ack then
    return 'ack_required';
  end if;

  perform set_config('armus.attendance_system_update', 'on', true);

  update profiles
  set hidden_from_new_students = false,
      hidden_reason = null,
      hidden_at = null,
      trial_hidden_tier = 0,
      trial_unhide_eligible_at = null,
      trial_unhide_requires_ack = false
  where id = auth.uid();

  return 'ok';
end;
$$;
