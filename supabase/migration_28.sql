-- Migration 28: lesson credits (replaces wallet-balance refunds).
--
-- The wallet feature (balance/top-up/spend-at-checkout) is on hold for now
-- (see ARMUS_WALLET_ENABLED in auth.js) - its tables stay untouched. This
-- migration adds a separate, simpler mechanism for what a cancellation
-- refund actually does going forward: instead of crediting money, it
-- grants one "lesson credit" tied to the teacher of the cancelled lesson.
--
--   - booking a new lesson (trial or regular) with that SAME teacher:
--     the credit covers it fully, no charge at all
--   - booking with a DIFFERENT teacher: the credit only covers a trial
--     lesson with them, not a full-price lesson
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run,
-- then redeploy cancel-booking and create-payment (see their file headers
-- for the updated code).

create table lesson_credits (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  teacher_id text not null,
  teacher_name text not null,
  status text not null default 'available' check (status in ('available', 'used')),
  source_booking_id uuid references bookings(id) on delete set null,
  used_booking_id uuid references bookings(id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

alter table lesson_credits enable row level security;

create policy "lesson_credits_select_own" on lesson_credits
  for select
  using (auth.uid() = student_id);
