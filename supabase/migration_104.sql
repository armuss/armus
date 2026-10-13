-- migration_104.sql: two fixes to the attendance-penalty system.
--
-- === PART A: a dismissed (false-alarm) report could strand a teacher hidden forever ===
--
-- hidden_from_new_students has been doing two jobs with one boolean:
-- "a report is waiting for review" (set by handle_new_attendance_report
-- the moment a student files one) and "a penalty is in force" (an upheld
-- regular report, or the migration_100.sql trial-no-show ladder). Nothing
-- remembered which of the two a teacher's current hide actually came
-- from, and that broke in two concrete ways:
--
--   1. A teacher serving a trial-ladder hide (hidden_reason =
--      'trial_no_show') who then got ANY new report had hidden_reason
--      overwritten to 'no_show'/'late' by handle_new_attendance_report.
--      dashboard.html only shows the "Profilimi Görünür Yap" flow, and
--      self_unhide_from_new_students only works, when hidden_reason is
--      'trial_no_show' - so even if that new report was later dismissed
--      as a false alarm, the teacher could never clear their own trial
--      hide again. Only a manual admin DB edit got them out.
--
--   2. The dismissed branch refused to unhide anyone with an upheld
--      report anywhere in their history - including one they had long
--      since served (a tier-1 trial hide is cleared the same day) or an
--      admin had already forgiven. So for a teacher with any past upheld
--      report, a later false alarm, once dismissed, left them hidden
--      from new students indefinitely, with the dashboard showing a
--      generic banner that no longer matched anything real.
--
-- Fix: penalty_hide_reason records the penalty in force on its own,
-- separate from "a report is pending": null (none), 'trial_no_show'
-- (self-service, migration_100.sql), or 'no_show'/'late' (an upheld
-- regular report - stays until an admin clears it, the existing
-- behavior). A teacher is hidden from new students exactly when a
-- penalty is in force or a report is still waiting for review; once the
-- last pending report is resolved, visibility goes back to whatever the
-- standing penalty says. The stricter, admin-only regular penalty always
-- outranks the self-service trial one, so a trial verdict can never be
-- used to talk your way out of a regular one.
--
-- === PART B: banning a teacher never cancelled their upcoming lessons ===
--
-- A teacher banned by the 10-upheld-no-shows rule kept every lesson they
-- already had booked: students still saw them in my-lessons.html with a
-- working "Derse Katıl" button and could join class.html's room with
-- someone ARMUS had just closed for not showing up. Now the ban itself
-- cancels every not-yet-started confirmed lesson for that teacher -
-- same outcome as a teacher/admin cancelling each one by hand
-- (cancel-booking): a lesson credit back to the student when the lesson
-- was paid for (card or credit), and an email telling them what
-- happened (notify-lessons-cancelled Edge Function). A booking can't
-- slip in afterwards either: a checkout that started before the ban and
-- completes after it is refused (AR002) and the student gets a credit
-- instead, same as the existing slot-taken path in payment-callback.
--
-- Deploy order: deploy the notify-lessons-cancelled Edge Function (Verify
-- JWT OFF) and redeploy payment-callback/create-payment, then run this.

-- ---------------------------------------------------------------------
-- PART A
-- ---------------------------------------------------------------------

alter table profiles add column if not exists penalty_hide_reason text
  check (penalty_hide_reason is null or penalty_hide_reason in ('no_show', 'late', 'trial_no_show'));

-- enforce_teacher_profile_lock is a BLOCKLIST - any profiles column it
-- doesn't name is writable by the teacher themselves through a bare
-- client update (armusUpdateOwnProfile has no field allowlist). Re-
-- created here in full, unchanged apart from penalty_hide_reason being
-- added to the attendance-system block, so a teacher can't simply null
-- out their own penalty.
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
    or new.penalty_hide_reason is distinct from old.penalty_hide_reason
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

-- a new report hides the teacher from new students while it waits for
-- review. hidden_reason keeps showing the standing penalty if one is
-- already in force (previously it was always overwritten with the new
-- report's type, which is what erased 'trial_no_show').
create or replace function public.handle_new_attendance_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('armus.attendance_system_update', 'on', true);

  update profiles
  set hidden_from_new_students = true,
      hidden_reason = coalesce(penalty_hide_reason, new.type),
      hidden_at = now()
  where id::text = new.teacher_id
    and coalesce(is_banned, false) = false;

  return new;
end;
$$;

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
    -- another report still waiting for review keeps the hide in place
    if exists (
      select 1 from attendance_reports
      where teacher_id = new.teacher_id and status in ('open', 'explained') and id <> new.id
    ) then
      return new;
    end if;

    -- nothing else pending: back to whatever penalty is actually in
    -- force, independent of this false alarm. An active hidden_until
    -- (the hidden-from-everyone escalation) is left alone - it's its own
    -- column with its own expiry, and every path that sets it also sets
    -- a penalty, so it never needed this branch's old
    -- "coalesce(hidden_until, now()) <= now()" guard once penalties are
    -- tracked directly (that guard is also what stranded a teacher whose
    -- false alarm was dismissed DURING an escalation - nothing ever
    -- came back to unhide them after it expired).
    update profiles
    set hidden_from_new_students = (penalty_hide_reason is not null),
        hidden_reason = penalty_hide_reason,
        hidden_at = case when penalty_hide_reason is null then null else hidden_at end
    where id::text = new.teacher_id;
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

      select b.type into booking_type from bookings b where b.id = new.booking_id;

      if booking_type = 'trial' then
        -- migration_100.sql's trial-no-show ladder, unchanged apart from
        -- recording the penalty - and never downgrading an admin-only
        -- regular penalty already in force into the self-service one
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
              penalty_hide_reason = case when penalty_hide_reason in ('no_show', 'late') then penalty_hide_reason else 'trial_no_show' end,
              hidden_reason = case when penalty_hide_reason in ('no_show', 'late') then penalty_hide_reason else 'trial_no_show' end,
              hidden_at = now(),
              trial_hidden_tier = new_tier,
              trial_unhide_eligible_at = unhide_at,
              trial_unhide_requires_ack = requires_ack
          where id::text = new.teacher_id
            and coalesce(is_banned, false) = false;
        end if;
      else
        -- a regular (non-trial) upheld no-show keeps the teacher hidden
        -- from new students until an admin clears it - the existing
        -- behavior, now recorded as a penalty instead of only implied by
        -- the report having been pending
        update profiles
        set hidden_from_new_students = true,
            penalty_hide_reason = 'no_show',
            hidden_reason = 'no_show'
        where id::text = new.teacher_id;
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

      update profiles
      set hidden_from_new_students = true,
          penalty_hide_reason = 'late',
          hidden_reason = 'late'
      where id::text = new.teacher_id;

    end if;

  end if;

  return new;
end;
$$;

-- reads the penalty itself rather than hidden_reason, and refuses while
-- another report is still waiting for review (dashboard.html never even
-- offers the button then - this closes the direct-RPC path to escaping
-- a pending report's hide early).
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

  if t.penalty_hide_reason is distinct from 'trial_no_show' or t.trial_hidden_tier = 0 then
    return 'no_action';
  end if;

  if exists (
    select 1 from attendance_reports
    where teacher_id = auth.uid()::text and status in ('open', 'explained')
  ) then
    return 'not_eligible';
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
      penalty_hide_reason = null,
      trial_hidden_tier = 0,
      trial_unhide_eligible_at = null,
      trial_unhide_requires_ack = false
  where id = auth.uid();

  return 'ok';
end;
$$;

-- Backfill penalty_hide_reason for teachers who are hidden right now.
-- Conservative on purpose: nobody becomes visible from this alone.
do $$
begin
  perform set_config('armus.attendance_system_update', 'on', true);

  -- a trial-ladder hide in force - INCLUDING teachers already stranded
  -- by the bug above (hidden_reason overwritten to 'no_show'/'late' by a
  -- later report): trial tier still above 0, and no upheld non-trial
  -- verdict since their latest upheld trial one.
  update profiles p
  set penalty_hide_reason = 'trial_no_show'
  where p.hidden_from_new_students
    and p.trial_hidden_tier > 0
    and not exists (
      select 1 from attendance_reports r
      join bookings b on b.id = r.booking_id
      where r.teacher_id = p.id::text
        and r.status = 'upheld'
        and not (r.type = 'no_show' and b.type = 'trial')
        and r.resolved_at > (
          select max(r2.resolved_at) from attendance_reports r2
          join bookings b2 on b2.id = r2.booking_id
          where r2.teacher_id = p.id::text and r2.status = 'upheld'
            and r2.type = 'no_show' and b2.type = 'trial'
        )
    );

  -- any other currently-hidden teacher with an upheld report on record:
  -- keep them exactly as hidden as they are today, as an admin-only
  -- regular penalty
  update profiles p
  set penalty_hide_reason = case when p.hidden_reason in ('no_show', 'late') then p.hidden_reason else 'no_show' end
  where p.hidden_from_new_students
    and p.penalty_hide_reason is null
    and exists (select 1 from attendance_reports r where r.teacher_id = p.id::text and r.status = 'upheld');

  -- give the recovered trial-ladder teachers their banner and
  -- self-service button back
  update profiles
  set hidden_reason = 'trial_no_show'
  where penalty_hide_reason = 'trial_no_show'
    and hidden_reason is distinct from 'trial_no_show';
end $$;

-- ---------------------------------------------------------------------
-- PART B
-- ---------------------------------------------------------------------

create or replace function public.cancel_banned_teacher_future_lessons()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  cancelled_ids uuid[] := '{}';
begin
  for b in
    update bookings
    set status = 'cancelled', cancelled_at = now(), cancelled_by = 'admin'
    where teacher_id = new.id::text
      and status = 'confirmed'
      and ((lesson_date + lesson_time::time) at time zone teacher_timezone) > now()
    returning id, student_id, teacher_id, teacher_name
  loop
    -- same rule as cancel-booking: a card-paid lesson comes back as a
    -- new credit with this teacher; a credit-paid one gets that SAME
    -- credit back (never a freshly minted one - see cancel-booking's
    -- header for why)
    if exists (select 1 from pending_payments p where p.booking_id = b.id and p.status = 'succeeded') then
      insert into lesson_credits (student_id, teacher_id, teacher_name, source_booking_id)
      values (b.student_id, b.teacher_id, b.teacher_name, b.id);
      update bookings set refunded = true where id = b.id;
    else
      update lesson_credits
      set status = 'available', used_booking_id = null, used_at = null
      where used_booking_id = b.id and status = 'used';
      if found then
        update bookings set refunded = true where id = b.id;
      end if;
    end if;

    cancelled_ids := cancelled_ids || b.id;
  end loop;

  if coalesce(array_length(cancelled_ids, 1), 0) > 0 then
    perform net.http_post(
      url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/notify-lessons-cancelled',
      headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
      body := jsonb_build_object('booking_ids', to_jsonb(cancelled_ids), 'reason', 'teacher_banned')
    );
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_cancel_lessons_on_ban on profiles;
create trigger profiles_cancel_lessons_on_ban
  after update on profiles
  for each row
  when (coalesce(old.is_banned, false) = false and new.is_banned = true)
  execute procedure public.cancel_banned_teacher_future_lessons();

-- a checkout that started before the ban and finishes after it would
-- otherwise still create a booking nothing ever cancels - payment-
-- callback (and create-payment's credit path) treat AR002 like a taken
-- slot: no booking, a lesson credit instead.
create or replace function public.enforce_teacher_not_banned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from profiles p
    where p.id::text = new.teacher_id and coalesce(p.is_banned, false)
  ) then
    raise exception using errcode = 'AR002', message = 'teacher_banned: bu ogretmenin hesabi kapatildi';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_enforce_teacher_not_banned on bookings;
create trigger bookings_enforce_teacher_not_banned
  before insert on bookings
  for each row execute procedure public.enforce_teacher_not_banned();
