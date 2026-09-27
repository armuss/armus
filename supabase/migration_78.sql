-- ARMUS migration 78: makes send-verification-email's resend cooldown +
-- daily cap atomic.
--
-- send-verification-email checked its 45-second resend cooldown and
-- 8-per-day cap with a plain SELECT, then INSERTed the new code
-- afterward as a separate call - two concurrent invocations for the same
-- user_id (a double-click racing past the client-side "disabled" class
-- before it's applied, or a script firing the resend request twice) can
-- both run the SELECT before either INSERT lands, both see the same
-- (or no) prior row, and both proceed - the cooldown doesn't actually
-- hold under concurrent requests. Since profiles.email is set at signup
-- from whatever the signup form was given and never re-verified against
-- a real inbox first, this endpoint is reachable by signing up with a
-- victim's email address - the cooldown existing is what's supposed to
-- keep that from being a fast email-bomb cannon against them.
--
-- pg_advisory_xact_lock serializes concurrent calls for the same
-- user_id: the second caller blocks until the first's transaction
-- (which now does the whole check-then-insert atomically, all inside
-- this one function) completes, then correctly sees the row the first
-- call just inserted.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor, THEN
-- redeploy send-verification-email with its updated code.

create or replace function public.claim_verification_send(
  p_user_id uuid,
  p_code text,
  p_expires_at timestamptz
)
returns text  -- null on success (the row was inserted); 'cooldown' or 'daily_cap' if rejected
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent timestamptz;
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select created_at into v_recent
    from email_verifications
    where user_id = p_user_id
    order by created_at desc
    limit 1;

  if v_recent is not null and (now() - v_recent) < interval '45 seconds' then
    return 'cooldown';
  end if;

  select count(*) into v_count
    from email_verifications
    where user_id = p_user_id
      and created_at >= now() - interval '24 hours';

  if v_count >= 8 then
    return 'daily_cap';
  end if;

  insert into email_verifications (user_id, code, expires_at)
  values (p_user_id, p_code, p_expires_at);

  return null;
end;
$$;

-- deliberately NOT granted to anon/authenticated - only reachable over a
-- service-role connection (send-verification-email already uses
-- SUPABASE_SERVICE_ROLE_KEY), same as mark_email_verified() (migration_77.sql).
revoke all on function public.claim_verification_send(uuid, text, timestamptz) from public, anon, authenticated;
