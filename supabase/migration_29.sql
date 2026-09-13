-- Migration 29: lesson packages (a one-time bulk purchase of N lesson
-- credits with one teacher - e.g. "3 ders/hafta" charges 4 weeks up front
-- and grants 12 lesson_credits (migration_28.sql) for that teacher).
--
-- This is NOT a real recurring subscription - iyzico's subscription API
-- isn't integrated here, and nothing re-charges the card automatically
-- every 4 weeks. It's a single card charge that grants a fixed batch of
-- credits, consumed by create-payment exactly like a cancellation credit
-- already is.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run,
-- then redeploy create-payment and payment-callback (see their file
-- headers for the updated code).

alter table pending_payments drop constraint if exists pending_payments_type_check;
alter table pending_payments add constraint pending_payments_type_check
  check (type in ('trial', 'lesson', 'package'));

-- a package purchase has no specific lesson date/time - it just grants
-- credits, booked later like any other credit-covered lesson
alter table pending_payments alter column lesson_date drop not null;
alter table pending_payments alter column lesson_time drop not null;

-- how many lesson_credits a 'package' type payment grants once it succeeds
alter table pending_payments add column if not exists quantity integer;
