-- ARMUS database schema (Supabase / Postgres)
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run

-- === PROFILES ===================================================
-- One row per user, extending Supabase Auth (auth.users).
-- Students only use the first few columns; teacher-only columns
-- stay null until the user applies as a teacher.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null check (role in ('student', 'teacher')),
  is_admin boolean not null default false,

  -- teacher application fields
  country text,
  subject_taught text,
  title text,
  languages jsonb,
  phone text,
  age_confirmed boolean,
  photo_url text,
  has_certificate boolean,
  certificate_name text,
  certificate_years text,
  certificate_file_url text,
  certificate_file_name text,
  has_education boolean,
  university text,
  degree_type text,
  graduation_year text,
  specialization text,
  bio text,
  video_url text,
  availability text,
  price numeric,
  status text check (status in ('pending', 'approved', 'rejected')),
  applied_at timestamptz,
  weekly_availability jsonb,
  pending_changes jsonb,

  created_at timestamptz not null default now()
);

-- === BOOKINGS ====================================================

-- teacher_id is plain text, not a FK: demo teachers (teachers-data.js)
-- aren't real Supabase users, only real self-registered ones are.

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

-- === REVIEWS =====================================================

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

-- === AUTO-CREATE PROFILE ON SIGNUP ===============================
-- Runs whenever someone signs up via Supabase Auth; reads name/role
-- out of the signUp() call's options.data and creates their profile row.

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'student')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- === ROW LEVEL SECURITY ==========================================

alter table profiles enable row level security;
alter table bookings enable row level security;
alter table reviews enable row level security;

-- profiles: anyone can read approved teachers (public marketplace) or their own row
create policy "profiles_select_public_or_own"
  on profiles for select
  using (status = 'approved' or auth.uid() = id);

-- profiles: a user can create only their own row
create policy "profiles_insert_own"
  on profiles for insert
  with check (auth.uid() = id);

-- admin check goes through a security-definer function rather than a
-- raw subquery on profiles - a policy on profiles that subqueries
-- profiles directly makes Postgres re-evaluate RLS recursively and
-- eventually fail (every profile read errors out with a 500), so the
-- admin check has to happen in a function that bypasses RLS instead.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- profiles: a user can update their own row; an admin can update any row
-- (needed so admins can approve/reject teacher applications)
create policy "profiles_update_own_or_admin"
  on profiles for update
  using (auth.uid() = id or public.is_admin());

-- profiles: admins can see every application, not just approved ones
create policy "profiles_select_admin_all"
  on profiles for select
  using (public.is_admin());

-- once approved, a teacher can no longer write the "live" fields
-- directly - only pending_changes, which an admin must approve
create or replace function public.enforce_teacher_profile_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if old.status = 'approved' and (
    new.title is distinct from old.title
    or new.price is distinct from old.price
    or new.availability is distinct from old.availability
    or new.bio is distinct from old.bio
    or new.weekly_availability is distinct from old.weekly_availability
  ) then
    raise exception 'profile_locked: approved profile fields can only change through pending_changes + admin approval';
  end if;

  return new;
end;
$$;

create trigger profiles_lock_teacher_fields
  before update on profiles
  for each row execute procedure public.enforce_teacher_profile_lock();

-- bookings: student or teacher involved in the booking can read it
create policy "bookings_select_participant"
  on bookings for select
  using (auth.uid() = student_id or auth.uid()::text = teacher_id);

-- bookings: admins can read every booking (for the admin panel)
create policy "bookings_select_admin_all"
  on bookings for select
  using (public.is_admin());

-- bookings: a logged-in student can create a booking for themselves
create policy "bookings_insert_own_student"
  on bookings for insert
  with check (auth.uid() = student_id);

-- reviews: readable by everyone (shown on public teacher profiles)
create policy "reviews_select_all"
  on reviews for select
  using (true);

-- reviews: a student can review only their own completed booking
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
