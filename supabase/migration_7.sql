-- Migration 7: admin panel additions.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run,
-- on the live (EU-region) project. Safe to run once; running it a second
-- time will fail on "already exists" errors, which is expected.

-- === 1) Let an admin cancel (delete) a booking from the admin panel =====

create policy "bookings_delete_admin"
  on bookings for delete
  using (public.is_admin());

-- === 2) Admin activity log ==============================================
-- Records approve/reject/change/cancel actions taken from the admin panel.

create table admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references profiles(id) on delete cascade,
  admin_name text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  target_label text,
  created_at timestamptz not null default now()
);

alter table admin_actions enable row level security;

create policy "admin_actions_select_admin"
  on admin_actions for select
  using (public.is_admin());

create policy "admin_actions_insert_admin"
  on admin_actions for insert
  with check (public.is_admin() and admin_id = auth.uid());

-- === 3) Homepage testimonials, managed from the admin panel =============

create table testimonials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  quote text not null,
  rating smallint not null default 5 check (rating between 1 and 5),
  display_order int not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

alter table testimonials enable row level security;

-- anyone (including logged-out visitors on the homepage) can read
-- published testimonials; an admin can also read unpublished ones
create policy "testimonials_select_published_or_admin"
  on testimonials for select
  using (is_published or public.is_admin());

create policy "testimonials_write_admin"
  on testimonials for all
  using (public.is_admin())
  with check (public.is_admin());
