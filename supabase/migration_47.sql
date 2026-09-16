-- Fixes a TOCTOU race in payment-callback (same bug class already fixed
-- for create-payment/cancel-booking): the function's own comment notes
-- "iyzico can call this more than once for the same token" - two
-- concurrent callbacks (a genuine iyzico retry, or two browser tabs both
-- landing on the redirect) could both read pending_payments.status as not
-- yet "succeeded" before either committed its update, and each go on to
-- create a booking or grant a batch of lesson credits for one charge.
--
-- payment-callback now atomically claims the row (status 'pending'/
-- 'failed' -> 'processing') before doing any real work, so only one
-- concurrent call can proceed; this adds the 'processing' status value
-- that claim needs.

alter table pending_payments drop constraint if exists pending_payments_status_check;

alter table pending_payments add constraint pending_payments_status_check
  check (status in ('pending', 'processing', 'succeeded', 'failed', 'paid_no_booking'));
