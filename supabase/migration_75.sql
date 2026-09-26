-- ARMUS migration 75: scheduled cleanup of contact-form and site-chat IP
-- addresses after 30 days.
--
-- gizlilik-politikasi.html (Privacy Policy) promises the IP address
-- collected from the contact form is kept "kısa süreliğine" (briefly),
-- purely to prevent abuse (see send-contact-email's rate limiter,
-- migration_73.sql's identical one for site-chat). Until now nothing
-- ever actually deleted it - contact_messages.ip_address and
-- site_chat_logs.ip_address were kept forever, which didn't match what
-- the policy says and kept more personal data around than the stated
-- purpose (spam prevention, on a 1-hour rate-limit window) needs -
-- exactly what KVKK's storage-limitation principle is about.
--
-- This only nulls the ip_address column, never the row itself - the
-- message/reply content stays (a contact message can be a real support
-- record worth keeping; a chat transcript is what lets an admin review
-- widget quality). 30 days is comfortably past the 1-hour window either
-- limiter actually needs, while leaving a reasonable abuse-investigation
-- buffer.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor. Requires
-- pg_cron (already enabled - see migration_23.sql).

select cron.schedule(
  'armus-purge-old-ip-addresses',
  '0 4 * * *', -- once a day, 04:00 UTC
  $$
  update contact_messages
  set ip_address = null
  where ip_address is not null
    and created_at < now() - interval '30 days';

  update site_chat_logs
  set ip_address = null
  where ip_address is not null
    and created_at < now() - interval '30 days';
  $$
);
