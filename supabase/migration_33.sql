-- Migration 33: contact form submissions (iletisim.html).
-- Public, unauthenticated insert-only, mirroring newsletter_subscribers -
-- this is just a durable backup record of what was sent, in case the
-- outbound email (via the send-contact-email Edge Function) ever fails.
-- Nobody but an admin can read the list back.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

create table contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table contact_messages enable row level security;

create policy "contact_messages_insert_anyone" on contact_messages
  for insert
  with check (true);

create policy "contact_messages_select_admin" on contact_messages
  for select
  using (public.is_admin());
