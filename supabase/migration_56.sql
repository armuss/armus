-- Fixes disputes_insert_own: it already required an attached booking_id
-- to actually belong to the reporter (as student or teacher), but never
-- checked reporter_role or other_party_name against that booking's real
-- participants - both are plain client-supplied text. A caller could
-- attach a real booking_id (passing the ownership check) while claiming
-- an arbitrary reporter_role, or naming an arbitrary, unrelated person
-- as other_party_name - disputes are read by admins reviewing real
-- complaints, so this could misattribute or fabricate a complaint
-- against an innocent third party.
--
-- The one real call site (my-lessons.html) always sets these to match
-- the actual booking already, so this only closes a direct-API bypass -
-- same integrity pattern already used for
-- reviews_insert_own_student/attendance_reports_insert_own_student.
--
-- Verified against a local Postgres instance: a fabricated
-- other_party_name is rejected, a fabricated reporter_role is rejected,
-- a real matching dispute still succeeds, and a general dispute with no
-- booking_id is unaffected.

drop policy if exists "disputes_insert_own" on disputes;

create policy "disputes_insert_own"
  on disputes for insert
  with check (
    auth.uid() = reporter_id
    and (
      booking_id is null
      or exists (
        select 1 from bookings b
        where b.id = booking_id
          and (
            (b.student_id = auth.uid() and reporter_role = 'student' and other_party_name = b.teacher_name)
            or (b.teacher_id = auth.uid()::text and reporter_role = 'teacher' and other_party_name = b.student_name)
          )
      )
    )
  );
