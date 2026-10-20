# Diary Digitizer — Paper, kept close

A mobile web app for photographing handwritten pages, reviewing Gemini transcriptions, and keeping private journals, notes, letters, and lists. Source stays in GitHub, Vercel serves the app, and Supabase handles accounts, database rows, and private photos. No laptop server is needed.

## Diary index and optional covers

For an existing installation with the first two migrations applied, run only [`supabase/migrations/202610200003_diary_covers.sql`](supabase/migrations/202610200003_diary_covers.sql) before deploying the cover/index update. Do not reset or truncate any data. The migration adds a nullable cover reference and a private `diary-covers` storage bucket; existing diaries/pages are preserved. Review any unrelated broad storage policies, which combine with owner policies using OR.

Inside a diary, choose **Index** for contents ordered by page number, showing each page's title and written date. Selecting an item opens book view at that page. The index follows page edits/moves/number changes and the current search/type filter; text exports include the full diary contents list. This is a table of contents based on saved page metadata, not AI-generated topics or a subject index.

Use **New diary** or **Edit diary → Choose a cover photo** to add an optional cover. Replace/remove it in the same form, then save. Cover photos are resized on the device (maximum dimension 1,200 pixels and 750 KB per stored JPEG), kept in owner-only storage, and displayed through expiring signed URLs. The path must match the account and diary. Covers are never sent to Gemini. Replacement/removal deletes the old object only after the database save succeeds; a failed save attempts to clean up its new upload. Cleanup errors are shown so orphaned files can be removed by the project owner. Deleting an empty diary also removes its cover. Concurrent edits can leave unreferenced cover files, so inspect storage if multiple sessions edit the same diary.

## Multiple diaries update

For an existing installation that already ran `202610200001_private_accounts.sql`, run **only** [`supabase/migrations/202610200002_diaries.sql`](supabase/migrations/202610200002_diaries.sql) in Supabase SQL Editor before deploying the diaries update. Do not truncate tables or rerun any fresh-start cleanup commands. The migration adds private diaries and an optional diary reference to each page; existing pages remain intact under **Loose pages**.

Create a diary on the shelf, open it, then add pages inside. Each diary suggests its next page number from its own highest saved page number. Open an existing page and change the **Diary** field to move it. **Read as book** and **Export diary** follow page-number order for that diary. Diary names and descriptions can be edited; only empty diaries can be deleted. The database prevents deleting a diary while it still contains pages, including if another session adds a page after the UI loaded.

A composite foreign key enforces that each page and its diary belong to the same account, in addition to row-level security. `supabase/schema.sql` includes all migrations for new projects.

## Roll out to the existing project

Apply the database migration **before merging/deploying** this branch. The old shared passcode is removed; people must sign in with an individual Supabase account.

1. Export/back up the existing `entries` and `profiles` tables and any existing photos. The free Supabase plan does not replace your own backups.
2. In Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql), which includes all migrations. It is transactional and repeatable. It adds missing columns, replaces all existing policies on `entries` and `profiles` with owner-only policies, creates the private `diary-pages` bucket, and adds atomic scan allowances. It does not delete or automatically reassign existing diary rows. Review existing policies on `storage.objects`: any broad policy must be narrowed so it cannot grant access to this bucket. Storage RLS policies combine with OR.
3. In Supabase Authentication, enable email/password sign-in. Set Site URL to `https://diary-digitizer-hazel.vercel.app`. Add that URL and `https://diary-digitizer-hazel.vercel.app/reset-password` to allowed redirect URLs (and explicit preview URLs if needed). For a friends-only trial, invite/create users in the dashboard and disable new public signups. Supabase's default email sender is restricted; configure a suitable SMTP provider if confirmation/recovery emails cannot reach your friends, or create confirmed accounts manually in the dashboard. Never share one account between people.
4. Keep the existing Vercel variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). Optionally set `GEMINI_MODEL` to `gemini-3.5-flash-lite` (default) or `gemini-3.5-flash`. Confirm the exact model is available to your Google project. These model IDs were retained from the existing app/request; no live Gemini call was made during development. Remove `APP_PASSCODE` / `APP_PASSWORD` and rotate the former shared passcode anywhere it was reused. Never put a Gemini key or Supabase service-role key in `NEXT_PUBLIC_*` variables.
5. Deploy the branch preview, test with two distinct accounts, then merge into `main` for Vercel production deployment. Verify that each user can scan/save/edit/delete their own page, cannot read the other user's records/photos through the Supabase API, and can sign out/recover a password. Keep the old deployment URL available only as needed during migration; earlier deployments contain the obsolete shared-passcode interface.

## Preserve and assign old diary pages

The migration adds `user_id` if missing, without assigning an owner. Existing owner IDs are retained. Rows with null/shared/unrecognised ownership stay hidden from ordinary accounts. An administrator must identify the actual owner before assigning individual rows. In SQL Editor, inspect metadata (not through the public app):

```sql
select id, user_id, created_at from public.entries order by created_at;
select id, email from auth.users;
```

After verifying ownership, substitute the correct UUIDs and update **only the reviewed entry IDs**:

```sql
update public.entries
set user_id = 'VERIFIED_AUTH_USER_UUID'
where id in ('REVIEWED_ENTRY_UUID');
```

Do not assign every old row to whoever signs up first. Move personal vocabulary from the old shared profile only to its verified owner; the new app can save an individual vocabulary profile itself. Old base64 `image_url` values remain readable behind entry RLS. Old remote image URLs are deliberately not fetched by the new app: copy those images into the owner's private bucket folder, set `image_path` to `<user UUID>/<unique photo>.jpg`, then remove any publicly accessible originals. The migration does not make old public images private automatically.

## AI use and costs

- A photo is resized to a JPEG, then sent to Google Gemini only when the signed-in user selects **Read handwriting**. The saved personal vocabulary is included as a transcription hint. The UI warns users before sending diary content.
- Review applicable Google terms, region eligibility, and data handling before submitting private material. The app does not guarantee end-to-end encryption: the backend/AI provider processes scans.
- Database limits allow **10 attempts per account per UTC day**, and **100 attempts for the whole project per UTC day**, shared across all Vercel instances. Attempts count even if Gemini fails. A signed-in caller can consume their own allowance directly; public signup should remain disabled for a private trial.
- Gemini responses are capped at 8,192 output tokens. Incomplete results are rejected for recapture rather than silently saved. There are no automatic retries or fallback models. Provider quota failures stop the request.
- These caps limit usage, **not money**. A billable Google project can still charge for allowed calls. Keep the Google project on the intended tier and configure quotas there; billing alerts alone are not a hard spending cap. Unlimited free hosting, AI, or storage is not promised.
- New photos are stored privately, not as large base64 database strings. Each photo is capped at 2.25 MB. Monitor total storage/egress and export backups; no automatic paid upgrade is configured by this code.

## Scope

Included: individual accounts, password recovery, private photos and rows, original/corrected text, page numbering, titles/dates/types, archive search/filtering, per-user vocabulary, text export, deletion, mobile layout, and a Home Screen web manifest. No offline cache stores diary pages. Internet is required.

Lists are currently editable text. Interactive checkboxes, scheduled reminders, automatic page ordering, notifications, and chat bots are not implemented. Vocabulary is an explicit user-maintained hint; no model is trained or fine-tuned on handwriting.

## Develop and verify

Use Node.js 22 or later. Copy `.env.example` to `.env.local` and set your own project values. Never commit real credentials.

```sh
npm ci
npm test
npm run lint
npm run build
npm run dev
```

Database tests use an in-memory PostgreSQL runtime with minimal Supabase auth/storage schemas. They execute the actual migration, verify repeatability and legacy-row preservation, and exercise two-user row/storage isolation plus per-user/global quotas. They do not validate the live project's existing policies, Supabase email delivery, or Gemini handwriting accuracy.

## Rollback

Do not roll back database ownership policies to permissive access. The migration preserves old columns and entries, but the previous shared-passcode app cannot authenticate against the new private policies. If the new UI must be withdrawn, restrict app access while fixing it rather than reopening diary rows. Restore data only from a reviewed backup if required.
