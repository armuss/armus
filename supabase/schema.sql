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

  -- migration_71.sql: a shareable code ("give a friend, get a free
  -- lesson" referral program - see the REFERRALS section further down).
  -- Deterministic from the row's own id (10 hex chars), not declared
  -- UNIQUE - handle_new_user runs inside the auth.users insert
  -- transaction, and a uniqueness failure there would break signup
  -- itself over what is, at 10 hex chars, an astronomically unlikely
  -- collision; resolve_referral_code() just takes the first match.
  referral_code text,

  created_at timestamptz not null default now()
);

create index profiles_referral_code_idx on profiles (referral_code);

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
  -- 'slot_taken' and 'time_passed' (migration_84.sql) are both fully
  -- resolved outcomes where the charge succeeded but no booking row was
  -- made - the buyer got a lesson credit instead; 'paid_no_booking' is
  -- reserved for a genuine write failure that still needs manual
  -- follow-up.
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed', 'paid_no_booking', 'slot_taken', 'time_passed')),
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
  insert into public.profiles (id, email, name, role, city, referral_code)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'student'),
    new.raw_user_meta_data->>'city',
    upper(left(replace(new.id::text, '-', ''), 10))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- migration_90.sql: changing your email in Settings only ever updated
-- auth.users.email (Supabase Auth's own updateUser({email}) flow, after
-- confirmation) - profiles.email, the column every email-sending code
-- path in this app actually reads, never followed, and was itself
-- locked against a direct client write (email_lock below). From the
-- moment someone confirmed a new email, every notification for that
-- account silently kept going to the old, abandoned address forever.
-- Reuses mark_email_verified's own bypass flag
-- (armus.email_verification_update) to get past that same lock for
-- this one legitimate, system-initiated write.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    perform set_config('armus.email_verification_update', 'on', true);
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute procedure public.sync_profile_email();

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

-- === REFERRALS ========================================================
-- migration_71.sql: "give a friend, get a free lesson". Bare table here;
-- its RLS policies, resolve_referral_code(), and the reward trigger are
-- declared further down for the same reason as lesson_credits' own
-- deferred policies - they need public.is_admin()/bookings' full shape,
-- neither of which exists yet at this point in the file.

create table referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references profiles(id) on delete cascade,
  referred_id uuid not null unique references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'rewarded')),
  rewarded_booking_id uuid references bookings(id) on delete set null,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  constraint referrals_no_self_referral check (referrer_id <> referred_id)
);

alter table referrals enable row level security;

-- === EMAIL VERIFICATION (SIGNUP) ===================================
-- A 6-digit code emailed via Resend (send-verification-email Edge
-- Function) right after signup; verify-email-code checks it and flips
-- profiles.email_verified. RLS is on with zero policies on purpose -
-- only those two Edge Functions (service role) ever touch this table.

alter table profiles add column if not exists email_verified boolean not null default false;

-- verify-email-code's only legitimate way to flip email_verified
-- (migration_77.sql) - a raw client/table update to this column is
-- blocked by enforce_teacher_profile_lock below. Deliberately not
-- granted to anon/authenticated: only reachable over a service-role
-- connection, same as verify-email-code's own SUPABASE_SERVICE_ROLE_KEY use.
create or replace function public.mark_email_verified(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('armus.email_verification_update', 'on', true);
  update profiles set email_verified = true where id = p_user_id;
end;
$$;

revoke all on function public.mark_email_verified(uuid) from public, anon, authenticated;

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

-- send-verification-email's only legitimate way to check the resend
-- cooldown/daily cap and insert a new code (migration_78.sql) - does the
-- whole check-then-insert atomically under an advisory lock so two
-- concurrent resend requests for the same user can't both slip past the
-- 45-second cooldown. Deliberately not granted to anon/authenticated,
-- same reasoning as mark_email_verified() above.
create or replace function public.claim_verification_send(
  p_user_id uuid,
  p_code text,
  p_expires_at timestamptz
)
returns text  -- null on success (the row was inserted); 'cooldown' or 'daily_cap' if rejected
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent timestamptz;
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select created_at into v_recent
    from email_verifications
    where user_id = p_user_id
    order by created_at desc
    limit 1;

  if v_recent is not null and (now() - v_recent) < interval '45 seconds' then
    return 'cooldown';
  end if;

  select count(*) into v_count
    from email_verifications
    where user_id = p_user_id
      and created_at >= now() - interval '24 hours';

  if v_count >= 8 then
    return 'daily_cap';
  end if;

  insert into email_verifications (user_id, code, expires_at)
  values (p_user_id, p_code, p_expires_at);

  return null;
end;
$$;

revoke all on function public.claim_verification_send(uuid, text, timestamptz) from public, anon, authenticated;

-- === ROW LEVEL SECURITY ==========================================

alter table profiles enable row level security;
alter table bookings enable row level security;
alter table reviews enable row level security;

-- profiles: a user can read their own row. Public/other-party reads
-- (the marketplace, a conversation partner, an admin) go through
-- masked_profiles / profiles_select_admin_all instead (migration_67.sql
-- and migration_70.sql) - this used to also allow "status = 'approved'"
-- here, which let anyone with the (public) anon key read every column
-- of any approved teacher's raw row directly - not just the name
-- masked_profiles protects, but their real email, phone, and
-- certificate file - completely bypassing that view. migration_70.sql
-- closed the same hole for a conversation partner's raw row (see the
-- removed profiles_select_conversation_partner policy, further down).
create policy "profiles_select_own"
  on profiles for select
  using (auth.uid() = id);

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

-- referrals: each side of a referral can see it, so can an admin
create policy "referrals_select_own"
  on referrals for select
  using (auth.uid() = referrer_id or auth.uid() = referred_id or public.is_admin());

-- referred_id being UNIQUE (above) is what actually stops referral
-- farming via repeated inserts - a given account can only ever be
-- someone's referred friend once, whichever referrer's link they used
-- first.
create policy "referrals_insert_self"
  on referrals for insert
  with check (auth.uid() = referred_id);

-- resolves a referral_code to the referrer's id without granting the
-- caller any broader read access to that profile's row (name, email,
-- etc stay invisible - register.html only ever gets the id back, just
-- enough to file the referrals insert above).
create or replace function public.resolve_referral_code(code text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from profiles where referral_code = upper(code) limit 1;
$$;

grant execute on function public.resolve_referral_code(text) to anon, authenticated;

-- fires on every new booking; the first time a referred student's
-- booking is a REAL (non-trial) lesson, marks the referral "rewarded"
-- and grants the REFERRER a lesson_credit for that same teacher - reuses
-- the exact same same-teacher-credit semantics cancel-booking already
-- uses (see lesson_credits' own comment above). Requiring a real, paid
-- booking (not a free/cheap trial) before rewarding anyone is the
-- anti-fraud gate - a pending referral costs nothing to create, a real
-- booking costs the referred account real money.
create or replace function public.armus_reward_referral_on_first_real_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id uuid;
begin
  if new.type = 'trial' then
    return new;
  end if;

  if exists (
    select 1 from bookings b
    where b.student_id = new.student_id
      and b.type <> 'trial'
      and b.id <> new.id
  ) then
    return new;
  end if;

  update referrals
  set status = 'rewarded', rewarded_at = now(), rewarded_booking_id = new.id
  where referred_id = new.student_id
    and status = 'pending'
  returning referrer_id into v_referrer_id;

  if v_referrer_id is not null then
    insert into lesson_credits (student_id, teacher_id, teacher_name, source_booking_id)
    values (v_referrer_id, new.teacher_id, new.teacher_name, new.id);
  end if;

  return new;
end;
$$;

create trigger armus_reward_referral
  after insert on bookings
  for each row execute procedure public.armus_reward_referral_on_first_real_booking();

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

  -- set only by mark_email_verified() (migration_77.sql) - never by a
  -- plain client update
  if coalesce(current_setting('armus.email_verification_update', true), '') = 'on' then
    return new;
  end if;

  -- migration_81.sql: is_banned is the "account closed" state (10
  -- confirmed no-shows, migration_41.sql) - dashboard.html showed a
  -- closed-account banner over it, but the rest of the page (is_online,
  -- pending_changes, availability_dates) stayed fully writable, since
  -- nothing here actually stopped a banned teacher's own updates. A
  -- banned profile can only be written by an admin from here on.
  if old.is_banned then
    raise exception 'banned_lock: banned accounts cannot update their profile';
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
  -- conversation naming any real student as the other party - masking
  -- as a fake teacher to talk to a student who'd normally never see
  -- them in the marketplace.
  if new.role is distinct from old.role then
    raise exception 'role_lock: role can only be changed by an admin';
  end if;

  -- set once at signup from auth.users.email (handle_new_user) and never
  -- legitimately written again (migration_77.sql) - an unlocked
  -- profiles.email let a teacher redirect their own booking/message
  -- notification emails (create-payment, send-message-notification, ...
  -- all read this column, not auth.users.email) to an inbox they don't
  -- own.
  if new.email is distinct from old.email then
    raise exception 'email_lock: email can only be changed by an admin';
  end if;

  -- only mark_email_verified() (service-role only, migration_77.sql) may
  -- flip this - a plain client setting it directly would skip
  -- verify-email-code's entire verification flow.
  if new.email_verified is distinct from old.email_verified then
    raise exception 'email_verified_lock: email_verified can only be set by the verification system';
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

  -- migration_92.sql: subject_taught/languages moved here from the
  -- flatly-locked credential block below - same admin-approval gate as
  -- title/price/availability/bio, not an unrestricted write. They're
  -- self-declared marketing copy like bio/title, not a verified
  -- credential like the certificate/education fields below - they'd only
  -- ended up flatly locked because they came from the same
  -- application-form section as those, not from a deliberate decision
  -- that they could never be edited. Before this, an approved teacher had
  -- no way at all to fix a typo in their teaching languages or change
  -- subject short of asking support for a raw DB edit, and
  -- teachers.html's language filter depends on `languages` actually
  -- reflecting what a teacher teaches.
  if old.status = 'approved' and (
    new.title is distinct from old.title
    or new.price is distinct from old.price
    or new.availability is distinct from old.availability
    or new.bio is distinct from old.bio
    or new.weekly_availability is distinct from old.weekly_availability
    or new.subject_taught is distinct from old.subject_taught
    or new.languages is distinct from old.languages
  ) then
    raise exception 'profile_locked: approved profile fields can only change through pending_changes + admin approval';
  end if;

  -- migration_80.sql: the rest of apply-teacher.html's application fields
  -- were never locked here at all, unlike title/price/bio/availability/
  -- weekly_availability/subject_taught/languages just above -
  -- armusUpdateOwnProfile has no field allowlist (auth.js), so once
  -- approved a teacher could still rewrite their own certificate/
  -- education/video info with a bare client update, completely bypassing
  -- the pending_changes + admin review flow those other fields go
  -- through. That's the trust-critical, document-verified data
  -- admin.html's approval screen actually reviewed - a teacher could
  -- silently swap in a fake certificate_file_url or claim a different
  -- university after being approved on the strength of the real one, with
  -- no admin ever seeing the change. No UI writes any of these fields for
  -- an already-approved teacher (only apply-teacher.html does, and that
  -- always pairs them with status: 'pending', which the status_lock check
  -- above still allows), so flatly locking them (no pending_changes
  -- escape hatch, unlike the fields above) matches current behavior.
  if old.status = 'approved' and (
    new.country is distinct from old.country
    or new.phone is distinct from old.phone
    or new.age_confirmed is distinct from old.age_confirmed
    or new.photo_url is distinct from old.photo_url
    or new.has_certificate is distinct from old.has_certificate
    or new.certificate_name is distinct from old.certificate_name
    or new.certificate_years is distinct from old.certificate_years
    or new.certificate_file_url is distinct from old.certificate_file_url
    or new.certificate_file_name is distinct from old.certificate_file_name
    or new.has_education is distinct from old.has_education
    or new.university is distinct from old.university
    or new.degree_type is distinct from old.degree_type
    or new.graduation_year is distinct from old.graduation_year
    or new.specialization is distinct from old.specialization
    or new.video_url is distinct from old.video_url
  ) then
    raise exception 'application_locked: approved teachers cannot edit application details directly - contact support to update them';
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
      where k not in ('submitted_at', 'title', 'price', 'availability', 'bio', 'weekly_availability', 'subject_taught', 'languages')
    ) then
      raise exception 'pending_changes_lock: pending_changes may only contain submitted_at, title, price, availability, bio, weekly_availability, subject_taught, or languages';
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
      headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
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

-- reviews: the raw row (with the reviewer's real, unmasked name) is
-- readable only by the reviewing student, the reviewed teacher, and
-- admins - everyone else reads the public masked_reviews view instead
-- (defined further down, migration_67.sql), which masks student_name
-- the same way masked_profiles masks a teacher's name. Review ROWS
-- themselves stay fully public either way (shown on public teacher
-- profiles) - only the name column's content changes.
create policy "reviews_select_own_or_admin"
  on reviews for select
  using (
    auth.uid() = student_id
    or auth.uid()::text = teacher_id
    or public.is_admin()
  );

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
-- migration_83.sql: student_name was plain client-supplied text with
-- nothing tying it to the reviewer's real identity - a student could
-- submit a review under any name at all (someone else's real name
-- included), which masked_reviews then shows unmasked to the reviewed
-- teacher, and short_display_name(student_name) derives the public name
-- everyone else sees. Now pinned to the caller's own real profiles.name,
-- same integrity pattern as disputes_insert_own/attendance_reports_insert_own_student.
create policy "reviews_insert_own_student"
  on reviews for insert
  with check (
    auth.uid() = student_id
    and student_name = (select p.name from profiles p where p.id = auth.uid())
    and exists (
      select 1 from bookings b
      where b.id = booking_id
        and b.student_id = auth.uid()
        and b.teacher_id = reviews.teacher_id
        and b.status <> 'cancelled'
        and b.lesson_date <= (now() at time zone b.teacher_timezone)::date
    )
  );

-- migration_94.sql: emails the reviewed teacher right after a review is
-- inserted - nothing told them one had arrived before this (only
-- send-review-reminder.ts existed, which emails the STUDENT asking them
-- to leave one). Same shape as messages_notify_new_message below.
create or replace function public.notify_teacher_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-review-notification',
    headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
    body := jsonb_build_object('review_id', new.id)
  );
  return new;
end;
$$;

create trigger reviews_notify_teacher
  after insert on reviews
  for each row execute procedure public.notify_teacher_review();

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

-- migration_88.sql: lets an admin browse conversations for dispute
-- investigation (admin.html's Mesajlar panel) - before this, only the
-- two participants themselves could see a conversation existed at all.
create policy "conversations_select_admin_all"
  on conversations for select
  using (public.is_admin());

-- "a student and a real teacher" (see this table's own header comment)
-- was never actually checked - only that the caller is one of the two
-- named parties. Any authenticated user could set teacher_id (or
-- student_id) to ANY other profile's id, real teacher or not, and the
-- fabricated conversation would show up as an unsolicited thread in
-- that other person's inbox (mesajlar.html), including student-to-
-- student.
-- migration_82.sql: role = 'teacher' alone was never enough - a
-- brand-new self-registered account (register.html?role=teacher,
-- status starts null, no application/admin review yet) or an
-- admin-rejected one (status = 'rejected') still passed this, and could
-- open an unsolicited conversation with any real student by id, same as
-- a banned one could. Only an approved, non-banned teacher should ever
-- be able to originate a new thread - except an admin, who legitimately
-- messages a still-pending applicant straight from the review screen
-- (admin.html's "Öğretmene Mesaj" button), so that path stays open.
--
-- migration_86.sql: that teacher eligibility check ran as a plain
-- `exists (select ... from profiles p where p.id = teacher_id ...)`
-- inside this WITH CHECK clause, which executes under the INSERTing
-- user's own row-level security - and profiles_select_own only ever lets
-- someone SELECT their *own* row. So for every ordinary student (the only
-- caller this policy is actually meant to let through), that subquery
-- could never see the teacher's row at all - filtered out before
-- role/status/is_banned were even checked - and the whole policy
-- evaluated to false unconditionally. No student could ever start a new
-- conversation with any teacher. Moved the lookup into a SECURITY
-- DEFINER function (same fix shape as public.is_admin() below) so it runs
-- with the function owner's full visibility instead of the calling
-- student's.
create or replace function public.is_messageable_teacher(target_teacher_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = target_teacher_id
      and p.role = 'teacher'
      and (public.is_admin() or (p.status = 'approved' and coalesce(p.is_banned, false) = false))
  );
$$;

-- migration_90.sql: this policy constrained which TEACHER could
-- originate a conversation (is_messageable_teacher above) but placed no
-- constraint at all on WHICH student a teacher could name - any
-- approved teacher who knew (or guessed) a student's UUID could open an
-- unsolicited conversation in that student's inbox with zero prior
-- relationship. A student starting a new conversation with an eligible
-- teacher (the normal "message a teacher for the first time" flow this
-- whole policy exists for) still needs no prior relationship - only the
-- teacher-initiated branch now requires one.
create or replace function public.teacher_may_contact_student(target_student_id uuid, acting_teacher_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = target_student_id and p.role = 'student'
  )
  and (
    public.is_admin()
    or exists (
      select 1 from bookings b
      where b.student_id = target_student_id
        and b.teacher_id = acting_teacher_id::text
    )
  );
$$;

create policy "conversations_insert_participant"
  on conversations for insert
  with check (
    (auth.uid() = student_id or auth.uid() = teacher_id)
    and public.is_messageable_teacher(teacher_id)
    and (
      (auth.uid() = student_id and exists (select 1 from profiles p where p.id = student_id and p.role = 'student'))
      or (auth.uid() = teacher_id and public.teacher_may_contact_student(student_id, teacher_id))
    )
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

-- migration_88.sql: counterpart to conversations_select_admin_all above -
-- an admin investigating a complaint needs to read the actual messages,
-- not just know the conversation exists.
create policy "messages_select_admin_all"
  on messages for select
  using (public.is_admin());

-- rate-limited (migration_69.sql) - every insert fires a real Resend
-- email via the messages_notify_new_message trigger with no debounce
-- of its own (see send-message-notification's header comment), and
-- unlike every other email-triggering action in this schema
-- (create-payment: 30/hr, send-verification-email: 8/day + 45s
-- cooldown), sending a message had no cap at all - a scripted account
-- could loop this insert to flood a specific person's inbox or burn
-- through ARMUS's shared Resend quota. 120/hour is far above any real
-- conversation's pace.
--
-- migration_87.sql: that cap used to be a bare subquery counting
-- `messages` right here, inside a policy defined ON messages - Postgres
-- refuses to plan a policy that scans the very table it protects in the
-- same statement ("infinite recursion detected in policy for relation
-- messages"), so EVERY insert failed, for every sender, not just ones
-- over the limit. Moved the count into its own SECURITY DEFINER
-- function below - a function call isn't inlined into the policy the
-- way a bare subquery is, so this no longer reads as the table
-- referencing itself.
create or replace function public.messages_under_rate_limit()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (
    select count(*) from messages m2
    where m2.sender_id = auth.uid()
      and m2.created_at > now() - interval '1 hour'
  ) < 120
$$;

create policy "messages_insert_own"
  on messages for insert
  with check (
    sender_id = auth.uid()
    -- migration_81.sql: a banned account (is_banned, migration_41.sql)
    -- could still send new messages to any student they already had a
    -- conversation with - nothing here checked it - even though
    -- enforce_teacher_profile_lock now refuses every other write for
    -- that account.
    and coalesce((select is_banned from profiles where id = auth.uid()), false) = false
    and exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
    )
    and public.messages_under_rate_limit()
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
--
-- migration_88.sql: an edit used to just overwrite body/attachment_url/
-- attachment_type in place - whatever it replaced was gone for good,
-- even to an admin looking into a complaint. message_edit_history keeps
-- what the message looked like right before each edit (one row per
-- edit, so editing the same message three times leaves three rows
-- behind it); messages.body etc. is still just the current text.
-- Admin-only: a participant doesn't need their own edit trail surfaced
-- back at them, only an admin investigating a dispute does.
create table message_edit_history (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  body text not null default '',
  attachment_url text,
  attachment_type text,
  edited_at timestamptz not null default now()
);

alter table message_edit_history enable row level security;

create policy "message_edit_history_select_admin"
  on message_edit_history for select
  using (public.is_admin());

-- security definer (migration_88.sql) so the insert into
-- message_edit_history above runs with this function's own privileges -
-- nobody but an admin should ever write into or read that table
-- directly, so there's deliberately no client-facing insert policy on
-- it for a participant to satisfy; this trigger is the only path in.
create or replace function public.enforce_message_edit_rules()
returns trigger
language plpgsql
security definer
set search_path = public
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

    insert into message_edit_history (message_id, body, attachment_url, attachment_type, edited_at)
    values (old.id, old.body, old.attachment_url, old.attachment_type, now());

    new.edited_at := now();
  end if;

  return new;
end;
$$;

create trigger messages_enforce_edit_rules
  before update on messages
  for each row execute procedure public.enforce_message_edit_rules();

alter publication supabase_realtime add table messages;

-- migration_89.sql: armusGetConversations (messages.js) used to fetch
-- EVERY message in every one of a user's conversations, with no limit,
-- just to compute each conversation's preview (last message) and unread
-- count for the nav bell/conversation list - which runs on nearly every
-- page load. This computes both directly in the database per
-- conversation via a lateral join instead. security invoker (the
-- default) - relies on the normal conversations_select_participant/
-- messages_select_participant RLS policies plus its own explicit WHERE,
-- so a caller only ever sees their own conversations.
create index if not exists messages_conversation_id_created_at_idx
  on messages (conversation_id, created_at desc);

create or replace function public.conversation_previews()
returns table (
  conversation_id uuid,
  last_message_id uuid,
  last_message_body text,
  last_message_attachment_type text,
  last_message_sender_id uuid,
  last_message_created_at timestamptz,
  unread_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id as conversation_id,
    lm.id, lm.body, lm.attachment_type, lm.sender_id, lm.created_at,
    coalesce(uc.unread_count, 0)
  from conversations c
  left join lateral (
    select m.id, m.body, m.attachment_type, m.sender_id, m.created_at
    from messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  left join lateral (
    select count(*) as unread_count
    from messages m2
    where m2.conversation_id = c.id
      and m2.sender_id <> auth.uid()
      and m2.read_at is null
  ) uc on true
  where c.student_id = auth.uid() or c.teacher_id = auth.uid();
$$;

grant execute on function public.conversation_previews() to anon, authenticated;

-- migration_70.sql removed this policy. It used to let each side of a
-- conversation read the other's raw profiles row so a teacher's inbox
-- wouldn't fall back to a generic "Kullanıcı" label for a student who
-- has no "approved" status of their own. But RLS is row-level, not
-- column-level - "read the other's name/photo" actually granted every
-- column, including email, phone, and certificate_file_url, to anyone
-- who had ever messaged the row's owner. Any student could open a
-- conversation with any teacher (no booking required - see
-- messages_insert_own below) and then read that teacher's real email,
-- phone number and certificate file straight off the raw REST endpoint
-- or a postgres_changes subscription (profiles is in the
-- supabase_realtime publication), bypassing masked_profiles and the
-- enforce_no_contact_sharing trigger's whole purpose. masked_profiles
-- (below) already reproduces this exact "own side of a conversation"
-- predicate in its WHERE clause and only exposes the columns a partner
-- actually needs (masked name, photo, bio, etc, never email/phone/
-- certificate_file_url) - every call site already reads from it instead
-- of the raw table for a conversation partner, so this raw-table policy
-- was pure unused exposure once masked_profiles shipped.

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
    headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
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

-- === CLIENT ERROR LOG =================================================
-- migration_72.sql: a lightweight, self-hosted stand-in for real error
-- monitoring (no source maps, no alerting - just "is this recurring,
-- discoverable instead of silent"). Captured by a small block at the
-- bottom of i18n.js (loaded on every page already), read in admin.html's
-- "Hata Günlüğü" panel.

create table client_errors (
  id uuid primary key default gen_random_uuid(),
  message text not null check (char_length(message) <= 2000),
  stack text check (stack is null or char_length(stack) <= 8000),
  page_url text,
  user_agent text,
  -- nullable - most JS errors happen to anonymous/logged-out visitors
  -- too, and the insert policy below lets a report go in with no user_id
  -- at all (anon can't set auth.uid()), never with someone ELSE's id
  user_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table client_errors enable row level security;

-- rate-limited by content, not just checked for a spoofed user_id
-- (migration_76.sql) - an anonymous caller could otherwise flood this
-- table with unlimited rows via a direct REST call, no login needed.
-- The count has to run as a security-definer function: a plain
-- subquery in the policy would be blocked by client_errors_select_admin
-- below and always see zero rows for a non-admin caller, never
-- actually throttling anyone.
create or replace function public.client_errors_recent_count(p_message text, p_page_url text)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int from client_errors
  where message = p_message
    and page_url is not distinct from p_page_url
    and created_at > now() - interval '10 minutes'
$$;

grant execute on function public.client_errors_recent_count(text, text) to anon, authenticated;

create policy "client_errors_insert_anyone"
  on client_errors for insert
  with check (
    (user_id is null or user_id = auth.uid())
    and public.client_errors_recent_count(message, page_url) < 20
  );

create policy "client_errors_select_admin"
  on client_errors for select
  using (public.is_admin());

create index client_errors_created_at_idx on client_errors (created_at desc);

-- migration_73.sql: log + IP rate-limit backing for the "site-chat"
-- Edge Function (floating chat bubble, added to i18n.js). Only the
-- Edge Function's service-role client ever writes here - no
-- anon/authenticated insert policy on purpose.

create table site_chat_logs (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  message text not null check (char_length(message) <= 2000),
  reply text check (reply is null or char_length(reply) <= 4000),
  ip_address text,
  user_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table site_chat_logs enable row level security;

create policy "site_chat_logs_select_admin"
  on site_chat_logs for select
  using (public.is_admin());

create index site_chat_logs_created_at_idx on site_chat_logs (created_at desc);
create index site_chat_logs_ip_idx on site_chat_logs (ip_address, created_at desc);

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
  resolved_at timestamptz,
  -- caps a booking to one dispute per reporter (migration_79.sql) -
  -- nulls (a "general" dispute with no booking_id) are never treated as
  -- equal, so this only stops flooding the SAME booking with duplicate
  -- reports from the SAME reporter.
  unique (booking_id, reporter_id)
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

-- scoped to the caller's own "<uid>/..." folder (migration_74.sql) -
-- checking bucket_id alone let any authenticated account upload to ANY
-- path in this bucket, not just their own prefix that
-- apply-teacher.html's uploadToStorage() always uses - the object's
-- `owner` column is set to the caller regardless of path chosen, so it
-- never actually protected the path itself.
create policy "teacher_uploads_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'teacher-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

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
-- authenticated user and needs its own SELECT policy. Scoped to the
-- owner (or an admin) rather than any authenticated user
-- (migration_68.sql) - "bucket_id = 'teacher-uploads'" alone let ANY
-- signed-in account (including a brand-new, unverified signup) call
-- storage.from('teacher-uploads').list(...) and enumerate/download
-- every teacher's application photo, certificate, and intro video -
-- including pending/rejected applications never shown on any public
-- page. This only governs the AUTHENTICATED list/download API; public
-- display (teacher.html img src, built via getPublicUrl - a pure
-- client-side string builder, no RLS involved) is on the separate
-- public-bucket serving path and is unaffected by this policy.
create policy "teacher_uploads_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'teacher-uploads' and (auth.uid() = owner or public.is_admin()));

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

-- insert/update also verify booking_id is actually one of the caller's
-- own bookings (migration_67.sql) - the original single "for all" policy
-- only pinned student_id to the caller, unlike every other "own real
-- booking" policy in this file (reviews_insert_own_student,
-- disputes_insert_own, attendance_reports_insert_own_student all join
-- back to bookings the same way) - a student could otherwise insert a
-- checkin against any booking id that exists at all, polluting their
-- own confidence-trend chart (never anyone else's - checkins are only
-- ever readable by their own student_id).
create policy "confidence_checkins_select_own"
  on confidence_checkins for select
  using (auth.uid() = student_id);

create policy "confidence_checkins_insert_own"
  on confidence_checkins for insert
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from bookings b
      where b.id = confidence_checkins.booking_id
        and b.student_id = auth.uid()
    )
  );

create policy "confidence_checkins_update_own"
  on confidence_checkins for update
  using (auth.uid() = student_id)
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from bookings b
      where b.id = confidence_checkins.booking_id
        and b.student_id = auth.uid()
    )
  );

create policy "confidence_checkins_delete_own"
  on confidence_checkins for delete
  using (auth.uid() = student_id);

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

-- migration_68.sql: "bucket_id = 'chat-attachments'" alone let ANY
-- signed-in account (including a brand-new signup, no relation to any
-- conversation at all) call storage.from('chat-attachments').list(...)
-- and enumerate/download every photo, video, and voice message ever
-- exchanged between any student and any teacher, not just their own
-- conversations - messages.js's upload paths ("<conversation_id>/...")
-- are trivially enumerable via list() once bucket_id alone is enough to
-- see them. Wrapped in a function (rather than inlined into the policy)
-- so a malformed/unexpected object name can never turn into a raw
-- ::uuid cast error breaking the whole query - it just evaluates to
-- "not a participant" instead.
create or replace function public.is_chat_attachment_participant(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  conv_id uuid;
begin
  begin
    conv_id := split_part(object_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;

  return exists (
    select 1 from conversations c
    where c.id = conv_id
      and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
  );
end;
$$;

create policy "chat_attachments_select_authenticated"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (auth.uid() = owner or public.is_chat_attachment_participant(name) or public.is_admin())
  );

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
-- payment-callback) since this call carries no Supabase auth token -
-- which is why it also needs the x-armus-trigger-secret header below
-- (migration_66.sql), same reason and same secret as the review-reminder
-- cron just under this one: without it, anyone who guessed a real
-- booking_id could call send-lesson-reminder directly.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'armus-lesson-reminders',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/send-lesson-reminder',
    headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
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
    headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
    body := jsonb_build_object('booking_id', b.id)
  )
  from bookings b
  where b.review_email_sent = false
    and b.status = 'confirmed'
    and ((b.lesson_date + b.lesson_time::time + interval '50 minutes') at time zone b.teacher_timezone)
        between now() - interval '40 minutes' and now() - interval '10 minutes'
  $$
);

-- === IP ADDRESS RETENTION (migration_75.sql) =======================
-- gizlilik-politikasi.html (Privacy Policy) promises the IP address
-- collected from the contact form is kept "kısa süreliğine" (briefly),
-- purely to prevent abuse - until this migration nothing ever actually
-- deleted it, on this table or on site_chat_logs' identical one. Nulls
-- ip_address (never the row - the message/reply content itself is a
-- real support/quality-review record worth keeping) once it's 30 days
-- past being useful for the 1-hour rate-limit window either logger
-- actually needs.

select cron.schedule(
  'armus-purge-old-ip-addresses',
  '0 4 * * *', -- once a day, 04:00 UTC
  $$
  update contact_messages
  set ip_address = null
  where ip_address is not null
    and created_at < now() - interval '30 days';

  update site_chat_logs
  set ip_address = null
  where ip_address is not null
    and created_at < now() - interval '30 days';
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
-- as masked_reviews (migration_67.sql).
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

-- migration_91.sql: same reasoning as teacher_marketplace_stats above -
-- the marketplace grid (armusGetRegisteredTeachers, marketplace.js) used
-- to download the ENTIRE site-wide reviews table (masked_reviews.select("*") -
-- every review's full comment and reviewer name, for every teacher) just
-- to average two numbers per teacher card, which never shows a review's
-- actual text. This aggregates server-side instead - a teacher's own
-- profile page still fetches that one teacher's real reviews, where the
-- text/name are actually shown.
create or replace function public.teacher_review_stats()
returns table (teacher_id text, avg_rating numeric, review_count bigint)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.teacher_id,
    round(avg(r.stars)::numeric, 1) as avg_rating,
    count(*) as review_count
  from reviews r
  group by r.teacher_id;
$$;

grant execute on function public.teacher_review_stats() to anon, authenticated;

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
-- Its WHERE clause reproduces the old profiles_select_public_or_own
-- policy's public branch (status = 'approved') plus the
-- conversation-partner predicate migration_70.sql removed from the
-- base table's own RLS (it's evaluated here instead, scoped to this
-- view's safe column list) - only the `name` column's content changes,
-- and only for a teacher row, and only when the viewer isn't
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

-- === PUBLIC-SAFE REVIEWS VIEW (name-masking) ==========================
-- Same bug, same fix, for reviews.student_name (migration_67.sql):
-- reviews_select_own_or_admin above only lets the reviewing student, the
-- reviewed teacher, and admins read the raw row - everyone else
-- (marketplace.js, teacher.html, armusGetReviewsForTeacher) reads this
-- view instead, which reuses short_display_name() the same way
-- masked_profiles does. Review rows themselves stay fully public (no
-- WHERE clause here) - only the name column's content changes.
create or replace view public.masked_reviews
as
select
  r.id,
  r.booking_id,
  r.teacher_id,
  r.student_id,
  case
    when auth.uid() = r.student_id then r.student_name
    when auth.uid()::text = r.teacher_id then r.student_name
    when public.is_admin() then r.student_name
    else public.short_display_name(r.student_name)
  end as student_name,
  r.stars,
  r.comment,
  r.created_at
from public.reviews r;

grant select on public.masked_reviews to anon, authenticated;

-- === WITHDRAWAL REQUESTS (migration_93.sql) ============================
-- A request queue for a teacher to cash out their earnings, not a real
-- payment rail - ARMUS has no bank payout integration, so a request here
-- just tells the admin team "this teacher wants ₺X sent to this IBAN";
-- the actual bank transfer still happens manually, outside the app, same
-- as every other admin-reviewed action in this codebase. The requested
-- amount is NOT re-validated against the teacher's real lifetime
-- earnings server-side - dashboard.html's own earnings-history math
-- already applies the current commission tier retroactively as an
-- estimate, and reproducing that (plus the trial-conversion logic) in a
-- trigger would just be a second copy of the same approximation to keep
-- in sync. The admin processing a request is the real check.
create table withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  amount numeric not null check (amount > 0),
  iban text not null,
  iban_name text not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'rejected')),
  admin_note text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references profiles(id)
);

alter table withdrawal_requests enable row level security;

create index withdrawal_requests_teacher_id_idx on withdrawal_requests(teacher_id);
create index withdrawal_requests_status_idx on withdrawal_requests(status);

create policy "withdrawal_requests_select_own_or_admin"
  on withdrawal_requests for select
  using (auth.uid() = teacher_id or public.is_admin());

create policy "withdrawal_requests_insert_own"
  on withdrawal_requests for insert
  with check (
    auth.uid() = teacher_id
    and status = 'pending'
    and coalesce((select status from profiles where id = auth.uid()), '') = 'approved'
    and coalesce((select is_banned from profiles where id = auth.uid()), false) = false
  );

create policy "withdrawal_requests_update_admin_only"
  on withdrawal_requests for update
  using (public.is_admin())
  with check (public.is_admin());

-- migration_95.sql: the unguessable secret in a teacher's subscribable
-- calendar-feed URL (dashboard.html's Uygunluk tab) - a calendar app
-- can't carry a Supabase session, so the feed is read through an
-- unauthenticated Edge Function instead of RLS, with this token standing
-- in for auth. Deliberately NOT added to enforce_teacher_profile_lock's
-- locked-field lists - like is_online/availability_dates, a teacher needs
-- to regenerate it instantly (if the URL ever leaks) with no admin
-- approval step in the way of a security action.
alter table profiles add column if not exists calendar_token uuid not null default gen_random_uuid();

-- === BLOCKED STUDENTS (migration_96.sql) ================================
-- Lets a teacher block one specific student from ever booking them
-- again (an abusive student, a repeat no-show, etc) - teacher-initiated
-- and scoped to that one teacher, unlike profiles.is_banned (platform-
-- wide, admin-only).
--
-- Enforcement has to live in a BEFORE INSERT trigger on bookings, not
-- an insert RLS policy: bookings has no client-facing insert policy at
-- all (every booking is created by a service-role Edge Function -
-- payment-callback after a real charge, or create-payment's
-- credit-covered path - see migration_22.sql), so RLS can't be the
-- choke point. A trigger fires for service-role inserts too, same as
-- messages_block_contact_sharing/enforce_no_contact_sharing above
-- (migration_16.sql) which this mirrors.
create table blocked_students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  blocked_at timestamptz not null default now(),
  unique (teacher_id, student_id)
);

alter table blocked_students enable row level security;

create policy "blocked_students_select_own"
  on blocked_students for select
  using (auth.uid() = teacher_id);

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

create trigger bookings_enforce_teacher_block
  before insert on bookings
  for each row execute procedure public.enforce_teacher_block();

-- === SUPPORT TICKETS (migration_97.sql) =================================
-- An internal support ticket system between a teacher and the ARMUS
-- admin team - dashboard.html's "Destek" panel to open a ticket and
-- reply, admin.html's "Destek Talepleri" panel to see every ticket and
-- reply/close it. Deliberately separate from conversations/messages
-- (student<->teacher chat) - this is teacher<->platform, has no "two
-- matched users" relationship to establish, and shouldn't be subject
-- to messages' contact-sharing filter or per-conversation rate limit.
--
-- No email notification on a new ticket/reply (unlike reviews/messages)
-- - same as pending_changes and withdrawal_requests, the admin panel's
-- own badge count is the notification.
create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  subject text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  sender_role text not null check (sender_role in ('teacher', 'admin')),
  body text not null,
  created_at timestamptz not null default now()
);

alter table support_tickets enable row level security;
alter table support_ticket_messages enable row level security;

create index support_tickets_teacher_id_idx on support_tickets(teacher_id);
create index support_ticket_messages_ticket_id_idx on support_ticket_messages(ticket_id);

create policy "support_tickets_select_own_or_admin"
  on support_tickets for select
  using (auth.uid() = teacher_id or public.is_admin());

create policy "support_tickets_insert_own"
  on support_tickets for insert
  with check (auth.uid() = teacher_id and status = 'open');

-- broad on purpose, same shape as messages_update_participant - either
-- side can open/close the ticket (a teacher closing their own resolved
-- issue, an admin closing a handled one, or an admin reopening one that
-- needs more attention)
create policy "support_tickets_update_own_or_admin"
  on support_tickets for update
  using (auth.uid() = teacher_id or public.is_admin())
  with check (auth.uid() = teacher_id or public.is_admin());

create policy "support_ticket_messages_select_participant"
  on support_ticket_messages for select
  using (
    exists (
      select 1 from support_tickets t
      where t.id = ticket_id
        and (t.teacher_id = auth.uid() or public.is_admin())
    )
  );

create policy "support_ticket_messages_insert_participant"
  on support_ticket_messages for insert
  with check (
    sender_id = auth.uid()
    and (
      (sender_role = 'teacher' and exists (
        select 1 from support_tickets t where t.id = ticket_id and t.teacher_id = auth.uid()
      ))
      or (sender_role = 'admin' and public.is_admin())
    )
  );

-- a new message bumps the ticket's updated_at (so admin.html can sort
-- by most-recently-active) and, if the TEACHER replies to a ticket the
-- admin had already closed, reopens it - mirrors how a real support
-- inbox behaves, so a teacher's follow-up never silently lands in a
-- closed thread nobody is watching
create or replace function public.support_ticket_bump_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update support_tickets
  set updated_at = now(),
      status = case when new.sender_role = 'teacher' then 'open' else status end
  where id = new.ticket_id;
  return new;
end;
$$;

create trigger support_ticket_messages_bump
  after insert on support_ticket_messages
  for each row execute procedure public.support_ticket_bump_on_message();
