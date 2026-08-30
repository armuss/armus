-- Migration 16: block off-platform contact sharing in messages before a
-- student has actually booked with that teacher.
--
-- A teacher could otherwise use the in-app chat to pitch a student on
-- moving to WhatsApp/Instagram/a phone call before ever booking through
-- ARMUS - which means ARMUS never sees (or earns commission on) that
-- lesson. Once the two of them actually have a booking together, the
-- restriction lifts (ARMUS has already been cut in on that
-- relationship, and legitimate lesson logistics shouldn't be blocked
-- forever).
--
-- This enforces it at the database level (not just in the UI) with a
-- trigger that rejects the insert outright - a phone-number-shaped
-- string, an email address, or the name of an outside messaging app/
-- platform in the message body. This is a blunt heuristic, not perfect
-- text understanding: it can false-positive (e.g. a long run of digits
-- that isn't really a phone number) and can be worked around by someone
-- determined to. It's meant to make the obvious, casual attempt
-- ("numaramı 0532 111 22 33 yaz") fail loudly, not to be airtight.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

create or replace function public.enforce_no_contact_sharing()
returns trigger
language plpgsql
as $$
declare
  already_booked boolean;
begin

  select exists (
    select 1
    from bookings b
    join conversations c on c.id = new.conversation_id
    where b.student_id = c.student_id
      and b.teacher_id = c.teacher_id::text
  ) into already_booked;

  if already_booked then
    return new;
  end if;

  if new.body ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
    or new.body ~ '(\d[ \-.()]{0,2}){7,}\d'
    or new.body ~* '(whatsapp|telegram|instagram|\minsta\M|snapchat|\mimo\M|viber|signal|numaram|numaray|numaras|telefonum|e-?posta|eposta|gmail|hotmail|outlook)'
  then
    raise exception 'contact_sharing_blocked: iletisim bilgisi paylasimi ve platform disi iletisim, resmi bir ders satin alana kadar yasaktir';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_block_contact_sharing on messages;

create trigger messages_block_contact_sharing
  before insert on messages
  for each row execute procedure public.enforce_no_contact_sharing();
