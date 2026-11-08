-- Run once in Supabase SQL Editor before deploying the new app.
-- Transactional, repeatable, and preserves existing rows. Back up first.
begin;
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  personal_lexicon text[] default '{}',
  character_quirks text[] default '{}',
  updated_at timestamptz default now()
);
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  image_url text not null,
  raw_transcription text,
  corrected_transcription text,
  created_at timestamptz default now()
);
alter table public.entries add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.entries add column if not exists page_number integer;
alter table public.entries add column if not exists title text not null default 'Untitled page';
alter table public.entries add column if not exists kind text not null default 'journal';
alter table public.entries add column if not exists entry_date date;
update public.entries set entry_date = coalesce((created_at at time zone 'utc')::date, current_date) where entry_date is null;
alter table public.entries alter column entry_date set default current_date;
alter table public.entries alter column entry_date set not null;
alter table public.entries add column if not exists image_path text;
create index if not exists entries_owner_date on public.entries(user_id, entry_date desc, page_number);
alter table public.profiles enable row level security;
alter table public.entries enable row level security;
-- Old permissive policies would combine with these using OR. Replace them all.
do $$ declare p record; begin
  for p in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' and tablename in ('profiles', 'entries') loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;
revoke all on public.profiles, public.entries from anon;
grant select, insert, update, delete on public.profiles, public.entries to authenticated;
create policy profiles_owner on public.profiles for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy entries_owner on public.entries for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('diary-pages', 'diary-pages', false, 2250000, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 2250000, allowed_mime_types = array['image/jpeg'];
drop policy if exists diary_pages_owner on storage.objects;
create policy diary_pages_owner on storage.objects for all to authenticated
using (bucket_id = 'diary-pages' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'diary-pages' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table if not exists public.transcription_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  requests integer not null default 0,
  primary key (user_id, usage_date)
);
alter table public.transcription_usage enable row level security;
revoke all on public.transcription_usage from public, anon, authenticated;
-- Count attempts before calling Gemini, including provider failures. No client-set limit.
-- Serialise quota updates so concurrent requests cannot exceed either allowance.
create or replace function public.reserve_transcription() returns boolean
language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); today date := (now() at time zone 'utc')::date;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(41803017);
  if (select coalesce(sum(requests), 0) from public.transcription_usage where usage_date = today) >= 100 then return false; end if;
  insert into public.transcription_usage(user_id, usage_date, requests) values(current_user_id, today, 1)
  on conflict (user_id, usage_date) do update set requests = public.transcription_usage.requests + 1
  where public.transcription_usage.requests < 10;
  return found;
end;
$$;
revoke all on function public.reserve_transcription() from public, anon;
grant execute on function public.reserve_transcription() to authenticated;
commit;
-- Existing rows with null/shared ownership stay inaccessible to regular users.
-- Assign them manually to the verified owner's auth.users ID; see README.

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

-- Run after the diaries migration. Existing diaries/pages remain unchanged.
begin;
alter table public.diaries add column if not exists cover_path text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'diaries_cover_owner_path' and conrelid = 'public.diaries'::regclass) then
    alter table public.diaries add constraint diaries_cover_owner_path check (
      cover_path is null or (
        split_part(cover_path, '/', 1) = user_id::text and
        split_part(cover_path, '/', 2) = id::text and
        split_part(cover_path, '/', 3) <> '' and
        array_length(string_to_array(cover_path, '/'), 1) = 3
      )
    );
  end if;
end $$;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('diary-covers', 'diary-covers', false, 750000, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 750000, allowed_mime_types = array['image/jpeg'];
drop policy if exists diary_covers_owner on storage.objects;
create policy diary_covers_owner on storage.objects for all to authenticated
using (bucket_id = 'diary-covers' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'diary-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
commit;

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

begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('diary-audio','diary-audio',false,8000000,array['audio/wav','audio/mpeg'])
on conflict(id) do update set public=false,file_size_limit=8000000,allowed_mime_types=array['audio/wav','audio/mpeg'];
drop policy if exists diary_audio_read on storage.objects;
create policy diary_audio_read on storage.objects for select to authenticated using (
 bucket_id='diary-audio' and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists(select 1 from public.entries where id::text=(storage.foldername(name))[2] and user_id=(select auth.uid())));
drop policy if exists diary_audio_write on storage.objects;
create policy diary_audio_write on storage.objects for insert to authenticated with check (
 bucket_id='diary-audio' and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists(select 1 from public.entries where id::text=(storage.foldername(name))[2] and user_id=(select auth.uid())));
drop policy if exists diary_audio_delete on storage.objects;
create policy diary_audio_delete on storage.objects for delete to authenticated using(bucket_id='diary-audio' and (storage.foldername(name))[1]=(select auth.uid())::text);
create table if not exists public.narration_usage(user_id uuid references auth.users(id) on delete cascade, usage_date date not null, requests integer not null default 0, primary key(user_id,usage_date));
create table if not exists public.narration_leases(user_id uuid references auth.users(id) on delete cascade, cache_key text not null, expires_at timestamptz not null, primary key(user_id,cache_key));
alter table public.narration_usage enable row level security;
alter table public.narration_leases enable row level security;
revoke all on public.narration_usage,public.narration_leases from public,anon,authenticated;
create or replace function public.reserve_narration(p_cache_key text) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); today date := (now() at time zone 'utc')::date;
begin
 if uid is null then raise exception 'Authentication required'; end if;
 if length(p_cache_key)>200 then return false; end if;
 perform pg_advisory_xact_lock(41803018);
 if exists(select 1 from public.narration_leases l where l.user_id=uid and l.cache_key=p_cache_key and l.expires_at>now()) then return false; end if;
 if (select coalesce(sum(requests),0) from public.narration_usage where usage_date=today)>=50 then return false; end if;
 insert into public.narration_usage values(uid,today,1) on conflict(user_id,usage_date) do update set requests=public.narration_usage.requests+1 where public.narration_usage.requests<10;
 if not found then return false; end if;
 insert into public.narration_leases values(uid,p_cache_key,now()+interval '2 minutes') on conflict(user_id,cache_key) do update set expires_at=excluded.expires_at;
 return true;
end; $$;
revoke all on function public.reserve_narration(text) from public,anon;
grant execute on function public.reserve_narration(text) to authenticated;
commit;

begin;
create or replace function public.reserve_narration_status(p_cache_key text) returns text
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); today date := (now() at time zone 'utc')::date;
begin
 if uid is null then raise exception 'Authentication required'; end if;
 if p_cache_key is null or length(p_cache_key)>200 then return 'invalid'; end if;
 perform pg_advisory_xact_lock(41803018);
 if exists(select 1 from public.narration_leases l where l.user_id=uid and l.cache_key=p_cache_key and l.expires_at>now()) then return 'processing'; end if;
 if (select coalesce(sum(requests),0) from public.narration_usage where usage_date=today)>=50 then return 'app_limit'; end if;
 insert into public.narration_usage values(uid,today,1) on conflict(user_id,usage_date) do update set requests=public.narration_usage.requests+1 where public.narration_usage.requests<10;
 if not found then return 'user_limit'; end if;
 insert into public.narration_leases values(uid,p_cache_key,now()+interval '2 minutes') on conflict(user_id,cache_key) do update set expires_at=excluded.expires_at;
 return 'reserved';
end; $$;
revoke all on function public.reserve_narration_status(text) from public,anon;
grant execute on function public.reserve_narration_status(text) to authenticated;
-- Keep older deployments compatible during rollout.
create or replace function public.reserve_narration(p_cache_key text) returns boolean
language sql security definer set search_path='' as $$
 select public.reserve_narration_status(p_cache_key)='reserved';
$$;
revoke all on function public.reserve_narration(text) from public,anon;
grant execute on function public.reserve_narration(text) to authenticated;
commit;
