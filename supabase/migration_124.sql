-- ARMUS migration 124: security fixes from the app audit.
--
-- 1. The trigger secret leaves the source code.
--    Every database trigger and cron job that calls an Edge Function
--    (send-message-notification, send-push-notification,
--    policy-notices, notify-lessons-cancelled, payment-callback's
--    reconcile, the reminder emails, ...) sent the shared
--    x-armus-trigger-secret as a literal written into schema.sql and
--    the migrations. The GitHub repository is public, so that value is
--    public too, and with it anyone could call those functions as if
--    they were the database. For example, policy-notices
--    {type: "student_banned", student_id} emails "Hesabın kapatıldı"
--    from ARMUS to any account. Student ids are readable by anyone
--    through masked_reviews.student_id (closed in part 4 below).
--    The header now comes from public.armus_trigger_headers(), which
--    reads a NEW secret from Supabase Vault. The old value is burnt and
--    must not be reused.
--
--    BEFORE running this file:
--      a) make a new secret, for example with
--           select encode(extensions.gen_random_bytes(32), 'hex');
--      b) store it in Vault:
--           select vault.create_secret('<the new value>', 'armus_trigger_secret');
--    RIGHT AFTER running it:
--      c) set the same value as the Edge Functions' TRIGGER_SECRET
--         (Dashboard -> Edge Functions -> Secrets, or
--          `supabase secrets set TRIGGER_SECRET=<the new value>`).
--    Between c) and running this file, trigger calls are refused (401)
--    for a moment, so do the two back to back. This file stops with an
--    error, changing nothing, if step b) hasn't been done.
--
-- 2. The contact-sharing rule also holds for edits and attachments.
--    enforce_no_contact_sharing ran on INSERT only. The website's own
--    "Düzenle" (edit within 2 minutes) went straight past it: send
--    "merhaba", then edit it into a phone number. attachment_url
--    only had to start with https://, so a direct API call could send
--    https://wa.me/90... as an "image" that both the app and the site
--    open on a tap. The trigger now also runs on an edit, and an
--    attachment must be a file in this conversation's own
--    chat-attachments folder, which is the only thing the site uploads.
--
-- 3. profiles.referral_code and profiles.created_at are locked.
--    Neither is written by any app or site code after signup, but the
--    profile-lock triggers left both open to a plain update.
--      - referral_code: anyone could copy another user's invite code
--        into their own row. resolve_referral_code took "limit 1" with
--        no order, so a friend signing up through the real link could
--        be counted for the copier, who then got the free lesson.
--        The lookup now also prefers the code's real owner (the code is
--        derived from the owner's id).
--      - created_at: the 6-digit email-code gate (site and app) only
--        applies to accounts created from 29 Sep 2026 on, so an
--        unverified account could skip it by moving its own created_at
--        back.
--
-- 4. masked_reviews (public, also to signed-out visitors) no longer
--    lists every reviewer's account id and booking id. The reviewer, the
--    reviewed teacher and admins still see them.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

-- --- 1. trigger secret from Vault ---------------------------------------

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'armus_trigger_secret' and coalesce(decrypted_secret, '') <> ''
  ) then
    raise exception 'Store the new trigger secret first: select vault.create_secret(''<new value>'', ''armus_trigger_secret''); - see the top of migration_124.sql';
  end if;
end;
$$;

-- the headers every trigger / cron call to an Edge Function sends; only
-- the database itself (security-definer triggers, cron) calls this
create or replace function public.armus_trigger_headers()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'armus_trigger_secret'
    limit 1;
  return jsonb_build_object(
    'Content-Type', 'application/json',
    'x-armus-trigger-secret', coalesce(v_secret, '')
  );
end;
$$;

revoke all on function public.armus_trigger_headers() from public, anon, authenticated;

-- Rewrites every live function and cron job that still carries the old
-- literal header, whatever migration created it. The function bodies are
-- otherwise left exactly as they are in the database. Each rewritten
-- function must be security definer, because only the database may read
-- the secret.
do $$
declare
  r record;
  v_def text;
  v_literal constant text :=
    '''\{"Content-Type": "application/json", "x-armus-trigger-secret": "[0-9a-f]+"\}''::jsonb';
begin
  for r in
    select p.oid, p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
      and p.prosrc ~ 'x-armus-trigger-secret": "[0-9a-f]{16,}"'
  loop
    if not r.prosecdef then
      raise exception 'function % sends the trigger secret but is not security definer', r.oid::regprocedure;
    end if;
    v_def := regexp_replace(pg_get_functiondef(r.oid), v_literal, 'public.armus_trigger_headers()', 'g');
    execute v_def;
  end loop;

  if exists (select 1 from pg_namespace where nspname = 'cron') then
    for r in
      select jobid, command from cron.job
      where command ~ 'x-armus-trigger-secret": "[0-9a-f]{16,}"'
    loop
      perform cron.alter_job(
        r.jobid,
        command := regexp_replace(r.command, v_literal, 'public.armus_trigger_headers()', 'g')
      );
    end loop;

    if exists (select 1 from cron.job where command ~ 'x-armus-trigger-secret": "[0-9a-f]{16,}"') then
      raise exception 'a cron job still carries the old trigger secret';
    end if;
  end if;

  if exists (select 1 from pg_proc where prosrc ~ 'x-armus-trigger-secret": "[0-9a-f]{16,}"') then
    raise exception 'a function still carries the old trigger secret';
  end if;
end;
$$;

-- --- 2. contact sharing: edits and attachments ----------------------------

create or replace function public.enforce_no_contact_sharing()
returns trigger
language plpgsql
as $$
declare
  already_booked boolean;
  v_attachment_prefix text;
begin

  -- an edit that leaves the text and the attachment as they were (or
  -- any other update that names those columns) is not checked again
  if tg_op = 'UPDATE'
     and new.body is not distinct from old.body
     and new.attachment_url is not distinct from old.attachment_url then
    return new;
  end if;

  -- an attachment is a file uploaded into this conversation's own folder
  -- of the chat-attachments bucket (armusUploadChatAttachment,
  -- messages.js) - never a link to somewhere else
  if new.attachment_url is not null then
    v_attachment_prefix := 'https://rwdxubadjbwdsmrmgmkr.supabase.co/storage/v1/object/public/chat-attachments/'
      || new.conversation_id::text || '/';
    if left(new.attachment_url, length(v_attachment_prefix)) <> v_attachment_prefix
       or position('..' in new.attachment_url) > 0 then
      raise exception 'attachment_url_invalid: an attachment must be a file uploaded to this conversation';
    end if;
  end if;

  select exists (
    select 1
    from bookings b
    join conversations c on c.id = new.conversation_id
    where b.student_id = c.student_id
      and b.teacher_id = c.teacher_id::text
      and b.status = 'confirmed'
  ) into already_booked;

  if already_booked then
    return new;
  end if;

  if new.body ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
    or new.body ~ '(\d[ \-.()]{0,2}){7,}\d'
    or new.body ~* '(whatsapp|telegram|instagram|\minsta\M|snapchat|\mimo\M|viber|signal|numaram|numaray|numaras|telefonum|e-?posta|eposta|gmail|hotmail|outlook)'
  then
    raise exception 'contact_sharing_blocked: iletisim bilgisi paylasimi ve platform disi iletisim, resmi bir ders satin alana kadar yasaktir';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_block_contact_sharing on messages;
create trigger messages_block_contact_sharing
  before insert or update of body, attachment_url on messages
  for each row execute procedure public.enforce_no_contact_sharing();

-- --- 3. referral_code and created_at locked ---------------------------------

create or replace function public.enforce_policy_columns_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or public.is_admin()
     or coalesce(current_setting('armus.attendance_system_update', true), '') = 'on' then
    return new;
  end if;

  if new.ban_suggested_at is distinct from old.ban_suggested_at
     or new.account_locked is distinct from old.account_locked
     or new.account_locked_reason is distinct from old.account_locked_reason
     or new.account_locked_at is distinct from old.account_locked_at then
    raise exception 'policy_lock: these fields can only be changed by an admin';
  end if;

  -- migration_124.sql: set once at signup (handle_new_user) and never
  -- written again by the site or the app
  if new.referral_code is distinct from old.referral_code
     or new.created_at is distinct from old.created_at then
    raise exception 'identity_lock: referral_code and created_at cannot be changed';
  end if;

  return new;
end;
$$;

-- the code's real owner first (handle_new_user derives it from the id),
-- then the oldest account - never an arbitrary row
create or replace function public.resolve_referral_code(code text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from profiles
  where referral_code = upper(code)
  order by (referral_code = upper(left(replace(id::text, '-', ''), 10))) desc, created_at
  limit 1;
$$;

grant execute on function public.resolve_referral_code(text) to anon, authenticated;

-- --- 4. masked_reviews without everyone's account and booking ids ----------

create or replace view public.masked_reviews
as
select
  r.id,
  case
    when auth.uid() = r.student_id or auth.uid()::text = r.teacher_id or public.is_admin() then r.booking_id
  end as booking_id,
  r.teacher_id,
  case
    when auth.uid() = r.student_id or auth.uid()::text = r.teacher_id or public.is_admin() then r.student_id
  end as student_id,
  case
    when auth.uid() = r.student_id then r.student_name
    when auth.uid()::text = r.teacher_id then r.student_name
    when public.is_admin() then r.student_name
    else public.short_display_name(r.student_name)
  end as student_name,
  r.stars,
  r.comment,
  r.created_at
from public.reviews r;

grant select on public.masked_reviews to anon, authenticated;
