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
  city text,

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
  insert into public.profiles (id, email, name, role, city)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'student'),
    new.raw_user_meta_data->>'city'
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

-- === MESSAGING ====================================================
-- Real-time chat between a student and a real (self-registered)
-- teacher. Demo teachers (teachers-data.js) have no real account, so
-- they're never a valid participant here.

create table conversations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  teacher_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (student_id, teacher_id)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table conversations enable row level security;
alter table messages enable row level security;

create policy "conversations_select_participant"
  on conversations for select
  using (auth.uid() = student_id or auth.uid() = teacher_id);

create policy "conversations_insert_participant"
  on conversations for insert
  with check (auth.uid() = student_id or auth.uid() = teacher_id);

create policy "messages_select_participant"
  on messages for select
  using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
    )
  );

create policy "messages_insert_own"
  on messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
    )
  );

create policy "messages_update_participant"
  on messages for update
  using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
    )
  );

alter publication supabase_realtime add table messages;

-- === ADMIN PANEL EXTRAS ==========================================
-- Booking cancellation from the admin panel, an admin activity log,
-- and homepage testimonials managed from the admin panel.

create policy "bookings_delete_admin"
  on bookings for delete
  using (public.is_admin());

create table admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references profiles(id) on delete cascade,
  admin_name text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  target_label text,
  created_at timestamptz not null default now()
);

alter table admin_actions enable row level security;

create policy "admin_actions_select_admin"
  on admin_actions for select
  using (public.is_admin());

create policy "admin_actions_insert_admin"
  on admin_actions for insert
  with check (public.is_admin() and admin_id = auth.uid());

create table testimonials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  quote text not null,
  rating smallint not null default 5 check (rating between 1 and 5),
  display_order int not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

alter table testimonials enable row level security;

-- anyone (including logged-out visitors on the homepage) can read
-- published testimonials; an admin can also read unpublished ones
create policy "testimonials_select_published_or_admin"
  on testimonials for select
  using (is_published or public.is_admin());

create policy "testimonials_write_admin"
  on testimonials for all
  using (public.is_admin())
  with check (public.is_admin());

-- === LIVE PULSE FEED =============================================
-- Lets the admin panel subscribe to new bookings/signups/reviews in
-- real time (same Realtime feature already used for chat messages).

alter publication supabase_realtime add table bookings;
alter publication supabase_realtime add table profiles;
alter publication supabase_realtime add table reviews;

-- === SITE-WIDE ANNOUNCEMENT BANNER ===============================

create table site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table site_settings enable row level security;

-- readable by everyone, including logged-out visitors, so the banner
-- can show on public pages
create policy "site_settings_select_all"
  on site_settings for select
  using (true);

create policy "site_settings_write_admin"
  on site_settings for all
  using (public.is_admin())
  with check (public.is_admin());

-- === DISPUTE / ISSUE REPORTS ======================================
-- A student or teacher can report a problem with a specific booking;
-- an admin triages and resolves it from the admin panel.

create table disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete set null,
  reporter_id uuid not null references profiles(id) on delete cascade,
  reporter_name text not null,
  reporter_role text not null check (reporter_role in ('student', 'teacher')),
  other_party_name text,
  subject text not null,
  description text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  admin_notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table disputes enable row level security;

create policy "disputes_select_own_or_admin"
  on disputes for select
  using (auth.uid() = reporter_id or public.is_admin());

create policy "disputes_insert_own"
  on disputes for insert
  with check (auth.uid() = reporter_id);

create policy "disputes_update_admin"
  on disputes for update
  using (public.is_admin())
  with check (public.is_admin());

-- === TEACHER DASHBOARD EXTRAS =====================================
-- is_online and income_goal are deliberately NOT in the list of fields
-- the profiles_lock_teacher_fields trigger blocks, so a teacher can
-- update them directly (armusUpdateOwnProfile) without going through
-- admin-approved pending_changes - they're personal/live-status fields,
-- not public marketplace listing content.

alter table profiles add column is_online boolean not null default false;
alter table profiles add column income_goal numeric;

-- a teacher's private notes about a specific student - never shown to
-- the student or anyone else
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
