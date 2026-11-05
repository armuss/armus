-- migration_114.sql: the free level test (seviye-testi.html). Anyone can
-- take it without an account; each finished test is saved here so the
-- admin panel can count tests and how many of them turned into accounts.
-- A test taken while signed out can be attached to the account made
-- right after (claim_level_test, called from auth.js with the token the
-- page kept). Scoring happens in the page - this is a free self-check,
-- not an exam, so there is nothing to protect in the answers.
-- Run once in the Supabase SQL Editor; safe to run again.

-- === LEVEL TEST ========================================================

create table if not exists public.level_test_results (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references public.profiles(id) on delete set null,
  claim_token uuid not null default gen_random_uuid(),
  claimed_at timestamptz,
  level text not null check (level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  goal text check (goal in ('yds', 'ielts', 'work', 'speaking', 'travel', 'school')),
  grammar smallint not null check (grammar between 0 and 100),
  vocabulary smallint not null check (vocabulary between 0 and 100),
  reading smallint not null check (reading between 0 and 100),
  correct smallint not null check (correct between 0 and 40),
  skipped smallint not null check (skipped between 0 and 40),
  duration_seconds integer check (duration_seconds between 0 and 7200)
);

create index if not exists level_test_results_created_idx on public.level_test_results (created_at);
create index if not exists level_test_results_user_idx on public.level_test_results (user_id);

alter table public.level_test_results enable row level security;

drop policy if exists level_test_results_select_own on public.level_test_results;
create policy level_test_results_select_own on public.level_test_results
  for select using (user_id = auth.uid() or public.is_admin());

-- Written only through the two functions below.

create or replace function public.submit_level_test(
  p_level text, p_goal text, p_grammar integer, p_vocabulary integer, p_reading integer,
  p_correct integer, p_skipped integer, p_duration_seconds integer
)
returns table (id uuid, claim_token uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- the page is public, so keep a flood of fake results out of the numbers
  if (select count(*) from level_test_results r where r.created_at > now() - interval '1 minute') >= 60 then
    raise exception 'too many level tests, try again in a minute';
  end if;

  return query
  insert into level_test_results (user_id, level, goal, grammar, vocabulary, reading, correct, skipped, duration_seconds, claimed_at)
  values (auth.uid(), p_level, nullif(p_goal, ''), p_grammar, p_vocabulary, p_reading, p_correct, p_skipped, p_duration_seconds,
          case when auth.uid() is not null then now() end)
  returning level_test_results.id, level_test_results.claim_token;
end;
$$;

revoke all on function public.submit_level_test(text, text, integer, integer, integer, integer, integer, integer) from public;
grant execute on function public.submit_level_test(text, text, integer, integer, integer, integer, integer, integer) to anon, authenticated;

-- A signed-out test, attached to the account that was just made (or
-- signed into) on the same browser. Only within 7 days, only once.
create or replace function public.claim_level_test(p_id uuid, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  update level_test_results
  set user_id = auth.uid(), claimed_at = now()
  where id = p_id
    and claim_token = p_token
    and user_id is null
    and created_at > now() - interval '7 days';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.claim_level_test(uuid, uuid) from public, anon;
grant execute on function public.claim_level_test(uuid, uuid) to authenticated;

-- === GROWTH METRICS: + level tests ======================================

-- migration_113.sql's admin_growth_metrics, plus per month:
--   level_tests          finished level tests
--   level_test_accounts  ... of them now on an account (taken signed in,
--                        or claimed by the account made right after)

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
      (select ms.note from marketing_spend ms where ms.month = mo.month) as spend_note,
      (select count(*) from level_test_results lt where lt.created_at >= mo.m_start and lt.created_at < mo.m_end) as level_tests,
      (select count(*) from level_test_results lt where lt.created_at >= mo.m_start and lt.created_at < mo.m_end and lt.user_id is not null) as level_test_accounts
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
        'new_paying_with_spend', coalesce(sum(new_paying) filter (where spend is not null), 0),
        'level_tests', coalesce(sum(level_tests), 0),
        'level_test_accounts', coalesce(sum(level_test_accounts), 0)
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
