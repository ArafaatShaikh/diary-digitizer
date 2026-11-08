import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('restrictive storage guard survives broad legacy policies without changing other buckets',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 create table public.entries(id uuid primary key,user_id uuid);alter table public.entries enable row level security;
 create policy own_entries on public.entries for select to authenticated using(user_id=auth.uid());
 create table storage.buckets(id text primary key,public boolean);
 create table storage.objects(id integer generated always as identity,bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to anon,authenticated;
 grant select on public.entries to authenticated;
 grant all on storage.objects to anon,authenticated;
 grant usage,select on all sequences in schema storage to anon,authenticated;
 create policy legacy_broad on storage.objects for all to public using(true) with check(true);
 insert into public.entries values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
 insert into storage.buckets values('diary-pages',true),('diary-covers',true),('diary-audio',true),('unrelated',true);
 insert into storage.objects(bucket_id,name) values
 ('diary-pages','00000000-0000-0000-0000-000000000001/photo.jpg'),
 ('diary-covers','00000000-0000-0000-0000-000000000001/cover.jpg'),
 ('diary-audio','00000000-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000001/clip.audio'),
 ('unrelated','public.txt');`);
 const sql=readFileSync('supabase/migrations/202611080004_storage_guard.sql','utf8');await db.exec(sql);await db.exec(sql);
 assert.equal((await db.query("select count(*)::int n from storage.buckets where public=true and id<>'unrelated'")).rows[0].n,0);
 await db.exec("set role anon;");
 assert.deepEqual((await db.query('select bucket_id from storage.objects')).rows,[{bucket_id:'unrelated'}]);
 await assert.rejects(()=>db.exec("insert into storage.objects(bucket_id,name) values('diary-pages','anonymous/file.jpg')"));
 await db.exec("set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';");
 assert.equal((await db.query('select * from storage.objects')).rows.length,4);
 await db.exec("insert into storage.objects(bucket_id,name) values('diary-pages','00000000-0000-0000-0000-000000000001/second.jpg')");
 await assert.rejects(()=>db.exec("update storage.objects set name='00000000-0000-0000-0000-000000000002/stolen.jpg' where bucket_id='diary-pages'"));
 await db.exec("set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';");
 assert.deepEqual((await db.query('select bucket_id from storage.objects')).rows,[{bucket_id:'unrelated'}]);
 assert.equal((await db.query("delete from storage.objects where bucket_id='diary-pages' returning id")).rows.length,0);
 await assert.rejects(()=>db.exec("insert into storage.objects(bucket_id,name) values('diary-audio','00000000-0000-0000-0000-000000000002/10000000-0000-0000-0000-000000000001/clip.audio')"));
 } finally {await db.close();}
});
