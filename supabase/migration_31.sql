-- Migration 31: homepage newsletter signup (footer form on index.html).
-- Public, unauthenticated insert-only - anyone can add their email, but
-- nobody but an admin can read the list back (no scraping other
-- visitors' emails through the anon key).
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

create table newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table newsletter_subscribers enable row level security;

create policy "newsletter_subscribers_insert_anyone" on newsletter_subscribers
  for insert
  with check (true);

create policy "newsletter_subscribers_select_admin" on newsletter_subscribers
  for select
  using (public.is_admin());
