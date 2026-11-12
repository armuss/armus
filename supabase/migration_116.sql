-- ARMUS migration 116: owners, a level above admins.
--
-- The two people who own the company use the admin panel too, but they
-- are not "admins" in the sense the admin log is about: the log
-- (migration_115.sql) exists so the owners can see what the admins they
-- appoint do. Until now there was only is_admin, so an owner and an
-- admin were the same thing - every admin could read the whole log,
-- make new admins, or close an owner's account.
--
-- profiles.is_owner marks an owner. An owner is also an admin
-- (is_admin stays true, so every existing admin rule still applies to
-- them). On top of that:
--
--   1. Only an owner can read the admin log. Admins still write their
--      own rows to it, but can't see it.
--   2. Only an owner can give or remove admin rights.
--   3. An admin can't change an owner's account (close it, lock it,
--      change its role or email).
--   4. Nobody can make an owner from the browser, not even an owner -
--      that is done here, in the SQL editor.
--   5. Owner changes are logged like admin-rights changes are.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
-- It makes nobody an owner by itself - see the note at the end.

alter table profiles add column if not exists is_owner boolean not null default false;

-- same shape as public.is_admin(), for the same reason (a policy on
-- profiles can't subquery profiles directly)
create or replace function public.is_owner()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_owner from profiles where id = auth.uid()), false);
$$;

-- 2, 3, 4. A trigger of its own rather than more branches in
-- enforce_teacher_profile_lock: that one lets every admin through at
-- its first line, and these rules are exactly the ones an admin must
-- not get past. auth.uid() is null in the SQL editor, where the people
-- who own the database work - nothing here applies there.
create or replace function public.enforce_owner_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.is_owner is distinct from old.is_owner then
    raise exception 'owner_lock: an owner can only be set in the database';
  end if;

  if public.is_owner() then
    return new;
  end if;

  if new.is_admin is distinct from old.is_admin then
    raise exception 'admin_lock: only an owner can give or remove admin rights';
  end if;

  -- an owner's own edits to their own row are covered by the usual
  -- profile rules; anyone else is an admin reaching into it
  if old.is_owner and auth.uid() <> old.id then
    raise exception 'owner_lock: an admin cannot change an owner''s account';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_enforce_owner_lock on profiles;
create trigger profiles_enforce_owner_lock
  before update on profiles
  for each row execute procedure public.enforce_owner_lock();

-- 1. the log is the owners' to read
drop policy if exists "admin_actions_select_admin" on admin_actions;
drop policy if exists "admin_actions_select_owner" on admin_actions;
create policy "admin_actions_select_owner"
  on admin_actions for select
  using (public.is_owner());

-- 5. owner changes go into the log next to admin-rights changes
-- (replaces migration_115.sql's version of this function and trigger)
create or replace function public.log_admin_rights_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.is_admin is distinct from old.is_admin then
      insert into admin_actions (admin_id, admin_name, action, target_type, target_id, target_label)
      values (
        auth.uid(), 'Supabase',
        case when new.is_admin then 'admin_grant' else 'admin_revoke' end,
        'profile', new.id::text, new.name
      );
    end if;
    if new.is_owner is distinct from old.is_owner then
      insert into admin_actions (admin_id, admin_name, action, target_type, target_id, target_label)
      values (
        auth.uid(), 'Supabase',
        case when new.is_owner then 'owner_grant' else 'owner_revoke' end,
        'profile', new.id::text, new.name
      );
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists profiles_log_admin_rights on profiles;
create trigger profiles_log_admin_rights
  after update on profiles
  for each row
  when (old.is_admin is distinct from new.is_admin or old.is_owner is distinct from new.is_owner)
  execute procedure public.log_admin_rights_change();

-- Making someone an owner (and an admin, if they aren't one yet) is done
-- here in the SQL editor, with the profile lock off for that one change:
--
--   begin;
--   alter table public.profiles disable trigger profiles_lock_teacher_fields;
--   update public.profiles set is_admin = true, is_owner = true
--     where lower(email) in (lower('first@example.com'), lower('second@example.com'));
--   alter table public.profiles enable trigger profiles_lock_teacher_fields;
--   commit;
