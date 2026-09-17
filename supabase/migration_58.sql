-- send-contact-email has no auth requirement (it's the public contact
-- form) and no rate limiting at all - a script can call it any number of
-- times per minute, each call consuming one send against the same
-- Resend account send-verification-email also depends on. A per-email
-- limit alone is trivially bypassed (the caller supplies `email` freely),
-- so this adds the sender's IP to contact_messages and the edge function
-- now caps how many messages one IP can submit per hour.

alter table contact_messages add column if not exists ip_address text;
