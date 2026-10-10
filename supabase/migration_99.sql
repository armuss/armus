-- ARMUS migration 99: a temporary, auto-expiring throttle on repeated
-- failed logins for ONE email address - closes the gap of unlimited
-- password-guessing against any known account email (armusSignIn used
-- to call Supabase Auth's signInWithPassword directly from the client
-- with nothing else in front of it).
--
-- Deliberately a short, auto-resetting window (6 failed attempts / 15
-- minutes, reset immediately on a successful login) rather than a hard
-- account lock an admin has to clear - a long/permanent lock keyed only
-- by email is itself a denial-of-service vector (anyone who knows a
-- teacher's email could lock them out of their own account on demand
-- just by failing their password a few times). This still meaningfully
-- blocks automated password-guessing (which needs hundreds/thousands of
-- tries, not 6) while bounding the worst case for a legitimate user to
-- "wait 15 minutes."
--
-- reserve_login_attempt/resolve_login_attempt are two separate calls
-- (not one plain check-then-insert) so the reservation itself happens
-- atomically, under a per-email advisory lock, BEFORE the real password
-- check runs - a flood of concurrent requests for the same email is
-- fully serialized through that lock, so concurrency can't be used to
-- slip more than 6 attempts past the count (same race class
-- claim_verification_send already guards against for verification-code
-- sends).
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create table if not exists login_attempts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  succeeded boolean not null default false,
  created_at timestamptz not null default now()
);

alter table login_attempts enable row level security;
-- no policies - this table is only ever touched by the SECURITY DEFINER
-- functions below (called via the service-role client inside the
-- login-with-throttle Edge Function), never directly by any client

create index if not exists login_attempts_email_created_idx on login_attempts(email, created_at);

create or replace function public.reserve_login_attempt(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_failures int;
  new_id uuid;
  normalized_email text := lower(p_email);
begin
  perform pg_advisory_xact_lock(hashtext(normalized_email));

  select count(*) into recent_failures
  from login_attempts
  where email = normalized_email
    and succeeded = false
    and created_at > now() - interval '15 minutes';

  if recent_failures >= 6 then
    return null;
  end if;

  insert into login_attempts (email, succeeded) values (normalized_email, false)
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.resolve_login_attempt(p_id uuid, p_succeeded boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_email text;
begin
  update login_attempts set succeeded = p_succeeded where id = p_id
  returning email into target_email;

  if p_succeeded and target_email is not null then
    delete from login_attempts
    where email = target_email
      and succeeded = false
      and id <> p_id;
  end if;
end;
$$;
