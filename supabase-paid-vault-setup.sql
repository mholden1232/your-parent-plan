-- Your Parent Plan: paid membership + encrypted password vault
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free','plus_monthly','plus_annual')),
  status text not null default 'active' check (status in ('active','trialing','past_due','canceled','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  salt text not null,
  verifier_ciphertext text not null,
  verifier_iv text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.vault_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vault_items_user_id_idx on public.vault_items(user_id);

alter table public.memberships enable row level security;
alter table public.vault_settings enable row level security;
alter table public.vault_items enable row level security;

-- Users can read only their own membership.
drop policy if exists "members can read own membership" on public.memberships;
create policy "members can read own membership"
on public.memberships for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

-- Vault settings: only the owner, and only while Plus is active.
drop policy if exists "plus users can read own vault settings" on public.vault_settings;
create policy "plus users can read own vault settings"
on public.vault_settings for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.tier in ('plus_monthly','plus_annual')
  )
);

drop policy if exists "plus users can create own vault settings" on public.vault_settings;
create policy "plus users can create own vault settings"
on public.vault_settings for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.tier in ('plus_monthly','plus_annual')
  )
);

drop policy if exists "plus users can update own vault settings" on public.vault_settings;
create policy "plus users can update own vault settings"
on public.vault_settings for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "plus users can delete own vault settings" on public.vault_settings;
create policy "plus users can delete own vault settings"
on public.vault_settings for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Vault entries: owner-only and active Plus only.
drop policy if exists "plus users can read own vault items" on public.vault_items;
create policy "plus users can read own vault items"
on public.vault_items for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.tier in ('plus_monthly','plus_annual')
  )
);

drop policy if exists "plus users can create own vault items" on public.vault_items;
create policy "plus users can create own vault items"
on public.vault_items for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.tier in ('plus_monthly','plus_annual')
  )
);

drop policy if exists "plus users can update own vault items" on public.vault_items;
create policy "plus users can update own vault items"
on public.vault_items for update
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.tier in ('plus_monthly','plus_annual')
  )
)
with check ((select auth.uid()) = user_id);

drop policy if exists "plus users can delete own vault items" on public.vault_items;
create policy "plus users can delete own vault items"
on public.vault_items for delete
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.tier in ('plus_monthly','plus_annual')
  )
);

grant select on public.memberships to authenticated;
grant select, insert, update, delete on public.vault_settings to authenticated;
grant select, insert, update, delete on public.vault_items to authenticated;

-- Automatically give new users a free membership.
create or replace function public.handle_new_ypp_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.memberships (user_id, tier, status)
  values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_ypp_membership on auth.users;
create trigger on_auth_user_created_ypp_membership
after insert on auth.users
for each row execute procedure public.handle_new_ypp_user();

-- Backfill existing users as free if they do not already have a membership row.
insert into public.memberships (user_id, tier, status)
select id, 'free', 'active'
from auth.users
on conflict (user_id) do nothing;

-- TESTING ONLY:
-- After replacing the email below, run this single UPDATE to make a test account Plus.
-- update public.memberships
-- set tier='plus_monthly', status='active', updated_at=now()
-- where user_id = (select id from auth.users where email='YOUR_TEST_EMAIL');
