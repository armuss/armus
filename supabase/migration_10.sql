-- Migration 10: teacher dashboard additions (online-now toggle, monthly
-- income goal, private per-student notes).
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to run once; running it a second time will fail on "already
-- exists" errors, which is expected.
--
-- Note: is_online and income_goal are deliberately NOT in the list of
-- fields the profiles_lock_teacher_fields trigger blocks, so a teacher
-- can update them directly (armusUpdateOwnProfile) without going through
-- admin-approved pending_changes - that's the point, they're personal/
-- live-status fields, not public marketplace listing content.

alter table profiles add column is_online boolean not null default false;
alter table profiles add column income_goal numeric;

-- === PRIVATE PER-STUDENT NOTES ===================================
-- A teacher's private notes about a specific student (e.g. "weak on
-- past tense, focus next lesson") - never shown to the student or
-- anyone else.

create table teacher_notes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique (teacher_id, student_id)
);

alter table teacher_notes enable row level security;

create policy "teacher_notes_select_own"
  on teacher_notes for select
  using (auth.uid() = teacher_id);

create policy "teacher_notes_write_own"
  on teacher_notes for all
  using (auth.uid() = teacher_id)
  with check (auth.uid() = teacher_id);
