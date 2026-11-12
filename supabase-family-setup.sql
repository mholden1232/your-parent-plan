-- Your Parent Plan: family sharing + Plus limits
-- Run this once in Supabase > SQL Editor, AFTER supabase-app-data-setup.sql.
-- It is safe to run again.
--
-- A "plan" belongs to the account that created it (its owner). A Plus owner
-- can invite family by email. Invited people can view (viewer) or view and
-- edit (editor) the owner's plan and documents. The Password Vault is never
-- shared.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------
create table if not exists public.plan_members (
  owner_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  member_email text not null default '',
  role text not null default 'editor' check (role in ('editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (owner_id, member_id),
  check (owner_id <> member_id)
);
create index if not exists plan_members_member_idx on public.plan_members(member_id);

create table if not exists public.plan_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'editor' check (role in ('editor','viewer')),
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz
);
create index if not exists plan_invites_owner_idx on public.plan_invites(owner_id);

alter table public.plan_members enable row level security;
alter table public.plan_invites enable row level security;

-- ---------------------------------------------------------------
-- Access helpers (text versions are used by storage policies)
-- ---------------------------------------------------------------
create or replace function public.ypp_can_view(owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) = owner
      or exists (select 1 from public.plan_members m
                 where m.owner_id = owner and m.member_id = (select auth.uid()));
$$;

create or replace function public.ypp_can_edit(owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) = owner
      or exists (select 1 from public.plan_members m
                 where m.owner_id = owner and m.member_id = (select auth.uid()) and m.role = 'editor');
$$;

create or replace function public.ypp_can_view_folder(folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid())::text = folder
      or exists (select 1 from public.plan_members m
                 where m.owner_id::text = folder and m.member_id = (select auth.uid()));
$$;

create or replace function public.ypp_can_edit_folder(folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid())::text = folder
      or exists (select 1 from public.plan_members m
                 where m.owner_id::text = folder and m.member_id = (select auth.uid()) and m.role = 'editor');
$$;

grant execute on function public.ypp_can_view(uuid), public.ypp_can_edit(uuid),
  public.ypp_can_view_folder(text), public.ypp_can_edit_folder(text) to authenticated;

-- ---------------------------------------------------------------
-- plan_data: family can read; owner + editors can write.
-- Free plans can save up to 2 Care facilities; Plus is unlimited.
-- ---------------------------------------------------------------
drop policy if exists "owner can read plan data" on public.plan_data;
drop policy if exists "owner can insert plan data" on public.plan_data;
drop policy if exists "owner can update plan data" on public.plan_data;
drop policy if exists "owner can delete plan data" on public.plan_data;
drop policy if exists "family can read plan data" on public.plan_data;
drop policy if exists "family can insert plan data" on public.plan_data;
drop policy if exists "family can update plan data" on public.plan_data;

create policy "family can read plan data" on public.plan_data
for select to authenticated using (public.ypp_can_view(user_id));

create policy "family can insert plan data" on public.plan_data
for insert to authenticated
with check (
  public.ypp_can_edit(user_id)
  and (section <> 'care' or public.ypp_is_plus(user_id)
       or jsonb_array_length(coalesce(data->'facilities','[]'::jsonb)) <= 2)
);

create policy "family can update plan data" on public.plan_data
for update to authenticated
using (public.ypp_can_edit(user_id))
with check (
  public.ypp_can_edit(user_id)
  and (section <> 'care' or public.ypp_is_plus(user_id)
       or jsonb_array_length(coalesce(data->'facilities','[]'::jsonb)) <= 2)
);

create policy "owner can delete plan data" on public.plan_data
for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------
-- documents: family can read; owner + editors can add/delete.
-- The 10-document free limit follows the plan owner's membership.
-- ---------------------------------------------------------------
drop policy if exists "owner can read documents" on public.documents;
drop policy if exists "owner can add documents within plan limit" on public.documents;
drop policy if exists "owner can update documents" on public.documents;
drop policy if exists "owner can delete documents" on public.documents;
drop policy if exists "family can read documents" on public.documents;
drop policy if exists "family can add documents within plan limit" on public.documents;
drop policy if exists "family can update documents" on public.documents;
drop policy if exists "family can delete documents" on public.documents;

create policy "family can read documents" on public.documents
for select to authenticated using (public.ypp_can_view(user_id));

create policy "family can add documents within plan limit" on public.documents
for insert to authenticated
with check (
  public.ypp_can_edit(user_id)
  and storage_path like user_id::text || '/%'
  and (
    public.ypp_is_plus(user_id)
    or (select count(*) from public.documents d where d.user_id = documents.user_id) < 10
  )
);

create policy "family can update documents" on public.documents
for update to authenticated
using (public.ypp_can_edit(user_id)) with check (public.ypp_can_edit(user_id));

create policy "family can delete documents" on public.documents
for delete to authenticated using (public.ypp_can_edit(user_id));

drop policy if exists "ypp owner can read own files" on storage.objects;
drop policy if exists "ypp owner can upload own files" on storage.objects;
drop policy if exists "ypp owner can delete own files" on storage.objects;
drop policy if exists "ypp family can read files" on storage.objects;
drop policy if exists "ypp family can upload files" on storage.objects;
drop policy if exists "ypp family can delete files" on storage.objects;

create policy "ypp family can read files" on storage.objects
for select to authenticated
using (bucket_id = 'documents' and public.ypp_can_view_folder((storage.foldername(name))[1]));

create policy "ypp family can upload files" on storage.objects
for insert to authenticated
with check (bucket_id = 'documents' and public.ypp_can_edit_folder((storage.foldername(name))[1]));

create policy "ypp family can delete files" on storage.objects
for delete to authenticated
using (bucket_id = 'documents' and public.ypp_can_edit_folder((storage.foldername(name))[1]));

-- ---------------------------------------------------------------
-- plan_members / plan_invites policies
-- ---------------------------------------------------------------
drop policy if exists "owner or member can see membership" on public.plan_members;
create policy "owner or member can see membership" on public.plan_members
for select to authenticated
using ((select auth.uid()) = owner_id or (select auth.uid()) = member_id);

drop policy if exists "owner can change role" on public.plan_members;
create policy "owner can change role" on public.plan_members
for update to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

drop policy if exists "owner removes or member leaves" on public.plan_members;
create policy "owner removes or member leaves" on public.plan_members
for delete to authenticated
using ((select auth.uid()) = owner_id or (select auth.uid()) = member_id);

grant select, update, delete on public.plan_members to authenticated;

drop policy if exists "owner can see invites" on public.plan_invites;
create policy "owner can see invites" on public.plan_invites
for select to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists "plus owner can invite" on public.plan_invites;
create policy "plus owner can invite" on public.plan_invites
for insert to authenticated
with check ((select auth.uid()) = owner_id and public.ypp_is_plus(owner_id));

drop policy if exists "owner can cancel invites" on public.plan_invites;
create policy "owner can cancel invites" on public.plan_invites
for delete to authenticated using ((select auth.uid()) = owner_id);

grant select, insert, delete on public.plan_invites to authenticated;

-- ---------------------------------------------------------------
-- RPCs used by the website
-- ---------------------------------------------------------------

-- Details shown on the "accept invitation" page.
create or replace function public.ypp_invite_info(p_token text)
returns table (owner_email text, role text, invited_email text, expired boolean, accepted boolean)
language sql stable security definer set search_path = '' as $$
  select u.email::text, i.role, i.email, i.expires_at < now(), i.accepted_at is not null
  from public.plan_invites i join auth.users u on u.id = i.owner_id
  where i.token = p_token;
$$;

-- Accept an invitation. The signed-in email must match the invited email.
create or replace function public.ypp_accept_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  inv public.plan_invites%rowtype;
  me uuid := auth.uid();
  my_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me is null then raise exception 'Please log in first.'; end if;
  select * into inv from public.plan_invites where token = p_token;
  if not found then raise exception 'This invitation link is not valid.'; end if;
  if inv.accepted_at is not null then raise exception 'This invitation has already been used.'; end if;
  if inv.expires_at < now() then raise exception 'This invitation has expired. Ask for a new one.'; end if;
  if lower(inv.email) <> my_email then
    raise exception 'This invitation was sent to %. Log in with that email to accept it.', inv.email;
  end if;
  if inv.owner_id = me then raise exception 'This is your own plan.'; end if;
  insert into public.plan_members (owner_id, member_id, member_email, role)
  values (inv.owner_id, me, my_email, inv.role)
  on conflict (owner_id, member_id) do update set role = excluded.role;
  update public.plan_invites set accepted_at = now() where id = inv.id;
  return inv.owner_id;
end;
$$;

-- Plans shared with me, with the owner's email and the parent's name.
create or replace function public.ypp_shared_plans()
returns table (owner_id uuid, owner_email text, role text, parent_name text)
language sql stable security definer set search_path = '' as $$
  select m.owner_id, u.email::text, m.role,
         coalesce(nullif(trim(p.data ->> 'parentName'), ''), '')
  from public.plan_members m
  join auth.users u on u.id = m.owner_id
  left join public.plan_data p on p.user_id = m.owner_id and p.section = 'profile'
  where m.member_id = auth.uid();
$$;

-- Is this plan's owner on Plus? (Only answers for plans you can see.)
create or replace function public.ypp_plan_is_plus(owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when public.ypp_can_view(owner) then public.ypp_is_plus(owner) else false end;
$$;

grant execute on function public.ypp_invite_info(text) to anon;
grant execute on function public.ypp_invite_info(text), public.ypp_accept_invite(text),
  public.ypp_shared_plans(), public.ypp_plan_is_plus(uuid) to authenticated;
