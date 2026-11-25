-- migration_131.sql: the deletion periods the KVKK Aydınlatma Metni
-- (Bölüm 10) promises, for the tables that had no clean-up yet.
-- (sign_in_events' 90 days and the contact form / chat IP addresses'
-- 30 days already run in armus-daily-policies and armus-purge-old-ip-addresses.)
--
--   client_errors          90 days   (uygulama hata kayıtları)
--   login_attempts         90 days   (giriş kayıtları; failed ones were
--                                     only removed after a later success)
--   site_chat_logs         1 year    (sohbet asistanı yazışmaları)
--   contact_messages       2 years   (iletişim formu mesajları)
--   email_verifications    7 days after the code expired
--
-- IMPORTANT: this deletes rows for good. Read it once more before running.
-- Run once in the Supabase SQL Editor; safe to run again (cron.schedule
-- with the same name replaces the job).

select cron.schedule(
  'armus-retention',
  '41 3 * * *',
  $$
  delete from public.client_errors where created_at < now() - interval '90 days';
  delete from public.login_attempts where created_at < now() - interval '90 days';
  delete from public.site_chat_logs where created_at < now() - interval '1 year';
  delete from public.contact_messages where created_at < now() - interval '2 years';
  delete from public.email_verifications where expires_at < now() - interval '7 days';
  $$
);
