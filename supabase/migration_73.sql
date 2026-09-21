-- ARMUS migration 73: site chat assistant log + rate limiting.
--
-- Backs the new "site-chat" Edge Function (floating chat bubble, added
-- to i18n.js so it's on every page). Every exchange is logged here so
-- the Edge Function can rate-limit by IP the same way send-contact-email
-- does (count recent rows), and so an admin can review what visitors
-- are asking. Only the Edge Function (service role) ever writes to this
-- table - there is deliberately no insert policy for anon/authenticated,
-- unlike contact_messages, since nothing legitimate writes a chat log
-- row except the function itself.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create table if not exists site_chat_logs (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  message text not null check (char_length(message) <= 2000),
  reply text check (reply is null or char_length(reply) <= 4000),
  ip_address text,
  user_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table site_chat_logs enable row level security;

drop policy if exists "site_chat_logs_select_admin" on site_chat_logs;
create policy "site_chat_logs_select_admin"
  on site_chat_logs for select
  using (public.is_admin());

create index if not exists site_chat_logs_created_at_idx on site_chat_logs (created_at desc);
create index if not exists site_chat_logs_ip_idx on site_chat_logs (ip_address, created_at desc);
