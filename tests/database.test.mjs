import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL(
    "../supabase/migrations/202610200001_private_accounts.sql",
    import.meta.url,
  ),
  "utf8",
);
const ids = Array.from(
  { length: 11 },
  (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
);
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
    grant usage on schema public, auth, storage to anon, authenticated;
    grant all on storage.objects to authenticated;
    insert into auth.users(id) values ${ids.map((id) => `('${id}')`).join(",")};`);
  return db;
}
async function asUser(db, id) {
  await db.exec(
    `reset role; set role authenticated; set request.jwt.claim.sub = '${id}';`,
  );
}

test("migration is repeatable and isolates entries, profiles, photos, and quotas", async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await db.exec(migration);
    await asUser(db, ids[0]);
    await db.exec(`insert into public.entries(user_id, image_url, corrected_transcription) values ('${ids[0]}', '', 'private words');
      insert into public.profiles(id, personal_lexicon) values ('${ids[0]}', array['private name']);
      insert into storage.objects(bucket_id, name) values ('diary-pages', '${ids[0]}/photo.jpg');`);
    await asUser(db, ids[1]);
    assert.equal(
      (await db.query("select * from public.entries")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.profiles")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "update public.entries set corrected_transcription = 'stolen' returning id",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.exec(
        `insert into public.entries(user_id, image_url) values ('${ids[0]}', '')`,
      ),
      /row-level security/,
    );
    await assert.rejects(
      db.exec(
        `insert into storage.objects(bucket_id, name) values ('diary-pages', '${ids[0]}/other.jpg')`,
      ),
      /row-level security/,
    );
    await assert.rejects(
      db.exec("select * from public.transcription_usage"),
      /permission denied/,
    );
    await asUser(db, ids[0]);
    await assert.rejects(
      db.exec(`update public.entries set user_id = '${ids[1]}'`),
      /row-level security/,
    );
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await db.query("select public.reserve_transcription() as allowed"))
          .rows[0].allowed,
        true,
      );
    assert.equal(
      (await db.query("select public.reserve_transcription() as allowed"))
        .rows[0].allowed,
      false,
    );
    for (const id of ids.slice(1, 10)) {
      await asUser(db, id);
      for (let i = 0; i < 10; i++)
        assert.equal(
          (await db.query("select public.reserve_transcription() as allowed"))
            .rows[0].allowed,
          true,
        );
    }
    await asUser(db, ids[10]);
    assert.equal(
      (await db.query("select public.reserve_transcription() as allowed"))
        .rows[0].allowed,
      false,
    );
    await db.exec("reset role; set role anon;");
    await assert.rejects(
      db.exec("select * from public.entries"),
      /permission denied/,
    );
    await assert.rejects(
      db.exec("select public.reserve_transcription()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("migration preserves legacy rows and removes permissive policies", async () => {
  const db = await fixture();
  try {
    await db.exec(`create table public.entries(id uuid primary key default gen_random_uuid(), image_url text not null, raw_transcription text, corrected_transcription text, created_at timestamptz default now());
      insert into public.entries(image_url, corrected_transcription) values ('data:image/jpeg;base64,old', 'legacy diary');
      alter table public.entries enable row level security;
      create policy legacy_public on public.entries for all to public using (true) with check (true);`);
    await db.exec(migration);
    assert.equal(
      (await db.query("select corrected_transcription from public.entries"))
        .rows[0].corrected_transcription,
      "legacy diary",
    );
    await asUser(db, ids[0]);
    assert.equal(
      (await db.query("select * from public.entries")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
