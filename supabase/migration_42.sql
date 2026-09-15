-- ARMUS migration 42: four follow-up fixes found auditing the
-- attendance-report system (migration_41.sql).
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

-- 1. CRITICAL (the most serious of the four): the original
--    attendance_reports_insert_own_student policy wrote
--    "b.teacher_id = teacher_id" - inside that subquery, the bare
--    (unqualified) "teacher_id" resolves to the SAME "bookings b" row
--    it's already being compared against ("b.teacher_id"), NOT to the
--    new attendance_reports row's own teacher_id column. That makes the
--    whole comparison a tautology (b.teacher_id = b.teacher_id, always
--    true) - the policy only ever actually verified the BOOKING belongs
--    to the reporting student and is real/confirmed/already happened,
--    but never checked that the teacher_id being written down matches
--    who that booking was actually with. In practice: any student who
--    has ever completed a single real lesson with ANY teacher could
--    submit a report naming a COMPLETELY DIFFERENT, totally uninvolved
--    teacher as teacher_id, and the auto-hide would fire on that
--    innocent teacher regardless. Verified against a real local Postgres
--    instance: reproduced the exploit first (an uninvolved teacher gets
--    hidden), then confirmed this fix (explicitly qualifying the target
--    row as "attendance_reports.teacher_id") blocks it while the
--    legitimate same-booking-same-teacher case still succeeds.
--
-- 2. attendance_reports_insert_own_student also never checked that the
--    lesson had actually happened yet, or that the booking was even
--    still confirmed - a student could report "no_show"/"late" against
--    a lesson scheduled days or weeks in the future (the teacher never
--    had a chance to show up at all), or one they'd already cancelled,
--    and it would still immediately hide the teacher from new students.
--    Verified against a real local Postgres instance: before this fix, a
--    report on a booking 30 days out succeeds and hides the teacher;
--    after this fix, it's rejected.
drop policy if exists "attendance_reports_insert_own_student" on attendance_reports;
create policy "attendance_reports_insert_own_student"
  on attendance_reports for insert
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from bookings b
      where b.id = booking_id
        and b.student_id = auth.uid()
        and b.status = 'confirmed'
        and b.teacher_id = attendance_reports.teacher_id
        and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone) <= now()
    )
  );

-- 3 & 4: handle_attendance_report_resolution's "more than 5% of a
-- calendar month's lessons upheld as late" check had two bugs:
--   - the calendar month was computed in the database's own session
--     timezone (UTC), the same "wall-clock read as UTC" gap
--     migration_37.sql/migration_40.sql closed elsewhere, instead of the
--     reported teacher's own timezone.
--   - the denominator counted every non-cancelled lesson scheduled
--     anywhere in that month, INCLUDING ones still in the future that
--     haven't happened yet - artificially diluting the late percentage
--     and making the threshold harder to reach than intended. Now only
--     counts lessons that have actually started already.
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
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  perform set_config('armus.attendance_system_update', 'on', true);

  if new.status = 'dismissed' then
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

-- 5. a sanity bound on late_minutes to match the client-side
--    min="1" max="180" on the input - nothing enforced it server-side
alter table attendance_reports drop constraint if exists attendance_reports_late_minutes_check;
alter table attendance_reports add constraint attendance_reports_late_minutes_check
  check (late_minutes is null or late_minutes between 1 and 180);
