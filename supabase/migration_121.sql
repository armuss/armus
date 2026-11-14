-- ARMUS migration 121: a teacher's profile edit can be approved again.
--
-- An approved teacher's title/price/bio/languages edits wait in
-- profiles.pending_changes until an admin approves or rejects them.
-- admin.html only does that while pending_changes->>submitted_at still
-- matches what it loaded - its guard against approving a newer edit
-- nobody has looked at yet. But neither the website's teacher panel nor
-- the app ever wrote submitted_at, so that filter became
-- "= 'undefined'", matched no row, and every approve/reject ended in
-- "Bu talep değişmiş, lütfen sayfayı yenile": no teacher's edit could
-- ever go live.
--
--   1. From now on the database stamps submitted_at itself whenever
--      pending_changes is written, so every submission (website, app,
--      an older app version) carries one and a later edit always
--      carries a newer one. dashboard.html also sends one now.
--   2. Edits already waiting get a stamp, so they can be approved or
--      rejected right away instead of waiting for the teacher to send
--      them again.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create or replace function public.stamp_pending_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.pending_changes is not null
     and jsonb_typeof(new.pending_changes) = 'object'
     and new.pending_changes is distinct from old.pending_changes then
    new.pending_changes := new.pending_changes
      || jsonb_build_object('submitted_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;
  return new;
end;
$$;

-- named to fire after profiles_lock_teacher_fields (before-triggers run
-- in name order), which checks the keys the teacher sent - submitted_at
-- is one it already allows
drop trigger if exists profiles_stamp_pending_changes on profiles;
create trigger profiles_stamp_pending_changes
  before update on profiles
  for each row execute procedure public.stamp_pending_changes();

-- the edits already waiting (the flag lets this one data fix through
-- enforce_teacher_profile_lock, e.g. for a banned teacher's old edit)
do $$
begin
  perform set_config('armus.attendance_system_update', 'on', true);

  update profiles
  set pending_changes = pending_changes
    || jsonb_build_object('submitted_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  where pending_changes is not null
    and jsonb_typeof(pending_changes) = 'object'
    and not (pending_changes ? 'submitted_at');

  perform set_config('armus.attendance_system_update', 'off', true);
end;
$$;
