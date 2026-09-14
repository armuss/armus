-- ARMUS migration 36: close a loophole in the off-platform contact-
-- sharing guard (migration_16.sql) - a cancelled booking still counted
-- as "already booked", so a student could create a booking with a
-- teacher (even a trial, even one they cancel seconds later for a full
-- lesson credit) purely to permanently unlock free-form phone/email/
-- WhatsApp sharing with that teacher in chat, without ever actually
-- taking a paid lesson through ARMUS.
--
-- migration_16.sql predates the cancellation feature (migration_24.sql)
-- entirely, so this was never a deliberate choice - the bookings.status
-- column just didn't exist yet when this trigger was first written.
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
      and b.status = 'confirmed'
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
