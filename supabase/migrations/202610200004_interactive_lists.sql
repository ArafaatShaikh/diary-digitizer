-- Run after the previous migrations before deploying the interactive Lists UI.
-- Creates separate private lists/items; diaries and their pages are unchanged.
begin;
create table if not exists public.task_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  kind text not null default 'todo' check (kind in ('todo', 'shopping')),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create table if not exists public.task_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null,
  text text not null check (char_length(btrim(text)) between 1 and 1000),
  completed boolean not null default false,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  constraint task_items_list_owner_fk foreign key (list_id, user_id)
    references public.task_lists(id, user_id) on delete cascade
);
alter table public.task_lists enable row level security;
alter table public.task_items enable row level security;
revoke all on public.task_lists, public.task_items from anon;
grant select, insert, update, delete on public.task_lists, public.task_items to authenticated;
drop policy if exists task_lists_owner on public.task_lists;
create policy task_lists_owner on public.task_lists for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists task_items_owner on public.task_items;
create policy task_items_owner on public.task_items for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create index if not exists task_lists_owner_created on public.task_lists(user_id, created_at desc);
create index if not exists task_items_owner_list_order on public.task_items(user_id, list_id, position, created_at, id);
commit;
