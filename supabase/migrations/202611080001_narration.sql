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
