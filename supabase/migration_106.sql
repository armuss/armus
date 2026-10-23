-- migration_106.sql: a teacher no-show, once upheld, gives the student
-- their lesson back - and takes it out of the teacher's pay.
--
-- Until now an upheld no_show report only penalized the teacher (hide
-- from new students, the trial ladder, escalations, the 10-strike ban).
-- The booking itself stayed "confirmed", so:
--   - the student had paid for a lesson that never happened and got
--     nothing back (cancel-booking refuses a lesson that already
--     started, so not even an admin could refund it), and
--   - dashboard.html/admin.html counted it as a completed lesson: the
--     teacher was PAID for the lesson they didn't show up to, and it
--     even counted toward their taught hours / commission tier.
--
-- Now, the moment an admin upholds a no_show report, the booking is
-- cancelled (cancelled_by 'admin', the new teacher_no_show flag set) and
-- the lesson goes back to the student exactly the way a teacher/admin
-- cancellation already does it (cancel-booking, migration_104.sql's ban
-- trigger): a card-paid lesson comes back as a new lesson credit with
-- that teacher, a credit-paid one gets that SAME credit back. Being
-- cancelled, it drops out of the teacher's earnings, balance, payout,
-- taught hours and tier everywhere, with no client change needed for
-- the money itself. The student is emailed (notify-lessons-cancelled,
-- reason 'teacher_no_show'). An upheld "late" report changes nothing
-- here - that lesson did happen.
--
-- Backfill: reports ALREADY upheld before this migration get the same
-- treatment, once - those students were wronged under the old behavior
-- too. Their teachers' earnings drop by those lessons accordingly.
--
-- Deploy order: redeploy notify-lessons-cancelled first (it learns the
-- 'teacher_no_show' reason), then run this.

alter table bookings add column if not exists teacher_no_show boolean not null default false;

-- Cancels one no-show lesson and returns it to the student. Returns true
-- only when THIS call did it (the booking was still confirmed), so the
-- caller knows whether to email. Never callable by a client: it would
-- let anyone "refund" any booking they could name.
create or replace function public.refund_teacher_no_show_lesson(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
begin
  update bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = 'admin', teacher_no_show = true
  where id = p_booking_id and status = 'confirmed'
  returning id, student_id, teacher_id, teacher_name into b;

  if not found then
    return false;
  end if;

  -- same rule as cancel-booking for a teacher/admin cancellation
  if exists (select 1 from pending_payments p where p.booking_id = b.id and p.status = 'succeeded') then
    insert into lesson_credits (student_id, teacher_id, teacher_name, source_booking_id)
    values (b.student_id, b.teacher_id, b.teacher_name, b.id);
    update bookings set refunded = true where id = b.id;
  else
    update lesson_credits
    set status = 'available', used_booking_id = null, used_at = null
    where used_booking_id = b.id and status = 'used';
    if found then
      update bookings set refunded = true where id = b.id;
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.refund_teacher_no_show_lesson(uuid) from public, anon, authenticated;

-- emails the students (notify-lessons-cancelled caps one call at 500 ids)
create or replace function public.notify_teacher_no_show_refunds(p_booking_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := coalesce(array_length(p_booking_ids, 1), 0);
  i integer := 1;
begin
  while i <= n loop
    perform net.http_post(
      url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/notify-lessons-cancelled',
      headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
      body := jsonb_build_object('booking_ids', to_jsonb(p_booking_ids[i:i + 499]), 'reason', 'teacher_no_show')
    );
    i := i + 500;
  end loop;
end;
$$;

revoke all on function public.notify_teacher_no_show_refunds(uuid[]) from public, anon, authenticated;

-- migration_104.sql's version, unchanged apart from the refund at the
-- top of the upheld no_show branch
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
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  perform set_config('armus.attendance_system_update', 'on', true);

  if new.status = 'dismissed' then
    -- another report still waiting for review keeps the hide in place
    if exists (
      select 1 from attendance_reports
      where teacher_id = new.teacher_id and status in ('open', 'explained') and id <> new.id
    ) then
      return new;
    end if;

    -- nothing else pending: back to whatever penalty is actually in force
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
      -- student, out of the teacher's pay
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
        end if;
      end if;

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
        update profiles
        set hidden_from_new_students = true,
            penalty_hide_reason = 'no_show',
            hidden_reason = 'no_show'
        where id::text = new.teacher_id;
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

      update profiles
      set hidden_from_new_students = true,
          penalty_hide_reason = 'late',
          hidden_reason = 'late'
      where id::text = new.teacher_id;

    end if;

  end if;

  return new;
end;
$$;

-- Backfill: no-show reports upheld before this migration
do $$
declare
  r record;
  refunded_ids uuid[] := '{}';
begin
  for r in
    select booking_id from attendance_reports
    where type = 'no_show' and status = 'upheld'
  loop
    if public.refund_teacher_no_show_lesson(r.booking_id) then
      refunded_ids := refunded_ids || r.booking_id;
    end if;
  end loop;

  perform public.notify_teacher_no_show_refunds(refunded_ids);
end $$;
