-- migration_129.sql: signing out of the app always takes the phone off the
-- account's push notifications.
--
-- The app removed its expo_push_tokens row on sign-out with a plain
-- delete, which RLS only allows while still signed in. When that delete
-- didn't go through (no network at that moment) or the app was signed out
-- without its own sign-out running (the session ended on the server), the
-- row stayed, and the signed-out phone kept getting that person's lesson
-- and message notifications - message previews included - until someone
-- else signed in on it.
--
-- unregister_expo_push_token deletes the row for a token, signed in or
-- not, so the app can also do it afterwards (it keeps the token and tries
-- again). Same reasoning as register_expo_push_token (migration_111.sql):
-- the token is only known to the phone, Expo and this database, so having
-- it means having the phone.
--
-- Run once, after migration_111.sql. Safe to re-run. The app falls back to
-- the old delete until this has been run.

create or replace function public.unregister_expo_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or p_token !~ '^(Exponent|Expo)PushToken\[[^]]+\]$' then
    return;
  end if;
  delete from expo_push_tokens where token = p_token;
end;
$$;

revoke all on function public.unregister_expo_push_token(text) from public;
grant execute on function public.unregister_expo_push_token(text) to anon, authenticated;
