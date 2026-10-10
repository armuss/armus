-- ARMUS migration 96: let a teacher block a specific student from ever
-- booking them again - for a student who was abusive, a repeat no-show,
-- etc. This is teacher-initiated and scoped to that one teacher, unlike
-- profiles.is_banned (platform-wide, admin-only).
--
-- Enforcement has to live in a BEFORE INSERT trigger on bookings, not
-- an insert RLS policy: bookings has no client-facing insert policy at
-- all (every booking is created by a service-role Edge Function -
-- payment-callback after a real charge, or create-payment's
-- credit-covered path - see migration_22.sql), so RLS can't be the
-- choke point. A trigger fires for service-role inserts too, same as
-- messages_block_contact_sharing/enforce_no_contact_sharing further
-- down this file (migration_16.sql) which this mirrors.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create table if not exists blocked_students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  blocked_at timestamptz not null default now(),
  unique (teacher_id, student_id)
);

alter table blocked_students enable row level security;

drop policy if exists "blocked_students_select_own" on blocked_students;
create policy "blocked_students_select_own"
  on blocked_students for select
  using (auth.uid() = teacher_id);

drop policy if exists "blocked_students_write_own" on blocked_students;
create policy "blocked_students_write_own"
  on blocked_students for all
  using (auth.uid() = teacher_id)
  with check (auth.uid() = teacher_id);

-- teacher_id on bookings is text, not uuid (demo teachers aren't real
-- Supabase users - see the BOOKINGS section's own comment on this), so
-- the join casts blocked_students.teacher_id to text to compare.
create or replace function public.enforce_teacher_block()
returns trigger
language plpgsql
as $$
declare
  is_blocked boolean;
begin

  select exists (
    select 1 from blocked_students bs
    where bs.student_id = new.student_id
      and bs.teacher_id::text = new.teacher_id
  ) into is_blocked;

  if is_blocked then
    raise exception 'teacher_blocked_student: bu ogretmen bu ogrenciyle yeni bir rezervasyonu engellemis';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_enforce_teacher_block on bookings;
create trigger bookings_enforce_teacher_block
  before insert on bookings
  for each row execute procedure public.enforce_teacher_block();
