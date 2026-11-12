-- Your Parent Plan: saved plan data, document uploads, and Stripe billing
-- Run this once in Supabase > SQL Editor, AFTER supabase-paid-vault-setup.sql.
-- It is safe to run again.

-- ---------------------------------------------------------------
-- Helper: is this user on an active Plus membership?
-- ---------------------------------------------------------------
create or replace function public.ypp_is_plus(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = uid
      and m.status = 'active'
      and m.tier in ('plus_monthly','plus_annual')
  );
$$;
grant execute on function public.ypp_is_plus(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 1. Saved plan data (Essentials, Money, checklist, Care, profile)
--    One JSON document per user per section.
-- ---------------------------------------------------------------
create table if not exists public.plan_data (
  user_id uuid not null references auth.users(id) on delete cascade,
  section text not null check (section in ('profile','essentials','people','money','checklist','care','careAssumptions')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, section)
);

alter table public.plan_data enable row level security;

drop policy if exists "owner can read plan data" on public.plan_data;
create policy "owner can read plan data" on public.plan_data
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "owner can insert plan data" on public.plan_data;
create policy "owner can insert plan data" on public.plan_data
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "owner can update plan data" on public.plan_data;
create policy "owner can update plan data" on public.plan_data
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "owner can delete plan data" on public.plan_data;
create policy "owner can delete plan data" on public.plan_data
for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.plan_data to authenticated;

-- ---------------------------------------------------------------
-- 2. Documents (Scan & Organize)
--    Files live in a PRIVATE storage bucket under <user id>/...
--    Free accounts can keep up to 10 documents; Plus is unlimited.
-- ---------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default 'Other',
  note text not null default '',
  storage_path text not null unique,
  mime_type text not null default '',
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists documents_user_id_idx on public.documents(user_id);

alter table public.documents enable row level security;

drop policy if exists "owner can read documents" on public.documents;
create policy "owner can read documents" on public.documents
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "owner can add documents within plan limit" on public.documents;
create policy "owner can add documents within plan limit" on public.documents
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and storage_path like (select auth.uid())::text || '/%'
  and (
    public.ypp_is_plus((select auth.uid()))
    or (select count(*) from public.documents d where d.user_id = (select auth.uid())) < 10
  )
);

drop policy if exists "owner can update documents" on public.documents;
create policy "owner can update documents" on public.documents
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "owner can delete documents" on public.documents;
create policy "owner can delete documents" on public.documents
for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.documents to authenticated;

-- Private bucket, 15 MB per file, photos / PDFs / Word documents only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 15728640,
  array['image/jpeg','image/png','image/heic','image/heif','image/webp','application/pdf',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ypp owner can read own files" on storage.objects;
create policy "ypp owner can read own files" on storage.objects
for select to authenticated
using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "ypp owner can upload own files" on storage.objects;
create policy "ypp owner can upload own files" on storage.objects
for insert to authenticated
with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "ypp owner can delete own files" on storage.objects;
create policy "ypp owner can delete own files" on storage.objects
for delete to authenticated
using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------
-- 3. Stripe billing fields on memberships
--    Only the stripe-webhook Edge Function (service role) writes these.
--    Browsers can still only READ their own membership row.
-- ---------------------------------------------------------------
alter table public.memberships add column if not exists stripe_customer_id text unique;
alter table public.memberships add column if not exists stripe_subscription_id text;
alter table public.memberships add column if not exists stripe_status text;
alter table public.memberships add column if not exists current_period_end timestamptz;
alter table public.memberships add column if not exists cancel_at_period_end boolean not null default false;
