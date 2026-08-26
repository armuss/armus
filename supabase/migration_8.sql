-- Migration 8: creative admin panel additions (live pulse, at-risk
-- detection, announcement banner, disputes, sentiment flags, bulk
-- actions, commission ledger).
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to run once; running it a second time will fail on "already
-- exists" errors, which is expected.
--
-- Note: "at-risk teacher detection", "sentiment-flagged reviews",
-- "bulk approve/reject", and the "commission/payout ledger" are computed
-- entirely in the admin panel's JS from data that's already readable -
-- they need no schema changes and need nothing from this file.

-- === 1) Live pulse feed ==================================================
-- Lets the admin panel subscribe to new bookings/signups/reviews in real
-- time (same Realtime feature already used for chat messages).

alter publication supabase_realtime add table bookings;
alter publication supabase_realtime add table profiles;
alter publication supabase_realtime add table reviews;

-- === 2) Site-wide announcement banner ===================================

create table site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table site_settings enable row level security;

-- readable by everyone, including logged-out visitors, so the banner can
-- show on public pages
create policy "site_settings_select_all"
  on site_settings for select
  using (true);

create policy "site_settings_write_admin"
  on site_settings for all
  using (public.is_admin())
  with check (public.is_admin());

-- === 3) Dispute / issue reports ==========================================
-- A student or teacher can report a problem with a specific booking;
-- an admin triages and resolves it from the admin panel.

create table disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete set null,
  reporter_id uuid not null references profiles(id) on delete cascade,
  reporter_name text not null,
  reporter_role text not null check (reporter_role in ('student', 'teacher')),
  other_party_name text,
  subject text not null,
  description text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  admin_notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table disputes enable row level security;

create policy "disputes_select_own_or_admin"
  on disputes for select
  using (auth.uid() = reporter_id or public.is_admin());

create policy "disputes_insert_own"
  on disputes for insert
  with check (auth.uid() = reporter_id);

create policy "disputes_update_admin"
  on disputes for update
  using (public.is_admin())
  with check (public.is_admin());
