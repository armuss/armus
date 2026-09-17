-- Fixes attendance_reports.resolved_by having no ON DELETE behavior at
-- all (defaults to NO ACTION). delete-account (service role, via
-- supabase.auth.admin.deleteUser) explicitly assumes every table
-- referencing profiles(id) cascades, needing no manual cleanup - true
-- everywhere else, but not here: any admin who had ever resolved even
-- one attendance report could never delete their own account - the
-- delete would hit this foreign key and fail every single time, with no
-- way to clear the blocker from inside the app.
--
-- Verified by reproducing the exact failure against a local Postgres
-- instance (an admin who resolved a report tries to delete their own
-- profile -> "violates foreign key constraint attendance_reports_resolved_by_fkey"),
-- then confirming this fix resolves it cleanly (the report and its
-- resolution stay intact, only resolved_by goes null) - same pattern
-- already used by disputes.booking_id / lesson_credits.source_booking_id
-- for "keep the record, drop the now-dangling reference".

alter table attendance_reports drop constraint if exists attendance_reports_resolved_by_fkey;
alter table attendance_reports add constraint attendance_reports_resolved_by_fkey
  foreign key (resolved_by) references profiles(id) on delete set null;
