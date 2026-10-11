-- migration_103.sql: closes a double-booking gap bookings_teacher_slot_unique
-- (migration_35.sql) never covered. That unique index only ever stopped
-- two bookings at the EXACT same (teacher_id, lesson_date, lesson_time) -
-- but a lesson runs ARMUS_LESSON_MINUTES (50 minutes, bookings.js) on a
-- 30-minute slot grid, so a lesson at 10:00 (running until 10:50)
-- genuinely overlaps a lesson at 10:30 (10:30-11:20) too, without ever
-- colliding on the exact tuple the unique index checks. Two students
-- could successfully pay for and book overlapping slots with the same
-- teacher. bookings.js's armusSlotsForDate (the booking.html/teacher.html
-- picker) is fixed client-side in this same change to stop OFFERING an
-- overlapping slot in the first place, but that alone can't close a
-- race between two students checking out at nearly the same time, or a
-- request made straight to create-payment/payment-callback bypassing
-- the picker entirely - this trigger is the real, server-side fix for
-- that, mirroring enforce_teacher_block's own reasoning for why this
-- has to be a trigger rather than an RLS policy (bookings has no
-- client-facing insert policy at all; every booking is written by a
-- service-role Edge Function).
--
-- Raises with a custom AR001 SQLSTATE (rather than a bare exception, as
-- enforce_teacher_block does) so create-payment/payment-callback can
-- tell this apart from an unrelated failure and treat it exactly like
-- the existing 23505 (exact-slot-taken) case - see those two files.

create or replace function public.enforce_no_overlapping_bookings()
returns trigger
language plpgsql
as $$
declare
  lesson_minutes constant int := 50;
  new_start timestamptz;
  new_end timestamptz;
begin

  if new.status = 'cancelled' then
    return new;
  end if;

  new_start := (new.lesson_date + new.lesson_time::time) at time zone new.teacher_timezone;
  new_end := new_start + (lesson_minutes || ' minutes')::interval;

  if exists (
    select 1 from bookings b
    where b.teacher_id = new.teacher_id
      and b.id is distinct from new.id
      and b.status <> 'cancelled'
      -- bounds the scan to a tight window around the new lesson's own
      -- date (an overlap can only ever reach into the adjacent calendar
      -- date right at midnight) instead of scanning this teacher's
      -- entire booking history on every insert
      and b.lesson_date between new.lesson_date - 1 and new.lesson_date + 1
      and (b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone < new_end
      and ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone) + (lesson_minutes || ' minutes')::interval > new_start
  ) then
    raise exception using errcode = 'AR001', message = 'overlapping_booking: bu ogretmenin bu saat araliginda baska bir dersi var';
  end if;

  return new;
end;
$$;

create trigger bookings_enforce_no_overlap
  before insert on bookings
  for each row execute procedure public.enforce_no_overlapping_bookings();
