-- Migration 23: email verification codes (signup) + lesson reminder
-- emails, both sent via Resend from Edge Functions.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run,
-- then deploy the three Edge Functions (send-verification-email,
-- verify-email-code, send-lesson-reminder - see their file headers for
-- deploy steps and required secrets).

-- === EMAIL VERIFICATION (signup) =================================

alter table profiles add column if not exists email_verified boolean not null default false;

create table if not exists email_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  code text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

alter table email_verifications enable row level security;
-- no client-facing policies on purpose - only the Edge Functions (service
-- role) ever read or write this table.

-- === LESSON REMINDER EMAILS =======================================

alter table bookings add column if not exists reminder_sent boolean not null default false;

-- pg_cron/pg_net are standard Postgres extensions Supabase ships on every
-- project (including free tier) - this enables them if they aren't
-- already. If this line errors, enable them manually first: Dashboard ->
-- Database -> Extensions -> search "pg_cron" and "pg_net" -> Enable.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Runs every 10 minutes: any lesson starting 50-70 minutes from now that
-- hasn't been reminded about yet gets a call to send-lesson-reminder (one
-- HTTP call per matching booking). The Edge Function itself is the one
-- that actually marks reminder_sent = true, and only after the email
-- really went out - so a failed HTTP call here just gets retried on the
-- next run instead of silently skipping that booking forever.
--
-- send-lesson-reminder must have "Verify JWT" turned OFF (same as
-- payment-callback) since this call carries no Supabase auth token.
select cron.schedule(
  'armus-lesson-reminders',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-lesson-reminder',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('booking_id', b.id)
  )
  from bookings b
  where b.reminder_sent = false
    and (b.lesson_date + b.lesson_time::time) between now() + interval '50 minutes' and now() + interval '70 minutes'
  $$
);
