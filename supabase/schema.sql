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
  -- these three are normally whatever a real Supabase Storage upload
  -- returned, but nothing else stops a user writing an arbitrary string
  -- here directly (armusUpdateOwnProfile has no field allowlist, RLS
  -- only checks ownership) - the client (armusSafeUrl, i18n.js) builds
  -- an <img src="...">/<video src="..."> straight from this value via a
  -- template literal, so a string like
  -- 'https://x.com/a.jpg" onerror="...' broke out of that attribute and
  -- ran arbitrary JS in whoever viewed it (an admin reviewing a brand
  -- new application, most importantly). These constraints mirror
  -- armusSafeUrl's own rule so a write path that forgets to use it can't
  -- reopen the hole.
  photo_url text check (photo_url is null or (photo_url ~ '^https://' and photo_url !~ '[\s"''<>`]')),
  has_certificate boolean,
  certificate_name text,
  certificate_years text,
  certificate_file_url text check (certificate_file_url is null or (certificate_file_url ~ '^https://' and certificate_file_url !~ '[\s"''<>`]')),
  certificate_file_name text,
  has_education boolean,
  university text,
  degree_type text,
  graduation_year text,
  specialization text,
  bio text,
  video_url text check (video_url is null or (video_url ~ '^https://' and video_url !~ '[\s"''<>`]')),
  availability text,
  -- dashboard.html's own price-change form only ever rejects 0/NaN
  -- (`Number(...) || 0`), not a negative value - nothing stopped a
  -- teacher from submitting a negative price into pending_changes, which
  -- admin.html's approval handler applies unfiltered. create-payment
  -- re-validates price > 0 before ever charging a student, so this was
  -- never chargeable, but a negative price would still show broken on
  -- the teacher's own public listing until someone tried to book them.
  price numeric check (price is null or price > 0),
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

-- whether the "your lesson starts soon" reminder email (send-lesson-reminder
-- Edge Function, fired by the armus-lesson-reminders cron job at the
-- bottom of this file) has already gone out for this booking
alter table bookings add column if not exists reminder_sent boolean not null default false;

-- same idea, for the "leave a review" email sent to the student a bit
-- after the lesson ends (send-review-reminder Edge Function, fired by
-- the armus-review-reminders cron job at the bottom of this file)
alter table bookings add column if not exists review_email_sent boolean not null default false;

-- soft-cancellation (see cancel-booking Edge Function) - a student
-- cancelling >= 4 hours before the lesson gets a full iyzico refund, a
-- teacher/admin cancelling always does, a late student cancellation
-- does not. No client-facing update policy touches these columns; only
-- cancel-booking (service role) ever writes them.
alter table bookings add column if not exists status text not null default 'confirmed' check (status in ('confirmed', 'cancelled'));
alter table bookings add column if not exists cancelled_at timestamptz;
alter table bookings add column if not exists cancelled_by text check (cancelled_by in ('student', 'teacher', 'admin'));
alter table bookings add column if not exists refunded boolean not null default false;

-- which IANA zone lesson_date/lesson_time (above) is wall-clock time IN -
-- a snapshot of the teacher's profiles.timezone at booking time (see
-- create-payment/payment-callback and the TIMEZONES section further
-- down this file for profiles.timezone itself). Declared here, ahead of
-- that section, only because reviews_insert_own_student below already
-- needs it.
alter table bookings add column if not exists teacher_timezone text not null default 'Europe/Istanbul';

-- stops two different bookings ever existing for the same teacher at
-- the same date+time - partial so a cancelled row at an old slot never
-- blocks a later (re-)booking of that same slot (see migration_35.sql)
create unique index if not exists bookings_teacher_slot_unique
  on bookings (teacher_id, lesson_date, lesson_time)
  where status <> 'cancelled';

-- === PENDING PAYMENTS ============================================
-- Sits in front of "bookings": create-payment (Edge Function) writes a
-- row here and sends the student to iyzico's hosted checkout; only
-- payment-callback (Edge Function, after re-checking the charge with
-- iyzico itself) turns a row here into a real "bookings" row. RLS is on
-- with zero policies on purpose - only the service role (used by both
-- Edge Functions) can ever touch this table; client-side code has no
-- access at all. See migration_22.sql and supabase/functions/.

create table pending_payments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique,
  iyzico_token text,
  -- set once the payment succeeds - needed later to refund this exact
  -- charge if the booking gets cancelled (see cancel-booking)
  iyzico_payment_id text,
  iyzico_payment_transaction_id text,
  student_id uuid not null references profiles(id) on delete cascade,
  student_name text not null,
  teacher_id text not null,
  teacher_name text not null,
  -- migration_29.sql: 'package' (a one-time bulk purchase of N lesson
  -- credits with one teacher, not a real recurring subscription) was
  -- applied to the live database but this constraint, and the two
  -- nullability changes plus the quantity column below, were never
  -- folded back into this file - a fresh install from schema.sql alone
  -- would reject every package purchase outright and create-payment's
  -- own package insert (which sets quantity, no lesson_date/lesson_time)
  -- would fail on both the missing column and the NOT NULL columns.
  type text not null check (type in ('trial', 'lesson', 'package')),
  -- a package purchase has no specific lesson date/time - it just
  -- grants credits, booked later like any other credit-covered lesson
  lesson_date date,
  lesson_time text,
  -- how many lesson_credits a 'package' type payment grants once it succeeds
  quantity integer,
  price numeric not null,
  -- 'processing' is a short-lived claim state: payment-callback flips a
  -- row into it atomically (status = 'pending'/'failed' -> 'processing')
  -- before doing any real work, so a concurrent second callback for the
  -- same token (iyzico can genuinely call back more than once) can't
  -- also pass that check and create a second booking / grant a second
  -- batch of lesson credits for what was really one charge.
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed', 'paid_no_booking')),
  booking_id uuid references bookings(id),
  created_at timestamptz not null default now()
);

alter table pending_payments enable row level security;

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

-- === LESSON CREDITS =================================================
-- Replaces "cancel = money back" with "cancel = a lesson owed back".
-- cancel-booking grants one when a cancellation is refund-eligible (see
-- its own comment for exactly which cancellations qualify), tied to the
-- teacher of the cancelled lesson:
--   - booking a new lesson (trial or regular) with that SAME teacher:
--     the credit covers it fully, no charge at all
--   - booking with a DIFFERENT teacher: the credit only covers a trial
--     lesson with them, not a full-price lesson
-- create-payment looks up available credits and applies one automatically
-- when the booking qualifies; there is no card refund and no cash value -
-- an unused credit is only ever a lesson, never money.

create table lesson_credits (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  teacher_id text not null,
  teacher_name text not null,
  status text not null default 'available' check (status in ('available', 'used')),
  source_booking_id uuid references bookings(id) on delete set null,
  used_booking_id uuid references bookings(id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

alter table lesson_credits enable row level security;

create policy "lesson_credits_select_own" on lesson_credits
  for select
  using (auth.uid() = student_id);

-- lesson_credits_select_teacher/lesson_credits_select_admin (migration_30.sql)
-- are declared further down, right after public.is_admin() exists to
-- reference (that function isn't defined until the ROW LEVEL SECURITY
-- section below) - see the comment there for why they're needed.

-- === EMAIL VERIFICATION (SIGNUP) ===================================
-- A 6-digit code emailed via Resend (send-verification-email Edge
-- Function) right after signup; verify-email-code checks it and flips
-- profiles.email_verified. RLS is on with zero policies on purpose -
-- only those two Edge Functions (service role) ever touch this table.

alter table profiles add column if not exists email_verified boolean not null default false;

-- === ATTENDANCE (migration_41.sql) =================================
-- Teacher hide/ban state driven by student-reported no-shows/lateness
-- (attendance_reports, declared further down where bookings/disputes
-- already exist) - declared here, ahead of enforce_teacher_profile_lock
-- below, which locks these columns down.
alter table profiles add column if not exists hidden_from_new_students boolean not null default false;
alter table profiles add column if not exists hidden_reason text;
alter table profiles add column if not exists hidden_at timestamptz;
-- when set and in the future, the teacher is hidden from EVERYONE (not
-- just new students) - the harsher, repeated-violation tier
alter table profiles add column if not exists hidden_until timestamptz;
alter table profiles add column if not exists is_banned boolean not null default false;
alter table profiles add column if not exists banned_at timestamptz;

create table email_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  code text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

alter table email_verifications enable row level security;

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

-- migration_30.sql: a teacher (and admins) also need to see lesson_credits
-- tied to them, to detect when a trial converted into a real package
-- purchase (armusTrialCountsAsEarned, bookings.js), so the trial's price
-- can count as real earnings instead of staying with ARMUS by default.
-- Declared here (rather than back with lesson_credits_select_own above)
-- because it needs public.is_admin(), just defined above. Applied to the
-- live database but never folded back into this file - a fresh install
-- from schema.sql alone left dashboard.html's own credits query
-- (`lesson_credits.select("*").eq("teacher_id", user.id)`) and admin.html's
-- (`lesson_credits.select("*")`) silently returning nothing for anyone
-- but the student, permanently breaking trial-conversion earnings and
-- the admin credits view.
create policy "lesson_credits_select_teacher" on lesson_credits
  for select
  using (auth.uid()::text = teacher_id);

create policy "lesson_credits_select_admin" on lesson_credits
  for select
  using (public.is_admin());

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
-- directly - only pending_changes, which an admin must approve. Also
-- blocks a non-admin from ever writing is_admin, or moving status
-- anywhere but 'pending' (self-service apply/re-apply) themselves -
-- profiles_update_own_or_admin otherwise lets a user update any column
-- on their own row, which without this would let anyone grant
-- themselves admin access or self-approve a teacher application
-- (see migration_34.sql).
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

  -- set by the attendance-report system (migration_41.sql) right before
  -- it writes hidden_from_new_students/hidden_until/is_banned on behalf
  -- of whichever student's report or admin's resolution triggered it -
  -- lets that one trusted, server-side write through without needing to
  -- be an admin itself
  if coalesce(current_setting('armus.attendance_system_update', true), '') = 'on' then
    return new;
  end if;

  if new.is_admin is distinct from old.is_admin then
    raise exception 'admin_lock: is_admin can only be changed by an admin';
  end if;

  -- role is set once, at signup (handle_new_user, from the auth metadata
  -- armusSignUp passes in) and never written again by any legitimate app
  -- code path - apply-teacher.html only ever sets status/title/price/etc,
  -- never role. Without this lock, a plain student could self-promote to
  -- role = 'teacher' with a bare client update, which lets them pass
  -- conversations_insert_participant's role checks and fabricate a
  -- conversation naming any real student as the other party - and
  -- profiles_select_conversation_partner then hands back that student's
  -- full profile row (email, phone, city, ...), which is otherwise
  -- completely invisible to another student.
  if new.role is distinct from old.role then
    raise exception 'role_lock: role can only be changed by an admin';
  end if;

  if new.status is distinct from old.status and new.status is distinct from 'pending' then
    raise exception 'status_lock: only an admin can approve or reject an application';
  end if;

  if new.hidden_from_new_students is distinct from old.hidden_from_new_students
    or new.hidden_reason is distinct from old.hidden_reason
    or new.hidden_at is distinct from old.hidden_at
    or new.hidden_until is distinct from old.hidden_until
    or new.is_banned is distinct from old.is_banned
    or new.banned_at is distinct from old.banned_at
  then
    raise exception 'attendance_lock: these fields can only be changed by the attendance-report system or an admin';
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

  -- pending_changes is itself just a jsonb blob a teacher writes to their
  -- own row, and admin.html's approval handler spreads its contents
  -- straight into the profile on approve (minus submitted_at) - without
  -- this check a non-admin could smuggle keys like is_admin or status into
  -- it that the review UI never renders, so an admin approving what looks
  -- like a harmless bio/price edit would silently apply them too
  if new.pending_changes is distinct from old.pending_changes and new.pending_changes is not null then
    if exists (
      select 1 from jsonb_object_keys(new.pending_changes) as k
      where k not in ('submitted_at', 'title', 'price', 'availability', 'bio', 'weekly_availability')
    ) then
      raise exception 'pending_changes_lock: pending_changes may only contain submitted_at, title, price, availability, bio, or weekly_availability';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_lock_teacher_fields
  before update on profiles
  for each row execute procedure public.enforce_teacher_profile_lock();

-- migration_63.sql: emails a teacher applicant when their status changes
-- to approved or rejected - covers both admin.html's single approve/
-- reject buttons and its bulk action (both are a plain profiles.update,
-- so a DB-level trigger catches both without duplicating this in two
-- client code paths). send-teacher-status-email is an Edge Function -
-- deploy it too, and turn its "Verify JWT" off, same as the other
-- trigger-fired functions. Depends on pg_net, enabled down in the LESSON
-- REMINDER EMAILS section - fine, a trigger body is only checked against
-- what actually exists when it *runs*, not when it's defined, and pg_net
-- exists long before any real approval/rejection happens.
create or replace function public.notify_teacher_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('approved', 'rejected') then
    perform net.http_post(
      url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-teacher-status-email',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object('profile_id', new.id, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger profiles_notify_teacher_status_change
  after update on profiles
  for each row
  when (old.status is distinct from new.status)
  execute procedure public.notify_teacher_status_change();

-- bookings: student or teacher involved in the booking can read it
create policy "bookings_select_participant"
  on bookings for select
  using (auth.uid() = student_id or auth.uid()::text = teacher_id);

-- bookings: admins can read every booking (for the admin panel)
create policy "bookings_select_admin_all"
  on bookings for select
  using (public.is_admin());

-- bookings: no client-facing insert policy - a booking is only ever
-- created by the payment-callback Edge Function (service role, after
-- confirming the charge with iyzico), never directly by a student. See
-- pending_payments above and migration_22.sql.

-- reviews: readable by everyone (shown on public teacher profiles)
create policy "reviews_select_all"
  on reviews for select
  using (true);

-- reviews: a student can review only their own completed booking - same
-- day or earlier counts as "completed" (rather than strictly before
-- today), so a student can rate a lesson right after leaving the live
-- classroom (class.html) instead of waiting for the next calendar day.
-- Compares against "today" in the booking's own teacher_timezone
-- (migration_37.sql/migration_40.sql), not the database's session
-- timezone (UTC) - otherwise a lesson already past midnight in the
-- teacher's own zone could still read as "tomorrow" here and wrongly
-- block the review.
--
-- IMPORTANT: "b.teacher_id = reviews.teacher_id" is required (migration_44.sql)
-- - without it, this only ever verified the BOOKING belongs to the
-- reviewing student and has already happened, never that the teacher_id
-- being written down is who that booking was actually with. Any student
-- with even one real completed booking (with ANY teacher) could post a
-- review naming a completely different, uninvolved teacher - a fake
-- rating with zero real basis, visible on that teacher's public profile.
--
-- IMPORTANT: "b.status <> 'cancelled'" is required (migration_61.sql) -
-- without it, a student could book a lesson, cancel it (even with a full
-- credit refund, so at no real cost - cancel-booking), wait for that
-- lesson_date to pass, and still post a review for a lesson that never
-- happened - a free way to fake-boost a friend's rating or leave a
-- baseless bad review on a competitor, reachable straight from
-- my-lessons.html's normal "rate this lesson" prompt.
create policy "reviews_insert_own_student"
  on reviews for insert
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from bookings b
      where b.id = booking_id
        and b.student_id = auth.uid()
        and b.teacher_id = reviews.teacher_id
        and b.status <> 'cancelled'
        and b.lesson_date <= (now() at time zone b.teacher_timezone)::date
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
  -- see profiles.photo_url's comment above - same attribute-breakout XSS
  -- risk (armusSafeUrl builds an <img>/<video> src straight from this),
  -- same fix.
  attachment_url text check (attachment_url is null or (attachment_url ~ '^https://' and attachment_url !~ '[\s"''<>`]')),
  attachment_type text check (attachment_type in ('image', 'video', 'audio')),
  -- vestigial: an earlier "Düzelt Beni" feature let a teacher attach a
  -- correction to a student's message this way; removed from the UI
  -- (see enforce_message_edit_rules below - only the sender can ever
  -- change a message's own body now), kept only so old rows still resolve
  corrected_of_id uuid references messages(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  edited_at timestamptz,
  constraint messages_body_or_attachment check (body <> '' or attachment_url is not null)
);

alter table conversations enable row level security;
alter table messages enable row level security;

create policy "conversations_select_participant"
  on conversations for select
  using (auth.uid() = student_id or auth.uid() = teacher_id);

-- "a student and a real teacher" (see this table's own header comment)
-- was never actually checked - only that the caller is one of the two
-- named parties. Any authenticated user could set teacher_id (or
-- student_id) to ANY other profile's id, real teacher or not, and the
-- fabricated conversation would show up as an unsolicited thread in
-- that other person's inbox (mesajlar.html), including student-to-
-- student.
create policy "conversations_insert_participant"
  on conversations for insert
  with check (
    (auth.uid() = student_id or auth.uid() = teacher_id)
    and exists (select 1 from profiles p where p.id = student_id and p.role = 'student')
    and exists (select 1 from profiles p where p.id = teacher_id and p.role = 'teacher')
  );

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

-- broad on purpose - the OTHER participant needs to update read_at to
-- mark a message read. What a participant can actually change on a row
-- they didn't send is narrowed by the trigger below (body edits only
-- ever allowed for the sender, and only briefly).
create policy "messages_update_participant"
  on messages for update
  using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
    )
  );

-- only the sender can edit a message's body, and only within 2 minutes
-- of sending it - RLS alone can't express "this column, this
-- condition, one specific role" cleanly, hence a trigger.
--
-- messages_update_participant is deliberately broad (both participants
-- need to update read_at), so without this trigger locking everything
-- else, either participant could rewrite ANY column on a message via a
-- direct API call - most seriously sender_id, letting a participant make
-- a message look like the OTHER person wrote it, with no time limit and
-- no trace. attachment_url/attachment_type had the same gap: unlike
-- body, they weren't held to the sender-only/2-minute rule at all.
create or replace function public.enforce_message_edit_rules()
returns trigger
language plpgsql
as $$
begin

  if new.sender_id is distinct from old.sender_id
    or new.conversation_id is distinct from old.conversation_id
    or new.created_at is distinct from old.created_at
    or new.corrected_of_id is distinct from old.corrected_of_id
  then
    raise exception 'message_locked: sender_id, conversation_id, created_at, and corrected_of_id cannot be changed after sending';
  end if;

  if new.body is distinct from old.body
    or new.attachment_url is distinct from old.attachment_url
    or new.attachment_type is distinct from old.attachment_type
  then

    if auth.uid() <> old.sender_id then
      raise exception 'message_edit_denied: only the sender can edit a message';
    end if;

    if old.created_at < now() - interval '2 minutes' then
      raise exception 'message_edit_expired: messages can only be edited within 2 minutes of sending';
    end if;

    new.edited_at := now();
  end if;

  return new;
end;
$$;

create trigger messages_enforce_edit_rules
  before update on messages
  for each row execute procedure public.enforce_message_edit_rules();

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
-- A cancelled booking doesn't count (migration_36.sql) - otherwise
-- booking-then-cancelling would permanently unlock this for free.
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
      and b.status = 'confirmed'
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

-- migration_62.sql: emails whichever participant did NOT send this
-- message (send-message-notification, an Edge Function - deploy it and
-- turn its "Verify JWT" off, same as payment-callback/send-lesson-reminder).
-- Demo teachers are never a real conversation participant (this table's
-- own header comment), so both conversations.student_id/teacher_id
-- always reference a real profile with a real email - no isUuid-style
-- guard needed here. Depends on the pg_net extension, enabled down in
-- the LESSON REMINDER EMAILS section below - fine, since a trigger body
-- is only checked against what actually exists when it *runs*, not when
-- it's defined, and pg_net exists long before any real message is sent.
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-message-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('message_id', new.id)
  );
  return new;
end;
$$;

create trigger messages_notify_new_message
  after insert on messages
  for each row execute procedure public.notify_new_message();

-- === ADMIN PANEL EXTRAS ==========================================
-- An admin activity log and homepage testimonials managed from the
-- admin panel. Booking cancellation from the admin panel used to be a
-- direct client-side delete here (bookings_delete_admin) - now that
-- cancelling can mean an iyzico refund, it goes through the
-- cancel-booking Edge Function (service role) instead, so that policy
-- was dropped (see migration_24.sql).

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

-- === NEWSLETTER SIGNUP (migration_31.sql) =========================
-- Homepage footer form (index.html). Public, unauthenticated
-- insert-only - anyone can add their email, but nobody but an admin can
-- read the list back (no scraping other visitors' emails through the
-- anon key). Applied to the live database but never folded back into
-- this file - a fresh install from schema.sql alone left index.html's
-- own insert into this table failing outright (relation does not exist).

create table newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table newsletter_subscribers enable row level security;

create policy "newsletter_subscribers_insert_anyone" on newsletter_subscribers
  for insert
  with check (true);

create policy "newsletter_subscribers_select_admin" on newsletter_subscribers
  for select
  using (public.is_admin());

-- === CONTACT FORM (migration_33.sql) ==============================
-- iletisim.html submissions - a durable backup record of what was sent,
-- in case the outbound email (send-contact-email Edge Function) ever
-- fails, mirroring newsletter_subscribers above. Same schema-drift gap:
-- applied to the live database but never folded back into this file -
-- send-contact-email's own insert into this table would fail outright
-- on a fresh install.

create table contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  ip_address text,
  created_at timestamptz not null default now()
);

alter table contact_messages enable row level security;

create policy "contact_messages_insert_anyone" on contact_messages
  for insert
  with check (true);

create policy "contact_messages_select_admin" on contact_messages
  for select
  using (public.is_admin());

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

-- a reporter can only attach a booking_id that's actually theirs (as
-- student or teacher) - a general dispute with no booking_id at all is
-- still allowed (migration_40.sql). When a booking IS attached,
-- reporter_role/other_party_name are also cross-checked against that
-- booking's real participants - same integrity pattern as
-- reviews_insert_own_student/attendance_reports_insert_own_student.
-- Without this, a caller could attach a real booking_id (passing the
-- ownership check above) while claiming an arbitrary reporter_role or
-- naming an arbitrary, unrelated person as other_party_name - both are
-- plain client-supplied text with nothing else tying them to reality,
-- and disputes are read by admins reviewing real complaints. The one
-- real call site (my-lessons.html) always sets these to match the
-- actual booking already, so this only closes a direct-API bypass.
create policy "disputes_insert_own"
  on disputes for insert
  with check (
    auth.uid() = reporter_id
    and (
      booking_id is null
      or exists (
        select 1 from bookings b
        where b.id = booking_id
          and (
            (b.student_id = auth.uid() and reporter_role = 'student' and other_party_name = b.teacher_name)
            or (b.teacher_id = auth.uid()::text and reporter_role = 'teacher' and other_party_name = b.student_name)
          )
      )
    )
  );

create policy "disputes_update_admin"
  on disputes for update
  using (public.is_admin())
  with check (public.is_admin());

-- === ATTENDANCE REPORTS (migration_41.sql) ==========================
-- A student reports a no-show or a late start for one of their own
-- bookings (class.html). That immediately hides the teacher from NEW
-- students' search (existing students who've booked with them before
-- still see them) - see handle_new_attendance_report below. The teacher
-- can submit one explanation while it's still open (dashboard.html); an
-- admin then marks it "dismissed" (false alarm, unhides) or "upheld"
-- (stays hidden, counts toward the escalating thresholds in
-- handle_attendance_report_resolution: 10 upheld no-shows lifetime ->
-- permanent ban, 3 upheld no-shows within 30 days -> hidden from
-- EVERYONE for 14 days, more than 5% of a calendar month's lessons
-- upheld as late -> hidden from EVERYONE for 30 days). Only upheld
-- reports ever count toward a threshold - an open, explained, or
-- dismissed one never does.

create table attendance_reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id) on delete cascade,
  teacher_id text not null,
  student_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('no_show', 'late')),
  late_minutes integer check (late_minutes is null or late_minutes between 1 and 180),
  student_note text,
  status text not null default 'open' check (status in ('open', 'explained', 'upheld', 'dismissed')),
  teacher_explanation text,
  created_at timestamptz not null default now(),
  explained_at timestamptz,
  resolved_at timestamptz,
  -- delete-account (service role, via supabase.auth.admin.deleteUser)
  -- assumes every table referencing profiles(id) cascades, needing no
  -- manual cleanup - true everywhere else, but this column had no ON
  -- DELETE clause at all (defaults to NO ACTION), so any admin who had
  -- ever resolved even one attendance report could never delete their
  -- own account - the delete would hit this foreign key and fail every
  -- time, with no way to clear the blocker from inside the app. set
  -- null instead, matching disputes.booking_id/lesson_credits.source_booking_id's
  -- same "keep the record, drop the now-dangling reference" pattern -
  -- the report and its resolution stay intact, only the "which admin"
  -- attribution is lost.
  resolved_by uuid references profiles(id) on delete set null
);

alter table attendance_reports enable row level security;

create policy "attendance_reports_select_participant_or_admin"
  on attendance_reports for select
  using (auth.uid() = student_id or auth.uid()::text = teacher_id or public.is_admin());

-- a student can only report their OWN real booking, and only against the
-- teacher that booking is actually with - same integrity pattern as
-- reviews_insert_own_student / disputes_insert_own above. Also requires
-- the booking to still be confirmed (not cancelled) and its lesson to
-- have actually started already (migration_42.sql) - without this, a
-- report against a lesson scheduled days in the future, or one already
-- cancelled, would still immediately hide the teacher.
--
-- IMPORTANT: "b.teacher_id = attendance_reports.teacher_id" must stay
-- explicitly qualified like this - a bare "teacher_id" here resolves to
-- the innermost "bookings b" row it's already next to (b.teacher_id),
-- making the comparison a tautology that never actually checks the new
-- row's own teacher_id at all (migration_42.sql fixed exactly this).
--
-- The 10-minute no-show grace period (class.html's noShowReportReady -
-- "a student who reports within seconds of joining, the teacher might
-- just be a minute behind, can't instantly hide someone over nothing")
-- was only ever enforced by disabling the button client-side - a direct
-- API call could file a no_show report the literal instant the lesson's
-- scheduled start passed, with zero grace period, doing exactly what
-- that comment says it shouldn't. "late" intentionally has no such gate
-- (any time after the scheduled start, it already is late) - only
-- no_show needs the extra 10 minutes here.
create policy "attendance_reports_insert_own_student"
  on attendance_reports for insert
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from bookings b
      where b.id = booking_id
        and b.student_id = auth.uid()
        and b.status = 'confirmed'
        and b.teacher_id = attendance_reports.teacher_id
        and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone)
            <= now() - (case when attendance_reports.type = 'no_show' then interval '10 minutes' else interval '0' end)
    )
  );

-- the reported teacher can submit ONE explanation while it's still open;
-- an admin can do anything (resolve it upheld/dismissed). Column-level
-- restriction (a teacher can only set teacher_explanation + move
-- open -> explained, nothing else) is enforced by the trigger below,
-- same shape as enforce_teacher_profile_lock.
create policy "attendance_reports_update_participant_or_admin"
  on attendance_reports for update
  using (auth.uid()::text = teacher_id or public.is_admin())
  with check (auth.uid()::text = teacher_id or public.is_admin());

create or replace function public.enforce_attendance_report_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    new.resolved_by := auth.uid();
    if new.status is distinct from old.status and new.status in ('upheld', 'dismissed') then
      new.resolved_at := now();
    end if;
    return new;
  end if;

  -- everything below is the reported teacher explaining themselves
  if old.status <> 'open' then
    raise exception 'attendance_report_locked: this report has already been reviewed';
  end if;

  if new.status is distinct from 'explained' then
    raise exception 'attendance_report_locked: only an admin can set the final outcome';
  end if;

  if new.booking_id is distinct from old.booking_id
    or new.teacher_id is distinct from old.teacher_id
    or new.student_id is distinct from old.student_id
    or new.type is distinct from old.type
    or new.late_minutes is distinct from old.late_minutes
    or new.student_note is distinct from old.student_note
  then
    raise exception 'attendance_report_locked: cannot modify the original report';
  end if;

  -- the comment above promises "nothing else" changes besides
  -- teacher_explanation/status - resolved_at/resolved_by weren't
  -- actually held to that: a non-admin update reaching this point could
  -- still set them to anything (a fabricated past timestamp, someone
  -- else's profile id posing as the resolving admin) since only the
  -- columns explicitly listed above were locked (migration_43.sql).
  new.resolved_at := old.resolved_at;
  new.resolved_by := old.resolved_by;
  new.explained_at := now();
  return new;
end;
$$;

create trigger attendance_reports_before_update
  before update on attendance_reports
  for each row execute procedure public.enforce_attendance_report_update();

-- runs as the reporting STUDENT's own request, so it sets a session-local
-- flag enforce_teacher_profile_lock checks to let this one specific,
-- trusted write through without needing to be an admin
create or replace function public.handle_new_attendance_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('armus.attendance_system_update', 'on', true);

  update profiles
  set hidden_from_new_students = true,
      hidden_reason = new.type,
      hidden_at = now()
  where id::text = new.teacher_id
    and coalesce(is_banned, false) = false;

  return new;
end;
$$;

create trigger attendance_reports_after_insert
  after insert on attendance_reports
  for each row execute procedure public.handle_new_attendance_report();

-- escalates (or clears) once an admin resolves a report. The "late"
-- branch measures "this calendar month" in the reported teacher's own
-- timezone (migration_42.sql), not the database's session timezone, and
-- only counts lessons that have actually started already as the
-- denominator - otherwise lessons still scheduled later in the month
-- would dilute the late percentage and make the threshold harder to
-- reach than intended.
create or replace function public.handle_attendance_report_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total_no_shows integer;
  recent_no_shows integer;
  report_teacher_tz text;
  month_start_local timestamptz;
  month_end_local timestamptz;
  month_lesson_count integer;
  month_late_count integer;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  perform set_config('armus.attendance_system_update', 'on', true);

  if new.status = 'dismissed' then
    -- false alarm - unhide, unless something ELSE is still pending or
    -- was separately upheld. The comment above always described this as
    -- checking upheld reports too, but the condition itself only ever
    -- checked 'open'/'explained' - dismissing one report could unhide a
    -- teacher who still had a completely separate, confirmed-real upheld
    -- violation on record, as long as that upheld report hadn't itself
    -- crossed the 14/30-day hidden_until escalation threshold (which the
    -- coalesce(hidden_until, now()) <= now() check below does still
    -- protect once escalated - this was specifically the gap for a
    -- teacher's first upheld report, before escalation kicks in).
    if not exists (
      select 1 from attendance_reports
      where teacher_id = new.teacher_id and status in ('open', 'explained', 'upheld') and id <> new.id
    ) then
      update profiles
      set hidden_from_new_students = false, hidden_reason = null, hidden_at = null
      where id::text = new.teacher_id and coalesce(hidden_until, now()) <= now();
    end if;
    return new;
  end if;

  if new.status = 'upheld' then

    if new.type = 'no_show' then

      select count(*) into total_no_shows
      from attendance_reports
      where teacher_id = new.teacher_id and type = 'no_show' and status = 'upheld';

      if total_no_shows >= 10 then
        update profiles set is_banned = true, banned_at = now() where id::text = new.teacher_id;
      else
        select count(*) into recent_no_shows
        from attendance_reports
        where teacher_id = new.teacher_id and type = 'no_show' and status = 'upheld'
          and created_at >= now() - interval '30 days';

        if recent_no_shows >= 3 then
          update profiles
          set hidden_until = greatest(coalesce(hidden_until, now()), now() + interval '14 days')
          where id::text = new.teacher_id;
        end if;
      end if;

    elsif new.type = 'late' then

      select b.teacher_timezone into report_teacher_tz
      from bookings b where b.id = new.booking_id;
      report_teacher_tz := coalesce(report_teacher_tz, 'Europe/Istanbul');

      month_start_local := date_trunc('month', new.created_at at time zone report_teacher_tz) at time zone report_teacher_tz;
      month_end_local := month_start_local + interval '1 month';

      select count(*) into month_lesson_count
      from bookings b
      where b.teacher_id = new.teacher_id
        and b.status <> 'cancelled'
        and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone) >= month_start_local
        and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone) < month_end_local
        and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone) <= now();

      select count(*) into month_late_count
      from attendance_reports
      where teacher_id = new.teacher_id and type = 'late' and status = 'upheld'
        and created_at >= month_start_local and created_at < month_end_local;

      if month_lesson_count > 0 and (month_late_count::numeric / month_lesson_count) > 0.05 then
        update profiles
        set hidden_until = greatest(coalesce(hidden_until, now()), now() + interval '30 days')
        where id::text = new.teacher_id;
      end if;

    end if;

  end if;

  return new;
end;
$$;

create trigger attendance_reports_after_update
  after update on attendance_reports
  for each row execute procedure public.handle_attendance_report_resolution();

-- lets the admin panel's live pulse feed show a new attendance report
-- the moment it comes in, same as bookings/profiles/reviews above
alter publication supabase_realtime add table attendance_reports;

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

-- allowed_mime_types/file_size_limit are enforced by Supabase Storage
-- itself (not RLS) - without this, the "any authenticated account" write
-- policies below let anyone upload ANY file type here, including .html
-- or .svg with embedded <script>, which this public bucket would then
-- serve back with that same content-type at its own public URL (a
-- classic unrestricted-file-upload hole: hosting arbitrary
-- executable/phishing content on ARMUS's own trusted upload flow).
-- Matches what this field is actually for: photo/certificate/video.
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values (
  'teacher-uploads', 'teacher-uploads', true,
  array['image/png', 'image/jpeg', 'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime'],
  26214400 -- 25MB
)
on conflict (id) do update set
  allowed_mime_types = excluded.allowed_mime_types,
  file_size_limit = excluded.file_size_limit;

create policy "teacher_uploads_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'teacher-uploads');

-- update/delete used to have NO ownership check at all - any
-- authenticated account (any student, any other teacher) could
-- overwrite or delete ANY file in this public bucket, not just their
-- own. Since teacher-uploads is public and every photo/certificate/video
-- URL is embedded directly in that teacher's own public profile page
-- (teacher.html), the exact path to target was never a secret - anyone
-- who viewed a teacher's page could vandalize or delete their photo,
-- certificate, or intro video. uploadToStorage (apply-teacher.html)
-- always writes to a fresh, timestamped path per upload and the app
-- never calls storage.remove() itself, so restricting these to the
-- actual owner doesn't affect any real flow - it only closes the hole.
create policy "teacher_uploads_update_authenticated"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'teacher-uploads' and auth.uid() = owner)
  with check (bucket_id = 'teacher-uploads' and auth.uid() = owner);

create policy "teacher_uploads_delete_authenticated"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'teacher-uploads' and auth.uid() = owner);

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
  created_at timestamptz not null default now(),
  -- migration_32.sql: replaced the due-date review schedule above (kept,
  -- unused, no data loss) with something the student drives themselves -
  -- tag a word with a category, mark it known whenever they want. This
  -- create table was never updated to match, so a fresh install from
  -- this file alone got a vocab_entries table missing both columns the
  -- flashcard feature (student-dashboard.html) actually reads/writes,
  -- breaking every add/edit/mastered-toggle on it.
  category text not null default 'Genel',
  mastered boolean not null default false
);

alter table vocab_entries enable row level security;

create policy "vocab_entries_all_own"
  on vocab_entries for all
  using (auth.uid() = student_id)
  with check (auth.uid() = student_id);

-- vocab_entries: a teacher can also pin a word into a student's vault
-- mid-lesson (class.html's "Kelime Ekle" widget), scoped to students
-- they actually share a booking with.
create policy "vocab_entries_insert_teacher"
  on vocab_entries for insert
  with check (
    exists (
      select 1 from bookings b
      where b.teacher_id = auth.uid()::text
        and b.student_id = vocab_entries.student_id
    )
  );

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

-- allowed_mime_types/file_size_limit - see teacher-uploads above for why:
-- without this, any authenticated user could upload an .html/.svg file
-- with embedded script here too, via a direct API call (armusUploadChatAttachment
-- itself only ever sends image/video/audio, but that's client-side JS,
-- not an enforced restriction). Matches armusAttachmentTypeForFile
-- (messages.js).
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values (
  'chat-attachments', 'chat-attachments', true,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg'],
  26214400 -- 25MB
)
on conflict (id) do update set
  allowed_mime_types = excluded.allowed_mime_types,
  file_size_limit = excluded.file_size_limit;

create policy "chat_attachments_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'chat-attachments');

-- same ownership gap as teacher_uploads_update/delete_authenticated
-- above - without this, any authenticated user could overwrite or
-- delete any chat attachment, including ones from a conversation they
-- were never part of, once they had (or guessed) its path. messages.js's
-- armusUploadChatAttachment always writes a fresh, timestamped path and
-- the app never calls storage.remove() itself, so this doesn't affect
-- any real flow.
create policy "chat_attachments_update_authenticated"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'chat-attachments' and auth.uid() = owner)
  with check (bucket_id = 'chat-attachments' and auth.uid() = owner);

create policy "chat_attachments_delete_authenticated"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'chat-attachments' and auth.uid() = owner);

create policy "chat_attachments_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'chat-attachments');

-- === TEACHER AVAILABILITY (WEEKLY, DRAG-EDITED) ===================
-- { "1": ["14:00","14:30"], ... } - keyed by day-of-week
-- (JS getDay() index as a string, "0" = Sunday .. "6" = Saturday), not
-- a real date: a recurring weekly pattern the teacher edits as
-- draggable blocks on the dashboard. Deliberately not one of the
-- fields profiles_lock_teacher_fields blocks (like is_online/income_goal)
-- - a teacher needs to update this instantly and often.

alter table profiles add column availability_dates jsonb not null default '{}';

-- === TIMEZONES (migration_37.sql) =================================
-- lesson_date/lesson_time are plain wall-clock strings with no zone of
-- their own - they mean whatever the TEACHER's calendar grid meant when
-- they set their availability, in the teacher's own local time.
--
-- profiles.timezone: which IANA zone this person is currently in,
-- auto-detected client-side (Intl.DateTimeFormat().resolvedOptions().timeZone,
-- see auth.js armusGetSession) and kept fresh on every login/session
-- check. Used to format lesson-time notifications (send-lesson-reminder)
-- in each recipient's own current time.
alter table profiles add column if not exists timezone text not null default 'Europe/Istanbul';

-- bookings.teacher_timezone (same shape - a snapshot of the teacher's
-- profiles.timezone at booking time) is declared up in the BOOKINGS
-- section instead, since reviews_insert_own_student needs it earlier in
-- this file than this section runs.

-- === LESSON REMINDER EMAILS =======================================
-- Runs every 10 minutes: any lesson starting 50-70 minutes from now that
-- hasn't been reminded about yet gets a call to send-lesson-reminder (one
-- HTTP call per matching booking). The Edge Function itself marks
-- reminder_sent = true, and only after the email really went out - so a
-- failed HTTP call here just gets retried on the next run instead of
-- silently skipping that booking forever.
--
-- send-lesson-reminder must have "Verify JWT" turned OFF (same as
-- payment-callback) since this call carries no Supabase auth token.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'armus-lesson-reminders',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-lesson-reminder',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('booking_id', b.id)
  )
  from bookings b
  where b.reminder_sent = false
    and b.status = 'confirmed'
    and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone)
        between now() + interval '50 minutes' and now() + interval '70 minutes'
  $$
);

-- === LEAVE-A-REVIEW EMAILS =========================================
-- Same shape as the reminder cron above, but the other end of the
-- lesson: runs every 10 minutes, matches any lesson that ENDED 10-40
-- minutes ago (ARMUS_LESSON_MINUTES = 50, bookings.js) and hasn't had
-- its review email sent yet. The 30-minute-wide window against a
-- 10-minute schedule is the same deliberate overlap as the reminder
-- cron - a retry safety net for a failed call, not a bug. Only the
-- student gets this one (send-review-reminder) - reviews_insert_own_student
-- already requires the booking not be cancelled (migration_61.sql), so
-- no need to check status here beyond 'confirmed'.
--
-- send-review-reminder must have "Verify JWT" turned OFF, same as
-- send-lesson-reminder.

select cron.schedule(
  'armus-review-reminders',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-review-reminder',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('booking_id', b.id)
  )
  from bookings b
  where b.review_email_sent = false
    and b.status = 'confirmed'
    and ((b.lesson_date + b.lesson_time::time + interval '50 minutes') at time zone b.teacher_timezone)
        between now() - interval '40 minutes' and now() - interval '10 minutes'
  $$
);

-- === MARKETPLACE TEACHER STATS (aggregate, RLS-safe) ================
-- teachers.html/teacher.html show each teacher's "completed lessons" /
-- "students taught" counts as a trust signal. marketplace.js used to get
-- these by running a plain `bookings.select("*")` client-side and
-- counting rows itself - but bookings_select_participant only ever
-- returns rows the CALLER is a participant in (or an admin), so for
-- every viewer except that exact teacher looking at their own listing,
-- this silently returned almost nothing: an anonymous visitor (no
-- auth.uid() at all) got zero rows for every teacher, and a signed-in
-- student got counted only the bookings they personally had, not the
-- teacher's real totals. The public marketplace's core trust signal was
-- wrong for nearly all traffic.
--
-- This aggregates server-side (security definer, bypasses RLS) and
-- returns only per-teacher COUNTS - no student identity, no individual
-- booking rows - so it's safe to expose to anyone, same trust boundary
-- as reviews_select_all.
create or replace function public.teacher_marketplace_stats()
returns table (teacher_id text, completed_count bigint, student_count bigint)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.teacher_id,
    count(*) filter (
      where b.lesson_date < (now() at time zone b.teacher_timezone)::date
    ) as completed_count,
    count(distinct b.student_id) as student_count
  from bookings b
  where b.status <> 'cancelled'
  group by b.teacher_id;
$$;

grant execute on function public.teacher_marketplace_stats() to anon, authenticated;

-- === PUBLIC-SAFE PROFILE VIEW (name-masking) =========================
-- "A teacher's full real name is never shown to a student" (see
-- auth.js's armusShortDisplayName comment - it's there so a student
-- can't take a teacher's name off ARMUS and contact them elsewhere,
-- defeating the platform's commission) was only ever enforced by
-- truncating the name at RENDER time in the client. The raw API
-- response from a plain `profiles.select(...)` still carried the real
-- full name over the wire regardless - trivially visible to any student
-- via devtools' Network tab or Console, no exploit needed. marketplace.js
-- and messages.js now read from this view instead of the raw table for
-- every place a student (or anonymous visitor) sees a teacher's name.
--
-- Its WHERE clause reproduces the union of profiles_select_public_or_own's
-- public branch (status = 'approved') and profiles_select_conversation_partner,
-- so this view never exposes a ROW the base table's RLS didn't already
-- allow that same viewer to read - only the `name` column's content
-- changes, and only for a teacher row, and only when the viewer isn't
-- that teacher themselves or an admin.

create or replace function public.short_display_name(full_name text)
returns text
language sql
immutable
as $$
  select case
    when array_length(regexp_split_to_array(trim(coalesce(full_name, '')), '\s+'), 1) < 2
      then coalesce(nullif(trim(coalesce(full_name, '')), ''), 'Öğretmen')
    else
      (regexp_split_to_array(trim(full_name), '\s+'))[1] || ' ' ||
      left(
        (regexp_split_to_array(trim(full_name), '\s+'))[
          array_length(regexp_split_to_array(trim(full_name), '\s+'), 1)
        ],
        1
      ) || '.'
  end;
$$;

create or replace view public.masked_profiles
as
select
  p.id,
  case
    when auth.uid() = p.id then p.name
    when public.is_admin() then p.name
    when p.role = 'teacher' then public.short_display_name(p.name)
    else p.name
  end as name,
  p.photo_url,
  p.video_url,
  p.title,
  p.price,
  p.subject_taught,
  p.availability,
  p.bio,
  p.languages,
  p.weekly_availability,
  p.availability_dates,
  p.is_online,
  p.timezone,
  p.is_banned,
  p.hidden_from_new_students,
  p.hidden_until,
  p.role,
  p.status
from public.profiles p
where
  p.status = 'approved'
  or auth.uid() = p.id
  or public.is_admin()
  or exists (
    select 1 from public.conversations c
    where (c.student_id = auth.uid() and c.teacher_id = p.id)
       or (c.teacher_id = auth.uid() and c.student_id = p.id)
  );

grant select on public.masked_profiles to anon, authenticated;
