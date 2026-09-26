-- ARMUS migration 74: scopes teacher-uploads INSERT to the caller's own
-- folder.
--
-- teacher_uploads_insert_authenticated (schema.sql) only ever checked
-- `bucket_id = 'teacher-uploads'` - any authenticated account (a brand
-- new signup, another teacher, a student) could upload a file to ANY
-- path in this bucket, not just their own `<their session.id>/...`
-- prefix that apply-teacher.html's uploadToStorage() always uses. The
-- object's `owner` column is set to the caller's own auth.uid()
-- automatically regardless of the path chosen, so it never actually
-- protected the path itself - update/delete/select were already fixed
-- to check `auth.uid() = owner` (migration_68.sql), but that only
-- stops OTHERS from touching a file once it exists; it did nothing to
-- stop someone from planting a new file under a different user's
-- folder in the first place (namespace pollution - a same-named file
-- landing in another teacher's own upload prefix, or simply spending
-- someone else's quota).
--
-- storage.foldername(name) is Supabase's own helper for this exact
-- "user can only write inside a folder named after their own uid"
-- pattern - it returns the object key's path segments as an array, so
-- checking element 1 against auth.uid() confines every insert to the
-- same `<uid>/...` prefix uploadToStorage() already uses.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

drop policy if exists "teacher_uploads_insert_authenticated" on storage.objects;

create policy "teacher_uploads_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'teacher-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
