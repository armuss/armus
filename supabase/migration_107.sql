-- migration_107.sql: rescheduling (Preply-style) + a monthly cap on
-- teacher cancellations.
--
-- === RESCHEDULING ===
-- Moving a lesson used to mean cancel + rebook: two steps, the slot
-- could be taken in between, impossible inside the 12-hour window, and
-- a teacher had no way to move a lesson at all - only cancel it.
-- Now (reschedule-booking Edge Function):
--   - student, >= 12 hours before the lesson: moves it straight away to
--     another open slot in the teacher's availability
--   - student, < 12 hours before: sends a request the teacher accepts
--     or declines
--   - teacher, any time before the lesson: proposes a new time the
--     student accepts or declines
-- The booking row itself is moved (same id, same payment, same credit) -
-- nothing about money changes. A request nobody answers before the
-- lesson starts simply lapses and the lesson stays where it was.
-- reschedule_requests keeps every move, including the instant ones, as
-- history. Only the Edge Function (service role) writes it.
--
-- === TEACHER CANCELLATION CAP ===
-- A teacher can cancel at most 3 lessons per calendar month (in the
-- teacher's own timezone). cancel-booking marks a teacher's own
-- cancellation with counts_as_teacher_cancel; the trigger below refuses
-- the 4th one (AR003) - an emergency past that goes through support,
-- since an admin cancellation never counts. Cancelling the lessons of a
-- student the teacher is blocking (teacher-blocks.js) doesn't count
-- either - that's not flaking on a student, it's ending the relationship.

-- ---------------------------------------------------------------------
-- RESCHEDULING
-- ---------------------------------------------------------------------

create table if not exists reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  requested_by text not null check (requested_by in ('student', 'teacher')),
  requester_id uuid references profiles(id) on delete set null,
  old_date date not null,
  old_time text not null,
  new_date date not null,
  new_time text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists reschedule_requests_booking_id_idx on reschedule_requests(booking_id);

-- at most one open request per lesson
create unique index if not exists reschedule_requests_one_pending
  on reschedule_requests(booking_id) where status = 'pending';

alter table reschedule_requests enable row level security;

drop policy if exists "reschedule_requests_select_participant_or_admin" on reschedule_requests;
create policy "reschedule_requests_select_participant_or_admin"
  on reschedule_requests for select
  using (
    public.is_admin()
    or exists (
      select 1 from bookings b
      where b.id = booking_id
        and (b.student_id = auth.uid() or b.teacher_id = auth.uid()::text)
    )
  );

-- moving a booking must respect the same no-overlap rule as creating one
-- (migration_103.sql) - the trigger only ever ran on insert
drop trigger if exists bookings_enforce_no_overlap on bookings;
create trigger bookings_enforce_no_overlap
  before insert or update of lesson_date, lesson_time on bookings
  for each row execute procedure public.enforce_no_overlapping_bookings();

-- Moves a booking, atomically with its request row. p_request_id given:
-- accepts that pending request. Not given: an instant student move,
-- recorded as an already-accepted request. Raises AR004 when the lesson
-- can't be moved anymore (cancelled, already started, request no longer
-- pending); AR001/23505 when the new slot overlaps another lesson.
-- Never callable by a client.
create or replace function public.apply_booking_reschedule(
  p_booking_id uuid,
  p_new_date date,
  p_new_time text,
  p_request_id uuid default null,
  p_requested_by text default null,
  p_requester_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  req_id uuid := p_request_id;
begin
  select * into b from bookings where id = p_booking_id for update;

  if not found or b.status <> 'confirmed'
    or ((b.lesson_date + b.lesson_time::time) at time zone b.teacher_timezone) <= now() then
    raise exception using errcode = 'AR004', message = 'reschedule_not_possible: lesson cancelled or already started';
  end if;

  if ((p_new_date + p_new_time::time) at time zone b.teacher_timezone) <= now() then
    raise exception using errcode = 'AR004', message = 'reschedule_not_possible: new time is in the past';
  end if;

  if req_id is not null then
    update reschedule_requests
    set status = 'accepted', resolved_at = now()
    where id = req_id and booking_id = p_booking_id and status = 'pending';
    if not found then
      raise exception using errcode = 'AR004', message = 'reschedule_not_possible: request is no longer pending';
    end if;
  else
    -- an instant move supersedes anything still open on this lesson
    update reschedule_requests
    set status = 'cancelled', resolved_at = now()
    where booking_id = p_booking_id and status = 'pending';

    insert into reschedule_requests
      (booking_id, requested_by, requester_id, old_date, old_time, new_date, new_time, status, resolved_at)
    values
      (p_booking_id, p_requested_by, p_requester_id, b.lesson_date, b.lesson_time, p_new_date, p_new_time, 'accepted', now())
    returning id into req_id;
  end if;

  -- reminder_sent reset: the "starts soon" email has to go out again for
  -- the new time
  update bookings
  set lesson_date = p_new_date, lesson_time = p_new_time, reminder_sent = false
  where id = p_booking_id;

  return req_id;
end;
$$;

revoke all on function public.apply_booking_reschedule(uuid, date, text, uuid, text, uuid) from public, anon, authenticated;

-- a lesson that gets cancelled (by anyone, any path) closes its open request
create or replace function public.close_reschedule_requests_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update reschedule_requests
  set status = 'cancelled', resolved_at = now()
  where booking_id = new.id and status = 'pending';
  return new;
end;
$$;

drop trigger if exists bookings_close_reschedule_requests on bookings;
create trigger bookings_close_reschedule_requests
  after update of status on bookings
  for each row
  when (old.status is distinct from 'cancelled' and new.status = 'cancelled')
  execute procedure public.close_reschedule_requests_on_cancel();

-- ---------------------------------------------------------------------
-- TEACHER CANCELLATION CAP
-- ---------------------------------------------------------------------

alter table bookings add column if not exists counts_as_teacher_cancel boolean not null default false;

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
  -- one teacher's cancellations are counted one at a time, so two
  -- racing cancels can't both slip in as the 3rd
  perform pg_advisory_xact_lock(hashtext('teacher_cancel:' || new.teacher_id));

  month_start := date_trunc('month', now() at time zone tz) at time zone tz;

  select count(*) into used
  from bookings
  where teacher_id = new.teacher_id
    and counts_as_teacher_cancel
    and cancelled_at >= month_start
    and id <> new.id;

  if used >= monthly_limit then
    raise exception using errcode = 'AR003', message = 'teacher_cancel_limit: bu ay en fazla 3 ders iptal edebilirsin';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_enforce_teacher_cancel_limit on bookings;
create trigger bookings_enforce_teacher_cancel_limit
  before update of counts_as_teacher_cancel on bookings
  for each row
  when (new.counts_as_teacher_cancel and not old.counts_as_teacher_cancel)
  execute procedure public.enforce_teacher_monthly_cancel_limit();
