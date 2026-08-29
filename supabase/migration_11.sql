-- Migration 11: fix teacher application uploads failing on Supabase's
-- request size limit.
--
-- apply-teacher.html used to base64-encode the profile photo,
-- certificate, and intro video and cram them into a single profiles
-- UPDATE as text - a 20MB video becomes ~27MB of base64 text in one
-- request, which is well past what Supabase's API gateway accepts in a
-- single PostgREST call, so the whole application submit failed with a
-- generic error. Photos/certificates could hit the same wall once
-- combined with everything else in one request.
--
-- The fix (already applied in apply-teacher.html) is to upload these
-- files to Supabase Storage instead, and store only the resulting
-- (short) public URL in profiles.photo_url / video_url /
-- certificate_file_url - exactly like they're already treated in the
-- rest of the app. This migration creates the storage bucket and the
-- policies that let a logged-in teacher upload into their own folder.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to run once; running it a second time will fail on "already
-- exists" for the policies, which is expected (the bucket insert is
-- idempotent via ON CONFLICT).

insert into storage.buckets (id, name, public)
values ('teacher-uploads', 'teacher-uploads', true)
on conflict (id) do nothing;

-- a teacher can only write into a path that starts with their own user
-- id (e.g. "<uid>/photo-169...jpg") - reads are open because the bucket
-- itself is public, so anyone with the URL can view (same as the
-- photo/video being shown on a public teacher profile page already)

create policy "teacher_uploads_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'teacher-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "teacher_uploads_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'teacher-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'teacher-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "teacher_uploads_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'teacher-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
