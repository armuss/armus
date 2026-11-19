-- ARMUS migration 121: two teacher-side fixes.
--
-- A. A teacher's profile edit can be approved again.
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
-- B. A trial no-show hide the teacher may lift themselves ("Profilimi
--    Görünür Yap", self_unhide_from_new_students) was refused while ANY
--    of their reports waited for review. Since migration_112.sql only a
--    no-show report hides a teacher - a late or technical one is a
--    warning - so only an open/explained no-show report blocks it now.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

-- === A. pending_changes.submitted_at ===

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

-- === B. self_unhide_from_new_students ===
-- unchanged from migration_104.sql except "and type = 'no_show'"

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
      and type = 'no_show'
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
