-- Migration 19: real-date availability calendar for teachers.
--
-- Replaces the old "Haftalık Uygunluk" weekly-recurring grid on the
-- teacher dashboard with an actual calendar - a teacher picks a
-- specific date and marks which times they're free that day, not just
-- a repeating Mon-Sun pattern.
--
-- Like is_online/income_goal, this is a live/operational field a
-- teacher needs to update instantly and often, so it's deliberately
-- NOT one of the fields profiles_lock_teacher_fields blocks - no
-- admin-approval round trip for every date change.
--
-- booking.html prefers this when a date has an entry here; if not, it
-- falls back to the old weekly_availability pattern (still set once
-- during the apply-teacher.html signup wizard), and finally to a
-- deterministic mock for demo teachers.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

alter table profiles add column if not exists availability_dates jsonb not null default '{}';
