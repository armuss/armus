-- Migration 14: student weekly lesson goal.
--
-- Powers the "haftalık hedef" progress bar on the new student panel
-- (student-dashboard.html) - how many lessons a student wants to take
-- this week, compared against how many they've actually booked. Lives
-- on profiles (not a new table) the same way income_goal does for
-- teachers - a single number a user sets for themselves.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

alter table profiles add column if not exists weekly_lesson_goal integer not null default 3;
