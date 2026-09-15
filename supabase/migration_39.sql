-- ARMUS migration 39: remove the wallet feature entirely (balance,
-- top-ups, spending it at checkout).
--
-- The wallet was already "on hold" (ARMUS_WALLET_ENABLED = false) and
-- never actually reachable end-to-end - create-payment never read a
-- wallet balance at checkout, so nothing could ever be spent even when a
-- top-up succeeded. It's now fully superseded by lesson_credits
-- (migration_28.sql): when a booking is cancelled eligibly, the student
-- already gets a lesson_credits row ("bir ders hakkı kazandın") they can
-- use to reschedule with that teacher (or, for a trial, any teacher) -
-- exactly the "you're owed one lesson" behavior wanted here, with no
-- wallet/balance involved. That mechanism is untouched by this file.
--
-- SUPERSEDES migration_38.sql - if you haven't run that one yet, skip it
-- and just run this file instead (it covers the same ground and then
-- removes the column it was protecting).
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

-- 1. drop the wallet_balance guard from the shared profile-lock trigger
--    before the column it references disappears
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

  if new.is_admin is distinct from old.is_admin then
    raise exception 'admin_lock: is_admin can only be changed by an admin';
  end if;

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

-- 2. drop the wallet tables (RLS policies on them go with the tables)
--    and the wallet_balance column on profiles
drop table if exists wallet_topups;
drop table if exists wallet_transactions;
alter table profiles drop column if exists wallet_balance;

-- 3. pending_payments.wallet_applied was always 0 in practice -
--    create-payment never set it, the wallet-at-checkout step was never
--    actually wired in end to end
alter table pending_payments drop column if exists wallet_applied;
