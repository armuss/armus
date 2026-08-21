-- ARMUS migration 3: fix infinite recursion in the admin RLS policy.
-- The old policy queried "profiles" from inside a policy ON profiles,
-- which Postgres re-evaluates recursively and eventually errors out
-- (surfaces as an HTTP 500 on every profile read, even for non-admins).
-- Fix: check admin status through a security-definer function, which
-- runs with elevated privilege and bypasses RLS internally.

drop policy if exists "profiles_select_admin_all" on profiles;
drop policy if exists "profiles_update_own_or_admin" on profiles;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

create policy "profiles_select_admin_all"
  on profiles for select
  using (public.is_admin());

create policy "profiles_update_own_or_admin"
  on profiles for update
  using (auth.uid() = id or public.is_admin());
