-- ARMUS migration 123: a teacher's block gets its own error code.
--
-- bookings_enforce_teacher_block (migration_96.sql) refuses a booking
-- between a teacher and a student they blocked with a plain exception
-- (SQLSTATE P0001), which no booking path recognised. create-payment
-- didn't check the block either, so a blocked student could pay by card;
-- payment-callback then failed to write the booking and left the paid
-- checkout in the manual "paid_no_booking" state ("contact us").
-- create-payment now refuses a blocked student before any charge, and
-- payment-callback turns a block that arrives while the student is on
-- the payment page into a lesson credit like a taken slot. Both read
-- AR008 (and, until this runs, the message below). The message is
-- unchanged.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

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
    raise exception using errcode = 'AR008', message = 'teacher_blocked_student: bu ogretmen bu ogrenciyle yeni bir rezervasyonu engellemis';
  end if;

  return new;
end;
$$;
