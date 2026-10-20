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
