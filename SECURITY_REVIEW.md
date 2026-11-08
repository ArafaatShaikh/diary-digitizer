# Security review — 8 November 2026

Scope: the Diary Digitizer repository, reachable Git history, the public Vercel app, SQL migrations and local account-isolation tests. This is a targeted review, not a penetration-test certificate. No real diary content or user passwords were used.

## Findings and changes

1. **High, conditional: broad historical storage policies can bypass owner-only policies.** Existing diary storage policies are permissive. An unrelated `USING (true)` policy on `storage.objects` combines with them using OR. This was reproduced in a local PostgreSQL fixture; it is not evidence that the live database currently contains such a policy. Migration `202611080004_storage_guard.sql` adds restrictive guards for authenticated and anonymous callers across the three diary buckets and sets them private. It retains other buckets' policies and deletes no files. Tests verify anonymous access, cross-account reads/deletes/writes, owner uploads, and rejection of audio associated with another owner's page, even with an intentionally broad legacy policy. Service-role/database administrators still bypass RLS by design; their credentials must stay server-side.
2. **Medium: public sign-up and resource abuse require deployment verification.** The UI supports account creation. AI generation has atomic per-account and app-wide attempt limits; those do not cap ordinary diary rows, uploads or account creation. A malicious registered user can consume their allowance or upload repeated files under their own prefix. Supabase email confirmation, CAPTCHA, auth rate limits, project storage budgets and Vercel firewall/rate limits were not accessible in this workspace. Keep registration invite-only until these settings and expected public usage are reviewed. The website and source repository can remain publicly visible with registration restricted. Hiding the sign-up button alone is not an access control. See [Supabase auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).
3. **Low: missing browser security headers.** Live responses lacked framing protection, content-type sniffing protection and a referrer policy. The change adds X-Frame-Options DENY, nosniff, no-referrer, a restrictive permissions policy and CSP directives for framing, base URLs, forms and plugins. Headers were verified through actual HTTP responses from the local production build. This is a limited CSP; it does not claim to prevent all inline-script XSS. Next's bootstrap remains functional.
4. **Moderate development dependency advisory remains.** npm reports eight affected package nodes from one minimatch denial-of-service advisory, propagated through the TypeScript/ESLint toolchain. npm reports no available automatic fix. No forced major override was introduced. Avoid running repository tooling on untrusted supplied patterns; revisit the upstream fix. Advisory: [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).

## Verified protections

- Live unauthenticated POST requests to `/api/narrate`, `/api/transcribe` and `/api/learn` return 401; no paid AI calls were requested. The old shared-passcode flow is disabled in source.
- The public `/synthesise`, `/.env` and `/.git/config` paths return 404. The private speech service separately verifies the forwarded Supabase session. Alternate service-host URLs and deployment permissions were not available for inspection.
- Source uses verified Supabase sessions rather than trusting a client user ID. The narration API queries saved text by page and owner, ignores submitted narration text, and uses short-lived signed private audio URLs.
- SQL tests cover account isolation for entries, profiles, diaries, covers, lists, pages and audio, including composite owner foreign keys. These prove the repository migrations' behavior in fixtures, not that production applied every migration. Supabase's [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) describes the underlying control.
- No use of raw HTML rendering was found in the app. Model output is rendered as text; image requests have streamed-byte limits and signature checks; narration and model generation have timeouts and output limits.
- Pattern scanning of 42 reachable Git commits found no matches for Google API keys, GitHub token formats, private key blocks or Supabase secret-key formats. This is not an exhaustive secret scan: arbitrary passwords, JWT-format historical keys, deleted/unreachable objects, external forks and GitHub secret-scanning alerts were not certified. `.env*` is ignored except the placeholder example; browser Supabase anon keys are public by design and depend on RLS.
- npm production dependency audit: zero known findings. Python pip-audit: 24 resolved packages, zero known findings. Findings are advisory-database snapshots, not a guarantee of absence.
- 44 Node tests, ESLint and the production build passed.

## Deployment checks still required

1. Apply storage migration `202611080004_storage_guard.sql` before deploying this PR. It assumes the existing diary tables and narration setup exist. Run `supabase/security-audit.sql` in the SQL editor; it is read-only and returns policies/configuration rather than diary contents. Confirm all listed tables use RLS, all three buckets are private, both new storage guards exist and anonymous users cannot execute quota functions. Inspect other permissive policies on the application tables too.
2. In Supabase Auth, verify registration policy, email confirmation, CAPTCHA, password policy, rate limits and exact production redirect URLs. Do not use broad wildcard redirects for production. Enable MFA on the Supabase, GitHub and Vercel administrator accounts. Inspect Supabase Security Advisor and GitHub secret-scanning/Dependabot alerts.
3. After deployment, repeat the header/API checks and use two non-sensitive test accounts to try reading and modifying each other's page, cover, list and audio. Check the storage and billing budgets before opening registrations.

## Review dimensions

| Dimension | Assessment |
| --- | --- |
| Security | Core controls tested; storage/header hardening prepared; live configuration and sign-up abuse controls unresolved. |
| Performance | AI work has size/time/attempt bounds; per-account stored-data volume and sign-up abuse remain operational risks. |
| Correctness | Regression tests pass, including deliberately broad legacy storage policies. |
| Maintainability | Repeatable migration and read-only deployment audit added; one upstream development advisory remains. |
