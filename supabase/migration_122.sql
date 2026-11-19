-- ARMUS migration 122: attendance reports and deleting an admin account.
--
-- A. A decided attendance report keeps its outcome.
--
-- admin.html's report list isn't live. Once one admin upheld a report
-- (the lesson refunded, the teacher penalised), a second admin whose
-- page was loaded earlier still saw "Doğrula / Reddet / Asılsız" and
-- could flip it to dismissed - which ran the dismissal branch of
-- handle_attendance_report_resolution on top: the teacher unhidden and,
-- for "Asılsız", a false-report strike against the student (the third
-- closes their account). The outcome of an upheld or dismissed report
-- (status, false_report) and who decided it now stay as they are.
--
-- B. The reported teacher's explanation can't rewrite the report.
--
-- The teacher-side lock listed the report's original columns from
-- migration_41.sql only. The ones migration_112.sql added were left
-- writable by the reported teacher while explaining: tech_side and
-- minutes_held decide whether an upheld technical report refunds the
-- student (teacher's side, under 25 minutes held), so a teacher could
-- turn their own side into the student's and keep the lesson's pay;
-- and false_report is what counts a student's strikes, so a teacher
-- could mark the report against them as false, which upheld or not
-- counted towards closing the student's account.
--
-- C + D. An admin who handled a report or a withdrawal can delete their
-- account.
--
-- delete-account removes the auth user and everything that references
-- the profile is meant to cascade or go null. migration_54.sql made
-- attendance_reports.resolved_by "on delete set null", but that null is
-- written as an UPDATE, which this same trigger refused (a decided
-- report isn't 'open' any more, and the deleting request isn't an
-- admin): "attendance_report_locked", and the account stayed. And
-- message_reports.resolved_by / withdrawal_requests.processed_by had no
-- ON DELETE at all, so an admin who had closed a message report or
-- processed a withdrawal could never delete their account either. The
-- reports and requests stay; only the "which admin" goes null.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

-- === A, B, C. enforce_attendance_report_update ===
-- unchanged from migration_43.sql except the first check (C), the
-- decided-report branch for an admin (A) and the last three columns of
-- the teacher's lock (B)

create or replace function public.enforce_attendance_report_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- C: the resolving admin's profile was deleted ("on delete set null")
  if new.resolved_by is null and old.resolved_by is not null
     and (to_jsonb(new) - 'resolved_by') = (to_jsonb(old) - 'resolved_by') then
    return new;
  end if;

  if public.is_admin() then
    -- A: decided - the outcome and who decided it stay
    if old.status in ('upheld', 'dismissed') then
      if new.status is distinct from old.status or new.false_report is distinct from old.false_report then
        raise exception 'attendance_report_decided: this report has already been resolved';
      end if;
      new.resolved_by := old.resolved_by;
      new.resolved_at := old.resolved_at;
      return new;
    end if;
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
    -- B
    or new.tech_side is distinct from old.tech_side
    or new.minutes_held is distinct from old.minutes_held
    or new.false_report is distinct from old.false_report
  then
    raise exception 'attendance_report_locked: cannot modify the original report';
  end if;

  new.resolved_at := old.resolved_at;
  new.resolved_by := old.resolved_by;
  new.explained_at := now();
  return new;
end;
$$;

-- === D. foreign keys that blocked deleting an admin ===

alter table message_reports drop constraint if exists message_reports_resolved_by_fkey;
alter table message_reports add constraint message_reports_resolved_by_fkey
  foreign key (resolved_by) references profiles(id) on delete set null;

alter table withdrawal_requests drop constraint if exists withdrawal_requests_processed_by_fkey;
alter table withdrawal_requests add constraint withdrawal_requests_processed_by_fkey
  foreign key (processed_by) references profiles(id) on delete set null;
