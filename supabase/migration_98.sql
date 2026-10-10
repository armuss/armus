-- ARMUS migration 98: real browser push notifications (Web Push API) for
-- a teacher's new bookings and new messages - unlike every other
-- notification so far, this reaches the teacher even when ARMUS isn't
-- open in any tab (a service worker, registered once, keeps listening).
--
-- push_subscriptions stores what navigator.serviceWorker.ready.pushManager
-- .subscribe() returns (endpoint + the two public keys a push service
-- needs to encrypt payloads for this exact device/browser) - see
-- push-notifications.js and sw.js. user_id (not "teacher_id") since the
-- mechanism itself is generic to any profile, even though only
-- dashboard.html's teacher-facing "Bildirimler" section offers the
-- subscribe toggle today.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

create index if not exists push_subscriptions_user_id_idx on push_subscriptions(user_id);

drop policy if exists "push_subscriptions_select_own" on push_subscriptions;
create policy "push_subscriptions_select_own"
  on push_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "push_subscriptions_insert_own" on push_subscriptions;
create policy "push_subscriptions_insert_own"
  on push_subscriptions for insert
  with check (auth.uid() = user_id);

-- lets the client armusSupabase.from("push_subscriptions").upsert(...,
-- {onConflict:"endpoint"}) when the SAME browser subscribes again
-- (push services sometimes rotate a subscription's endpoint/keys)
drop policy if exists "push_subscriptions_update_own" on push_subscriptions;
create policy "push_subscriptions_update_own"
  on push_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_delete_own" on push_subscriptions;
create policy "push_subscriptions_delete_own"
  on push_subscriptions for delete
  using (auth.uid() = user_id);

-- fires a push to the teacher on a new booking - mirrors
-- notify_new_message below but needs its OWN trigger since bookings has
-- no notification trigger at all yet (the "booking confirmed" EMAIL is
-- sent inline by payment-callback/create-payment instead of via a
-- trigger). bookings.teacher_id is text (demo teachers aren't real
-- profiles) - the edge function checks it's a real uuid before looking
-- up push_subscriptions, the same isUuid guard cancel-booking/
-- payment-callback/send-lesson-reminder already use for this column.
create or replace function public.notify_push_new_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-push-notification',
    headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
    body := jsonb_build_object('type', 'booking_new', 'booking_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists bookings_notify_push on bookings;
create trigger bookings_notify_push
  after insert on bookings
  for each row execute procedure public.notify_push_new_booking();

-- extends the existing new-message trigger (migration_62.sql) with a
-- second, independent http_post to the new push function - same message
-- row, same trigger, no new trigger needed on `messages`.
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-message-notification',
    headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
    body := jsonb_build_object('message_id', new.id)
  );
  perform net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-push-notification',
    headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
    body := jsonb_build_object('type', 'message_new', 'message_id', new.id)
  );
  return new;
end;
$$;
