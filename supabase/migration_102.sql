-- migration_102.sql: message-level harassment/spam reporting (Preply's
-- own "report spam" + harassment-reporting pattern), the #3+#5 item of
-- the Preply-inspired policy build (#1 was migration_100.sql's trial
-- no-show ladder, #4 was migration_101.sql's enhanced blocking, #2 was
-- the static ogretmen-etik-kurallari.html page).
--
-- A student or teacher can report one of the OTHER party's messages as
-- harassment, spam, or something else, with an optional note. ARMUS
-- staff review every report from a new admin panel; mesajlar.html's own
-- existing "Engelle" (block) feature already stops any further contact
-- immediately if the student wants that right away - this is the
-- separate, slower "ARMUS looked into it" channel, same as Preply keeps
-- blocking and reporting as two different buttons.

create table message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  -- denormalized off the message at report time, purely so the admin
  -- panel and openConversationDetail don't need an extra join/lookup -
  -- the insert policy below re-derives and cross-checks both against
  -- the real message row, so a client can't misattribute a report.
  conversation_id uuid not null references conversations(id) on delete cascade,
  reporter_id uuid not null references profiles(id) on delete cascade,
  reported_user_id uuid not null references profiles(id) on delete cascade,
  reason text not null check (reason in ('harassment', 'spam', 'other')),
  note text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id),
  unique (message_id, reporter_id)
);

alter table message_reports enable row level security;

create policy "message_reports_select_own_or_admin"
  on message_reports for select
  using (auth.uid() = reporter_id or public.is_admin());

-- Every field here is either forced to the caller (reporter_id) or
-- cross-checked against the real message/conversation row - a client
-- can't report a message it isn't a participant of, attribute the
-- report to the wrong sender, or report its own message.
create policy "message_reports_insert_own"
  on message_reports for insert
  with check (
    reporter_id = auth.uid()
    and exists (
      select 1 from messages m
      join conversations c on c.id = m.conversation_id
      where m.id = message_id
        and c.id = conversation_id
        and m.sender_id = reported_user_id
        and m.sender_id <> auth.uid()
        and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
    )
  );

create policy "message_reports_update_admin"
  on message_reports for update
  using (public.is_admin())
  with check (public.is_admin());
