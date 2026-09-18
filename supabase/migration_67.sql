-- ARMUS migration 67: closes two RLS gaps that let a caller bypass the
-- name-masking this project already built (migration_59.sql's
-- masked_profiles view) by simply querying the raw table instead.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor, AFTER
-- deploying the matching frontend change that switches
-- armusGetReviewsForTeacher (reviews.js) and the reviews fetch in
-- armusGetRegisteredTeachers (marketplace.js) to read from the new
-- masked_reviews view instead of the raw reviews table - otherwise the
-- marketplace/teacher-profile review list goes empty for anyone who
-- isn't the reviewer, the reviewed teacher, or an admin, the moment this
-- migration runs.

-- === 1. profiles: close the raw-table full-column leak =================
--
-- profiles_select_public_or_own's "status = 'approved'" branch let
-- ANYONE with the (public, embedded-in-every-page) anon key read every
-- column of every approved teacher's row directly from the base table -
-- not just the name (which masked_profiles already protects), but their
-- real email, phone number, city, and certificate_file_url/_name -
-- completely bypassing masked_profiles, which only protects callers that
-- go through it voluntarily.
--
-- masked_profiles's own WHERE clause independently reproduces exactly
-- this same row-visibility (status = 'approved' OR own row OR admin OR
-- conversation partner - see its comment), and every legitimate
-- frontend read of another user's profile already goes through it
-- (marketplace.js, messages.js) or through one of the OTHER two
-- policies below, which are untouched by this migration:
--   - profiles_select_admin_all (an admin can still read every row/column)
--   - profiles_select_conversation_partner (each side of a real
--     conversation can still read the other's name/photo)
-- So dropping the public branch here only removes the one path nothing
-- legitimate ever used: an unauthenticated/unrelated caller reading the
-- raw table directly.
drop policy if exists "profiles_select_public_or_own" on profiles;

create policy "profiles_select_own"
  on profiles for select
  using (auth.uid() = id);

-- === 2. reviews: same bug, for the reviewing student's real name =======
--
-- reviews_select_all (using (true)) let anyone read a review's raw
-- student_name column - the client only ever truncated it to "Mehmet K."
-- at RENDER time (armusFormatReviewerName, reviews.js), same mistake
-- migration_59.sql already fixed once for teacher names. Unlike
-- profiles, review ROWS themselves are meant to be fully public (that's
-- the feature - reviews are public marketplace trust signals), so this
-- can't be fixed by restricting row visibility the way profiles was -
-- only the student_name COLUMN needs masking, and RLS can't mask a
-- column, only filter rows. So: the raw table's own SELECT policy is
-- tightened to just the reviewing student, the reviewed teacher, and
-- admins (who all legitimately need the real name), and a masked_reviews
-- view - mirroring masked_profiles exactly, reusing its same
-- short_display_name() function - is added for every public/other-party
-- read, with the real name only when the viewer is one of those three.
drop policy if exists "reviews_select_all" on reviews;

create policy "reviews_select_own_or_admin"
  on reviews for select
  using (
    auth.uid() = student_id
    or auth.uid()::text = teacher_id
    or public.is_admin()
  );

create or replace view public.masked_reviews
as
select
  r.id,
  r.booking_id,
  r.teacher_id,
  r.student_id,
  case
    when auth.uid() = r.student_id then r.student_name
    when auth.uid()::text = r.teacher_id then r.student_name
    when public.is_admin() then r.student_name
    else public.short_display_name(r.student_name)
  end as student_name,
  r.stars,
  r.comment,
  r.created_at
from public.reviews r;

grant select on public.masked_reviews to anon, authenticated;

-- === 3. confidence_checkins: an insert-time integrity gap (low risk) ===
--
-- The old policy only pinned student_id to the caller - it never checked
-- that booking_id was actually one of THEIR bookings, unlike every other
-- "own real booking" policy in this file (reviews_insert_own_student,
-- disputes_insert_own, attendance_reports_insert_own_student all join
-- back to bookings). A student could insert a checkin row against any
-- booking id that exists (their own, another student's, even a
-- different student's booking with the same teacher) as long as
-- student_id = auth.uid() - harmless to anyone else (checkins are only
-- ever readable by their own student_id, so nobody else's data is
-- exposed), but it could pollute that student's own confidence-trend
-- chart with checkins that don't correspond to a real lesson they took.
drop policy if exists "confidence_checkins_all_own" on confidence_checkins;

create policy "confidence_checkins_select_own"
  on confidence_checkins for select
  using (auth.uid() = student_id);

create policy "confidence_checkins_insert_own"
  on confidence_checkins for insert
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from bookings b
      where b.id = confidence_checkins.booking_id
        and b.student_id = auth.uid()
    )
  );

create policy "confidence_checkins_update_own"
  on confidence_checkins for update
  using (auth.uid() = student_id)
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from bookings b
      where b.id = confidence_checkins.booking_id
        and b.student_id = auth.uid()
    )
  );

create policy "confidence_checkins_delete_own"
  on confidence_checkins for delete
  using (auth.uid() = student_id);
