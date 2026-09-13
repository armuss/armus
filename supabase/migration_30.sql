-- Migration 30: lets a teacher (and admins) see lesson_credits tied to
-- them, needed to detect when a trial converted into a real package
-- purchase (see armusTrialCountsAsEarned in bookings.js) so the trial's
-- price can count as real earnings instead of staying with ARMUS by
-- default (see PROJECT_SUMMARY.md's trial-lesson design). Previously
-- only the student themselves could select their own credits
-- (lesson_credits_select_own, migration_28.sql).
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

create policy "lesson_credits_select_teacher" on lesson_credits
  for select
  using (auth.uid()::text = teacher_id);

create policy "lesson_credits_select_admin" on lesson_credits
  for select
  using (public.is_admin());
