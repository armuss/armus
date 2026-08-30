-- Migration 18: chat upgrades - voice messages, photo/video attachments,
-- and teacher inline corrections ("Düzelt Beni").
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

-- === MESSAGES: attachments + corrections =========================

alter table messages alter column body set default '';

alter table messages add column if not exists attachment_url text;
alter table messages add column if not exists attachment_type text
  check (attachment_type in ('image', 'video', 'audio'));

-- when set, this message IS a correction of the message it points to -
-- the corrected text lives in this row's own body, and the original
-- gets looked up client-side to show struck through above it.
alter table messages add column if not exists corrected_of_id uuid
  references messages(id) on delete set null;

-- a message needs either real text or an attachment - never neither
alter table messages drop constraint if exists messages_body_or_attachment;
alter table messages add constraint messages_body_or_attachment
  check (body <> '' or attachment_url is not null);

-- === CHAT ATTACHMENTS (STORAGE) ===================================
-- Public bucket, same trade-off as teacher-uploads (migration_11.sql):
-- reads are open to anyone with the URL (which is an unguessable path,
-- not browsable), writes just require being logged in.

insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', true)
on conflict (id) do nothing;

drop policy if exists "chat_attachments_insert_authenticated" on storage.objects;
drop policy if exists "chat_attachments_update_authenticated" on storage.objects;
drop policy if exists "chat_attachments_delete_authenticated" on storage.objects;
drop policy if exists "chat_attachments_select_authenticated" on storage.objects;

create policy "chat_attachments_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'chat-attachments');

create policy "chat_attachments_update_authenticated"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'chat-attachments')
  with check (bucket_id = 'chat-attachments');

create policy "chat_attachments_delete_authenticated"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'chat-attachments');

-- uploads don't use upsert here (every attachment path is unique), but
-- this is included anyway after migration_13.sql's lesson: some storage
-- operations check object existence under the caller's own role first.
create policy "chat_attachments_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'chat-attachments');
