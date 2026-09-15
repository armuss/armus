-- ARMUS migration 38: lock profiles.wallet_balance from direct client
-- writes, same pattern as migration_34.sql's is_admin/status lock.
--
-- profiles_update_own_or_admin (schema.sql) lets a signed-in user update
-- any column on their own row, and nothing was stopping
-- armusSupabase.from("profiles").update({ wallet_balance: 999999 })
-- from the browser console. The wallet checkout flow (create-payment)
-- doesn't currently read wallet_balance at all - the feature is on hold,
-- see ARMUS_WALLET_ENABLED in auth.js - so this has no live payout today,
-- but the moment that flag flips back on, a self-inflated balance would
-- be free money. wallet-topup-callback (the only legitimate writer,
-- service role, after a real verified iyzico charge) is unaffected: it
-- runs with no authenticated user (auth.uid() is null), which this
-- explicitly allows.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

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

  if new.wallet_balance is distinct from old.wallet_balance and auth.uid() is not null then
    raise exception 'wallet_locked: wallet_balance can only be changed by a trusted server process';
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
