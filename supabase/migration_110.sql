-- migration_110.sql: five money rules, decided together.
--
-- 1. One trial lesson per student per teacher. bookings_enforce_one_trial
--    refuses a second trial with the same teacher (AR005) - a trial is
--    only paid to the teacher if the student carries on, so a student
--    booking trial after trial with one teacher had them working for free.
--    A trial counts as taken unless it was cancelled with nothing lost
--    (a late cancellation still counts).
-- 2. A lesson credit remembers what it's worth (lesson_credits.value):
--    the price actually paid for that lesson. With its own teacher it
--    covers a lesson at that price, even if the teacher has raised theirs
--    since. Used for a trial with another teacher: a more expensive trial
--    is topped up by card (pending_payments.credit_id/booking_price, the
--    credit sits 'reserved' while the student is on iyzico's page); a
--    cheaper one is covered and the rest isn't paid back. A topped-up
--    lesson that's later cancelled gives the credit back worth the full
--    lesson, tied to that lesson's teacher (refund_booking_to_credit).
-- 3. Package lessons whose teacher can no longer teach this student
--    (banned, blocked them, account closed) - "stranded" - can be refunded
--    to the card or moved to another teacher (package-credits Edge
--    Function, my-lessons.html). A moved credit keeps its value and gets
--    transferred_at, so with the new teacher it follows the value rule
--    above instead of the price-locked own-teacher rule.
-- 4. payment-callback's reconcile mode runs every 15 minutes
--    (armus-reconcile-payments) and settles checkouts whose callback
--    never arrived: a charge iyzico confirms becomes the booking (or a
--    credit), an unpaid one expires.
-- 5. Teacher payouts wait 7 days after each lesson - that one is only
--    the dashboard/admin balance (bookings.js ARMUS_PAYOUT_HOLD_DAYS),
--    nothing here.
--
-- Run once, after migration_109.sql. Safe to re-run.

-- === lesson_credits ===================================================

alter table lesson_credits add column if not exists value numeric;
alter table lesson_credits add column if not exists source text;
alter table lesson_credits add column if not exists pending_payment_id uuid references pending_payments(id) on delete set null;
alter table lesson_credits add column if not exists reserved_payment_id uuid references pending_payments(id) on delete set null;
alter table lesson_credits add column if not exists transferred_at timestamptz;
alter table lesson_credits add column if not exists refunded_at timestamptz;

alter table lesson_credits drop constraint if exists lesson_credits_value_check;
alter table lesson_credits add constraint lesson_credits_value_check check (value is null or value >= 0);

alter table lesson_credits drop constraint if exists lesson_credits_source_check;
alter table lesson_credits add constraint lesson_credits_source_check
  check (source is null or source in ('package', 'refund', 'payment_issue', 'referral'));

alter table lesson_credits drop constraint if exists lesson_credits_status_check;
alter table lesson_credits add constraint lesson_credits_status_check
  check (status in ('available', 'used', 'reserved', 'refunded'));

-- === pending_payments =================================================

alter table pending_payments add column if not exists credit_id uuid references lesson_credits(id) on delete set null;
alter table pending_payments add column if not exists booking_price numeric;
alter table pending_payments add column if not exists last_reconciled_at timestamptz;
alter table pending_payments add column if not exists refunded_amount numeric not null default 0;

alter table pending_payments drop constraint if exists pending_payments_status_check;
alter table pending_payments add constraint pending_payments_status_check
  check (status in ('pending', 'processing', 'succeeded', 'failed', 'paid_no_booking', 'slot_taken', 'time_passed', 'expired'));

-- === backfill what existing credits are worth =========================
-- referral rewards and lessons that came back from a cancellation carry
-- the booking they came from
update lesson_credits c
set source = 'referral', value = coalesce(c.value, b.price)
from bookings b
where c.source is null
  and c.source_booking_id = b.id
  and b.student_id <> c.student_id;

update lesson_credits c
set source = 'refund', value = coalesce(c.value, b.price)
from bookings b
where c.source is null
  and c.source_booking_id = b.id
  and b.student_id = c.student_id;

-- package lessons and "paid but the slot was gone" credits only point at
-- their payment by time: the closest earlier payment of that kind by the
-- same student for the same teacher. Anything that can't be matched keeps
-- value = null, which every rule treats as "covers the lesson in full".
update lesson_credits c
set source = case when m.type = 'package' then 'package' else 'payment_issue' end,
    value = coalesce(c.value, round(m.price / greatest(coalesce(m.quantity, 1), 1), 2)),
    pending_payment_id = m.payment_id
from (
  select c2.id as credit_id, p.id as payment_id, p.type, p.price, p.quantity
  from lesson_credits c2
  cross join lateral (
    select pp.id, pp.type, pp.price, pp.quantity from pending_payments pp
    where pp.student_id = c2.student_id
      and pp.teacher_id = c2.teacher_id
      and (
        (pp.type = 'package' and pp.status = 'succeeded')
        or pp.status in ('slot_taken', 'time_passed')
      )
      and pp.created_at <= c2.created_at
      and pp.created_at > c2.created_at - interval '1 day'
    order by pp.created_at desc
    limit 1
  ) p
  where c2.source is null
    and c2.source_booking_id is null
) m
where c.id = m.credit_id;

-- === one trial per teacher (AR005) ====================================

create or replace function public.has_taken_trial(p_student_id uuid, p_teacher_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from bookings b
    where b.student_id = p_student_id
      and b.teacher_id = p_teacher_id
      and b.type = 'trial'
      and (b.status <> 'cancelled' or coalesce(b.late_cancel, false))
  );
$$;

revoke all on function public.has_taken_trial(uuid, text) from public, anon, authenticated;

create or replace function public.enforce_one_trial_per_teacher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type <> 'trial' or new.status = 'cancelled' then
    return new;
  end if;

  -- two checkouts for the same pair finishing at once would both pass
  -- the check below without this
  perform pg_advisory_xact_lock(hashtextextended('armus-trial:' || new.student_id::text || ':' || new.teacher_id, 0));

  if public.has_taken_trial(new.student_id, new.teacher_id) then
    raise exception using errcode = 'AR005', message = 'trial_already_taken: bu ogrenci bu ogretmenle zaten deneme dersi aldi';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_enforce_one_trial on bookings;
create trigger bookings_enforce_one_trial
  before insert on bookings
  for each row execute procedure public.enforce_one_trial_per_teacher();

-- === giving a cancelled lesson back ===================================
-- One rule for every refund-eligible cancellation (cancel-booking, an
-- upheld teacher no-show, a ban). The caller has already cancelled the
-- booking. Returns true when something went back to the student.
--   - card top-up on a credit (pending_payments.credit_id): that credit
--     comes back worth the whole lesson (its value + the card part),
--     tied to this lesson's teacher
--   - card-paid: a new credit with this teacher, worth what was paid
--   - credit-paid: that same credit back, unchanged
create or replace function public.refund_booking_to_credit(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  p record;
  done boolean := false;
begin
  select id, student_id, teacher_id, teacher_name, price into b from bookings where id = p_booking_id;
  if not found then
    return false;
  end if;

  select * into p from pending_payments
  where booking_id = b.id and status = 'succeeded'
  order by created_at desc
  limit 1;

  if p.id is not null and p.credit_id is not null then
    update lesson_credits
    set status = 'available', used_booking_id = null, used_at = null,
        value = coalesce(value, 0) + p.price,
        teacher_id = b.teacher_id, teacher_name = b.teacher_name,
        transferred_at = null
    where id = p.credit_id and used_booking_id = b.id and status = 'used';
    done := found;
  elsif p.id is not null then
    if not exists (
      select 1 from lesson_credits
      where source_booking_id = b.id and student_id = b.student_id and source = 'refund'
    ) then
      insert into lesson_credits (student_id, teacher_id, teacher_name, source_booking_id, value, source, pending_payment_id)
      values (b.student_id, b.teacher_id, b.teacher_name, b.id, p.price, 'refund', p.id);
      done := true;
    end if;
  else
    update lesson_credits
    set status = 'available', used_booking_id = null, used_at = null
    where used_booking_id = b.id and status = 'used';
    done := found;
  end if;

  if done then
    update bookings set refunded = true where id = b.id;
  end if;

  return done;
end;
$$;

revoke all on function public.refund_booking_to_credit(uuid) from public, anon, authenticated;

create or replace function public.refund_teacher_no_show_lesson(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = 'admin', teacher_no_show = true
  where id = p_booking_id and status = 'confirmed';

  if not found then
    return false;
  end if;

  perform public.refund_booking_to_credit(p_booking_id);
  return true;
end;
$$;

revoke all on function public.refund_teacher_no_show_lesson(uuid) from public, anon, authenticated;

create or replace function public.cancel_banned_teacher_future_lessons()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  cancelled_ids uuid[] := '{}';
begin
  for b in
    update bookings
    set status = 'cancelled', cancelled_at = now(), cancelled_by = 'admin'
    where teacher_id = new.id::text
      and status = 'confirmed'
      and ((lesson_date + lesson_time::time) at time zone teacher_timezone) > now()
    returning id
  loop
    perform public.refund_booking_to_credit(b.id);
    cancelled_ids := cancelled_ids || b.id;
  end loop;

  -- students holding package lessons with this teacher hear about it too
  -- (refund or move them - my-lessons.html), even with nothing booked
  if coalesce(array_length(cancelled_ids, 1), 0) > 0
     or exists (
       select 1 from lesson_credits
       where teacher_id = new.id::text and source = 'package' and status = 'available'
     ) then
    perform net.http_post(
      url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/notify-lessons-cancelled',
      headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
      body := jsonb_build_object('booking_ids', to_jsonb(cancelled_ids), 'reason', 'teacher_banned', 'teacher_id', new.id)
    );
  end if;

  return new;
end;
$$;

-- the referral reward now records what it's worth, like every other credit
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
    insert into lesson_credits (student_id, teacher_id, teacher_name, source_booking_id, value, source)
    values (v_referrer_id, new.teacher_id, new.teacher_name, new.id, new.price, 'referral');
  end if;

  return new;
end;
$$;

-- === stranded package lessons =========================================
-- Package lessons (source = 'package') still on the balance whose teacher
-- can't teach this student anymore: banned, blocking them, or no longer
-- an approved teacher. A teacher who's only hidden for review isn't
-- stranded - that ends one way or the other.
create or replace function public.stranded_package_credits(p_student_id uuid, p_teacher_id text default null)
returns setof lesson_credits
language sql
stable
security definer
set search_path = public
as $$
  select c.* from lesson_credits c
  left join profiles t on t.id::text = c.teacher_id
  where c.student_id = p_student_id
    and c.status = 'available'
    and c.source = 'package'
    and (p_teacher_id is null or c.teacher_id = p_teacher_id)
    and (
      t.id is null
      or coalesce(t.is_banned, false)
      or coalesce(t.status, '') <> 'approved'
      or exists (
        select 1 from blocked_students bs
        where bs.teacher_id::text = c.teacher_id and bs.student_id = c.student_id
      )
    );
$$;

revoke all on function public.stranded_package_credits(uuid, text) from public, anon, authenticated;

-- what my-lessons.html shows: one row per teacher
create or replace function public.my_stranded_package_credits()
returns table (teacher_id text, teacher_name text, lessons integer, total_value numeric, refundable boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.teacher_id,
         max(c.teacher_name),
         count(*)::integer,
         coalesce(sum(c.value), 0),
         bool_and(c.value is not null and p.iyzico_payment_transaction_id is not null)
  from public.stranded_package_credits(auth.uid()) c
  left join pending_payments p on p.id = c.pending_payment_id
  group by c.teacher_id;
$$;

revoke all on function public.my_stranded_package_credits() from public, anon;
grant execute on function public.my_stranded_package_credits() to authenticated;

-- === settle checkouts whose callback never came =======================
-- iyzico's checkout token lives 30 minutes, so 35 minutes after a
-- checkout started its outcome is final. Each row is looked at once
-- (last_reconciled_at); the call is only made when there's something to
-- look at. payment-callback must keep "Verify JWT" OFF (iyzico calls it).
select cron.schedule(
  'armus-reconcile-payments',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/payment-callback',
    headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
    body := '{"action": "reconcile"}'::jsonb
  )
  where exists (
    select 1 from pending_payments
    where status in ('pending', 'failed')
      and last_reconciled_at is null
      and created_at < now() - interval '35 minutes'
      and created_at > now() - interval '48 hours'
  )
  $$
);
