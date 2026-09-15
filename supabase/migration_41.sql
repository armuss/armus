-- ARMUS migration 41: teacher attendance reports (no-show / late), with
-- automatic profile hiding and escalating consequences for repeated,
-- admin-confirmed incidents.
--
-- Flow:
--   1. A student reports a no-show or a late start for one of their own
--      bookings (class.html - either from the waiting screen if the
--      teacher never joined, or from the post-lesson check-in). This
--      immediately hides the teacher from NEW students' search (existing
--      students who've booked with them before still see them) until
--      it's resolved.
--   2. The teacher can submit one explanation for an still-open report
--      (dashboard.html banner). That alone does not unhide them - it
--      just flags the report "explained" for an admin to look at.
--   3. An admin marks the report "dismissed" (false alarm - unhides the
--      teacher, no consequence) or "upheld" (stays hidden, counts toward
--      the thresholds below). Only upheld reports ever count toward a
--      threshold - an unresolved or dismissed report never does.
--   4. Thresholds (see handle_attendance_report_resolution below):
--        - 10 upheld no-shows (lifetime) -> permanent account ban.
--        - 3 upheld no-shows within a rolling 30 days -> hidden from
--          EVERYONE (not just new students) for 14 days.
--        - more than 5% of a calendar month's scheduled lessons upheld
--          as late -> hidden from EVERYONE for 30 days.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

-- === profiles: hide/ban state =====================================
alter table profiles add column if not exists hidden_from_new_students boolean not null default false;
alter table profiles add column if not exists hidden_reason text;
alter table profiles add column if not exists hidden_at timestamptz;
-- when set and in the future, the teacher is hidden from EVERYONE
-- (not just new students) - the harsher, repeated-violation tier
alter table profiles add column if not exists hidden_until timestamptz;
alter table profiles add column if not exists is_banned boolean not null default false;
alter table profiles add column if not exists banned_at timestamptz;

-- === attendance_reports =============================================
create table if not exists attendance_reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id) on delete cascade,
  teacher_id text not null,
  student_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('no_show', 'late')),
  late_minutes integer,
  student_note text,
  status text not null default 'open' check (status in ('open', 'explained', 'upheld', 'dismissed')),
  teacher_explanation text,
  created_at timestamptz not null default now(),
  explained_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references profiles(id)
);

alter table attendance_reports enable row level security;

create policy "attendance_reports_select_participant_or_admin"
  on attendance_reports for select
  using (auth.uid() = student_id or auth.uid()::text = teacher_id or public.is_admin());

-- a student can only report their OWN real booking, and only against the
-- teacher that booking is actually with - same integrity pattern as
-- reviews_insert_own_student / disputes_insert_own (migration_40.sql)
create policy "attendance_reports_insert_own_student"
  on attendance_reports for insert
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from bookings b
      where b.id = booking_id
        and b.student_id = auth.uid()
        and b.teacher_id = teacher_id
    )
  );

-- the reported teacher can submit ONE explanation while it's still open;
-- an admin can do anything (resolve it upheld/dismissed). Column-level
-- restriction (a teacher can only set teacher_explanation + move
-- open -> explained, nothing else) is enforced by the trigger below,
-- same shape as enforce_teacher_profile_lock.
create policy "attendance_reports_update_participant_or_admin"
  on attendance_reports for update
  using (auth.uid()::text = teacher_id or public.is_admin())
  with check (auth.uid()::text = teacher_id or public.is_admin());

create or replace function public.enforce_attendance_report_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    new.resolved_by := auth.uid();
    if new.status is distinct from old.status and new.status in ('upheld', 'dismissed') then
      new.resolved_at := now();
    end if;
    return new;
  end if;

  -- everything below is the reported teacher explaining themselves
  if old.status <> 'open' then
    raise exception 'attendance_report_locked: this report has already been reviewed';
  end if;

  if new.status is distinct from 'explained' then
    raise exception 'attendance_report_locked: only an admin can set the final outcome';
  end if;

  if new.booking_id is distinct from old.booking_id
    or new.teacher_id is distinct from old.teacher_id
    or new.student_id is distinct from old.student_id
    or new.type is distinct from old.type
    or new.late_minutes is distinct from old.late_minutes
    or new.student_note is distinct from old.student_note
  then
    raise exception 'attendance_report_locked: cannot modify the original report';
  end if;

  new.explained_at := now();
  return new;
end;
$$;

create trigger attendance_reports_before_update
  before update on attendance_reports
  for each row execute procedure public.enforce_attendance_report_update();

-- === auto-hide the moment a report comes in =========================
-- Runs as the REPORTING STUDENT's own request, so it sets a session-local
-- flag enforce_teacher_profile_lock (below) checks to let this one
-- specific, trusted write through without needing to be an admin.
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
      hidden_reason = new.type,
      hidden_at = now()
  where id::text = new.teacher_id
    and coalesce(is_banned, false) = false;

  return new;
end;
$$;

create trigger attendance_reports_after_insert
  after insert on attendance_reports
  for each row execute procedure public.handle_new_attendance_report();

-- === escalate (or clear) once an admin resolves a report ============
create or replace function public.handle_attendance_report_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total_no_shows integer;
  recent_no_shows integer;
  month_start date;
  month_lesson_count integer;
  month_late_count integer;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  perform set_config('armus.attendance_system_update', 'on', true);

  if new.status = 'dismissed' then
    -- false alarm - unhide, unless something ELSE is still pending or
    -- was separately upheld inside the current 30-day escalation window
    if not exists (
      select 1 from attendance_reports
      where teacher_id = new.teacher_id and status in ('open', 'explained') and id <> new.id
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

    elsif new.type = 'late' then

      month_start := date_trunc('month', new.created_at)::date;

      select count(*) into month_lesson_count
      from bookings
      where teacher_id = new.teacher_id
        and lesson_date >= month_start
        and lesson_date < month_start + interval '1 month'
        and status <> 'cancelled';

      select count(*) into month_late_count
      from attendance_reports
      where teacher_id = new.teacher_id and type = 'late' and status = 'upheld'
        and created_at >= month_start and created_at < month_start + interval '1 month';

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

create trigger attendance_reports_after_update
  after update on attendance_reports
  for each row execute procedure public.handle_attendance_report_resolution();

-- === lock the hide/ban columns down on profiles =====================
-- Extends the shared profile-lock trigger (migration_34.sql) so a
-- teacher can never self-unhide/self-unban by updating their own row
-- directly - only an admin, or the attendance-report system itself
-- (via the trusted session flag the two functions above set) can.
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

  if new.is_admin is distinct from old.is_admin then
    raise exception 'admin_lock: is_admin can only be changed by an admin';
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

  return new;
end;
$$;

-- lets the admin panel subscribe to new attendance reports in real time
-- (same as bookings/profiles/reviews - see schema.sql's LIVE PULSE section)
alter publication supabase_realtime add table attendance_reports;
