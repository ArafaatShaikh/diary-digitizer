import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const source=readFileSync('lib/narration.ts','utf8');
const narrationModule={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:narrationModule.exports,module:narrationModule,Buffer,AbortSignal,process,fetch,URL});
const {generateNarration,narrationChunks,narrationVoice}=narrationModule.exports;
const env={SPEECH_SERVICE_URL:'http://speech.internal/'};
test('chunking preserves Unicode and the complete reviewed text',()=>{
 const text=('বাংলা diary sentence. 🌻 '.repeat(200)).trim();
 const chunks=narrationChunks(text);
 assert.equal(chunks.join(''),text);
 assert.ok(chunks.every(s=>Array.from(s).length<=800));
});
test('Edge service uses the selected voice and forwards auth in one private call',async()=>{
 let calls=0;
 const result=await generateNarration('My diary','Bearer test','en-GB-SoniaNeural',env,async(url,options)=>{
  calls++;assert.equal(String(url),'http://speech.internal/synthesise');
  assert.equal(options.headers.Authorization,'Bearer test');
  assert.equal(JSON.parse(options.body).voice,'en-GB-SoniaNeural');
  return new Response(Buffer.from('ID3 test'),{headers:{'Content-Type':'audio/mpeg'}});
 });
 assert.equal(calls,1);assert.equal(result.mime,'audio/mpeg');
 assert.equal(narrationVoice('English'),'en-GB-SoniaNeural');
 assert.equal(narrationVoice('বাংলা'),'bn-BD-NabanitaNeural');
});
test('Edge errors stop without calling paid providers or retrying',async()=>{
 for(const status of [400,401,429,500]) {
  let calls=0;
  await assert.rejects(()=>generateNarration('Diary','Bearer test','en-GB-SoniaNeural',env,async()=>{calls++;return new Response('',{status});}));
  assert.equal(calls,1);
 }
 let calls=0;await assert.rejects(()=>generateNarration('Diary','Bearer test','en-GB-SoniaNeural',{},async()=>{calls++;}));assert.equal(calls,0);
 await assert.rejects(()=>generateNarration('Diary','Bearer test','en-GB-SoniaNeural',env,async()=>new Response('not audio')));
});
test('narration migration is repeatable, private and enforces quota plus generation leases',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 grant usage on schema public,auth,storage to anon,authenticated;grant all on storage.objects to authenticated;
 create table public.entries(id uuid primary key,user_id uuid);
 insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
 insert into public.entries values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
 grant select on public.entries to authenticated;`);
 const sql=readFileSync('supabase/migrations/202611080001_narration.sql','utf8');await db.exec(sql);await db.exec(sql);
 await db.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';`);
 assert.equal((await db.query(`select public.reserve_narration('page/hash/0') as ok`)).rows[0].ok,true);
 assert.equal((await db.query(`select public.reserve_narration('page/hash/0') as ok`)).rows[0].ok,false);
 for(let i=1;i<10;i++)assert.equal((await db.query(`select public.reserve_narration('page/hash/${i}') as ok`)).rows[0].ok,true);
 assert.equal((await db.query(`select public.reserve_narration('page/hash/11') as ok`)).rows[0].ok,false);
 await db.exec(`insert into storage.objects(bucket_id,name) values('diary-audio','00000000-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000001/hash/0.audio');`);
 assert.equal((await db.query('select * from storage.objects')).rows.length,1);
 await db.exec(`set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';`);
 assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await assert.rejects(()=>db.exec(`insert into storage.objects(bucket_id,name) values('diary-audio','00000000-0000-0000-0000-000000000002/10000000-0000-0000-0000-000000000001/hash/0.audio')`));
 }finally{await db.close();}
});
function routeFixture({owner=true,cached=false,allowed=true}={}) {
 const state={generated:0,reserved:0,uploaded:0};
 class RequestError extends Error {constructor(message,status=400){super(message);this.status=status;}}
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:owner?{id:'10000000-0000-0000-0000-000000000001',corrected_transcription:'Reviewed diary'}:null})};
 let present=cached;
 const db={from:()=>query,rpc:async()=>{state.reserved++;return {data:allowed}},storage:{from:()=>({
  createSignedUrl:async()=>present?{data:{signedUrl:'https://private.test/audio'}}:{error:'missing'},
  upload:async()=>{state.uploaded++;present=true;return {};}
 })}};
 const crypto=awaitCrypto;
 const adapters={
  'node:crypto':crypto,
  '@/lib/server-auth':{requireUser:async(request)=>{if(request.headers.get('authorization')!=='Bearer valid')throw new RequestError('Sign in',401);return {db,user:{id:'owner'}};},apiError:error=>Response.json({error:error.message},{status:error.status||502})},
  '@/lib/request-validation':{RequestError,readJson:request=>request.json()},
  '@/lib/narration':{narrationChunks, narrationVoice, NarrationError:narrationModule.exports.NarrationError,generateNarration:async()=>{state.generated++;return {bytes:Buffer.from('audio'),mime:'audio/mpeg'}}},
 };
 const routeModule={exports:{}};
 vm.runInNewContext(ts.transpileModule(readFileSync('app/api/narrate/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:routeModule.exports,module:routeModule,require:name=>adapters[name],Response,process:{env:{}}});
 return {POST:routeModule.exports.POST,state};
}
const awaitCrypto=await import('node:crypto');
function narrationRequest(token='valid',overrides={}) {
 return new Request('https://diary.test/api/narrate',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({entryId:'10000000-0000-0000-0000-000000000001',chunk:0,consent:true,textHash:awaitCrypto.createHash('sha256').update('Reviewed diary').digest('hex'),...overrides})});
}
test('narration route authenticates and rejects inaccessible, stale or unconfirmed pages before spending quota',async()=>{
 for(const [options,token,body,status] of [[{},'invalid',{},401],[{owner:false},'valid',{},404],[{},'valid',{consent:false},400],[{},'valid',{textHash:'old'},409],[{},'valid',{chunk:99},400]]) {
  const {POST,state}=routeFixture(options);
  assert.equal((await POST(narrationRequest(token,body))).status,status);
  assert.equal(state.generated,0);assert.equal(state.reserved,0);
 }
});
test('cached playback spends no quota, uncached audio is reserved and saved once',async()=>{
 for(const cached of [true,false]) {
  const {POST,state}=routeFixture({cached});
  assert.equal((await POST(narrationRequest())).status,200);
  assert.equal(state.generated,cached?0:1);assert.equal(state.reserved,cached?0:1);
  assert.equal((await POST(narrationRequest())).status,200);
  assert.equal(state.generated,cached?0:1);
 }
 const {POST,state}=routeFixture({allowed:false});
 assert.equal((await POST(narrationRequest())).status,429);assert.equal(state.generated,0);
});
