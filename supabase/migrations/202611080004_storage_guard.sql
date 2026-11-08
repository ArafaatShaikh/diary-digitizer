-- Restrictive guard prevents older permissive policies from exposing diary objects.
-- Other buckets retain their existing policies. No objects are deleted.
begin;
update storage.buckets set public=false where id in ('diary-pages','diary-covers','diary-audio');
drop policy if exists diary_storage_private_guard on storage.objects;
create policy diary_storage_private_guard on storage.objects as restrictive
for all to authenticated
using (bucket_id not in ('diary-pages','diary-covers','diary-audio') or (
 (select auth.uid()) is not null
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and (bucket_id <> 'diary-audio' or exists(
  select 1 from public.entries where id::text=(storage.foldername(name))[2] and user_id=(select auth.uid())
 ))
) )
with check (bucket_id not in ('diary-pages','diary-covers','diary-audio') or (
 (select auth.uid()) is not null
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and (bucket_id <> 'diary-audio' or exists(
  select 1 from public.entries where id::text=(storage.foldername(name))[2] and user_id=(select auth.uid())
 ))
) );
drop policy if exists diary_storage_anon_guard on storage.objects;
create policy diary_storage_anon_guard on storage.objects as restrictive
for all to anon
using (bucket_id not in ('diary-pages','diary-covers','diary-audio'))
with check (bucket_id not in ('diary-pages','diary-covers','diary-audio'));
commit;
