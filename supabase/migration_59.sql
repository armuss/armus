-- Closes the remaining gap in "a teacher's full real name is never shown
-- to a student" (see auth.js's armusShortDisplayName comment): that rule
-- was only ever enforced by truncating the name at RENDER time in the
-- client. The raw API response (marketplace.js's/messages.js's plain
-- `profiles.select("*")`/`.select("id, name, photo_url")`) still carried
-- the real full name over the wire - trivially visible to any student
-- who opens devtools' Network tab or Console, no exploit needed.
--
-- masked_profiles is a view that returns a teacher's name already
-- short-formed (server-side, mirroring auth.js's armusShortDisplayName
-- exactly) unless the viewer is that same teacher (auth.uid() = id) or
-- an admin - in which case the real name comes through. Its WHERE
-- clause reproduces the union of profiles_select_public_or_own's public
-- branch (status = 'approved') and profiles_select_conversation_partner,
-- so this view exposes no ROW that the base table's RLS didn't already
-- allow the same viewer to read - only the `name` column's content
-- changes.

create or replace function public.short_display_name(full_name text)
returns text
language sql
immutable
as $$
  select case
    when array_length(regexp_split_to_array(trim(coalesce(full_name, '')), '\s+'), 1) < 2
      then coalesce(nullif(trim(coalesce(full_name, '')), ''), 'Öğretmen')
    else
      (regexp_split_to_array(trim(full_name), '\s+'))[1] || ' ' ||
      left(
        (regexp_split_to_array(trim(full_name), '\s+'))[
          array_length(regexp_split_to_array(trim(full_name), '\s+'), 1)
        ],
        1
      ) || '.'
  end;
$$;

create or replace view public.masked_profiles
as
select
  p.id,
  case
    when auth.uid() = p.id then p.name
    when public.is_admin() then p.name
    when p.role = 'teacher' then public.short_display_name(p.name)
    else p.name
  end as name,
  p.photo_url,
  p.video_url,
  p.title,
  p.price,
  p.subject_taught,
  p.availability,
  p.bio,
  p.languages,
  p.weekly_availability,
  p.availability_dates,
  p.is_online,
  p.timezone,
  p.is_banned,
  p.hidden_from_new_students,
  p.hidden_until,
  p.role,
  p.status
from public.profiles p
where
  p.status = 'approved'
  or auth.uid() = p.id
  or public.is_admin()
  or exists (
    select 1 from public.conversations c
    where (c.student_id = auth.uid() and c.teacher_id = p.id)
       or (c.teacher_id = auth.uid() and c.student_id = p.id)
  );

grant select on public.masked_profiles to anon, authenticated;
