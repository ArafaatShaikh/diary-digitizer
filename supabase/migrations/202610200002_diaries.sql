-- Run after 202610200001_private_accounts.sql, before deploying the diaries UI.
-- Existing pages remain unfiled; no rows or photos are deleted.
begin;
create table if not exists public.diaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 500),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
alter table public.diaries enable row level security;
revoke all on public.diaries from anon;
grant select, insert, update, delete on public.diaries to authenticated;
drop policy if exists diaries_owner on public.diaries;
create policy diaries_owner on public.diaries for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter table public.entries add column if not exists diary_id uuid;
-- The composite FK enforces that a page and its diary have the same owner,
-- even though foreign-key existence checks themselves bypass RLS.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'entries_diary_owner_fk' and conrelid = 'public.entries'::regclass) then
    alter table public.entries add constraint entries_diary_owner_fk
      foreign key (diary_id, user_id) references public.diaries(id, user_id) on delete restrict;
  end if;
end $$;
create index if not exists entries_diary_order on public.entries(user_id, diary_id, page_number, id);
create index if not exists diaries_owner_created on public.diaries(user_id, created_at desc);
commit;
