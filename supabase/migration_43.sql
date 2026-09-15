-- ARMUS migration 43: one more follow-up fix found auditing the
-- attendance-report system (two other bugs fixed alongside this one -
-- silently-ignored insert failures in class.html's post-lesson
-- check-in, and dashboard.html only ever showing a teacher's single
-- most recent report - were both pure client-side JS, no SQL needed).
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

-- enforce_attendance_report_update's own comment promises the
--    reported teacher can only set teacher_explanation + move the
--    report from open -> explained, "nothing else" - but resolved_at
--    and resolved_by were never actually locked down for that path.
--    A teacher submitting their explanation could also set resolved_at
--    to an arbitrary (e.g. backdated) timestamp and resolved_by to any
--    profile id, forging that the report had already been reviewed by
--    someone else. It never changes the report's actual status past
--    'explained' (that's still admin-only), so it can't itself hide the
--    report from moderation, but it pollutes the audit trail of who
--    resolved what and when. Verified against a real local Postgres
--    instance: reproduced the forgery first (resolved_at/resolved_by
--    took the teacher's fabricated values), then confirmed this fix
--    (resetting both back to their old value for any non-admin update)
--    blocks it while a genuine admin resolution still sets them
--    correctly afterwards.
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

  new.resolved_at := old.resolved_at;
  new.resolved_by := old.resolved_by;
  new.explained_at := now();
  return new;
end;
$$;
