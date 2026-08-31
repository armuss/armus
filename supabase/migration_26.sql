-- Migration 26: spend wallet balance at checkout.
--
-- create-payment now applies the student's wallet balance against the
-- price first - if it covers the lesson entirely, the booking is
-- created directly with no iyzico step at all; otherwise only the
-- remainder is charged to the card. Either way the wallet is only
-- actually debited once the booking is confirmed (immediately for a
-- wallet-only booking, or in payment-callback once the card charge for
-- the remainder succeeds) - never upfront, so an abandoned/failed
-- checkout can't lose wallet money for nothing.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run,
-- then redeploy create-payment and payment-callback with their updated
-- code (see their file headers).

alter table pending_payments add column if not exists wallet_applied numeric not null default 0;
