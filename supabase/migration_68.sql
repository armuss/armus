-- ARMUS migration 68: closes a Storage bucket enumeration hole - the
-- most severe finding from this session's dedicated security-focused
-- audit round.
--
-- Both teacher-uploads and chat-attachments' SELECT policies checked
-- only bucket_id, with no ownership/participant check at all:
--
--   using (bucket_id = 'teacher-uploads')
--   using (bucket_id = 'chat-attachments')
--
-- This governs Supabase Storage's AUTHENTICATED list()/download() API
-- (not the public getPublicUrl() download path teacher.html/mesajlar.html
-- actually use for display, which is unaffected by this migration) - but
-- since both buckets are public = true, anything list() returns is
-- immediately downloadable with no further check. Concretely, any
-- signed-in account (including one that just called signUp() seconds
-- ago, no email verification needed for the JWT to already work) could:
--
--   armusSupabase.storage.from('chat-attachments').list('', { limit: 1000 })
--
-- and enumerate + download every photo/video/voice-message ever
-- exchanged in ANY conversation on the platform, not just their own -
-- and identically for teacher-uploads, browsing every teacher's
-- application photo/certificate/intro video, including pending or
-- rejected applications never shown on any public page.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor. No
-- frontend change is needed - the app only ever uses getPublicUrl()
-- (a pure client-side string builder, no network/RLS call at all) to
-- display these files, never the list()/download() API this migration
-- restricts.

drop policy if exists "teacher_uploads_select_authenticated" on storage.objects;

create policy "teacher_uploads_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'teacher-uploads' and (auth.uid() = owner or public.is_admin()));

-- wrapped in a function (rather than inlined into the policy) so a
-- malformed/unexpected object name can never turn into a raw ::uuid
-- cast error breaking the whole query - it just evaluates to "not a
-- participant" instead.
create or replace function public.is_chat_attachment_participant(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  conv_id uuid;
begin
  begin
    conv_id := split_part(object_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;

  return exists (
    select 1 from conversations c
    where c.id = conv_id
      and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
  );
end;
$$;

drop policy if exists "chat_attachments_select_authenticated" on storage.objects;

create policy "chat_attachments_select_authenticated"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (auth.uid() = owner or public.is_chat_attachment_participant(name) or public.is_admin())
  );
