-- Fixes a serious storage hole: teacher_uploads_update_authenticated and
-- teacher_uploads_delete_authenticated (and the matching chat-attachments
-- policies) only ever checked bucket_id - not ownership. Any authenticated
-- account (any student, any other teacher) could overwrite or delete ANY
-- file in these public buckets, not just their own.
--
-- teacher-uploads is public and every photo/certificate/video URL is
-- embedded directly in that teacher's own public profile page
-- (teacher.html) - the exact storage path to target was never a secret,
-- so anyone who viewed a teacher's page could vandalize or delete their
-- photo, certificate, or intro video. chat-attachments has a smaller
-- blast radius (paths include a random conversation id), but the same
-- gap existed there too.
--
-- uploadToStorage (apply-teacher.html) and armusUploadChatAttachment
-- (messages.js) always write a fresh, timestamped path per upload, and
-- the app never calls storage.remove() itself, so restricting update/
-- delete to the actual owner doesn't affect any real flow.
--
-- Verified against a local Postgres instance (stubbed storage.objects
-- with its real `owner` column): a non-owner's delete/update now affects
-- 0 rows, the real owner's delete still succeeds.

drop policy if exists "teacher_uploads_update_authenticated" on storage.objects;
drop policy if exists "teacher_uploads_delete_authenticated" on storage.objects;

create policy "teacher_uploads_update_authenticated"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'teacher-uploads' and auth.uid() = owner)
  with check (bucket_id = 'teacher-uploads' and auth.uid() = owner);

create policy "teacher_uploads_delete_authenticated"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'teacher-uploads' and auth.uid() = owner);

drop policy if exists "chat_attachments_update_authenticated" on storage.objects;
drop policy if exists "chat_attachments_delete_authenticated" on storage.objects;

create policy "chat_attachments_update_authenticated"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'chat-attachments' and auth.uid() = owner)
  with check (bucket_id = 'chat-attachments' and auth.uid() = owner);

create policy "chat_attachments_delete_authenticated"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'chat-attachments' and auth.uid() = owner);
