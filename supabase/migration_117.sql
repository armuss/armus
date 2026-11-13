-- ARMUS migration 117: the sign-in email can't be changed.
--
-- The rule: a teacher or student keeps the email address they signed up
-- with, for good. Settings (website) and Profil (app) no longer offer a
-- way to change it, but that alone isn't enough - anyone signed in can
-- call Supabase Auth's updateUser({ email }) straight from the browser
-- console with their own session. So the database refuses it:
--
--   * updateUser({ email }) first writes the requested address into
--     auth.users.email_change (and mails a confirmation link). That
--     write is refused here, so the request fails right away and no
--     confirmation link is ever sent.
--   * auth.users.email itself can't change either, so no other route
--     (an old confirmation link from before this migration, an admin
--     API call) moves an account to a new address.
--
-- profiles.email was already locked against a direct write from the
-- browser (email_lock in protect_profile_columns); sync_profile_email
-- keeps following auth.users.email, which now simply never changes.
--
-- When an owner really must move an account to a new address (the
-- person lost access to their mailbox, a typo at signup), they do it
-- here in the SQL editor, inside one transaction, with the bypass flag:
--
--   begin;
--   select set_config('armus.allow_email_change', 'on', true);
--   update auth.users set email = 'yeni@adres.com' where id = '<user id>';
--   commit;
--
-- (sync_profile_email then copies it to profiles.email as before.)
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

create or replace function public.block_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- the owner's own SQL-editor fix (see above) - never set by app code
  if coalesce(current_setting('armus.allow_email_change', true), '') = 'on' then
    return new;
  end if;

  -- updateUser({ email }) asking for a new address
  if coalesce(new.email_change, '') <> '' and new.email_change is distinct from old.email_change then
    raise exception 'email_change_locked: the sign-in email of an account cannot be changed';
  end if;

  -- the address itself (first-time set on a brand-new row is fine)
  if old.email is not null and new.email is distinct from old.email then
    raise exception 'email_change_locked: the sign-in email of an account cannot be changed';
  end if;

  return new;
end;
$$;

drop trigger if exists before_auth_user_email_change on auth.users;
create trigger before_auth_user_email_change
  before update on auth.users
  for each row execute procedure public.block_email_change();

-- any change request already waiting from before this migration is
-- dropped, so its confirmation link can't complete it later
update auth.users
set email_change = '', email_change_token_new = '', email_change_token_current = '', email_change_confirm_status = 0
where coalesce(email_change, '') <> '';
