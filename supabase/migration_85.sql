-- ARMUS migration 85: automatic teacher online-presence tracking,
-- replacing the "Şu an müsaitim" manual toggle a teacher used to flip
-- themselves (dashboard.html, is_online - migration_10.sql).
--
-- last_active_at is refreshed by armusGetSession() (auth.js) whenever a
-- logged-in teacher loads or stays on any page, throttled to at most
-- once every couple of minutes per browser tab. A teacher reads as
-- "online" to students (teacher.html/teachers.html, via masked_profiles)
-- for ARMUS_PRESENCE_WINDOW_MS (auth.js) after this timestamp - an
-- automatic, activity-derived status instead of a boolean a teacher has
-- to remember to flip by hand.
--
-- is_online itself is left in place rather than dropped (nothing writes
-- or reads it anymore after this migration, but dropping a column is
-- real data loss and far harder to undo than leaving an unused one).
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

alter table profiles add column if not exists last_active_at timestamptz;

-- masked_profiles (migration_59.sql) is the only way marketplace.js /
-- teacher.html read another teacher's profile fields - last_active_at
-- has to be added to its column list or it never reaches a student's
-- browser no matter what profiles itself holds. Restates the view's
-- existing definition in full (its own comment, further up in
-- schema.sql, explains why: who it's visible to and the name-masking)
-- plus the one new column.
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
  p.status,
  -- appended at the end, not alongside is_online above where it reads
  -- more naturally - CREATE OR REPLACE VIEW only allows adding columns
  -- at the end of the list, not inserting one in the middle (it errors
  -- "cannot change name of view column ... to ..." otherwise, since
  -- every column after the insertion point would shift position)
  p.last_active_at
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
