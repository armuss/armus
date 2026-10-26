-- migration_109.sql: undoes migration_108.sql (any-teacher lesson credits).
--
-- Decision: a lesson credit stays tied to the teacher it came from, in
-- every case - including a teacher no-show or a teacher being banned.
-- With that teacher it covers any lesson; with anyone else it only covers
-- a TRIAL lesson. That keeps ARMUS's trial economics in charge of
-- cross-teacher use: if the student continues with the new teacher after
-- the trial, ARMUS pays that teacher; if not, the trial fee stays with
-- ARMUS. (A banned teacher can't be booked, so their students' credits
-- are good for a trial elsewhere - same as before migration_108.)
--
-- Safe to run whether or not migration_108.sql was ever run: it puts the
-- two functions back to their migration_106 / migration_104 versions and
-- drops the column if it exists.

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
    -- new credit with this teacher; a credit-paid one gets that SAME
    -- credit back (never a freshly minted one - see cancel-booking's
    -- header for why)
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

    cancelled_ids := cancelled_ids || b.id;
  end loop;

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

alter table lesson_credits drop column if exists any_teacher;
