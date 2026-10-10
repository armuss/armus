-- ARMUS migration 97: an internal support ticket system between a
-- teacher and the ARMUS admin team - dashboard.html gets a "Destek"
-- panel to open a ticket and reply, admin.html gets a "Destek
-- Talepleri" panel to see every ticket and reply/close it. Deliberately
-- separate from conversations/messages (student<->teacher chat) - this
-- is teacher<->platform, has no "two matched users" relationship to
-- establish, and shouldn't be subject to messages' contact-sharing
-- filter or per-conversation rate limit.
--
-- No email notification on a new ticket/reply (unlike reviews/messages)
-- - same as pending_changes and withdrawal_requests, the admin panel's
-- own badge count is the notification; this keeps the scope to what was
-- asked instead of adding a second Edge Function.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  subject text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  sender_role text not null check (sender_role in ('teacher', 'admin')),
  body text not null,
  created_at timestamptz not null default now()
);

alter table support_tickets enable row level security;
alter table support_ticket_messages enable row level security;

create index if not exists support_tickets_teacher_id_idx on support_tickets(teacher_id);
create index if not exists support_ticket_messages_ticket_id_idx on support_ticket_messages(ticket_id);

drop policy if exists "support_tickets_select_own_or_admin" on support_tickets;
create policy "support_tickets_select_own_or_admin"
  on support_tickets for select
  using (auth.uid() = teacher_id or public.is_admin());

drop policy if exists "support_tickets_insert_own" on support_tickets;
create policy "support_tickets_insert_own"
  on support_tickets for insert
  with check (auth.uid() = teacher_id and status = 'open');

-- broad on purpose, same shape as messages_update_participant - either
-- side can open/close the ticket (a teacher closing their own resolved
-- issue, an admin closing a handled one, or an admin reopening one that
-- needs more attention)
drop policy if exists "support_tickets_update_own_or_admin" on support_tickets;
create policy "support_tickets_update_own_or_admin"
  on support_tickets for update
  using (auth.uid() = teacher_id or public.is_admin())
  with check (auth.uid() = teacher_id or public.is_admin());

drop policy if exists "support_ticket_messages_select_participant" on support_ticket_messages;
create policy "support_ticket_messages_select_participant"
  on support_ticket_messages for select
  using (
    exists (
      select 1 from support_tickets t
      where t.id = ticket_id
        and (t.teacher_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists "support_ticket_messages_insert_participant" on support_ticket_messages;
create policy "support_ticket_messages_insert_participant"
  on support_ticket_messages for insert
  with check (
    sender_id = auth.uid()
    and (
      (sender_role = 'teacher' and exists (
        select 1 from support_tickets t where t.id = ticket_id and t.teacher_id = auth.uid()
      ))
      or (sender_role = 'admin' and public.is_admin())
    )
  );

-- a new message bumps the ticket's updated_at (so admin.html can sort
-- by most-recently-active) and, if the TEACHER replies to a ticket the
-- admin had already closed, reopens it - mirrors how a real support
-- inbox behaves, so a teacher's follow-up never silently lands in a
-- closed thread nobody is watching
create or replace function public.support_ticket_bump_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update support_tickets
  set updated_at = now(),
      status = case when new.sender_role = 'teacher' then 'open' else status end
  where id = new.ticket_id;
  return new;
end;
$$;

drop trigger if exists support_ticket_messages_bump on support_ticket_messages;
create trigger support_ticket_messages_bump
  after insert on support_ticket_messages
  for each row execute procedure public.support_ticket_bump_on_message();
