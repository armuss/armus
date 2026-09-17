-- Fixes the attendance-report "no-show" grace period being enforced only
-- client-side. class.html disables the "teacher never showed up" report
-- button for the first 10 minutes after a lesson's scheduled start
-- (noShowReportReady) - "a student who reports within seconds of
-- joining, the teacher might just be a minute behind, can't instantly
-- hide someone over nothing" - but attendance_reports_insert_own_student
-- only ever required the lesson to have started at all, with no grace
-- period. A direct API call (bypassing class.html) could file a
-- no_show report the literal instant the scheduled start passed,
-- immediately hiding the teacher over nothing, exactly what that
-- comment says shouldn't be possible.
--
-- "late" intentionally keeps no gate here (any time after the scheduled
-- start, it already is late) - only no_show gets the extra 10 minutes.
--
-- Verified against a local Postgres instance: a no_show 3 minutes after
-- start is now rejected, a late report 3 minutes after start still
-- succeeds, and a no_show 12 minutes after start still succeeds.

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
        and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone)
            <= now() - (case when attendance_reports.type = 'no_show' then interval '10 minutes' else interval '0' end)
    )
  );
