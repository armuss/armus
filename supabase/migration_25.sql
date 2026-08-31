-- Migration 25: cancellation "refunds" go to an in-platform wallet
-- balance instead of back to the card.
--
-- cancel-booking previously called iyzico's refund API to send money
-- back to the original card. Per your instruction, a cancellation that's
-- eligible for money back now credits profiles.wallet_balance instead -
-- nothing goes back to the card. wallet_transactions is a simple audit
-- log (so a balance is never just a bare number with no history behind
-- it) - service role only, same as pending_payments/email_verifications.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run,
-- then redeploy cancel-booking with its updated code (see its file
-- header).

alter table profiles add column if not exists wallet_balance numeric not null default 0;

create table if not exists wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  amount numeric not null,
  reason text not null,
  booking_id uuid references bookings(id),
  created_at timestamptz not null default now()
);

alter table wallet_transactions enable row level security;

create policy "wallet_transactions_select_own" on wallet_transactions
  for select
  using (auth.uid() = student_id);
-- no insert/update/delete policies - only cancel-booking (service role)
-- ever writes here.
