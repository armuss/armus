-- Fixes handle_attendance_report_resolution's 'dismissed' branch: its own
-- comment says a teacher stays hidden "unless something ELSE is still
-- pending or was separately upheld", but the actual condition only ever
-- checked status in ('open', 'explained') - never 'upheld'. Dismissing
-- one report could unhide a teacher who still had a completely separate,
-- confirmed-real upheld violation on record, as long as that upheld
-- report hadn't itself crossed the 14/30-day hidden_until escalation
-- threshold (a teacher's FIRST upheld report, before escalation, was
-- exactly the gap - the coalesce(hidden_until, now()) <= now() check
-- already protects the escalated case).
--
-- Reproduced against a local Postgres instance: a teacher with one
-- upheld no_show report, plus one separate open report that then gets
-- dismissed, was incorrectly unhidden by the dismissal alone. Verified
-- this fix keeps them hidden while the upheld report stands, and still
-- correctly unhides once every report (including that upheld one, if an
-- admin later reverses it) is no longer open/explained/upheld.

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
