-- migration_113.sql: the admin panel's growth numbers ("Büyüme" panel,
-- admin.html) - the three questions that say whether ARMUS works as a
-- business:
--   1. how many students continue after their trial lesson,
--   2. how many of those who started regular lessons are still taking
--      lessons the month after,
--   3. what it costs to bring in one paying student (ad spend, entered
--      by an admin per month, divided by new paying students).
-- Months are calendar months in Istanbul time. Run once in the Supabase
-- SQL Editor; safe to run again.

-- === AD SPEND ==========================================================

create table if not exists public.marketing_spend (
  month date primary key check (month = date_trunc('month', month)::date),
  amount numeric not null check (amount >= 0),
  note text,
  updated_at timestamptz not null default now()
);

alter table public.marketing_spend enable row level security;

drop policy if exists marketing_spend_admin_select on public.marketing_spend;
create policy marketing_spend_admin_select on public.marketing_spend
  for select using (public.is_admin());

-- Written only through admin_set_marketing_spend below.

create or replace function public.admin_set_marketing_spend(p_month date, p_amount numeric, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m date := date_trunc('month', p_month)::date;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_month is null then
    raise exception 'month required';
  end if;

  -- an empty amount clears the month
  if p_amount is null then
    delete from marketing_spend where month = m;
    return;
  end if;
  if p_amount < 0 then
    raise exception 'amount must be >= 0';
  end if;

  insert into marketing_spend (month, amount, note, updated_at)
  values (m, p_amount, nullif(trim(coalesce(p_note, '')), ''), now())
  on conflict (month) do update
    set amount = excluded.amount, note = excluded.note, updated_at = now();
end;
$$;

revoke all on function public.admin_set_marketing_spend(date, numeric, text) from public, anon;
grant execute on function public.admin_set_marketing_spend(date, numeric, text) to authenticated;

-- === GROWTH METRICS ====================================================

-- One row per month (oldest first, the current month last):
--   signups         students who registered that month
--   trials          trial lessons held that month (one per student-teacher
--                   pair; confirmed and already over)
--   converted_same  ... whose student went on with THAT teacher: a regular
--                   lesson (not cancelled, or cancelled late and paid) or
--                   a package - the same rule as armusTrialCountsAsEarned
--                   (bookings.js), which decides whether the trial fee goes
--                   to the teacher
--   converted_any   ... whose student went on with any teacher
--   cohort          students whose FIRST regular lesson was held that month
--   retained        ... who also have a regular lesson (held, upcoming or
--                   paid late cancel) in the following month
--   cohort_complete whether that following month is over (if not,
--                   `retained` can still grow)
--   new_paying      students whose first card payment was that month
--   cash_in         card payments that month, minus what was refunded
--   spend           ad spend entered for that month (null = not entered)
-- plus totals over the months shown, and all-time paying students with
-- their average net card payment.

create or replace function public.admin_growth_metrics(p_months integer default 6)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n integer := least(greatest(coalesce(p_months, 6), 1), 24);
  this_month date := date_trunc('month', now() at time zone 'Europe/Istanbul')::date;
  first_month date := (date_trunc('month', now() at time zone 'Europe/Istanbul') - make_interval(months => n - 1))::date;
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  with months as (
    select m::date as month,
           ((m::date)::timestamp at time zone 'Europe/Istanbul') as m_start,
           (((m + interval '1 month')::date)::timestamp at time zone 'Europe/Istanbul') as m_end,
           (((m + interval '2 month')::date)::timestamp at time zone 'Europe/Istanbul') as next_end
    from generate_series(first_month::timestamp, this_month::timestamp, interval '1 month') as m
  ),
  lessons as (
    select b.*,
           (b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone as starts_at
    from bookings b
  ),
  trials as (
    -- the first held trial of each student-teacher pair
    select distinct on (l.student_id, l.teacher_id)
           l.student_id, l.teacher_id, l.starts_at
    from lessons l
    where l.type = 'trial'
      and l.status = 'confirmed'
      and l.starts_at + interval '50 minutes' <= now()
    order by l.student_id, l.teacher_id, l.starts_at
  ),
  trial_outcomes as (
    select t.*,
           (
             exists (
               select 1 from bookings b
               where b.student_id = t.student_id and b.teacher_id = t.teacher_id
                 and b.type = 'lesson' and (b.status <> 'cancelled' or b.late_cancel)
             )
             or exists (
               select 1 from lesson_credits c
               where c.student_id = t.student_id and c.teacher_id = t.teacher_id
                 and (c.source = 'package' or (c.source is null and c.source_booking_id is null))
                 and c.status <> 'refunded'
             )
           ) as went_on_same,
           (
             exists (
               select 1 from bookings b
               where b.student_id = t.student_id
                 and b.type = 'lesson' and (b.status <> 'cancelled' or b.late_cancel)
             )
             or exists (
               select 1 from lesson_credits c
               where c.student_id = t.student_id
                 and (c.source = 'package' or (c.source is null and c.source_booking_id is null))
                 and c.status <> 'refunded'
             )
           ) as went_on_any
    from trials t
  ),
  first_regular as (
    select l.student_id, min(l.starts_at) as first_at
    from lessons l
    where l.type = 'lesson'
      and l.status = 'confirmed'
      and l.starts_at + interval '50 minutes' <= now()
    group by l.student_id
  ),
  paid as (
    select p.student_id, p.created_at,
           p.price - coalesce(p.refunded_amount, 0) as net
    from pending_payments p
    where p.status in ('succeeded', 'paid_no_booking', 'slot_taken', 'time_passed')
  ),
  first_paid as (
    select student_id, min(created_at) as first_at from paid group by student_id
  ),
  per_month as (
    select
      mo.month,
      (select count(*) from profiles pr
        where pr.role = 'student' and pr.created_at >= mo.m_start and pr.created_at < mo.m_end) as signups,
      (select count(*) from trial_outcomes o where o.starts_at >= mo.m_start and o.starts_at < mo.m_end) as trials,
      (select count(*) from trial_outcomes o where o.starts_at >= mo.m_start and o.starts_at < mo.m_end and o.went_on_same) as converted_same,
      (select count(*) from trial_outcomes o where o.starts_at >= mo.m_start and o.starts_at < mo.m_end and o.went_on_any) as converted_any,
      (select count(*) from first_regular f where f.first_at >= mo.m_start and f.first_at < mo.m_end) as cohort,
      (select count(*) from first_regular f
        where f.first_at >= mo.m_start and f.first_at < mo.m_end
          and exists (
            select 1 from lessons l
            where l.student_id = f.student_id and l.type = 'lesson'
              and (l.status = 'confirmed' or l.late_cancel)
              and l.starts_at >= mo.m_end and l.starts_at < mo.next_end
          )) as retained,
      (now() >= mo.next_end) as cohort_complete,
      (select count(*) from first_paid fp where fp.first_at >= mo.m_start and fp.first_at < mo.m_end) as new_paying,
      (select coalesce(sum(pd.net), 0) from paid pd where pd.created_at >= mo.m_start and pd.created_at < mo.m_end) as cash_in,
      (select ms.amount from marketing_spend ms where ms.month = mo.month) as spend,
      (select ms.note from marketing_spend ms where ms.month = mo.month) as spend_note
    from months mo
  )
  select jsonb_build_object(
    'generated_at', now(),
    'months', coalesce((select jsonb_agg(to_jsonb(pm) order by pm.month) from per_month pm), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
        'signups', coalesce(sum(signups), 0),
        'trials', coalesce(sum(trials), 0),
        'converted_same', coalesce(sum(converted_same), 0),
        'converted_any', coalesce(sum(converted_any), 0),
        -- retention only over months whose following month is over
        'cohort', coalesce(sum(cohort) filter (where cohort_complete), 0),
        'retained', coalesce(sum(retained) filter (where cohort_complete), 0),
        'new_paying', coalesce(sum(new_paying), 0),
        'cash_in', coalesce(sum(cash_in), 0),
        -- cost per paying student only over months with spend entered
        'spend', coalesce(sum(spend), 0),
        'new_paying_with_spend', coalesce(sum(new_paying) filter (where spend is not null), 0)
      )
      from per_month
    ),
    'paying_students', (select count(*) from first_paid),
    'avg_paid_per_student', (
      select case when count(distinct student_id) = 0 then null
                  else round(sum(net) / count(distinct student_id), 2) end
      from paid
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.admin_growth_metrics(integer) from public, anon;
grant execute on function public.admin_growth_metrics(integer) to authenticated;
