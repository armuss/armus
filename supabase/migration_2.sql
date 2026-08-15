-- ARMUS migration 2: admin visibility, denormalized names, and
-- looser teacher_id (demo teachers aren't real Supabase users, so
-- teacher_id can't always be a strict FK to profiles).
-- Run this in SQL Editor after schema.sql. Safe to run even though
-- bookings/reviews are recreated - both tables are still empty.

alter table profiles add column certificate_file_name text;

-- languages need to hold {language, level} objects, not plain strings
alter table profiles drop column languages;
alter table profiles add column languages jsonb;

-- admins need to see pending/rejected applications too, not just approved ones
create policy "profiles_select_admin_all"
  on profiles for select
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );

drop table if exists reviews;
drop table if exists bookings;

create table bookings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  student_name text not null,
  teacher_id text not null,
  teacher_name text not null,
  type text not null check (type in ('trial', 'lesson')),
  lesson_date date not null,
  lesson_time text not null,
  price numeric not null,
  created_at timestamptz not null default now()
);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id) on delete cascade,
  teacher_id text not null,
  student_id uuid not null references profiles(id) on delete cascade,
  student_name text not null,
  stars smallint not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

alter table bookings enable row level security;
alter table reviews enable row level security;

create policy "bookings_select_participant"
  on bookings for select
  using (auth.uid() = student_id or auth.uid()::text = teacher_id);

create policy "bookings_insert_own_student"
  on bookings for insert
  with check (auth.uid() = student_id);

create policy "reviews_select_all"
  on reviews for select
  using (true);

create policy "reviews_insert_own_student"
  on reviews for insert
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from bookings b
      where b.id = booking_id
        and b.student_id = auth.uid()
        and b.lesson_date < current_date
    )
  );
