-- ARMUS migration 115: the admin log now says who came into the admin
-- panel and when, and can be trusted on who and when for every row.
--
-- admin_actions (migration_7.sql) already kept a row for most things an
-- admin does in the panel, written by the panel itself. What it lacked,
-- for two owners who want to see each other's activity:
--
--   1. Entries. Nothing recorded an admin coming into the panel at all.
--      admin_log_visit() adds a 'panel_enter' row, with the IP address
--      and browser the request came from.
--
--   2. Trust in "who" and "when". admin_name and created_at were
--      whatever the browser sent. A trigger now sets them (and the IP
--      and browser) on the server for every row.
--
--   3. History that survives. admin_id was ON DELETE CASCADE - deleting
--      an admin's account deleted everything they had ever done from the
--      log. It is SET NULL now; the name stays on the row.
--
--   4. Admin rights. Making someone an admin, or taking it away, is
--      logged by the database itself - including when it's done straight
--      in the Supabase SQL editor, where the panel never sees it.
--
-- Rows still can't be changed or deleted from the browser (there is no
-- update/delete policy on the table, same as before).
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

-- 3. keep the log when an admin's account is deleted
alter table admin_actions alter column admin_id drop not null;

-- admin_id is the table's only foreign key; dropped by lookup, not by a
-- guessed name, so the old cascading one can't be left behind
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.admin_actions'::regclass and contype = 'f'
  loop
    execute format('alter table admin_actions drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table admin_actions
  add constraint admin_actions_admin_id_fkey
  foreign key (admin_id) references profiles(id) on delete set null;

alter table admin_actions add column if not exists details text;
alter table admin_actions add column if not exists ip text;
alter table admin_actions add column if not exists user_agent text;

create index if not exists admin_actions_created_at_idx on admin_actions (created_at desc);

-- One header of the API request this statement came in on (PostgREST
-- puts them in request.headers). Null outside a request, e.g. in the SQL
-- editor. Not callable from the browser - only the functions below use it.
create or replace function public.armus_request_header(p_name text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_headers text := current_setting('request.headers', true);
begin
  if v_headers is null or v_headers = '' then
    return null;
  end if;
  return nullif(left(trim(v_headers::json ->> p_name), 400), '');
exception when others then
  return null;
end;
$$;

revoke all on function public.armus_request_header(text) from public, anon, authenticated;

-- The caller's IP address. cf-connecting-ip and x-real-ip are set by the
-- proxies in front of the API; x-forwarded-for is the fallback, and only
-- its first entry is the client.
create or replace function public.armus_request_ip()
returns text
language sql
stable
set search_path = public
as $$
  select nullif(trim(split_part(coalesce(
    public.armus_request_header('cf-connecting-ip'),
    public.armus_request_header('x-real-ip'),
    public.armus_request_header('x-forwarded-for')
  ), ',', 1)), '');
$$;

revoke all on function public.armus_request_ip() from public, anon, authenticated;

-- 2. who, when and from where are the server's to say, not the browser's
create or replace function public.admin_actions_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.admin_id := auth.uid();
  -- outside a signed-in request (the SQL editor) the given name stands
  new.admin_name := coalesce((select name from profiles where id = auth.uid()), nullif(new.admin_name, ''), 'Supabase');
  new.created_at := now();
  new.ip := public.armus_request_ip();
  new.user_agent := public.armus_request_header('user-agent');
  new.details := left(new.details, 500);
  return new;
end;
$$;

drop trigger if exists admin_actions_stamp on admin_actions;
create trigger admin_actions_stamp
  before insert on admin_actions
  for each row execute procedure public.admin_actions_stamp();

-- 1. an admin came into the panel. Called by admin.html each time the
-- panel is opened; coming back within 30 minutes from the same device is
-- the same sitting, not a new entry. Does nothing for a non-admin.
create or replace function public.admin_log_visit()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text := public.armus_request_ip();
  v_agent text := public.armus_request_header('user-agent');
begin
  if not public.is_admin() then
    return;
  end if;

  if exists (
    select 1 from admin_actions
    where admin_id = auth.uid()
      and action = 'panel_enter'
      and created_at > now() - interval '30 minutes'
      and ip is not distinct from v_ip
      and user_agent is not distinct from v_agent
  ) then
    return;
  end if;

  insert into admin_actions (admin_id, admin_name, action, target_type, target_id)
  values (auth.uid(), '', 'panel_enter', 'panel', 'admin');
end;
$$;

revoke all on function public.admin_log_visit() from public, anon;
grant execute on function public.admin_log_visit() to authenticated;

-- 4. admin rights given or taken away, whoever does it and wherever
-- from. An AFTER trigger with its own error handling: the log can never
-- be the reason the change itself fails.
create or replace function public.log_admin_rights_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into admin_actions (admin_id, admin_name, action, target_type, target_id, target_label)
    values (
      auth.uid(), 'Supabase',
      case when new.is_admin then 'admin_grant' else 'admin_revoke' end,
      'profile', new.id::text, new.name
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists profiles_log_admin_rights on profiles;
create trigger profiles_log_admin_rights
  after update on profiles
  for each row
  when (old.is_admin is distinct from new.is_admin)
  execute procedure public.log_admin_rights_change();
