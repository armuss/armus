-- migration_112.sql: the lesson-rules batch (the 39-scenario list).
--
-- In the lesson
--   - lesson_presence: who was actually in the class room and for how long
--     (class.html / the app call lesson_heartbeat every minute while in the
--     call). The admin sees it next to every report.
--   - A report can be filed until 24 hours after the lesson ends.
--   - Neither side shows up (Preply's rule): the teacher is the one who has
--     to be there - a student who reports "the teacher didn't come" within
--     24 hours gets the lesson back if the teacher never joined, whether or
--     not the student joined. No report in 24 hours: the lesson counts as
--     held and the teacher is paid.
--   - Late teacher: up to 15 minutes is a warning (no hide, no money). Over
--     15 minutes the student chooses: the lesson went ahead with the time
--     left (a late report) or it counts as not held (a no-show report).
--   - Technical problem (attendance_reports.type = 'technical'): on the
--     teacher's side with under 25 minutes held -> the lesson comes back to
--     the student once an admin confirms; no penalty for the teacher. On the
--     student's side nothing comes back.
--   - False reports: an admin can dismiss a report as false
--     (false_report). 1st and 2nd: a warning email; 3rd: the student's
--     account is closed.
--   - 3 upheld teacher no-shows in 30 days: a "ban suggested" flag for the
--     admin (profiles.ban_suggested_at) plus an email to support.
-- Moving and cancelling
--   - A student can move one lesson at most 2 times; a teacher can propose
--     a new time at most 2 times per lesson (AR006).
--   - A teacher's cancellation less than 12 hours before the lesson counts
--     as 2 toward the 3-a-month cap (bookings.cancel_weight).
--   - Blocking a student cancels their lessons without counting toward the
--     cap - but unblocking within 30 days counts those cancellations after
--     all.
-- Reports and fraud
--   - teacher_reports: a student reports a teacher to the admin.
--   - Chargebacks: the admin records one on a payment -> the student's
--     account is locked (no booking, no messages), the teacher's pay for
--     that lesson is held (bookings.payout_hold) until the admin settles it.
--   - sign_in_events (kept 90 days) + pending_payments.client_ip /
--     card_fingerprint -> admin_fraud_flags(): a teacher and a student of
--     theirs signing in from the same IP, one card paying for several
--     student accounts of the same teacher.
-- Money rules
--   - A banned student loses everything: future lessons are cancelled
--     without refund, lesson credits are forfeited.
--   - Lesson credits expire 6 months after they're issued (reminder email 2
--     weeks before). A credit that comes back from a cancelled lesson gets
--     at least 30 more days. Credits stuck with a teacher who can't teach
--     the student anymore don't expire.
--   - A package can be withdrawn within 14 days of buying it if none of its
--     lessons were used: full refund to the card (package-credits
--     "withdraw"). The student agrees at checkout that the right of
--     withdrawal ends once a lesson starts (pending_payments.withdrawal_consent_at).
--   - A non-package lesson credit stuck with a teacher who can't teach the
--     student anymore can be refunded to the card after 30 days
--     (package-credits "refund_credits").
--   - Daylight-saving notices: a day or more before a lesson whose time in
--     the student's or teacher's own clock moves because one side's clocks
--     change, both get an email (policy-notices, bookings.dst_notice_sent).
--
-- Emails go through the new policy-notices Edge Function (Verify JWT OFF,
-- same x-armus-trigger-secret as the other trigger-fired functions).
--
-- Run once, after migration_111.sql. Safe to re-run.

-- === sending to policy-notices ========================================

create or replace function public.notify_policy(p_body jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/policy-notices',
    headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
    body := p_body
  );
end;
$$;

revoke all on function public.notify_policy(jsonb) from public, anon, authenticated;

-- === new columns ======================================================

alter table bookings add column if not exists technical_issue boolean not null default false;
alter table bookings add column if not exists cancel_weight smallint not null default 1;
alter table bookings drop constraint if exists bookings_cancel_weight_check;
alter table bookings add constraint bookings_cancel_weight_check check (cancel_weight between 1 and 2);
alter table bookings add column if not exists payout_hold boolean not null default false;
alter table bookings add column if not exists dst_notice_sent boolean not null default false;

alter table profiles add column if not exists ban_suggested_at timestamptz;
alter table profiles add column if not exists account_locked boolean not null default false;
alter table profiles add column if not exists account_locked_reason text;
alter table profiles add column if not exists account_locked_at timestamptz;

alter table pending_payments add column if not exists card_fingerprint text;
alter table pending_payments add column if not exists client_ip text;
alter table pending_payments add column if not exists withdrawal_consent_at timestamptz;
alter table pending_payments add column if not exists chargeback_at timestamptz;
alter table pending_payments add column if not exists chargeback_note text;
alter table pending_payments add column if not exists chargeback_outcome text;
alter table pending_payments drop constraint if exists pending_payments_chargeback_outcome_check;
alter table pending_payments add constraint pending_payments_chargeback_outcome_check
  check (chargeback_outcome is null or chargeback_outcome in ('won', 'lost'));

alter table lesson_credits add column if not exists expires_at timestamptz;
alter table lesson_credits add column if not exists expiry_reminder_sent_at timestamptz;
alter table lesson_credits drop constraint if exists lesson_credits_status_check;
alter table lesson_credits add constraint lesson_credits_status_check
  check (status in ('available', 'used', 'reserved', 'refunded', 'expired', 'forfeited'));

-- a user can't clear their own lock or "ban suggested" flag
create or replace function public.enforce_policy_columns_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or public.is_admin()
     or coalesce(current_setting('armus.attendance_system_update', true), '') = 'on' then
    return new;
  end if;

  if new.ban_suggested_at is distinct from old.ban_suggested_at
     or new.account_locked is distinct from old.account_locked
     or new.account_locked_reason is distinct from old.account_locked_reason
     or new.account_locked_at is distinct from old.account_locked_at then
    raise exception 'policy_lock: these fields can only be changed by an admin';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_enforce_policy_columns_lock on profiles;
create trigger profiles_enforce_policy_columns_lock
  before update on profiles
  for each row execute procedure public.enforce_policy_columns_lock();

-- === LESSON PRESENCE ==================================================

create table if not exists lesson_presence (
  booking_id uuid not null references bookings(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('student', 'teacher')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seconds_present integer not null default 0,
  primary key (booking_id, user_id)
);

alter table lesson_presence enable row level security;

drop policy if exists "lesson_presence_select_participant_or_admin" on lesson_presence;
create policy "lesson_presence_select_participant_or_admin"
  on lesson_presence for select
  using (
    public.is_admin()
    or exists (
      select 1 from bookings b
      where b.id = booking_id
        and (b.student_id = auth.uid() or b.teacher_id = auth.uid()::text)
    )
  );

-- Called about once a minute by whoever is in the class room. Only the
-- lesson's own student/teacher, only from 15 minutes before the start to
-- 20 minutes after the end. A gap of more than 90 seconds between two
-- calls isn't counted as time present.
create or replace function public.lesson_heartbeat(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  me uuid := auth.uid();
  my_role text;
  starts timestamptz;
begin
  if me is null then
    return;
  end if;

  select id, student_id, teacher_id, status, lesson_date, lesson_time, teacher_timezone
  into b from bookings where id = p_booking_id;
  if not found or b.status <> 'confirmed' then
    return;
  end if;

  if b.student_id = me then
    my_role := 'student';
  elsif b.teacher_id = me::text then
    my_role := 'teacher';
  else
    return;
  end if;

  starts := (b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone;
  if now() < starts - interval '15 minutes' or now() > starts + interval '70 minutes' then
    return;
  end if;

  insert into lesson_presence (booking_id, user_id, role)
  values (b.id, me, my_role)
  on conflict (booking_id, user_id) do update
    set seconds_present = lesson_presence.seconds_present
          + least(greatest(extract(epoch from now() - lesson_presence.last_seen_at), 0), 90)::integer,
        last_seen_at = now();
end;
$$;

revoke all on function public.lesson_heartbeat(uuid) from public, anon;
grant execute on function public.lesson_heartbeat(uuid) to authenticated;

-- === ATTENDANCE REPORTS ===============================================

alter table attendance_reports drop constraint if exists attendance_reports_type_check;
alter table attendance_reports add constraint attendance_reports_type_check
  check (type in ('no_show', 'late', 'technical'));
-- technical: whose side the problem was on, and how many minutes the
-- lesson could still be held
alter table attendance_reports add column if not exists tech_side text;
alter table attendance_reports add column if not exists minutes_held integer;
alter table attendance_reports drop constraint if exists attendance_reports_tech_side_check;
alter table attendance_reports add constraint attendance_reports_tech_side_check
  check ((type = 'technical') = (tech_side is not null) and (tech_side is null or tech_side in ('teacher', 'student')));
alter table attendance_reports drop constraint if exists attendance_reports_minutes_held_check;
alter table attendance_reports add constraint attendance_reports_minutes_held_check
  check (minutes_held is null or minutes_held between 0 and 50);
-- set by the admin when dismissing a report the student made up
alter table attendance_reports add column if not exists false_report boolean not null default false;

-- the student's own report on their own lesson: from the start (a no-show
-- after a 10-minute grace) until 24 hours after the lesson ends; always
-- arrives "open"
drop policy if exists "attendance_reports_insert_own_student" on attendance_reports;
create policy "attendance_reports_insert_own_student"
  on attendance_reports for insert
  with check (
    auth.uid() = student_id
    and status = 'open'
    and not false_report
    and exists (
      select 1 from bookings b
      where b.id = booking_id
        and b.student_id = auth.uid()
        and b.status = 'confirmed'
        and b.teacher_id = attendance_reports.teacher_id
        and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone)
            <= now() - (case when attendance_reports.type = 'no_show' then interval '10 minutes' else interval '0' end)
        and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone)
            + interval '50 minutes' + interval '24 hours' >= now()
    )
  );

-- only "the teacher never came" hides them while it's reviewed - a late
-- start is a warning, a technical problem isn't misconduct
create or replace function public.handle_new_attendance_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- migration_112.sql: only "the teacher never came" hides them while
  -- it's reviewed - a late start is a warning, a technical problem isn't
  -- misconduct
  if new.type <> 'no_show' then
    return new;
  end if;

  perform set_config('armus.attendance_system_update', 'on', true);

  update profiles
  set hidden_from_new_students = true,
      hidden_reason = coalesce(penalty_hide_reason, new.type),
      hidden_at = now()
  where id::text = new.teacher_id
    and coalesce(is_banned, false) = false;

  return new;
end;
$$;

-- a technical problem on the teacher's side cut the lesson short: back
-- to the student, out of the teacher's pay, no penalty
create or replace function public.refund_technical_issue_lesson(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = 'admin', technical_issue = true
  where id = p_booking_id and status = 'confirmed';

  if not found then
    return false;
  end if;

  perform public.refund_booking_to_credit(p_booking_id);
  return true;
end;
$$;

revoke all on function public.refund_technical_issue_lesson(uuid) from public, anon, authenticated;

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
  booking_type text;
  new_trial_count integer;
  new_tier integer;
  unhide_at timestamptz;
  requires_ack boolean;
  false_count integer;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  perform set_config('armus.attendance_system_update', 'on', true);

  if new.status = 'dismissed' then

    -- migration_112.sql: a made-up report - warn the student twice, close
    -- their account on the third
    if new.false_report then
      select count(*) into false_count
      from attendance_reports
      where student_id = new.student_id and false_report;

      if false_count >= 3 then
        update profiles set is_banned = true, banned_at = now()
        where id = new.student_id and coalesce(is_banned, false) = false;
      end if;

      perform public.notify_policy(jsonb_build_object('type', 'false_report', 'report_id', new.id, 'count', false_count));
    end if;

    -- another no-show report still waiting for review keeps the hide in
    -- place (only those hide - migration_112.sql)
    if exists (
      select 1 from attendance_reports
      where teacher_id = new.teacher_id and status in ('open', 'explained') and id <> new.id
        and type = 'no_show'
    ) then
      return new;
    end if;

    -- migration_104.sql: nothing else pending - back to whatever penalty
    -- is actually in force (penalty_hide_reason), independent of this
    -- false alarm. This used to refuse to unhide anyone with an upheld
    -- report ANYWHERE in their history, including one long since served
    -- (a tier-1 trial hide is cleared the same day) or already lifted by
    -- an admin - so for any teacher with a past upheld report, a later
    -- false alarm, once dismissed, left them hidden from new students
    -- indefinitely. An active hidden_until (the hidden-from-everyone
    -- escalation) is its own column with its own expiry and is left
    -- alone; every path that sets it also sets a penalty, so the old
    -- "coalesce(hidden_until, now()) <= now()" guard here is no longer
    -- needed (and it's what stranded a teacher whose false alarm was
    -- dismissed DURING an escalation - nothing ever came back to unhide
    -- them after it expired).
    update profiles
    set hidden_from_new_students = (penalty_hide_reason is not null),
        hidden_reason = penalty_hide_reason,
        hidden_at = case when penalty_hide_reason is null then null else hidden_at end
    where id::text = new.teacher_id;
    return new;
  end if;

  if new.status = 'upheld' then

    if new.type = 'no_show' then

      -- migration_106.sql: the lesson never happened - back to the
      -- student, out of the teacher's pay (it used to stay "confirmed"
      -- and count as a completed, paid lesson)
      if public.refund_teacher_no_show_lesson(new.booking_id) then
        perform public.notify_teacher_no_show_refunds(array[new.booking_id]);
      end if;

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

          -- migration_112.sql: and the admin is told to consider a ban
          -- (once per 30 days)
          update profiles
          set ban_suggested_at = now()
          where id::text = new.teacher_id
            and coalesce(is_banned, false) = false
            and (ban_suggested_at is null or ban_suggested_at < now() - interval '30 days');
          if found then
            perform public.notify_policy(jsonb_build_object('type', 'ban_suggestion', 'teacher_id', new.teacher_id, 'count', recent_no_shows));
          end if;
        end if;
      end if;

      -- migration_100.sql: a SEPARATE, finer-grained ladder for a missed
      -- TRIAL specifically (a new student's first impression) - counts
      -- LIFETIME upheld trial no-shows and escalates per occurrence,
      -- independent of (and in addition to) the flat thresholds just
      -- above. Only ever hides from NEW students (hidden_from_new_students),
      -- never the harsher hidden-from-everyone tier, and is only ever
      -- cleared by the teacher's own action (self_unhide_from_new_students
      -- below) once eligible - never automatically.
      select b.type into booking_type from bookings b where b.id = new.booking_id;

      if booking_type = 'trial' then
        update profiles
        set trial_noshow_count = trial_noshow_count + 1
        where id::text = new.teacher_id
        returning trial_noshow_count into new_trial_count;

        if new_trial_count is not null then
          new_tier := least(new_trial_count, 5);

          unhide_at := case new_tier
            when 1 then now()
            when 2 then now() + interval '7 days'
            when 3 then now() + interval '14 days'
            when 4 then now() + interval '30 days'
            else now() + interval '730 days'
          end;
          requires_ack := new_tier <= 2;

          -- migration_104.sql: records the penalty, but never downgrades
          -- an admin-only regular penalty already in force into this
          -- self-service one
          update profiles
          set hidden_from_new_students = true,
              penalty_hide_reason = case when penalty_hide_reason in ('no_show', 'late') then penalty_hide_reason else 'trial_no_show' end,
              hidden_reason = case when penalty_hide_reason in ('no_show', 'late') then penalty_hide_reason else 'trial_no_show' end,
              hidden_at = now(),
              trial_hidden_tier = new_tier,
              trial_unhide_eligible_at = unhide_at,
              trial_unhide_requires_ack = requires_ack
          where id::text = new.teacher_id
            and coalesce(is_banned, false) = false;
        end if;
      else
        -- migration_104.sql: a regular (non-trial) upheld no-show keeps
        -- the teacher hidden from new students until an admin clears it
        -- - the existing behavior, now recorded as a penalty instead of
        -- only implied by the report having been pending
        update profiles
        set hidden_from_new_students = true,
            penalty_hide_reason = 'no_show',
            hidden_reason = 'no_show'
        where id::text = new.teacher_id;
      end if;

    elsif new.type = 'late' then

      -- migration_112.sql: a confirmed late start is a warning - no hide.
      -- Only a pattern (over 5% of a month's lessons) still hides the
      -- teacher from everyone for 30 days.
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

    elsif new.type = 'technical' then

      -- migration_112.sql: the teacher's side, under 25 minutes held - the
      -- lesson goes back to the student, no penalty
      if new.tech_side = 'teacher' and coalesce(new.minutes_held, 0) < 25 then
        if public.refund_technical_issue_lesson(new.booking_id) then
          perform public.notify_policy(jsonb_build_object('type', 'technical_refund', 'booking_id', new.booking_id));
        end if;
      end if;

    end if;

  end if;

  return new;
end;
$$;

-- === TEACHER CANCELLATION CAP: weights, block/unblock ================

create or replace function public.enforce_teacher_monthly_cancel_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  monthly_limit constant int := 3;
  tz text := coalesce(new.teacher_timezone, 'Europe/Istanbul');
  month_start timestamptz;
  used int;
begin
  -- migration_112.sql: an unblock within 30 days counting earlier block
  -- cancellations after the fact (count_block_cancellations_on_unblock) -
  -- those already happened
  if coalesce(current_setting('armus.cancel_recount', true), '') = 'on' then
    return new;
  end if;

  -- one teacher's cancellations are counted one at a time, so two
  -- racing cancels can't both slip in as the 3rd
  perform pg_advisory_xact_lock(hashtext('teacher_cancel:' || new.teacher_id));

  month_start := date_trunc('month', now() at time zone tz) at time zone tz;

  -- migration_112.sql: a cancellation less than 12 hours before the
  -- lesson weighs 2
  select coalesce(sum(cancel_weight), 0) into used
  from bookings
  where teacher_id = new.teacher_id
    and counts_as_teacher_cancel
    and cancelled_at >= month_start
    and id <> new.id;

  if used + coalesce(new.cancel_weight, 1) > monthly_limit then
    raise exception using errcode = 'AR003', message = 'teacher_cancel_limit: bu ay en fazla 3 ders iptal edebilirsin';
  end if;

  return new;
end;
$$;

create or replace function public.count_block_cancellations_on_unblock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.blocked_at < now() - interval '30 days' then
    return old;
  end if;

  perform set_config('armus.cancel_recount', 'on', true);

  update bookings
  set counts_as_teacher_cancel = true
  where teacher_id = old.teacher_id::text
    and student_id = old.student_id
    and status = 'cancelled'
    and cancelled_by = 'teacher'
    and not counts_as_teacher_cancel
    and cancelled_at >= old.blocked_at - interval '5 minutes';

  perform set_config('armus.cancel_recount', 'off', true);
  return old;
end;
$$;

drop trigger if exists blocked_students_recount_on_unblock on blocked_students;
create trigger blocked_students_recount_on_unblock
  after delete on blocked_students
  for each row execute procedure public.count_block_cancellations_on_unblock();

-- === RESCHEDULE LIMITS ================================================

create or replace function public.enforce_reschedule_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if new.requested_by = 'student' then
    select count(*) into n from reschedule_requests
    where booking_id = new.booking_id and requested_by = 'student' and status = 'accepted';
    if n >= 2 then
      raise exception using errcode = 'AR006', message = 'reschedule_limit: bir ders en fazla 2 kez taşınabilir';
    end if;
  else
    select count(*) into n from reschedule_requests
    where booking_id = new.booking_id and requested_by = 'teacher';
    if n >= 2 then
      raise exception using errcode = 'AR006', message = 'proposal_limit: bir ders için en fazla 2 yeni saat önerilebilir';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists reschedule_requests_enforce_limits on reschedule_requests;
create trigger reschedule_requests_enforce_limits
  before insert on reschedule_requests
  for each row execute procedure public.enforce_reschedule_limits();

-- === TEACHER REPORTS ==================================================

create table if not exists teacher_reports (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  reporter_id uuid not null references profiles(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  reason text not null check (reason in ('harassment', 'inappropriate', 'payment_bypass', 'scam', 'unprofessional', 'other')),
  note text check (note is null or char_length(note) <= 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  admin_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id) on delete set null
);

create index if not exists teacher_reports_teacher_id_idx on teacher_reports(teacher_id);
-- one open report per student per teacher
create unique index if not exists teacher_reports_one_open
  on teacher_reports(teacher_id, reporter_id) where status = 'open';

alter table teacher_reports enable row level security;

drop policy if exists "teacher_reports_select_own_or_admin" on teacher_reports;
create policy "teacher_reports_select_own_or_admin"
  on teacher_reports for select
  using (auth.uid() = reporter_id or public.is_admin());

-- only someone who actually had a lesson or a conversation with them
drop policy if exists "teacher_reports_insert_own" on teacher_reports;
create policy "teacher_reports_insert_own"
  on teacher_reports for insert
  with check (
    auth.uid() = reporter_id
    and status = 'open'
    and admin_note is null
    and resolved_at is null
    and resolved_by is null
    and (
      exists (
        select 1 from bookings b
        where b.student_id = auth.uid() and b.teacher_id = teacher_reports.teacher_id::text
          and (booking_id is null or b.id = booking_id)
      )
      or (
        booking_id is null
        and exists (
          select 1 from conversations c
          where c.student_id = auth.uid() and c.teacher_id = teacher_reports.teacher_id
        )
      )
    )
  );

drop policy if exists "teacher_reports_update_admin" on teacher_reports;
create policy "teacher_reports_update_admin"
  on teacher_reports for update
  using (public.is_admin())
  with check (public.is_admin());

-- === BANNED OR LOCKED STUDENTS CAN'T BOOK =============================

create or replace function public.enforce_student_can_book()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from profiles p
    where p.id = new.student_id
      and (coalesce(p.is_banned, false) or coalesce(p.account_locked, false))
  ) then
    raise exception using errcode = 'AR007', message = 'student_locked: bu hesap ders alamaz';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_enforce_student_can_book on bookings;
create trigger bookings_enforce_student_can_book
  before insert on bookings
  for each row execute procedure public.enforce_student_can_book();

-- a locked account can't message either (banned ones already couldn't)
drop policy if exists "messages_insert_own" on messages;
create policy "messages_insert_own"
  on messages for insert
  with check (
    sender_id = auth.uid()
    and coalesce((select is_banned from profiles where id = auth.uid()), false) = false
    and coalesce((select account_locked from profiles where id = auth.uid()), false) = false
    and exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
        and not public.is_pair_blocked(c.teacher_id, c.student_id)
    )
    and public.messages_under_rate_limit()
  );

-- === A BANNED STUDENT LOSES EVERYTHING ================================

create or replace function public.forfeit_banned_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  cancelled_ids uuid[] := '{}';
  forfeited integer;
begin
  for b in
    update bookings
    set status = 'cancelled', cancelled_at = now(), cancelled_by = 'admin'
    where student_id = new.id
      and status = 'confirmed'
      and ((lesson_date + lesson_time::time) at time zone teacher_timezone) > now()
    returning id
  loop
    cancelled_ids := cancelled_ids || b.id;
  end loop;

  update lesson_credits
  set status = 'forfeited'
  where student_id = new.id and status in ('available', 'reserved');
  get diagnostics forfeited = row_count;

  perform public.notify_policy(jsonb_build_object(
    'type', 'student_banned',
    'student_id', new.id,
    'booking_ids', to_jsonb(cancelled_ids),
    'forfeited_credits', forfeited
  ));

  return new;
end;
$$;

drop trigger if exists profiles_forfeit_on_student_ban on profiles;
create trigger profiles_forfeit_on_student_ban
  after update on profiles
  for each row
  when (coalesce(old.is_banned, false) = false and new.is_banned = true and new.role = 'student')
  execute procedure public.forfeit_banned_student();

-- === CHARGEBACKS ======================================================
-- pending_payments has no client policies; the admin panel goes through
-- these (admin only).

create or replace function public.admin_find_payments(p_query text)
returns table (
  id uuid, type text, status text, price numeric, refunded_amount numeric, created_at timestamptz,
  student_id uuid, student_name text, student_email text, teacher_id text, teacher_name text,
  booking_id uuid, lesson_date date, lesson_time text, iyzico_payment_id text, card_fingerprint text,
  chargeback_at timestamptz, chargeback_note text, chargeback_outcome text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := lower(trim(coalesce(p_query, '')));
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  return query
  select p.id, p.type, p.status, p.price, coalesce(p.refunded_amount, 0), p.created_at,
         p.student_id, s.name, s.email, p.teacher_id, p.teacher_name,
         b.id, b.lesson_date, b.lesson_time, p.iyzico_payment_id, p.card_fingerprint,
         p.chargeback_at, p.chargeback_note, p.chargeback_outcome
  from pending_payments p
  left join profiles s on s.id = p.student_id
  left join bookings b on b.id = p.booking_id
  where p.status = 'succeeded'
    and (
      q = ''
      or lower(coalesce(s.email, '')) like '%' || q || '%'
      or lower(coalesce(s.name, '')) like '%' || q || '%'
      or lower(coalesce(p.iyzico_payment_id, '')) = q
      or p.id::text = q
      or p.chargeback_at is not null and q = 'chargeback'
    )
  order by p.chargeback_at desc nulls last, p.created_at desc
  limit 50;
end;
$$;

revoke all on function public.admin_find_payments(text) from public, anon;
grant execute on function public.admin_find_payments(text) to authenticated;

-- the lessons a payment paid for: its own booking, or every lesson booked
-- with one of its package's credits
create or replace function public.bookings_paid_by(p_payment_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select booking_id from pending_payments where id = p_payment_id and booking_id is not null
  union
  select used_booking_id from lesson_credits where pending_payment_id = p_payment_id and used_booking_id is not null;
$$;

revoke all on function public.bookings_paid_by(uuid) from public, anon, authenticated;

create or replace function public.admin_record_chargeback(p_payment_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  update pending_payments
  set chargeback_at = coalesce(chargeback_at, now()), chargeback_note = p_note, chargeback_outcome = null
  where id = p_payment_id and status = 'succeeded'
  returning * into p;
  if not found then
    raise exception 'payment not found';
  end if;

  update bookings set payout_hold = true
  where id in (select public.bookings_paid_by(p.id));

  update profiles
  set account_locked = true, account_locked_reason = 'chargeback', account_locked_at = now()
  where id = p.student_id;
end;
$$;

revoke all on function public.admin_record_chargeback(uuid, text) from public, anon;
grant execute on function public.admin_record_chargeback(uuid, text) to authenticated;

-- won: the teacher is paid, the account opens again (unless another
-- chargeback is still open). lost: the money went back to the card - the
-- teacher isn't paid for those lessons, unused package lessons are gone,
-- the account stays locked.
create or replace function public.admin_resolve_chargeback(p_payment_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_outcome not in ('won', 'lost') then
    raise exception 'outcome must be won or lost';
  end if;

  update pending_payments
  set chargeback_outcome = p_outcome
  where id = p_payment_id and chargeback_at is not null
  returning * into p;
  if not found then
    raise exception 'no chargeback on this payment';
  end if;

  if p_outcome = 'won' then
    update bookings set payout_hold = false
    where id in (select public.bookings_paid_by(p.id));

    if not exists (
      select 1 from pending_payments
      where student_id = p.student_id and chargeback_at is not null and chargeback_outcome is null
    ) then
      update profiles
      set account_locked = false, account_locked_reason = null, account_locked_at = null
      where id = p.student_id and account_locked_reason = 'chargeback';
    end if;
  else
    update lesson_credits set status = 'forfeited'
    where pending_payment_id = p.id and status in ('available', 'reserved');
  end if;
end;
$$;

revoke all on function public.admin_resolve_chargeback(uuid, text) from public, anon;
grant execute on function public.admin_resolve_chargeback(uuid, text) to authenticated;

-- what the admin sends iyzico: the payment, the lessons it paid for, who
-- was in each lesson and for how long, any report, the review
create or replace function public.admin_chargeback_evidence(p_payment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select jsonb_build_object(
    'payment', to_jsonb(p) - 'iyzico_token',
    'student', (select jsonb_build_object('id', s.id, 'name', s.name, 'email', s.email, 'created_at', s.created_at) from profiles s where s.id = p.student_id),
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'type', b.type, 'date', b.lesson_date, 'time', b.lesson_time, 'timezone', b.teacher_timezone,
        'status', b.status, 'price', b.price, 'teacher_name', b.teacher_name,
        'presence', coalesce((
          select jsonb_agg(jsonb_build_object('role', lp.role, 'first_seen_at', lp.first_seen_at, 'last_seen_at', lp.last_seen_at, 'minutes', round(lp.seconds_present / 60.0)))
          from lesson_presence lp where lp.booking_id = b.id
        ), '[]'::jsonb),
        'report', (select jsonb_build_object('type', r.type, 'status', r.status, 'created_at', r.created_at) from attendance_reports r where r.booking_id = b.id),
        'review', (select jsonb_build_object('stars', rv.stars, 'comment', rv.comment, 'created_at', rv.created_at) from reviews rv where rv.booking_id = b.id)
      ) order by b.lesson_date, b.lesson_time)
      from bookings b where b.id in (select public.bookings_paid_by(p.id))
    ), '[]'::jsonb),
    'messages_between', (
      select count(*) from messages m
      join conversations c on c.id = m.conversation_id
      where c.student_id = p.student_id and c.teacher_id::text = p.teacher_id
    )
  ) into result
  from pending_payments p
  where p.id = p_payment_id;

  return result;
end;
$$;

revoke all on function public.admin_chargeback_evidence(uuid) from public, anon;
grant execute on function public.admin_chargeback_evidence(uuid) to authenticated;

-- === SIGN-INS AND FRAUD FLAGS =========================================

create table if not exists sign_in_events (
  id bigserial primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  ip text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists sign_in_events_user_id_idx on sign_in_events(user_id);
create index if not exists sign_in_events_ip_idx on sign_in_events(ip);

alter table sign_in_events enable row level security;

drop policy if exists "sign_in_events_select_admin" on sign_in_events;
create policy "sign_in_events_select_admin"
  on sign_in_events for select
  using (public.is_admin());

create index if not exists pending_payments_card_fingerprint_idx on pending_payments(card_fingerprint);

-- A teacher and a student of theirs signing in (or paying) from the same
-- IP, and one card paying for two or more student accounts that booked
-- the same teacher - reasons to look, not proof.
create or replace function public.admin_fraud_flags()
returns table (teacher_id uuid, teacher_name text, student_id uuid, student_name text, reason text, detail text, last_seen timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  return query
  with pairs as (
    select distinct b.student_id as s_id, b.teacher_id::uuid as t_id
    from bookings b
    where b.teacher_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  same_ip as (
    select pr.t_id, pr.s_id, se.ip, max(greatest(se.created_at, te.created_at)) as seen
    from pairs pr
    join sign_in_events te on te.user_id = pr.t_id
    join sign_in_events se on se.user_id = pr.s_id and se.ip = te.ip
    group by pr.t_id, pr.s_id, se.ip
    union all
    select pr.t_id, pr.s_id, pp.client_ip, max(pp.created_at)
    from pairs pr
    join pending_payments pp on pp.student_id = pr.s_id and pp.client_ip is not null
    join sign_in_events te on te.user_id = pr.t_id and te.ip = pp.client_ip
    group by pr.t_id, pr.s_id, pp.client_ip
  ),
  cards as (
    select pr.t_id, pp.card_fingerprint as card, pp.student_id as s_id, max(pp.created_at) as seen
    from pending_payments pp
    join pairs pr on pr.s_id = pp.student_id
    where pp.card_fingerprint is not null and pp.status = 'succeeded'
    group by pr.t_id, pp.card_fingerprint, pp.student_id
  ),
  shared_cards as (
    select c.t_id, c.s_id, c.card, c.seen,
           count(*) over (partition by c.t_id, c.card) as accounts
    from cards c
  )
  select x.t_id, t.name, x.s_id, s.name, x.reason, x.detail, x.seen
  from (
    select si.t_id, si.s_id, 'same_ip'::text as reason, 'IP ' || si.ip as detail, max(si.seen) as seen
    from same_ip si
    group by si.t_id, si.s_id, si.ip
    union all
    select sc.t_id, sc.s_id, 'shared_card', 'Kart ' || sc.card || ' · ' || sc.accounts || ' hesap', sc.seen
    from shared_cards sc
    where sc.accounts >= 2
  ) x
  left join profiles t on t.id = x.t_id
  left join profiles s on s.id = x.s_id
  order by x.seen desc
  limit 300;
end;
$$;

revoke all on function public.admin_fraud_flags() from public, anon;
grant execute on function public.admin_fraud_flags() to authenticated;

-- === LESSON CREDIT EXPIRY =============================================

create or replace function public.set_lesson_credit_expiry()
returns trigger
language plpgsql
as $$
begin
  if new.expires_at is null then
    new.expires_at := now() + interval '6 months';
  end if;
  return new;
end;
$$;

drop trigger if exists lesson_credits_set_expiry on lesson_credits;
create trigger lesson_credits_set_expiry
  before insert on lesson_credits
  for each row execute procedure public.set_lesson_credit_expiry();

-- credits issued before this rule get the full 6 months from today
update lesson_credits set expires_at = now() + interval '6 months' where expires_at is null;

-- refund_booking_to_credit (migration_110.sql) with one change: a credit
-- coming back from a cancelled lesson has at least 30 days left
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
        transferred_at = null,
        -- migration_112.sql: at least 30 days left once it's back
        expires_at = greatest(coalesce(expires_at, now()), now() + interval '30 days')
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
    set status = 'available', used_booking_id = null, used_at = null,
        expires_at = greatest(coalesce(expires_at, now()), now() + interval '30 days')
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

-- a credit is "stuck" when its (real) teacher can't teach this student
-- anymore: gone, banned, no longer approved, or blocking them
create or replace function public.lesson_credit_is_stuck(p_student_id uuid, p_teacher_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_teacher_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (
      not exists (select 1 from profiles t where t.id::text = p_teacher_id)
      or exists (
        select 1 from profiles t
        where t.id::text = p_teacher_id
          and (coalesce(t.is_banned, false) or coalesce(t.status, '') <> 'approved')
      )
      or exists (
        select 1 from blocked_students bs
        where bs.teacher_id::text = p_teacher_id and bs.student_id = p_student_id
      )
    );
$$;

revoke all on function public.lesson_credit_is_stuck(uuid, text) from public, anon, authenticated;

create or replace function public.expire_lesson_credits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update lesson_credits c
  set status = 'expired'
  where c.status = 'available'
    and c.expires_at <= now()
    and not public.lesson_credit_is_stuck(c.student_id, c.teacher_id);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.expire_lesson_credits() from public, anon, authenticated;

-- === STUCK LESSON CREDITS: REFUND AFTER 30 DAYS =======================
-- Package lessons have their own refund/transfer (migration_110.sql). A
-- credit that came back from a paid lesson, stuck with a teacher who can't
-- teach the student anymore, can go back to the card 30 days after it
-- got stuck (until then it still works for a trial with another teacher).

create or replace function public.stranded_lesson_credits(p_student_id uuid, p_teacher_id text default null)
returns table (credit_id uuid, teacher_id text, teacher_name text, value numeric, pending_payment_id uuid, stuck_since timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.teacher_id, c.teacher_name, c.value, c.pending_payment_id,
         greatest(c.created_at, coalesce(bs.blocked_at, t.banned_at, c.created_at))
  from lesson_credits c
  left join profiles t on t.id::text = c.teacher_id
  left join blocked_students bs on bs.teacher_id::text = c.teacher_id and bs.student_id = c.student_id
  where c.student_id = p_student_id
    and c.status = 'available'
    and c.source in ('refund', 'payment_issue')
    and (p_teacher_id is null or c.teacher_id = p_teacher_id)
    and public.lesson_credit_is_stuck(c.student_id, c.teacher_id);
$$;

revoke all on function public.stranded_lesson_credits(uuid, text) from public, anon, authenticated;

-- what my-lessons.html shows: one row per teacher
create or replace function public.my_stranded_lesson_credits()
returns table (teacher_id text, teacher_name text, lessons integer, total_value numeric, refundable_from timestamptz, refundable boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.teacher_id,
         max(c.teacher_name),
         count(*)::integer,
         coalesce(sum(c.value), 0),
         min(c.stuck_since) + interval '30 days',
         bool_and(c.value is not null and p.iyzico_payment_transaction_id is not null and p.type in ('lesson', 'trial'))
  from public.stranded_lesson_credits(auth.uid()) c
  left join pending_payments p on p.id = c.pending_payment_id
  group by c.teacher_id;
$$;

revoke all on function public.my_stranded_lesson_credits() from public, anon;
grant execute on function public.my_stranded_lesson_credits() to authenticated;

-- === PACKAGE WITHDRAWAL (14 days, nothing used) =======================

create or replace function public.my_withdrawable_packages()
returns table (payment_id uuid, teacher_id text, teacher_name text, lessons integer, price numeric, paid_at timestamptz, withdraw_until timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.teacher_id, p.teacher_name, p.quantity, p.price, p.created_at, p.created_at + interval '14 days'
  from pending_payments p
  where p.student_id = auth.uid()
    and p.type = 'package'
    and p.status = 'succeeded'
    and p.created_at > now() - interval '14 days'
    and coalesce(p.refunded_amount, 0) = 0
    and p.chargeback_at is null
    and p.iyzico_payment_transaction_id is not null
    and (select count(*) from lesson_credits c where c.pending_payment_id = p.id) = p.quantity
    and not exists (
      select 1 from lesson_credits c
      where c.pending_payment_id = p.id and c.status <> 'available'
    );
$$;

revoke all on function public.my_withdrawable_packages() from public, anon;
grant execute on function public.my_withdrawable_packages() to authenticated;

-- === DAILY JOB ========================================================
-- 09:17 Istanbul: expire credits, drop sign-ins older than 90 days, then
-- policy-notices sends the expiry reminders and daylight-saving notices.

select cron.schedule(
  'armus-daily-policies',
  '17 6 * * *',
  $$
  select public.expire_lesson_credits();
  delete from sign_in_events where created_at < now() - interval '90 days';
  select public.notify_policy('{"type": "daily"}'::jsonb);
  $$
);
