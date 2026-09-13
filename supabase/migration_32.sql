-- Migration 32: flashcards get categories and a simple "mastered" flag.
-- Replaces vocab_entries' old due-date review schedule (review_count /
-- last_reviewed_at - those columns are unused now but left in place,
-- no data loss) with something the student drives themselves: tag a
-- word with a category, and mark it known whenever they want.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

alter table vocab_entries add column if not exists category text not null default 'Genel';
alter table vocab_entries add column if not exists mastered boolean not null default false;
