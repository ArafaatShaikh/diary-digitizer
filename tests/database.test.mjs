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

test("diaries preserve loose pages and enforce page/diary ownership", async () => {
  const db = await fixture();
  const diaryMigration = await readFile(
    new URL("../supabase/migrations/202610200002_diaries.sql", import.meta.url),
    "utf8",
  );
  try {
    await db.exec(migration);
    await asUser(db, ids[0]);
    await db.exec(
      `insert into public.entries(user_id, image_url, corrected_transcription) values ('${ids[0]}', '', 'existing page');`,
    );
    await db.exec("reset role");
    await db.exec(diaryMigration);
    await db.exec(diaryMigration);
    await asUser(db, ids[0]);
    const existing = (
      await db.query(
        "select id, diary_id, corrected_transcription from public.entries",
      )
    ).rows[0];
    assert.equal(existing.diary_id, null);
    assert.equal(existing.corrected_transcription, "existing page");
    const first = (
      await db.query(
        `insert into public.diaries(user_id, title) values ('${ids[0]}', '2026 diary') returning id`,
      )
    ).rows[0].id;
    const second = (
      await db.query(
        `insert into public.diaries(user_id, title) values ('${ids[0]}', 'Travel diary') returning id`,
      )
    ).rows[0].id;
    const empty = (
      await db.query(
        `insert into public.diaries(user_id, title) values ('${ids[0]}', 'Empty diary') returning id`,
      )
    ).rows[0].id;
    await db.query(
      `update public.entries set diary_id = $1, page_number = 1 where id = $2`,
      [first, existing.id],
    );
    await db.query(
      `insert into public.entries(user_id, image_url, diary_id, page_number) values ($1, '', $2, 1)`,
      [ids[0], second],
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from public.entries where page_number = 1",
        )
      ).rows[0].n,
      2,
    );
    await db.query("update public.diaries set title = $1 where id = $2", [
      "Renamed diary",
      first,
    ]);
    await assert.rejects(
      db.query("delete from public.diaries where id = $1", [first]),
      /foreign key/,
    );
    await db.query("delete from public.diaries where id = $1", [empty]);
    await asUser(db, ids[1]);
    assert.equal(
      (await db.query("select * from public.diaries")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.entries")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "update public.diaries set title = $1 where id = $2 returning id",
          ["stolen", first],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "delete from public.diaries where id = $1 returning id",
          [first],
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        `insert into public.entries(user_id, image_url, diary_id) values ($1, '', $2)`,
        [ids[1], first],
      ),
      /foreign key/,
    );
    await assert.rejects(
      db.query(
        `insert into public.diaries(user_id, title) values ($1, 'spoof')`,
        [ids[0]],
      ),
      /row-level security/,
    );
    const other = (
      await db.query(
        `insert into public.diaries(user_id, title) values ($1, 'Other owner') returning id`,
        [ids[1]],
      )
    ).rows[0].id;
    await asUser(db, ids[0]);
    await assert.rejects(
      db.query("update public.entries set diary_id = $1 where id = $2", [
        other,
        existing.id,
      ]),
      /foreign key/,
    );
    await db.query("update public.entries set diary_id = $1 where id = $2", [
      second,
      existing.id,
    ]);
    await db.query("update public.entries set diary_id = null where id = $1", [
      existing.id,
    ]);
    assert.equal(
      (
        await db.query("select diary_id from public.entries where id = $1", [
          existing.id,
        ])
      ).rows[0].diary_id,
      null,
    );
    await db.exec("reset role; set role anon;");
    await assert.rejects(
      db.exec("select * from public.diaries"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("optional covers stay private and cannot reference another owner or diary", async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610200002_diaries.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await asUser(db, ids[0]);
    const diary = (
      await db.query(
        `insert into public.diaries(user_id, title) values ($1, 'Original diary') returning id`,
        [ids[0]],
      )
    ).rows[0].id;
    await db.exec("reset role");
    const coversMigration = await readFile(
      new URL(
        "../supabase/migrations/202610200003_diary_covers.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(coversMigration);
    await db.exec(coversMigration);
    assert.equal(
      (
        await db.query("select cover_path from public.diaries where id = $1", [
          diary,
        ])
      ).rows[0].cover_path,
      null,
    );
    const bucket = (
      await db.query("select * from storage.buckets where id = 'diary-covers'")
    ).rows[0];
    assert.equal(bucket.public, false);
    assert.equal(Number(bucket.file_size_limit), 750000);
    assert.deepEqual(bucket.allowed_mime_types, ["image/jpeg"]);
    await asUser(db, ids[0]);
    const path = `${ids[0]}/${diary}/cover.jpg`;
    await db.query(
      "insert into storage.objects(bucket_id, name) values ('diary-covers', $1)",
      [path],
    );
    await db.query("update public.diaries set cover_path = $1 where id = $2", [
      path,
      diary,
    ]);
    await assert.rejects(
      db.query("update public.diaries set cover_path = $1 where id = $2", [
        `${ids[1]}/${diary}/cover.jpg`,
        diary,
      ]),
      /check constraint/,
    );
    await assert.rejects(
      db.query("update public.diaries set cover_path = $1 where id = $2", [
        `${ids[0]}/${ids[1]}/cover.jpg`,
        diary,
      ]),
      /check constraint/,
    );
    await asUser(db, ids[1]);
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id = 'diary-covers'",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "update storage.objects set name = $1 where name = $2 returning name",
          ["stolen", path],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "delete from storage.objects where name = $1 returning name",
          [path],
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "insert into storage.objects(bucket_id, name) values ('diary-covers', $1)",
        [path],
      ),
      /row-level security/,
    );
    await asUser(db, ids[0]);
    const replacement = `${ids[0]}/${diary}/replacement.jpg`;
    await db.query(
      "insert into storage.objects(bucket_id, name) values ('diary-covers', $1)",
      [replacement],
    );
    await db.query("update public.diaries set cover_path = $1 where id = $2", [
      replacement,
      diary,
    ]);
    await db.query("delete from storage.objects where name = $1", [path]);
    assert.equal(
      (
        await db.query("select cover_path from public.diaries where id = $1", [
          diary,
        ])
      ).rows[0].cover_path,
      replacement,
    );
    await db.query(
      "update public.diaries set cover_path = null where id = $1",
      [diary],
    );
    await db.query("delete from storage.objects where name = $1", [
      replacement,
    ]);
    assert.equal(
      (
        await db.query(
          "select title, cover_path from public.diaries where id = $1",
          [diary],
        )
      ).rows[0].title,
      "Original diary",
    );
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id = 'diary-covers'",
        )
      ).rows.length,
      0,
    );
    await db.exec("reset role; set role anon;");
    await assert.rejects(
      db.exec("select * from storage.objects"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
