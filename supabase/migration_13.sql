-- Migration 13: add a SELECT policy for teacher-uploads.
--
-- migration_12.sql added INSERT/UPDATE/DELETE policies on
-- storage.objects for the teacher-uploads bucket, but no SELECT policy.
-- apply-teacher.html uploads with { upsert: true }, and Supabase
-- Storage's upsert path checks whether the object already exists before
-- deciding to insert or update it - that existence check runs as the
-- authenticated user and needs its own SELECT policy. Without one, that
-- internal check can fail in a way that surfaces as the same "new row
-- violates row-level security policy" error on what looks like a plain
-- insert.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to run more than once (drops the policy first).

drop policy if exists "teacher_uploads_select_authenticated" on storage.objects;

create policy "teacher_uploads_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'teacher-uploads');
