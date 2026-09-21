-- ARMUS migration 71: adds a "give a friend, get a free lesson" referral
-- program.
--
-- Mechanics:
--   1. Every profile gets a referral_code (set once, at signup, in
--      handle_new_user - existing rows are backfilled below).
--   2. register.html?ref=<code> resolves that code to a referrer_id via
--      the new resolve_referral_code() RPC (a security-definer function -
--      a plain user has no SELECT access to another profile's raw row,
--      so the code has to be resolved server-side rather than by
--      querying profiles directly) and inserts a "pending" referrals row
--      once the new account exists.
--   3. armus_reward_referral_on_first_real_booking (an AFTER INSERT
--      trigger on bookings) fires for every new booking. The first time
--      a referred student's booking is a REAL (non-trial) lesson, the
--      referral is marked "rewarded" and the REFERRER gets a
--      lesson_credit for that same teacher - "your friend booked a real
--      lesson with Teacher X, you get a free lesson with Teacher X too",
--      reusing the exact same same-teacher-credit semantics
--      cancel-booking already uses (see lesson_credits' own comment).
--      Requiring a real (paid) booking, not just a free trial, is the
--      anti-fraud gate - a scripted pending referral costs nothing to
--      create, but a real booking costs the referred account real money.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

-- === 1. referral_code on profiles =====================================

alter table profiles add column if not exists referral_code text;

-- backfill existing rows - 10 hex chars derived from the profile's own
-- uuid, so it's deterministic and doesn't need a retry-on-collision loop.
-- Not declared UNIQUE: handle_new_user runs inside the auth.users insert
-- transaction, and a hard uniqueness failure there would take down
-- signup itself over what is, at 10 hex chars (~1 trillion values), an
-- astronomically unlikely collision - resolve_referral_code() below just
-- takes the first match, which is a harmless mis-attribution in the
-- limit case, never a broken signup.
update profiles
set referral_code = upper(left(replace(id::text, '-', ''), 10))
where referral_code is null;

create index if not exists profiles_referral_code_idx on profiles (referral_code);

create or replace function public.handle_new_user()
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

-- === 2. referrals table ===============================================

create table if not exists referrals (
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

drop policy if exists "referrals_select_own" on referrals;
create policy "referrals_select_own"
  on referrals for select
  using (auth.uid() = referrer_id or auth.uid() = referred_id or public.is_admin());

-- referred_id being UNIQUE is also what stops referral farming via
-- repeated inserts - a given account can only ever be someone's referred
-- friend once, whichever referrer's link they used first.
drop policy if exists "referrals_insert_self" on referrals;
create policy "referrals_insert_self"
  on referrals for insert
  with check (auth.uid() = referred_id);

-- resolves a referral_code to the referrer's id without granting the
-- caller any broader read access to that profile's row (name, email,
-- etc stay invisible - only the id needed to file the referrals insert
-- comes back).
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

-- === 3. reward on the referred friend's first real booking ============

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

drop trigger if exists armus_reward_referral on bookings;
create trigger armus_reward_referral
  after insert on bookings
  for each row execute procedure public.armus_reward_referral_on_first_real_booking();
