-- Migration 27: top up wallet balance directly (not tied to a booking).
--
-- wallet_topups tracks a real iyzico charge whose only purpose is to add
-- money to profiles.wallet_balance - same pending-row-first pattern as
-- pending_payments (create-wallet-topup creates it, wallet-topup-callback
-- confirms with iyzico before crediting anything).
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run,
-- then deploy the two new Edge Functions (create-wallet-topup,
-- wallet-topup-callback - see their file headers).

create table wallet_topups (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  amount numeric not null,
  iyzico_token text,
  iyzico_payment_id text,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  created_at timestamptz not null default now()
);

alter table wallet_topups enable row level security;
-- no client-facing policies - only the two Edge Functions (service role)
-- ever touch this table.
