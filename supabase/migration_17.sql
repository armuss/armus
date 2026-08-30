-- Migration 17: student panel additions - vocabulary vault and
-- post-lesson speaking confidence check-ins.
--
-- Both tables are entirely student-owned (a student's private word
-- bank / self-ratings, not visible to their teacher or anyone else),
-- so a single "own rows only" policy covers every operation.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

-- === VOCABULARY VAULT ============================================
-- A student's personal word/phrase bank with a lightweight leveled
-- review schedule (see armusIsVocabDue in student-dashboard.html):
-- review_count 0 is due immediately, and each successful review pushes
-- the next due date further out.

create table vocab_entries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  term text not null,
  meaning text not null,
  review_count integer not null default 0,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table vocab_entries enable row level security;

create policy "vocab_entries_all_own"
  on vocab_entries for all
  using (auth.uid() = student_id)
  with check (auth.uid() = student_id);

-- === SPEAKING CONFIDENCE CHECK-INS ================================
-- A quick 1-5 self-rating a student can leave once per completed
-- lesson ("bugün ne kadar rahat konuştun?"), charted as a trend over
-- time on the student panel.

create table confidence_checkins (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  unique (student_id, booking_id)
);

alter table confidence_checkins enable row level security;

create policy "confidence_checkins_all_own"
  on confidence_checkins for all
  using (auth.uid() = student_id)
  with check (auth.uid() = student_id);
