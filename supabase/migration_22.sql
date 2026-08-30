-- Migration 22: real payments via iyzico (Checkout Form).
--
-- Bookings used to be written straight to the "bookings" table the
-- moment a student clicked "Onayla" - no money ever actually changed
-- hands. This adds a pending_payments table that sits in front of it:
-- the create-payment Edge Function writes a row here and sends the
-- student to iyzico's hosted checkout; only the payment-callback Edge
-- Function (after re-checking the charge with iyzico itself) turns a
-- pending_payments row into a real "bookings" row.
--
-- No RLS policies are defined here on purpose - both Edge Functions use
-- the service role key, which bypasses RLS entirely, and no client-side
-- code should ever read or write this table directly (with RLS on and
-- zero policies, the default-deny leaves it completely inaccessible to
-- the anon/authenticated roles).
--
-- Also drops bookings_insert_own_student: now that payment happens
-- first, a booking is only ever supposed to be created by
-- payment-callback (service role, after confirming the charge with
-- iyzico) - leaving the old policy in place would let anyone with a
-- login insert a "paid" booking straight through the API for free,
-- skipping checkout entirely.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run,
-- then deploy the two Edge Functions (see their own file headers for
-- deploy steps and required secrets).

drop policy if exists "bookings_insert_own_student" on bookings;

create table pending_payments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique,
  iyzico_token text,
  student_id uuid not null references profiles(id) on delete cascade,
  student_name text not null,
  teacher_id text not null,
  teacher_name text not null,
  type text not null check (type in ('trial', 'lesson')),
  lesson_date date not null,
  lesson_time text not null,
  price numeric not null,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'paid_no_booking')),
  booking_id uuid references bookings(id),
  created_at timestamptz not null default now()
);

alter table pending_payments enable row level security;
