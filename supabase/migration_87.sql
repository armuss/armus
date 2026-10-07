-- ARMUS migration 87: fixes messages_insert_own (migration_69.sql), whose
-- per-sender rate-limit check queried the messages table from inside a
-- policy defined ON that same messages table:
--
--   and (
--     select count(*) from messages m2
--     where m2.sender_id = auth.uid()
--       and m2.created_at > now() - interval '1 hour'
--   ) < 120
--
-- Postgres refuses to plan that - a policy expression that scans the very
-- table it protects, in the same statement, fails outright with
-- "infinite recursion detected in policy for relation messages". That
-- made EVERY insert into messages fail, for every sender, regardless of
-- rate - not just over the 120/hour cap. Reopening a thread never
-- surfaced this (reading doesn't touch this policy), and until
-- migration_86.sql, students couldn't create a new conversation to begin
-- with - so the first real-world messages sent through a brand-new
-- thread are what finally hit it.
--
-- Fixed the same shape as migration_86.sql: the self-count moved into its
-- own SECURITY DEFINER function. A function call isn't inlined into the
-- policy the way a bare subquery is, so Postgres no longer treats it as
-- the table referencing itself.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create or replace function public.messages_under_rate_limit()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (
    select count(*) from messages m2
    where m2.sender_id = auth.uid()
      and m2.created_at > now() - interval '1 hour'
  ) < 120
$$;

drop policy if exists "messages_insert_own" on messages;

create policy "messages_insert_own"
  on messages for insert
  with check (
    sender_id = auth.uid()
    and coalesce((select is_banned from profiles where id = auth.uid()), false) = false
    and exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
    )
    and public.messages_under_rate_limit()
  );
