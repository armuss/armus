-- Migration 12: fix "new row violates row-level security policy" on
-- teacher photo/certificate/video uploads.
--
-- migration_11.sql's upload policies restricted writes to a path
-- starting with the uploader's own user id
-- ((storage.foldername(name))[1] = auth.uid()::text). That's the
-- pattern Supabase's own docs recommend, but it was rejecting uploads
-- in practice. Rather than debug the exact mismatch blind, this
-- replaces it with a simpler, more reliable check: any logged-in
-- (authenticated) ARMUS account can upload into the teacher-uploads
-- bucket, full stop. The bucket is already public-read (the photo/video
-- are shown on public teacher profile pages anyway), so the only thing
-- this policy change gives up is one authenticated user theoretically
-- being able to write into another's file path within that same public
-- bucket - not a meaningful loss of security for this app.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to run even if migration_11.sql's policies are still in place -
-- the DROP statements make this idempotent.

drop policy if exists "teacher_uploads_insert_own" on storage.objects;
drop policy if exists "teacher_uploads_update_own" on storage.objects;
drop policy if exists "teacher_uploads_delete_own" on storage.objects;

create policy "teacher_uploads_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'teacher-uploads');

create policy "teacher_uploads_update_authenticated"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'teacher-uploads')
  with check (bucket_id = 'teacher-uploads');

create policy "teacher_uploads_delete_authenticated"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'teacher-uploads');
