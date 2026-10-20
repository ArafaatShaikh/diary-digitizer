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
