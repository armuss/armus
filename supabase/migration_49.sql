-- Fixes unrestricted file uploads to ARMUS's two public storage buckets.
-- teacher_uploads_insert_authenticated / chat_attachments_insert_authenticated
-- only ever check bucket_id - any authenticated user could upload ANY
-- file type via a direct API call (the accept="..." on the <input
-- type="file"> in apply-teacher.html, and the file.type check in
-- messages.js's armusAttachmentTypeForFile, are both client-side only,
-- not enforced). A malicious .html or .svg file with embedded <script>
-- uploaded this way would be served back by Supabase Storage at its own
-- public URL with that same content-type - hosting arbitrary
-- executable/phishing content using ARMUS's own trusted upload flow.
--
-- allowed_mime_types/file_size_limit are enforced by Supabase Storage
-- itself, not RLS, so this closes the hole regardless of which insert
-- policy accepts the request.

update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime'],
    file_size_limit = 26214400 -- 25MB
where id = 'teacher-uploads';

update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg'],
    file_size_limit = 26214400 -- 25MB
where id = 'chat-attachments';
