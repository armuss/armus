-- ARMUS migration 34: close two privilege-escalation holes in
-- profiles_update_own_or_admin (schema.sql) - that policy lets a user
-- update ANY column on their own row (`auth.uid() = id`), and nothing
-- was stopping a signed-in user from writing directly to columns that
-- are supposed to be admin-only:
--
--   1. is_admin - any user could run
--        armusSupabase.from("profiles").update({ is_admin: true }).eq("id", session.id)
--      from the browser console and grant themselves full admin access
--      (admin.html, every other user's data, cancel any booking, etc).
--
--   2. status - a teacher applicant could run the same trick with
--        { status: "approved" }
--      and skip the entire admin review process, going live on the
--      Teachers page instantly with zero vetting.
--
-- Fixes both by extending the existing enforce_teacher_profile_lock
-- trigger (migration_5.sql) instead of adding a new one - it already
-- runs before every profile update and already exempts real admins.
-- The trigger is re-attached automatically since it's defined as
-- CREATE OR REPLACE on the same function name the existing
-- profiles_lock_teacher_fields trigger already points at - no need to
-- touch the trigger itself.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

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

  -- is_admin can only ever be changed by an existing admin - there is
  -- no legitimate self-service path that touches this column at all
  if new.is_admin is distinct from old.is_admin then
    raise exception 'admin_lock: is_admin can only be changed by an admin';
  end if;

  -- status: submitting or resubmitting an application (-> 'pending') is
  -- the one self-service transition a non-admin needs (apply-teacher.html
  -- sets this directly on its own profile row) - moving into 'approved'
  -- or 'rejected' must always go through an admin reviewing the
  -- application in admin.html, never straight from the client
  if new.status is distinct from old.status and new.status is distinct from 'pending' then
    raise exception 'status_lock: only an admin can approve or reject an application';
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
