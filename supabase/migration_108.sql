-- migration_108.sql: a lesson credit a student gets because the TEACHER
-- failed them (an upheld no-show, migration_106.sql; or the teacher's
-- account being closed, migration_104.sql) works with ANY teacher, for
-- any lesson.
--
-- A lesson credit is normally tied to the teacher it came from: any
-- lesson with them, or only a trial with someone else (create-payment).
-- That's fine when the student cancelled, but a student whose teacher
-- didn't show up - or got banned - was left with a credit for a teacher
-- they shouldn't have to go back to (or can't), good elsewhere only for
-- a trial. Now those credits carry any_teacher: create-payment lets them
-- cover any lesson with any teacher (the booked teacher is paid their
-- own price as usual - ARMUS absorbs any price difference).
--
-- Set on:
--   - refund_teacher_no_show_lesson: the credit it grants or restores
--   - cancel_banned_teacher_future_lessons: the credits it grants or
--     restores, AND every credit the student still holds with the banned
--     teacher (e.g. the rest of a package bought with them)
--   - payment-callback, when a checkout ends on a teacher banned mid-way
-- Backfilled for credits already handed out in those situations and still
-- unused. Only the database (service role) ever writes this column -
-- lesson_credits has no client-facing write policy.

alter table lesson_credits add column if not exists any_teacher boolean not null default false;

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

  -- same rule as cancel-booking for a teacher/admin cancellation, except
  -- the credit is good with any teacher (migration_108.sql)
  if exists (select 1 from pending_payments p where p.booking_id = b.id and p.status = 'succeeded') then
    insert into lesson_credits (student_id, teacher_id, teacher_name, source_booking_id, any_teacher)
    values (b.student_id, b.teacher_id, b.teacher_name, b.id, true);
    update bookings set refunded = true where id = b.id;
  else
    update lesson_credits
    set status = 'available', used_booking_id = null, used_at = null, any_teacher = true
    where used_booking_id = b.id and status = 'used';
    if found then
      update bookings set refunded = true where id = b.id;
    end if;
  end if;

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
    returning id, student_id, teacher_id, teacher_name
  loop
    -- same rule as cancel-booking: a card-paid lesson comes back as a
    -- new credit; a credit-paid one gets that SAME credit back - either
    -- way good with any teacher (migration_108.sql)
    if exists (select 1 from pending_payments p where p.booking_id = b.id and p.status = 'succeeded') then
      insert into lesson_credits (student_id, teacher_id, teacher_name, source_booking_id, any_teacher)
      values (b.student_id, b.teacher_id, b.teacher_name, b.id, true);
      update bookings set refunded = true where id = b.id;
    else
      update lesson_credits
      set status = 'available', used_booking_id = null, used_at = null, any_teacher = true
      where used_booking_id = b.id and status = 'used';
      if found then
        update bookings set refunded = true where id = b.id;
      end if;
    end if;

    cancelled_ids := cancelled_ids || b.id;
  end loop;

  -- whatever the students still hold with this teacher (the rest of a
  -- package, an earlier cancellation's credit) can't be used with them
  -- anymore - make it good with anyone
  update lesson_credits
  set any_teacher = true
  where teacher_id = new.id::text and status = 'available';

  if coalesce(array_length(cancelled_ids, 1), 0) > 0 then
    perform net.http_post(
      url := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/functions/v1/notify-lessons-cancelled',
      headers := '{"Content-Type": "application/json", "x-armus-trigger-secret": "053fe0b45c511da9f45e22f09f345d0e2ff74f84eada181a632ddb0737f0ec34"}'::jsonb,
      body := jsonb_build_object('booking_ids', to_jsonb(cancelled_ids), 'reason', 'teacher_banned')
    );
  end if;

  return new;
end;
$$;

-- Backfill: unused credits already handed out for a no-show, or held
-- with a teacher who's banned now
update lesson_credits c
set any_teacher = true
where c.status = 'available'
  and not c.any_teacher
  and (
    exists (select 1 from bookings b where b.id = c.source_booking_id and b.teacher_no_show)
    or exists (select 1 from profiles p where p.id::text = c.teacher_id and coalesce(p.is_banned, false))
  );
