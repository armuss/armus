-- ARMUS migration 6: real-time messaging between a student and a real
-- (self-registered) teacher. Demo teachers (teachers-data.js) have no
-- real account, so they're never a valid participant here.

create table conversations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  teacher_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (student_id, teacher_id)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table conversations enable row level security;
alter table messages enable row level security;

-- conversations: only the two participants can see or create their thread
create policy "conversations_select_participant"
  on conversations for select
  using (auth.uid() = student_id or auth.uid() = teacher_id);

create policy "conversations_insert_participant"
  on conversations for insert
  with check (auth.uid() = student_id or auth.uid() = teacher_id);

-- messages: only participants of the parent conversation can read;
-- you can only insert a message as yourself, into a conversation you're in
create policy "messages_select_participant"
  on messages for select
  using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
    )
  );

create policy "messages_insert_own"
  on messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
    )
  );

-- lets a participant mark the other side's messages as read
create policy "messages_update_participant"
  on messages for update
  using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
    )
  );

-- turn on realtime change events for the messages table
alter publication supabase_realtime add table messages;
