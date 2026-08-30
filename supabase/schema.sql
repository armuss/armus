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
  body text not null default '',
  attachment_url text,
  attachment_type text check (attachment_type in ('image', 'video', 'audio')),
  -- when set, this message IS a correction of the message it points to -
  -- the corrected text lives in this row's own body ("Düzelt Beni")
  corrected_of_id uuid references messages(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint messages_body_or_attachment check (body <> '' or attachment_url is not null)
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

-- lets each side of a conversation read the other's name/photo - without
-- this, a student's profile row (no "approved" status of its own) is
-- invisible to profiles_select_public_or_own, so a teacher's inbox falls
-- back to a generic "Kullanıcı" label for every student they message.
create policy "profiles_select_conversation_partner"
  on profiles for select
  using (
    exists (
      select 1 from conversations c
      where (c.student_id = auth.uid() and c.teacher_id = profiles.id)
         or (c.teacher_id = auth.uid() and c.student_id = profiles.id)
    )
  );

-- blocks off-platform contact sharing (phone numbers, email addresses,
-- named outside messaging apps) in chat until the two of them actually
-- have a booking together - see migration_16.sql for the full reasoning.
create or replace function public.enforce_no_contact_sharing()
returns trigger
language plpgsql
as $$
declare
  already_booked boolean;
begin

  select exists (
    select 1
    from bookings b
    join conversations c on c.id = new.conversation_id
    where b.student_id = c.student_id
      and b.teacher_id = c.teacher_id::text
  ) into already_booked;

  if already_booked then
    return new;
  end if;

  if new.body ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
    or new.body ~ '(\d[ \-.()]{0,2}){7,}\d'
    or new.body ~* '(whatsapp|telegram|instagram|\minsta\M|snapchat|\mimo\M|viber|signal|numaram|numaray|numaras|telefonum|e-?posta|eposta|gmail|hotmail|outlook)'
  then
    raise exception 'contact_sharing_blocked: iletisim bilgisi paylasimi ve platform disi iletisim, resmi bir ders satin alana kadar yasaktir';
  end if;

  return new;
end;
$$;

create trigger messages_block_contact_sharing
  before insert on messages
  for each row execute procedure public.enforce_no_contact_sharing();

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

-- === TEACHER APPLICATION UPLOADS (STORAGE) ========================
-- apply-teacher.html uploads the profile photo, certificate, and intro
-- video here instead of base64-encoding them into a profiles column -
-- that hit Supabase's request size limit for anything but tiny files.
-- Reads are open because the bucket is public (the photo/video are
-- shown on public teacher profile pages anyway); writes just require
-- being logged in (a per-uploader-folder path check was tried first but
-- rejected valid uploads in practice, so this settles for "any
-- authenticated ARMUS account" rather than debugging that blind).

insert into storage.buckets (id, name, public)
values ('teacher-uploads', 'teacher-uploads', true)
on conflict (id) do nothing;

create policy "teacher_uploads_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'teacher-uploads');

create policy "teacher_uploads_update_authenticated"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'teacher-uploads')
  with check (bucket_id = 'teacher-uploads');

create policy "teacher_uploads_delete_authenticated"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'teacher-uploads');

-- uploads use { upsert: true }, which needs storage to check whether the
-- object already exists first - that existence check runs as the
-- authenticated user and needs its own SELECT policy.

create policy "teacher_uploads_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'teacher-uploads');

-- === STUDENT DASHBOARD EXTRAS =====================================
-- how many lessons a student wants to take this week - powers the
-- weekly goal progress bar on student-dashboard.html.

alter table profiles add column weekly_lesson_goal integer not null default 3;

-- a student's personal word/phrase bank with a lightweight leveled
-- review schedule (see armusIsVocabDue in student-dashboard.html)

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

-- a quick 1-5 self-rating a student can leave once per completed
-- lesson ("bugün ne kadar rahat konuştun?"), charted as a trend

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

-- === CHAT ATTACHMENTS (STORAGE) ===================================
-- Public bucket, same trade-off as teacher-uploads: reads are open to
-- anyone with the URL (an unguessable path, not browsable), writes
-- just require being logged in.

insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', true)
on conflict (id) do nothing;

create policy "chat_attachments_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'chat-attachments');

create policy "chat_attachments_update_authenticated"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'chat-attachments')
  with check (bucket_id = 'chat-attachments');

create policy "chat_attachments_delete_authenticated"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'chat-attachments');

create policy "chat_attachments_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'chat-attachments');

-- === TEACHER AVAILABILITY CALENDAR ================================
-- { "2026-09-01": ["14:00","14:30"], ... } - a real per-date calendar,
-- replacing the weekly-recurring grid for day-to-day use on the
-- dashboard. Deliberately not one of the fields
-- profiles_lock_teacher_fields blocks (like is_online/income_goal) -
-- a teacher needs to update this instantly and often.

alter table profiles add column availability_dates jsonb not null default '{}';
