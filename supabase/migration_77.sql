-- ARMUS migration 77: closes an unprotected-column gap that let any
-- authenticated user bypass the entire email-verification mechanism.
--
-- profiles.email and profiles.email_verified were never included in
-- enforce_teacher_profile_lock's protected-column checks, even though
-- profiles_update_own_or_admin's RLS lets a user update ANY column on
-- their own row (same class of bug the is_admin/role/status locks below
-- already exist to close). Concretely:
--   - Any user could set their own email_verified = true directly, with
--     a plain client update, without ever receiving or entering a
--     verification code - defeating verify-email-code/
--     send-verification-email entirely (their code entropy, expiry,
--     attempt caps, resend rate limit - none of it matters if the
--     outcome can just be set directly).
--   - Any user could rewrite their own profiles.email to an arbitrary
--     string. profiles.email (NOT auth.users.email, which stays the
--     real, Supabase-Auth-verified address, used for login/password
--     reset, and is completely unaffected by this) is what
--     create-payment/payment-callback/send-message-notification etc.
--     actually read when emailing a TEACHER about their own bookings/
--     messages - so a teacher pointing their own profiles.email at
--     someone else's real inbox would redirect every future
--     notification meant for them to that victim instead.
--
-- Fix: lock both columns the same way role/is_admin already are.
-- profiles.email is never legitimately rewritten after signup (set once
-- in handle_new_user from auth.users.email) so it's locked outright, no
-- exception needed. profiles.email_verified needs exactly one legitimate
-- writer - verify-email-code - so that Edge Function now goes through
-- the new mark_email_verified() RPC below instead of a raw table
-- update, using the same set_config() escape-hatch pattern the
-- attendance-report system already uses for its own trusted
-- server-side writes (see the armus.attendance_system_update check just
-- above the new one this adds).
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor, THEN
-- redeploy verify-email-code with its updated code (the RPC call
-- replacing the raw .update()). Running this migration before that
-- redeploy just means email verification fails closed (rejected by the
-- trigger) until the redeploy catches up - safer than the reverse order.

create or replace function public.mark_email_verified(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('armus.email_verification_update', 'on', true);
  update profiles set email_verified = true where id = p_user_id;
end;
$$;

-- deliberately NOT granted to anon/authenticated - only reachable over a
-- service-role connection (verify-email-code already uses
-- SUPABASE_SERVICE_ROLE_KEY), the same way a plain client could never
-- set armus.attendance_system_update itself either.
revoke all on function public.mark_email_verified(uuid) from public, anon, authenticated;

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

  -- set by the attendance-report system (migration_41.sql) right before
  -- it writes hidden_from_new_students/hidden_until/is_banned on behalf
  -- of whichever student's report or admin's resolution triggered it -
  -- lets that one trusted, server-side write through without needing to
  -- be an admin itself
  if coalesce(current_setting('armus.attendance_system_update', true), '') = 'on' then
    return new;
  end if;

  -- set only by mark_email_verified() above - never by a plain client
  -- update, which is exactly the gap this migration closes
  if coalesce(current_setting('armus.email_verification_update', true), '') = 'on' then
    return new;
  end if;

  if new.is_admin is distinct from old.is_admin then
    raise exception 'admin_lock: is_admin can only be changed by an admin';
  end if;

  -- role is set once, at signup (handle_new_user, from the auth metadata
  -- armusSignUp passes in) and never written again by any legitimate app
  -- code path - apply-teacher.html only ever sets status/title/price/etc,
  -- never role. Without this lock, a plain student could self-promote to
  -- role = 'teacher' with a bare client update, which lets them pass
  -- conversations_insert_participant's role checks and fabricate a
  -- conversation naming any real student as the other party - masking
  -- as a fake teacher to talk to a student who'd normally never see
  -- them in the marketplace.
  if new.role is distinct from old.role then
    raise exception 'role_lock: role can only be changed by an admin';
  end if;

  -- set once at signup from auth.users.email (handle_new_user) and never
  -- legitimately written again - see this migration's header for why an
  -- unlocked profiles.email is a real notification-hijack vector, not
  -- just a cosmetic mismatch.
  if new.email is distinct from old.email then
    raise exception 'email_lock: email can only be changed by an admin';
  end if;

  -- only mark_email_verified() (service-role only, see above) may flip
  -- this - a plain client setting it directly would skip verification
  -- entirely.
  if new.email_verified is distinct from old.email_verified then
    raise exception 'email_verified_lock: email_verified can only be set by the verification system';
  end if;

  if new.status is distinct from old.status and new.status is distinct from 'pending' then
    raise exception 'status_lock: only an admin can approve or reject an application';
  end if;

  if new.hidden_from_new_students is distinct from old.hidden_from_new_students
    or new.hidden_reason is distinct from old.hidden_reason
    or new.hidden_at is distinct from old.hidden_at
    or new.hidden_until is distinct from old.hidden_until
    or new.is_banned is distinct from old.is_banned
    or new.banned_at is distinct from old.banned_at
  then
    raise exception 'attendance_lock: these fields can only be changed by the attendance-report system or an admin';
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

  -- pending_changes is itself just a jsonb blob a teacher writes to their
  -- own row, and admin.html's approval handler spreads its contents
  -- straight into the profile on approve (minus submitted_at) - without
  -- this check a non-admin could smuggle keys like is_admin or status into
  -- it that the review UI never renders, so an admin approving what looks
  -- like a harmless bio/price edit would silently apply them too
  if new.pending_changes is distinct from old.pending_changes and new.pending_changes is not null then
    if exists (
      select 1 from jsonb_object_keys(new.pending_changes) as k
      where k not in ('submitted_at', 'title', 'price', 'availability', 'bio', 'weekly_availability')
    ) then
      raise exception 'pending_changes_lock: pending_changes may only contain submitted_at, title, price, availability, bio, or weekly_availability';
    end if;
  end if;

  return new;
end;
$$;
