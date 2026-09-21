-- ARMUS migration 72: adds a lightweight, self-hosted client-error log.
--
-- The site had no error monitoring at all - a broken deploy or a JS
-- exception on a real visitor's device was invisible unless they
-- reported it themselves. This isn't a Sentry-style APM (no source maps,
-- no alerting, no dashboards) - it's the smallest useful thing: capture
-- uncaught errors/rejections from every page (see the new block at the
-- bottom of i18n.js, loaded everywhere already) into a table an admin
-- can read, so a recurring error is at least *discoverable* instead of
-- silent.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create table if not exists client_errors (
  id uuid primary key default gen_random_uuid(),
  message text not null check (char_length(message) <= 2000),
  stack text check (stack is null or char_length(stack) <= 8000),
  page_url text,
  user_agent text,
  -- nullable - most JS errors happen to anonymous/logged-out visitors
  -- too, and the insert policy below lets a report go in with no user_id
  -- at all (anon can't set auth.uid()), never with someone ELSE's id
  user_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table client_errors enable row level security;

drop policy if exists "client_errors_insert_anyone" on client_errors;
create policy "client_errors_insert_anyone"
  on client_errors for insert
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "client_errors_select_admin" on client_errors;
create policy "client_errors_select_admin"
  on client_errors for select
  using (public.is_admin());

create index if not exists client_errors_created_at_idx on client_errors (created_at desc);
