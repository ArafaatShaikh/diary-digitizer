-- Read-only: inspect live protections without returning diary contents.
select tablename, rowsecurity from pg_tables where schemaname='public'
and tablename in ('profiles','entries','diaries','task_lists','task_items','transcription_usage','narration_usage','narration_leases');
select id,public,file_size_limit,allowed_mime_types from storage.buckets
where id in ('diary-pages','diary-covers','diary-audio');
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where (schemaname='storage' and tablename='objects')
or (schemaname='public' and tablename in ('profiles','entries','diaries','task_lists','task_items'));
select p.proname,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'execute') as anon_can_execute,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('reserve_transcription','reserve_narration','reserve_narration_status');
