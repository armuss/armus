-- migration_130.sql: what each new account accepted at signup.
--
-- The signup step (legal-consent.js on the site, LegalConsent in the app)
-- only lets "Hesap Oluştur" through after the person has scrolled to the
-- end of the Kullanım Şartları and the KVKK Aydınlatma Metni and ticked
-- them, and made the age statement; the ticari ileti onayı is a separate,
-- optional box. The answers travel in the auth metadata:
--
--   { "consents": { "channel": "web" | "app",
--                   "versions": { "terms": "2026-11-25", "kvkk_notice": "2026-11-25", ... },
--                   "terms": true, "kvkk_notice": true,
--                   "age_statement": true, "marketing": false } }
--
-- and handle_new_user keeps one row per statement in user_consents, with
-- the document's version and the server's own time. That row is the proof
-- (KVKK m.10 aydınlatma, the contract, 6563 onay) if it is ever asked for.
--
-- user_consents has no foreign key to the account on purpose: the rows
-- outlive a deleted account (KVKK Aydınlatma Metni, Bölüm 10 - kept for
-- ispat). Nobody edits or deletes a row; a later change (e.g. taking the
-- marketing consent back) is a new row, newest wins.
--
-- Run once in the Supabase SQL Editor; safe to run again.

-- === TABLE ==============================================================

create table if not exists public.user_consents (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  document text not null check (document in ('terms', 'kvkk_notice', 'age_statement', 'marketing')),
  version text not null check (char_length(version) between 1 and 32),
  granted boolean not null,
  channel text not null default 'web' check (channel in ('web', 'app', 'support')),
  created_at timestamptz not null default now()
);

create index if not exists user_consents_user_idx
  on public.user_consents (user_id, document, created_at desc);

alter table public.user_consents enable row level security;

drop policy if exists user_consents_select_own on public.user_consents;
create policy user_consents_select_own on public.user_consents
  for select using (user_id = auth.uid() or public.is_admin());

-- no insert / update / delete policies: rows come only from
-- handle_new_user and set_marketing_consent below

-- === SIGNUP =============================================================
-- migration_71.sql's handle_new_user, unchanged for the profile row, plus
-- the consent rows. The consent part can never break a signup: anything
-- unexpected in it is skipped with a warning.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  c jsonb := new.raw_user_meta_data->'consents';
  doc text;
  doc_version text;
  ch text;
begin
  insert into public.profiles (id, email, name, role, city, referral_code)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'student'),
    new.raw_user_meta_data->>'city',
    upper(left(replace(new.id::text, '-', ''), 10))
  );

  if jsonb_typeof(c) = 'object' then
    begin
      ch := case when c->>'channel' = 'app' then 'app' else 'web' end;
      foreach doc in array array['terms', 'kvkk_notice', 'age_statement', 'marketing'] loop
        if jsonb_typeof(c->doc) = 'boolean' then
          doc_version := left(coalesce(nullif(c->'versions'->>doc, ''), nullif(c->>'version', ''), 'unknown'), 32);
          insert into public.user_consents (user_id, document, version, granted, channel)
          values (new.id, doc, doc_version, (c->>doc)::boolean, ch);
        end if;
      end loop;
    exception when others then
      raise warning 'handle_new_user: consents skipped for %: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$$;

-- === MARKETING CONSENT, LATER ===========================================
-- Giving or taking back the ticari ileti onayı after signup (a settings
-- switch, or support acting on an e-mail): a new row each time.

create or replace function public.set_marketing_consent(p_granted boolean, p_version text, p_channel text default 'web')
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into public.user_consents (user_id, document, version, granted, channel)
  values (
    auth.uid(),
    'marketing',
    left(coalesce(nullif(p_version, ''), 'unknown'), 32),
    coalesce(p_granted, false),
    case when p_channel = 'app' then 'app' else 'web' end
  );
end;
$$;

revoke all on function public.set_marketing_consent(boolean, text, text) from public, anon;
grant execute on function public.set_marketing_consent(boolean, text, text) to authenticated;

-- the caller's own current answer per document (newest row wins)
create or replace function public.my_consents()
returns table (document text, version text, granted boolean, created_at timestamptz)
language sql
stable
security definer set search_path = public
as $$
  select distinct on (c.document) c.document, c.version, c.granted, c.created_at
  from public.user_consents c
  where c.user_id = auth.uid()
  order by c.document, c.created_at desc, c.id desc;
$$;

revoke all on function public.my_consents() from public, anon;
grant execute on function public.my_consents() to authenticated;

-- === NEWSLETTER =========================================================
-- which onay metni the footer form showed when someone subscribed

alter table public.newsletter_subscribers add column if not exists consent_version text
  check (consent_version is null or char_length(consent_version) <= 32);
