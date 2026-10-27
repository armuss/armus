-- migration_111.sql: phone push notifications for the ARMUS app.
--
-- expo_push_tokens holds one row per phone the app is signed in on: the
-- Expo push token the app gets from expo-notifications
-- (mobile/lib/push.ts). send-push-notification sends to these through
-- Expo's push service alongside the browser push_subscriptions
-- (migration_98.sql) - a new booking (teacher), a new message, and now a
-- "your lesson starts soon" reminder (both sides, sent by
-- send-lesson-reminder). A token Expo reports as gone
-- (DeviceNotRegistered) is deleted there.
--
-- Run once, after migration_110.sql. Safe to re-run.

create table if not exists expo_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  token text not null unique,
  platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table expo_push_tokens enable row level security;

create index if not exists expo_push_tokens_user_id_idx on expo_push_tokens(user_id);

drop policy if exists "expo_push_tokens_select_own" on expo_push_tokens;
create policy "expo_push_tokens_select_own"
  on expo_push_tokens for select
  using (auth.uid() = user_id);

drop policy if exists "expo_push_tokens_delete_own" on expo_push_tokens;
create policy "expo_push_tokens_delete_own"
  on expo_push_tokens for delete
  using (auth.uid() = user_id);

-- The app registers its token through this rather than a plain upsert: a
-- phone someone else used before (signed out without the app getting the
-- chance to remove its row, or a reinstall that kept the token) would
-- otherwise hold another user's row, which RLS rightly won't let this
-- user overwrite - and the phone would keep getting that other person's
-- notifications. Having the token means having the phone, so the row
-- simply moves to whoever signed in on it last.
create or replace function public.register_expo_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_token is null or p_token !~ '^(Exponent|Expo)PushToken\[[^]]+\]$' then
    raise exception 'invalid push token';
  end if;

  insert into expo_push_tokens (user_id, token, platform)
  values (auth.uid(), p_token, left(p_platform, 20))
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();
end;
$$;

revoke all on function public.register_expo_push_token(text, text) from public, anon;
grant execute on function public.register_expo_push_token(text, text) to authenticated;
