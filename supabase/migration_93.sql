-- ARMUS migration 93: lets an approved teacher request a cash-out of
-- their earnings from the dashboard's new "Finansal" tab, and gives
-- admin.html a "Para Çekme Talepleri" panel to process those requests.
--
-- This is a REQUEST queue, not a real payment rail - ARMUS has no bank
-- payout integration, so a request here just tells the admin team "this
-- teacher wants ₺X sent to this IBAN"; the actual bank transfer still
-- happens manually, outside the app, same as every other admin-reviewed
-- action in this codebase (teacher approval, attendance reports). The
-- requested amount is NOT re-validated against the teacher's real
-- lifetime earnings server-side - dashboard.html's own earnings-history
-- math (migration from the earlier "Kazanç Geçmişi" feature) already
-- applies the CURRENT commission tier retroactively as an estimate, and
-- reproducing that (plus the trial-conversion logic) in a trigger would
-- just be a second copy of the same approximation to keep in sync. The
-- admin processing a request is the real check, using whatever figures
-- they trust at that moment - this table only needs amount > 0.
--
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create table withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  amount numeric not null check (amount > 0),
  iban text not null,
  iban_name text not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'rejected')),
  admin_note text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references profiles(id)
);

alter table withdrawal_requests enable row level security;

create index withdrawal_requests_teacher_id_idx on withdrawal_requests(teacher_id);
create index withdrawal_requests_status_idx on withdrawal_requests(status);

-- a teacher sees only their own requests; an admin sees everyone's (to
-- actually process them)
create policy "withdrawal_requests_select_own_or_admin"
  on withdrawal_requests for select
  using (auth.uid() = teacher_id or public.is_admin());

-- only an approved, non-banned teacher can file a request for
-- themselves, and only as a fresh 'pending' row - status/admin_note/
-- processed_at/processed_by are never client-settable (enforced by the
-- "status = 'pending'" check here, plus the update policy below being
-- admin-only means a teacher can never move a request past 'pending'
-- themselves even if they resent the same id with different fields)
create policy "withdrawal_requests_insert_own"
  on withdrawal_requests for insert
  with check (
    auth.uid() = teacher_id
    and status = 'pending'
    and coalesce((select status from profiles where id = auth.uid()), '') = 'approved'
    and coalesce((select is_banned from profiles where id = auth.uid()), false) = false
  );

-- only an admin can move a request to paid/rejected (or edit admin_note)
create policy "withdrawal_requests_update_admin_only"
  on withdrawal_requests for update
  using (public.is_admin())
  with check (public.is_admin());
