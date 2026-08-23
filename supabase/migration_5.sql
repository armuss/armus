-- ARMUS migration 5: approved teachers can no longer edit their live
-- profile directly - edits go into pending_changes and only take
-- effect once an admin approves them (via admin.html).

alter table profiles add column pending_changes jsonb;

-- Blocks a non-admin from writing to the "live" fields once their
-- profile is approved. Applying while status isn't 'approved' yet
-- (first application, or resubmission after rejection) is still
-- allowed, since that's not "changing" an existing live profile.
create or replace function public.enforce_teacher_profile_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if old.status = 'approved' and (
    new.title is distinct from old.title
    or new.price is distinct from old.price
    or new.availability is distinct from old.availability
    or new.bio is distinct from old.bio
    or new.weekly_availability is distinct from old.weekly_availability
  ) then
    raise exception 'profile_locked: approved profile fields can only change through pending_changes + admin approval';
  end if;

  return new;
end;
$$;

create trigger profiles_lock_teacher_fields
  before update on profiles
  for each row execute procedure public.enforce_teacher_profile_lock();
