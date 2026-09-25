# E2E tests (Playwright)

Config: `playwright.config.ts` (repo root). Runs against `PLAYWRIGHT_BASE_URL`
(defaults to `http://localhost:3000`, started via `npm run dev` unless
`PLAYWRIGHT_SKIP_WEBSERVER` is set). Env vars come from `tests/e2e/.env.test`
(gitignored - create it yourself, see below).

These specs exercise the real API routes and a real, Firestore-backed
project - there is no mock/fake auth layer (`src/lib/auth/verifyFirebaseToken.ts`
always verifies a genuine Firebase-signed ID token). **Every spec needs a
seeded, non-production Firebase project** - never point this at production.

## Layout

- `api/` - API-route-level specs (no browser, uses Playwright's `request` fixture/`APIRequestContext`).
- `ui/` - full-browser specs (none yet).
- `support/` - shared helpers: `auth.ts` (Firebase sign-in → `fms-session` cookie), `env.ts` (per-test env-var gating), `fixtures.ts` (valid request-body builders), `seed-scope-fixtures.mjs` (opt-in seed script, run by hand - see below).

## Running

```bash
npm run test:e2e
```

Each spec/test independently `test.skip()`s itself with a clear reason when
the env vars it specifically needs are missing - so an unconfigured
`tests/e2e/.env.test` reports every relevant test as skipped rather than
failing the whole suite.

## `faculty-scope-security.spec.ts`

Re-verifies the three sub-HOD department-scope checks fixed in the
2026-09-25 audit commit (`4e2f94c2`): faculty creation, link-hod, and
faculty-login creation must all refuse a department the caller only
*manages* (a grouped/shared branch), while still allowing their own
department. See `src/lib/departments/scope.ts`'s `canHodManageFacultyDepartment`
doc-comment for the underlying rule.

### One-time setup

1. Create (or pick an existing) **non-production** college in the Firebase
   project your root `.env` points at, and note its `collegeId`.
2. Run the seed script once:
   ```bash
   node tests/e2e/support/seed-scope-fixtures.mjs <collegeId>
   ```
   It creates a parent/child department pair, a managed/grouped branch the
   child does NOT own, a sub-HOD test login scoped to the child department,
   a second HOD-role login already recorded against that same department (for
   the link-hod positive case), and two faculty records with no login yet
   (one in the sub-HOD's own department, one in the managed branch). It's
   idempotent - re-running it reuses whatever it already created.
3. Create `tests/e2e/.env.test` (gitignored) with the env vars the script
   prints, e.g.:
   ```
   E2E_FIREBASE_API_KEY=...
   E2E_SUBHOD_EMAIL=e2e-subhod@example-college.test
   E2E_SUBHOD_PASSWORD=TestPassword123!
   E2E_SUBHOD_OWN_DEPARTMENT=E2E Scope Child
   E2E_SUBHOD_MANAGED_DEPARTMENT=E2E Scope Managed Branch
   E2E_LINK_HOD_TARGET_UID=<uid the script printed>
   E2E_FACULTY_ID_IN_OWN_DEPARTMENT=<id the script printed>
   E2E_FACULTY_ID_IN_MANAGED_DEPARTMENT=<id the script printed>
   ```
4. `npm run test:e2e -- tests/e2e/api/faculty-scope-security.spec.ts`

The positive-control tests (own department succeeds) mutate real data each
run (unique `employeeId`/`collegeEmail` per run, so re-runs never collide) -
same tradeoff every other spec in this suite already makes (see
`playwright.config.ts`'s own comment: `fullyParallel: false` because
"workflow tests mutate shared Firestore documents across steps").
