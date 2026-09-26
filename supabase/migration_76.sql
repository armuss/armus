-- ARMUS migration 76: rate-limits client_errors inserts.
--
-- client_errors_insert_anyone (migration_72.sql) only ever checked
-- "user_id is null or user_id = auth.uid())" - literally anyone,
-- including a fully anonymous caller, can insert unlimited rows
-- (message up to 2000 chars, stack up to 8000 chars) with a direct
-- REST call, no login and no rate limit at all. Every other
-- unauthenticated-writable table in this schema has some kind of cap
-- (contact_messages/site_chat_logs: IP-based, in their Edge Functions;
-- messages: 120/hour per sender, migration_69.sql) - this was the one
-- gap, and unlike those, a caller here doesn't even need to go through
-- an Edge Function to hit it, so IP-based limiting isn't an option (RLS
-- has no access to request headers).
--
-- Instead this throttles by CONTENT: the same (message, page_url) pair
-- can be inserted at most 20 times in a rolling 10-minute window. That
-- specifically stops a script flooding identical/near-identical junk
-- rows, while a real incident (many visitors hitting the same broken
-- deploy) still gets through - 20 samples in 10 minutes is already
-- plenty for an admin to see the pattern, and a real multi-page outage
-- produces multiple distinct (message, page_url) pairs, each with its
-- own allowance.
--
-- The count has to run as a security-definer function rather than an
-- inline subquery in the policy: client_errors_select_admin restricts
-- SELECT to admins only, so a plain subquery inside a non-admin
-- caller's own INSERT check would see zero rows (blocked by that same
-- SELECT policy) and never actually throttle anyone. Same reasoning as
-- resolve_referral_code() (migration_71.sql) needing security definer
-- to read a profiles row the caller has no direct SELECT access to.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create or replace function public.client_errors_recent_count(p_message text, p_page_url text)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int from client_errors
  where message = p_message
    and page_url is not distinct from p_page_url
    and created_at > now() - interval '10 minutes'
$$;

grant execute on function public.client_errors_recent_count(text, text) to anon, authenticated;

drop policy if exists "client_errors_insert_anyone" on client_errors;
create policy "client_errors_insert_anyone"
  on client_errors for insert
  with check (
    (user_id is null or user_id = auth.uid())
    and public.client_errors_recent_count(message, page_url) < 20
  );
