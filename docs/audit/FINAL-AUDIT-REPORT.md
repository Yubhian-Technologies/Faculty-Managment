# FMS — Pre-Production Audit Report

**Scope:** college creation → users/roles → departments & courses → subject import → staff (HOD adds faculty / supporting staff) → students (import, sections, promotion) → teaching assignments → timetable (timings, draft, publish) → student attendance → attendance reports. Cross-cutting: auth, Firestore rules, uploads, public endpoints, CI, dependencies, UI navigation patterns.

**Branch audited:** `claude/lucid-wright-nsk3ui` (includes `main` as of 2026-10-01, PR #332).
**Method:** static analysis of source (no production data, no live Firestore, no runtime load). Every finding below cites a file/line that was read. Items that depend on live configuration are marked **[verify live]**.
**Relationship to existing docs:** `docs/audit/00-overview/gaps-and-risks.md` (G1–G20) is the descriptive as-is audit. This report is the *verified gap register*; where a finding confirms or refines a G-item it is cross-referenced. New findings have no G-number.

Severity: **P0** stop-ship · **P1** fix before go-live · **P2** fix within the first release cycle · **P3** hygiene.

---

## 1. Verdict

| Area | State | One-line reason |
|---|---|---|
| Authorization at the API layer | **Good** | 332 of 340 routes are guarded; the 8 exceptions are public/seat-manager routes by design; roles are re-checked live (`liveRoles.ts`). |
| Authorization at the database layer | **Not production-ready** | Firestore rules let any faculty member read/write far more than the API allows, including writing attendance directly (F-01). |
| Data integrity of multi-step flows | **Weak** | Account provisioning, timetable publish and bulk imports are multi-write flows with no rollback (F-20, F-21, F-29). |
| Timetable correctness | **Weak** | Three different rules for "can a faculty be in two sections at the same period"; draft and publish disagree (F-22). |
| Attendance correctness | **Improved, not finished** | Counting fixed and holiday-aware (commit `ddc4066`); missed classes still not counted as held (F-25). |
| Scalability | **Weak in the timetable editor** | Every drag/edit reads all slots and all drafts of the college (F-40). |
| Test & release gate | **Not working** | CI stops at lint (160 errors); only 2 route-level tests; e2e not in CI (F-60, F-61). |
| Dependencies | **Not acceptable as-is** | `next@16.2.9` has 12 listed advisories incl. 1 critical; `nodemailer` high; 22 prod vulnerabilities (F-02). |
| UI navigation consistency | **Inconsistent** | Three competing patterns (drill-down / filter+Load / auto-fetch) across the flow (F-50). |

**Go/no-go:** not ready. Four items block go-live: **F-01, F-02, F-60, F-16**. Roadmap in §8.

---

## 2. Scale of the system (measured)

| Metric | Value |
|---|---|
| API route files | 340 (258 expose POST/PUT/PATCH/DELETE) |
| Page files | 606 (596 under `(dashboard)`) |
| Library files (`src/lib`) / unit-test files | 258 / 80 (838 tests passing) |
| e2e specs | 14 (need a seeded non-prod env; not run in CI) |
| Mutating routes using a schema validator (zod) | 3 of 258 |
| Mutating routes writing an audit-log entry | 97 of 258 (`college/*` 86 of 173; `location/*` 0 of 25; `upload/*` 0 of 26) |
| Routes that call `getAdminDb()` directly | 310 of 340 |
| Raw `fetch(` calls in UI code | 1,344 across 451 files (React Query used in 28 files) |
| Lint | 160 errors (142 `react-hooks/set-state-in-effect`), 136 warnings |
| Production dependency advisories (`npm audit --omit=dev`) | 22 (1 critical, 9 high) |

---

## 3. Architecture by MVC layer

| Layer | Where it lives | Assessment |
|---|---|---|
| **View** | `src/app/(dashboard)/**/page.tsx`, `src/components/**` | Pages fetch directly (1,344 raw `fetch` calls); no shared client data layer, so there is no caching, no central 401 handling (expired session → silently empty screens), and 695 `res.json()` calls with no `ok` check. Three navigation patterns coexist (F-50). 9 pages exceed 800 lines. Client Firestore is used in only 1 page (`leave/adjustments`). |
| **Controller** | `src/app/api/**/route.ts` | Auth/role/scope checks are consistent and well-commented. But the controller *is* the model for most features: 310/340 routes query Firestore directly and contain business rules, so rules are duplicated (e.g. faculty-clash, F-22). Validation is hand-written per route (3/258 use zod); `error: err.message` leaks internals in 9 routes (F-15). |
| **Model** | `src/lib/**`, `src/types/**`, Firestore | Real service layers exist where they were invested in: `lib/subjects/services/*` (atomic, tested), `lib/departments/scope.ts`, `lib/students/*`, `lib/studentAttendance/*`. Elsewhere the "model" is just types + inline queries. Department names are used as join keys (mitigated, see F-31). Two parallel role stores (`systemUsers` and `colleges/{id}/users`, F-28). |
| **Policy/Rules** | `firestore.rules`, `storage.rules`, `proxy.ts` | Second authorization layer is much coarser than the API and is deployed by hand (F-01, G3). `proxy.ts` gates pages only. |

**Where the architecture is strongest:** subject import (single transaction, drift check, read-back verification), department rename (one registry of 37+ collections with a drift test), draft timetable edits (transactional), attendance window enforcement (server-side, per period).
**Where it is weakest:** anything that creates an account plus several documents, anything that publishes many documents, and everything that reads "the whole collection to answer one question".

---

## 4. End-to-end flow map and status

| # | Stage | Entry (View) | API (Controller) | Core logic (Model) | Status |
|---|---|---|---|---|---|
| 1 | Create college | `super-admin/colleges/new` | `api/admin/colleges` | direct Firestore | Works; delete orphans data (F-27); no audit; location override (F-07) |
| 2 | Create Principal / users | `administration/users/new`, `principal/staff/new` | `api/college/users`, `administration/principals`, `role-seats` | `lib/roles/seats`, `authRest.createFirebaseUser` | Orphan-account risk (F-20); no forced password change (F-10) |
| 3 | Departments, courses, years, timings | `principal/departments/**`, `college-office/timings/**` | `college/departments` (1,156 lines), `courses`, `course-year-timings` | `lib/departments/*` | Rename cascade is solid (F-31); drill-down edit pages (F-50) |
| 4 | **Subject import** | `academics/course-structure` (Load pattern) | `college/subjects/import-and-assign` | `CourseStructureImportService` | **Best-built flow**: validate/commit, one transaction, read-back check, 250-row cap, 500-write guard. Dead `SUPER_ADMIN` role entry (F-14) |
| 5 | HOD adds staff | `hod/faculty/new`, `hod/supporting-staff/new`, imports | `college/faculty`, `supporting-staff`, `*/import` | `lib/firestore/facultyProvisioning` | Orphan accounts (F-20); `EMP` id by `count()+1` (F-26); PII exposed in list (F-06) |
| 6 | Students: import, sections, promotion | `hod/students`, `hod/sections`, `principal/students` | `college/students/*`, `sections` | `lib/students/*` | Import is chunked/non-atomic (F-29); promotion mutates in place (F-24) |
| 7 | Teaching assignments | `hod/teaching-assignments`, `academics/teaching-assignments` | `college/teaching-assignments` (873 lines) | inline | Auto-fetch filters (F-50); large route, rules inline |
| 8 | **Timetable** | `hod/timetable` (Load) + 3 legacy route trees | `timetable/draft`, `publish`, `timetable-slots`, `import` | `lib/timetable/*` | Publish non-atomic (F-21); clash rules inconsistent (F-22); context reload per edit (F-40); no auto-generator exists (F-54) |
| 9 | **Attendance marking** | `panel/mark-attendance` | `college/student-attendance`, `[id]`, `office-correction`, `today-periods` | `lib/timetable/currentPeriod`, `lib/studentAttendance/*` | Server-side window enforced; **bypassable through Firestore rules** (F-01); only PRESENT/ABSENT (F-55) |
| 10 | Not-posted sweep | Cloud Function → `api/cron/attendance-not-posted` | cron route | `lib/attendance/*` | Once/day, silent failure, no retry (F-45) |
| 11 | **Reports** | `principal/attendance-reports` (6 tabs), `hod/monthly-records`, `exam-cell/attendance-report` | `section-attendance-report`, `attendance-percentage-report`, `student-attendance-history` | `lib/studentAttendance/counting.ts` | Counting unified (fixed); cohort bleed (F-24); denominator (F-25); deep drill-downs (F-50) |

---

## 5. Findings register

Columns: **ID · Sev · Layer · Finding · Evidence · Impact · Recommended fix · Effort** (S ≤ 1 day, M ≤ 1 week, L > 1 week).

### 5.1 Security and access

| ID | Sev | Layer | Finding | Evidence | Impact | Fix | Effort |
|---|---|---|---|---|---|---|---|
| F-01 | **P0** | Rules | Firestore rules are far coarser than the API. `facultyMembers` and `students` are readable by every `isStaff` role (includes every faculty member, Finance, Purchase, Webmaster). `students` can be **created/updated by any faculty member**. `studentAttendance` and `internalExamMarks` can be **created by any faculty member** with only `facultyId == uid` checked — no date, status, window, roster or section check. The server's period-window rule is therefore bypassable: a faculty member can write a `SUBMITTED` session for any date directly with the public client SDK, and `POST /student-attendance` will then return it as existing. | `firestore.rules:287-288` (facultyMembers), `:269-272` (students), `:585-591` (internalExamMarks), `:597-599` (studentAttendance create); server returns existing SUBMITTED at `student-attendance/route.ts` (existing-session branch). Repo rules are also ahead of the deployed ruleset (G3) **[verify live]**. | Falsified attendance and marks; bulk PII read (Aadhaar/PAN/bank) by any teacher; cross-department student edits. Defeats every API-level scope rule. | Make `studentAttendance`/`internalExamMarks` create `false` (server-only, like update). Restrict student/faculty reads to the roles the API grants and write to server-only. Compile + emulator-test the rules in CI; deploy from CI. | M |
| F-02 | **P0** | Platform | Dependencies carry known advisories. `next@16.2.9` is in the vulnerable range for 12 listed advisories (proxy bypass, cache confusion, server-function endpoint disclosure, SSRF, RCE variants incl. `next/og`); `npm audit` reports a non-major fix at 16.3.8. `nodemailer` has 8 advisories incl. recipient-domain validation bypass (used by `lib/email/mailer.ts`). `firebase`/`@grpc/grpc-js`, `sharp`, `node-fetch`, `postcss`, `brace-expansion` also high. | `npm audit --omit=dev` (2026-10-01): 22 vulns, 1 critical, 9 high. | Remote exploitation of the framework; mail sent to attacker-controlled domains. | Upgrade `next` to the fixed 16.3.x, `nodemailer` to ≥10.0.6, re-run audit; add `npm audit --audit-level=high` to CI. | S |
| F-03 | P1 | Controller | Deactivating or re-roling a login does not revoke its Firebase Auth state, and custom claims are written only once. `college/users/[uid]` PATCH sets the Firestore flag only (no `disabled`, no `revokeRefreshTokens`); claims are set on first session only; only `admin/users`, `location/users`, `administration/college-people` and seat changes touch claims/tokens. Firestore rules read the claim, so a deactivated or demoted user keeps rules-level access for the life of the token. | `auth/session/route.ts:30,85-91`; `grep disabled` shows disable only in admin/location paths. Sign-in itself never checks `isActive`. | Ex-staff retain database access (compounds F-01). | One `deactivateLogin(uid)` service: disable Auth user, revoke refresh tokens, clear claims; call it from every deactivate/role-change path; refresh claims on role/seat change. | M |
| F-04 | P1 | Controller | `resolveLiveRoleInfo` **fails open**: a missing profile doc or a Firestore read error returns the cookie's roles. | `lib/auth/liveRoles.ts:35,43,58,78,85` | A deleted/deactivated account keeps its cookie roles for up to the cookie lifetime whenever the lookup fails. | Fail closed for write routes (deny on error); treat "no profile" as no roles. | S |
| F-05 | P1 | Controller | 15 routes authorize with raw `verifySession()` (cookie only), so they skip the live role re-check. | `admin/colleges` (×3), `location/{departments,departments/[id],users,vacancy-requests,vacancy-requests/[id],offers,offers/[id],interviews,interviews/[id],candidates,candidates/[id]}`, `college/publications`, `college/settings/nav-visibility`, `pdf/image-proxy` | Revocation does not apply to these routes. | Replace with `requireRole`/`requireLocationMember`. | S |
| F-06 | P1 | Controller | `GET /api/college/faculty` returns whole faculty documents (Aadhaar, PAN, bank/statutory fields) to every permitted role including `PANEL_MEMBER`, `COLLEGE_STAFF` (timetable in-charges) and `COLLEGE_OFFICE`; only the *rows* are scoped, not the *fields*. | `college/faculty/route.ts:27` (role list), response built from `migrateFacultyDoc(d.data())` | Colleagues' ID-document numbers exposed to peers. | Field-level projection per role (a "directory" shape for pickers; full shape only for HOD/Principal/Office). | M |
| F-07 | P1 | Controller | `GET /admin/colleges` lets any permitted non-Super-Admin override the location filter: `?locationId=` wins over the session's own location. | `admin/colleges/route.ts:44` | An Administration/HR/Dept-head user can list another location's colleges (names, contacts). | Ignore the param unless `SUPER_ADMIN`. | S |
| F-08 | P2 | Controller | No rate limiting or abuse protection anywhere (`grep rateLimit` = none). Unauthenticated endpoints: `auth/resolve-student-login` (roll number → login email, confirms existence, falls back to a collection-group scan), `public/candidate-form`, `public/offer-acceptance`, `public/student-feedback`, `public/faculty-public`. | `resolve-student-login/route.ts:23-48` | Enumeration, scraping, cost amplification. | Edge rate limit (IP + key) and uniform "not found" responses. | M |
| F-09 | P2 | Platform | No security headers (CSP, `X-Frame-Options`/`frame-ancestors`, HSTS, `Referrer-Policy`, `Permissions-Policy`). | `next.config.ts` (none); `grep` for the headers = none | Clickjacking, weaker XSS containment. | Add `headers()` in `next.config.ts`; start CSP in report-only. | S |
| F-10 | P2 | Controller | Passwords are chosen by the creator and sent in the request body; there is no forced change on first login (`grep mustChangePassword` = none) and no policy beyond Firebase's 6-character minimum. The "weak password" case is mapped to a 4xx in only 2 of 11 `createFirebaseUser` callers; `college/users` returns **500 "Internal error"**. | `lib/firebase/authRest.ts:27`; `college/users/route.ts:415-426`; `grep auth/weak-password` hits only `location/departments` | Shared/known initial passwords persist; confusing errors. | Generate one-time passwords or send reset links; force change on first login; centralise error mapping in the provisioning service. | M |
| F-11 | P2 | Controller | Upload routes (26): a 10 MB limit is declared but the Vercel serverless request-body limit is lower (4.5 MB) **[verify live]**; the whole file is buffered in memory; `contentType` comes from the client when only the extension matched; no magic-byte check; access is a permanent token URL (not revocable); `studentId` is taken raw into the storage path with no existence/ownership check. | `upload/student-document/route.ts:8,53`; `next.config.ts:22` | Uploads over the platform limit fail in production; spoofed content types; links that cannot be revoked. | Direct-to-Storage signed uploads; sniff content; store a path and mint short-lived URLs. | M |
| F-12 | P2 | Controller | Session hardening: expiry check is conditional (`payload.exp && …`); no server-side revocation list; if `SESSION_SECRET` is unset in production the cookie is signed with the Admin private key and only a `console.warn` is emitted. | `lib/auth/verifySession.ts:57`; `lib/auth/sessionToken.ts:15-22` | A leak of either secret compromises both; cookies without `exp` never expire. | Require `exp`; throw in production without `SESSION_SECRET`. | S |
| F-13 | P3 | Controller | Public candidate form stores `certificates[].url` and an unbounded `bioData` object unvalidated; the URLs are rendered as links in HOD/Office pages. | `public/candidate-form/.../route.ts:105-112`; `hod/batches/[id]/page.tsx:865` | Phishing links shown to staff; document bloat. (React 19 neutralises `javascript:` hrefs.) | Allow-list Storage URLs; size-cap and schema-validate `bioData`. | S |
| F-14 | P3 | Controller | 85 `college/*` routes list `SUPER_ADMIN` in `requireCollegeMember`, which requires a non-empty `collegeId`; global roles carry `collegeId ""`. The entry is likely dead and there is no documented support/impersonation path. | `verifySession.ts` (`NO_COLLEGE_CONTEXT`), `auth/session/route.ts:24-47` **[verify live: depends on the SUPER_ADMIN profile]** | Misleading access matrix. | Remove the dead entry or add an explicit audited "act-as" path. | S |
| F-15 | P3 | Controller | `error: err.message` is returned to clients in 9 routes (e.g. `timetable-slots` POST). | `timetable-slots/route.ts:322` + 8 others | Internal detail leakage. | Return a generic message; log the detail. | S |
| F-16 | **P0** | Platform | Plaintext credentials were committed in the past and remain in git history (G1). | `docs/audit/00-overview/gaps-and-risks.md` row 1 | Credential compromise. | Rotate (cannot be verified from code), then purge history. | S |

### 5.2 Data integrity

| ID | Sev | Layer | Finding | Evidence | Impact | Fix | Effort |
|---|---|---|---|---|---|---|---|
| F-20 | P1 | Controller/Model | Account provisioning creates the Auth user first, then writes Firestore with no compensation. A failure after `createFirebaseUser` leaves an orphan Auth account that blocks the email ("already exists") on retry. `college/users` POST also does 4-5 further writes (users, `systemUsers`, department HOD sync, section link, seat conversion) non-atomically. 11 files call `createFirebaseUser`. | `college/users/route.ts:327-396`; `lib/firestore/facultyProvisioning.ts:103-116` | Stuck onboarding, half-created people. | One provisioning service: Firestore writes in a transaction/batch first or compensate by deleting the Auth user on failure; idempotent by email. | M |
| F-21 | P1 | Controller | Timetable publish is not atomic and not race-safe. It deletes stale slots and inserts new ones across several independent batch commits (`flush()` every 400 ops), then marks the draft published in the last. A failure mid-way leaves a partial timetable. The faculty-clash re-check reads all slots, then writes — two sections publishing together can both pass. | `timetable/publish/route.ts:128-141,185-220` | Missing or duplicated periods; double-booked faculty. | Publish into a versioned set and flip a pointer, or use a transaction/lock per faculty-day; make it idempotent and resumable. | L |
| F-22 | P1 | Controller/Model | Three different rules for "same faculty, same day and period number in two sections": the draft editor and the direct slot route **allow** it (comment: years run different timings), but publish **rejects** it. Neither compares real clock times — both compare period numbers. | `lib/timetable/draftPlacement.ts:98-100`; `timetable-slots/route.ts:282-285`; `timetable/publish/route.ts:136-146` | An HOD can finish a full draft and be refused at publish; real overlaps between years with different timings are never detected. | One shared `facultyOverlap()` using resolved clock intervals from `CourseYearTiming`, used by draft, slots and publish. | M |
| F-23 | P2 | Controller | Publish never checks a generated slot against a manual/pinned slot or a second slot already in the same section cell (it deletes only `GENERATED` slots and inserts new ones). | `timetable/publish/route.ts:150-215` | Two subjects in one cell after a pinned slot is added post-draft. | Re-validate section cells at publish. | S |
| F-24 | P1 | Model | Cohort integrity: promotion rewrites the student in place; a `Section` document is reused by each new cohort; sessions and slots carry `semester` but sessions have **no `academicYear`**; report rosters are computed from *current* students. After a promotion, last year's section report has an empty roster and the new year's section inherits old sessions. (Counting now ignores sessions a student isn't on — `counting.ts` — which stops the worst bleed, but old-cohort reports remain unreachable.) | `students/promote/route.ts:148`; `StudentAttendanceSession` type; `lib/students/sectionRoster.ts` | Historical attendance cannot be reported per cohort. | Stamp `academicYear` on sessions/slots; add a student–section–year enrolment record; report by (section, academicYear). | L |
| F-25 | P1 | Model | Missed classes are not "held": percentages use only submitted sessions as the denominator, so a faculty member who never posts raises everyone's percentage. | `lib/studentAttendance/percentage.ts` (documented: "held = SUBMITTED sessions count, not timetable denominator") | Inflated percentages; defaulter lists understate. | Build the denominator from published timetable periods on teaching days, with explicit "not posted" handling (HOD correction or excused). | M |
| F-26 | P2 | Controller | Uniqueness by check-then-write, not transaction: singleton roles, one Class Leader per section, one Department Office per department, faculty `employeeId`. The provisioning path derives `EMP####` from `count()+1`, which **repeats an existing ID after any deletion** and races under concurrency; the manual POST accepts a client-supplied id. | `facultyProvisioning.ts:23-27,116,263`; `college/users/route.ts:253-258,296-309`; `college/faculty/route.ts:394-399` | Duplicate IDs/holders. | Counter document incremented in a transaction; unique-key documents for singletons. | M |
| F-27 | P2 | Controller | Deleting a college removes only the parent document after checking `users`; every subcollection (departments, sections, students, slots, attendance, …) is orphaned, with no soft delete and no audit entry. | `admin/colleges/route.ts:130-158` | Orphaned data and cost; unrecoverable. | Soft-delete (`isActive:false` + `deletedAt`); purge job with export. | M |
| F-28 | P2 | Model | Two role stores: `colleges/{id}/users` and `systemUsers` (written at user creation; also the first-login fallback). | `college/users/route.ts:359`; `auth/session/route.ts:35-49` | Drift between the two. | Pick one source of truth; derive the other. | M |
| F-29 | P2 | Controller | Bulk operations (`students/import-excel`, `promote`, `bulk-move`, `bulk-delete`, faculty/staff imports) use `ChunkedBatch`, which commits chunk by chunk with no cross-chunk atomicity (documented in `chunkedBatch.ts`). A failure leaves earlier chunks committed. | `lib/firestore/chunkedBatch.ts`; `students/import-excel/route.ts:368,785`; `students/promote/route.ts` | Partial imports/promotions that are hard to reconcile. | Per-run import record with row results and an idempotent retry; for promotion, a run id + resumable state. | M |
| F-30 | P2 | Controller | Audit logging is opt-in per route: 97 of 258 mutating routes write an entry; none in `location/*` (25 mutating) or `upload/*` (26). | route scan | Incomplete compliance trail (G10). | Central `withAudit()` wrapper; checklist in review. | M |
| F-31 | P3 | Model | Department **name** is used as a foreign key across 37+ collections. Mitigated well: `refFields.ts` is the single registry, the rename cascade covers it with a status/retry, and a test fails if it drifts. Residual: the cascade is eventually consistent, and queries still key on names. | `lib/departments/refFields.ts`, `renameCascade.ts` | Brief inconsistency after a rename. | Keep; prefer id-based queries in new code. | — |

### 5.3 Performance and scale

| ID | Sev | Layer | Finding | Evidence | Impact | Fix | Effort |
|---|---|---|---|---|---|---|---|
| F-40 | P1 | Controller/Model | **Every timetable edit** (`PATCH` move/add/remove) and every draft load calls `loadTimetableContext`, which reads *all* `timetableSlots`, *all* `timetableDrafts`, all timings, courses and more for the whole college. | `lib/timetable/loadContext.ts:74-104` (`timetableSlots.get()` at `:90`, `timetableDrafts.get()` at `:103`); `timetable/draft/route.ts:150,228` | Latency and Firestore read cost grow with the college; a busy editing session multiplies it. | Query only the faculty/day/period being validated; maintain a small per-faculty busy index; cache per request. | L |
| F-41 | P2 | Controller | Publish reads every slot and every timing for the college. | `timetable/publish/route.ts:44,128` | Same, once per publish. | Query by involved faculty and semester. | M |
| F-42 | P2 | Controller | 150 GET routes perform reads with no `.limit()`; examples: `college/users` GET returns all users of the college; `students` GET for roles that aren't paginated. | route scan; `college/users/route.ts:42-48` | Growth-driven slowness. | Cursor pagination for list endpoints; projection. | L |
| F-43 | P2 | Controller | `attendance-percentage-report` still loads every submitted session of each section (no date bound). Section report and student history were date-bounded in `ddc4066`. | `attendance-percentage-report/route.ts` | Slow defaulter report at scale. | Per-section/month rollup documents updated on submit. | M |
| F-44 | P2 | Platform | Hosting limits are not configured: no `maxDuration` anywhere; long routes (500-row imports, PDF via Chromium, cron over all colleges) run on platform defaults; `serverActions.bodySizeLimit` is 10 MB. | `grep maxDuration` = none; `next.config.ts` | Timeouts on large imports/PDFs **[verify live: plan limits]**. | Set per-route `maxDuration`; move long work to background jobs; chunk imports. | M |
| F-45 | P2 | Platform | Not-posted cron: sweeps once per college per day (after cutoff), sequentially per faculty; the Cloud Function logs failures and returns — no retry, timeout or alert. | `api/cron/attendance-not-posted/route.ts`; `functions/src/index.ts:15-42` | Missed reminders go unnoticed. | Per-period dedupe keys and every-15-minute processing; alert on non-2xx. | M |
| F-46 | P3 | Controller | `in` queries are silently truncated with `.slice(0, 30)` (faculty, students, scope — G7). | `college/faculty/route.ts`, `college/students/route.ts`, `lib/departments/scope.ts` | A user managing >30 departments silently loses rows. | Batch the query or fail loudly. | S |
| F-47 | P2 | View | No shared client data layer: 1,344 raw `fetch` calls, React Query in 28 files, no `401` handling (`grep status === 401` outside API = none), 695 calls that never check `res.ok`. | scans | Session expiry = silent empty pages; refetch storms. | One `apiFetch` + React Query; global 401 → re-login. | L |

### 5.4 Functional / UX

| ID | Sev | Layer | Finding | Evidence | Impact | Fix | Effort |
|---|---|---|---|---|---|---|---|
| F-50 | P1 | View | Three competing patterns for "pick a scope, then see data": **(a)** drill-down navigation (59 multi-segment pages; Appendix A), **(b)** filters + explicit Load (e.g. `hod/timetable`, `academics/*`, `college-office/students`, `exam-cell/attendance-report`), **(c)** filters that auto-fetch on every change (e.g. `hod/subjects`, `hod/teaching-assignments`, `principal/timetable`, `exam-cell/configure`; Appendix B). The same task (e.g. a section's attendance) is reachable through 3 different UIs. | Appendix A, B | Inconsistent behaviour, extra page loads per level, lost context on back. | Standardise on (b): a filter bar + **Load** button, results in place, filters in the URL. Retire the attendance/timetable drill chains. | L |
| F-51 | P2 | View | Duplicate route trees for the same feature: the timetable editor is mounted from `hod/…`, `panel/timetable-incharge/…` and `college-staff/timetable-incharge/…`; legacy `hod/timetable/[courseId]/[year]/[sectionId]` still exists beside the new `hod/timetable` Load page; attendance has `attendance-history`, `attendance-reports` and `monthly-records` (HOD and Panel copies). | route list | Triple maintenance; behaviour drift. | One page per feature, role differences in props. | L |
| F-52 | P2 | View | Pagination coverage: 138 pages render lists after fetching; 70 `DataTable` usages in 58 files don't opt into `paginate` (Appendix E; r-and-d 22, principal 8, finance 7, college-office 5). HOD pages were paginated in this branch. | Appendix E | Slow, unbounded tables. | Make `paginate` the default and opt out explicitly. | M |
| F-53 | P2 | View | `principal/attendance-reports` merges six former modules into tabs (Students/Faculty × sub-tabs) while its "By Section"/"By Student" tabs still open deep drill-downs; this conflicts with the "no merged tabs" direction used on mobile. | `principal/attendance-reports/page.tsx` | Mixed model. | Decide the target (separate sidebar items, each a filter + Load page). | M |
| F-54 | P3 | Model | There is no timetable auto-generator: constraints exist (`TimetableRules`, `validatePlacement`) but placement is manual; comments in `types`/`publish` still refer to "the generator". | `lib/timetable/*`, `components/timetable/TimetableGridEditor.tsx` | Timetable creation is slow; stale docs. | Product decision: build it or remove the dead vocabulary (`source: GENERATED` semantics remain). | L |
| F-55 | P3 | Model | Attendance marks are only PRESENT/ABSENT — no on-duty/medical/late, no link to approved leave. | `types/studentAttendance.ts` | Exam-eligibility disputes. | Add mark types + reason; link to leave/OD. | M |

### 5.5 Process and quality

| ID | Sev | Layer | Finding | Evidence | Impact | Fix | Effort |
|---|---|---|---|---|---|---|---|
| F-60 | **P0** | Platform | CI runs `lint` first and lint fails (160 errors: 142 `react-hooks/set-state-in-effect`, 8 `no-explicit-any`, 3 `no-unescaped-entities`, 3 `prefer-const`, …), so type-check, build and tests never run. | `.github/workflows/ci.yml`; `npx eslint src` (2026-10-01) (G2) | No release gate at all. | Fix or downgrade the rule; run `tsc`, tests, build regardless. | M |
| F-61 | P1 | Platform | Tests: 80 unit-test files, only 4 under `src/app/api` (2 are true route tests) for 340 routes; Firestore rules untested; the 14 e2e specs need a seeded environment and are not in CI. Library areas with no tests include `pdf` (14 files), `research` (13), `circular`, `budget`, `firebase`, `teaching`, `publications`. | scans | Regressions in routes and rules go unnoticed. | Route contract tests per guard; rules emulator tests; seeded e2e in CI. | L |
| F-62 | P2 | Platform | No observability: errors go to `console.error`; no tracing, metrics or alerting. | `grep` for monitoring libs = none | Failures (cron, imports) are invisible. | Structured logging + error tracking + cron heartbeat. | M |
| F-63 | P2 | Docs | Two agent-context docs (`AGENTS.md`/`CLAUDE.md`) and many `[UNVERIFIED]` markers in `docs/audit`. | `docs/audit/00-overview/gaps-and-risks.md` | Drift. | Single source; resolve the unverified items. | S |
| F-64 | P3 | Platform | `functions/` pins `firebase-admin@^12` while the app uses `^14`. | `functions/package.json` | Minor skew. | Align. | S |

---

## 6. Navigation and filter audit (the "drill-down vs filter + Load" request)

**Target pattern:** one page → filter bar → **Load** button → result table/grid in place → URL keeps the filters → paginated.

| Pattern | Count / examples | Verdict |
|---|---|---|
| Drill-down (multi-segment routes) | **59 pages.** Worst: `principal/attendance-reports/[dept]/[course]/[section]/[subject]/[year]/[month]` (6 levels), `principal/attendance-history/…/[studentId]` (4), `panel/monthly-records/[section]/[year]/[month]/[date]` (4), `hod/monthly-records/…` (3), `*/timetable-incharge/[course]/[year]/[section]` (3 × 3 roles), `hod/timetable/[course]/[year]/[section]` (3, legacy), leave-history (3), management faculty (4). | Convert the filter chains (Appendix A, rows marked **Filter chain**). Entity→module detail pages (`[id]/[module]`) are fine. |
| Filters + Load button | `hod/timetable`, `hod/timetable-view`, `hod/teaching`, `hod/monthly-records/[sectionId]`, `academics/{course-structure,regulation,syllabus,teaching-assignments}`, `college-office/students`, `exam-cell/attendance-report`, `super-admin/users` | Reference pattern. |
| Filters that fetch on every change (no Load) | `hod/subjects`, `hod/teaching-assignments`, `principal/timetable`, `principal/internal-marks`, `exam-cell/configure`, `hod/mid-paper-setter`, `hod/attendance`, `principal/attendance`, `panel/attendance`, `management/{attendance,indents}`, `location-dept-head/attendance/reports`, `location-staff-admin/attendance` (heuristic scan; the first four were confirmed by reading the effect dependencies) | Fine for cheap lookups; **should be Load** where the fetch is heavy (timetable, assignments, reports). |
| Merged tabs | `principal/attendance-reports` (6 modules) | See F-53. |

Detailed lists: Appendices A, B, E.

---

## 7. What is working well (verified)

* Cookie is HMAC-signed, `httpOnly`, `sameSite=strict`, `secure` except on localhost; roles re-derived live on about 315 of 340 routes (the rest are public, cron, seat-manager or the 15 in F-05); seat changes take effect within a 20 s cache.
* Department-scope helpers are centralised and unit-tested (10 test files in `lib/departments`).
* Subject import is the model for how the rest should be built (see §4 row 4).
* Draft timetable edits run in a transaction and re-validate every hard rule server-side.
* Attendance windows are enforced server-side per period, with optimistic-concurrency on save; IST handling is centralised in `lib/attendance/istTime.ts`.
* Department rename cascade has a registry, a retry state and a drift test.
* Student roll-number uniqueness has a dedicated registry (`rollNumberUniqueness`) and duplicate detection on import.
* Public endpoints use capability URLs with three unguessable IDs (college + candidate + application) and reject re-submission.
* `requireCollegeContext` only honours `?collegeId=` when the session has none (global roles), which limits G5.

---

## 8. Remediation roadmap

| Phase | Goal | Items |
|---|---|---|
| **0 — stop-ship (days)** | Make the release gate and the database safe | F-60 (CI), F-02 (dependency upgrade), F-01 (rules: server-only attendance/marks writes; tighten reads; deploy from CI), F-16 (rotate credentials), F-12 (require `SESSION_SECRET`) |
| **1 — integrity (1–2 weeks)** | Stop creating bad data | F-03/F-04/F-05 (revocation + fail closed), F-20 (provisioning service), F-21/F-22/F-23 (publish atomicity + one overlap rule), F-25 (denominator), F-26 (counters), F-06/F-07 (PII + location override) |
| **2 — scale & cohort (2–4 weeks)** | Make it hold at real size | F-40/F-41 (timetable context), F-24 (academic-year stamping + enrolment), F-42/F-43 (pagination + rollups), F-44/F-45 (limits, cron), F-47 (data layer) |
| **3 — consistency (ongoing)** | One way to do things | F-50/F-51/F-52/F-53 (Load-page pattern, retire duplicate trees, default pagination), F-30 (audit wrapper), F-61/F-62 (tests, monitoring) |

---

## 9. Attendance optimisation — status after `ddc4066`

| Item | Status |
|---|---|
| One shared held/attended rule across all reports and the student view (`lib/studentAttendance/counting.ts`, tests) | **Done** |
| Reports read date-bounded data (section report, student history) | **Done** (percentage report still unbounded → F-43) |
| No attendance on Sundays/non-working days/holidays/summer break (`classDay.ts`, enforced in POST, today-periods, cron) | **Done** |
| Batched reads and memoised timings in `currentPeriod`/`today-periods` | **Done** |
| Transactional save/submit in `student-attendance/[id]` | **Done** |
| Missed classes counted as held | **Open** → F-25 |
| Server-only attendance writes in Firestore rules | **Open** → F-01 (**P0**) |
| Cohort/academic-year stamping | **Open** → F-24 |
| On-duty/medical marks | **Open** → F-55 |
| Not-posted cron cadence/alerting | **Open** → F-45 |

---

## 10. Limits of this audit

* Static analysis only. **Not checked:** the *deployed* Firestore/Storage rules (F-01 assumes the repo file), Vercel plan limits (F-11, F-44), real data volumes, production env vars, and runtime behaviour.
* Read line-by-line: auth/session, college creation, user and faculty provisioning, department delete/rename, subject import, student list/promotion/import (structure), teaching-assignment and timetable draft/publish/slots/context, student attendance and its reports, upload (student document), public candidate form, Firestore/Storage rules, CI, functions, dependencies.
* Covered by automated scans only (patterns, counts, guards — not read in full): the remaining ~250 routes (leave, finance, hiring, research, library, payroll, budget), and the 606 pages. Findings in those areas are therefore under-reported; the module docs under `docs/audit/0x-*` list their open questions.
* Numbers come from scripts run on 2026-10-01 against this branch; the heuristic page classifiers (Appendix B) can mislabel a page and should be confirmed before refactoring a specific one.

---

## Appendix A — Drill-down pages

### Multi-segment (drill-down) pages — 59

| Depth | Page route | Kind |
|---|---|---|
| 6 | `principal/attendance-reports/[departmentId]/[courseId]/[sectionId]/[subjectId]/[year]/[month]` | **Filter chain as navigation** (Dept → Course → Section → Subject → Year → Month → Date) |
| 4 | `management/faculty/[collegeId]/departments/[deptId]/faculty/[facultyId]/[module]` | Entity → module detail (acceptable: record view, not a filter chain) |
| 4 | `panel/monthly-records/[sectionId]/[year]/[month]/[date]` | **Filter chain as navigation** (Dept → Course → Section → Subject → Year → Month → Date) |
| 4 | `principal/attendance-history/[departmentId]/[courseId]/[sectionId]/[studentId]` | **Filter chain as navigation** (Dept → Course → Section → Subject → Year → Month → Date) |
| 4 | `principal/attendance-reports/[departmentId]/[courseId]/[sectionId]/[subjectId]` | **Filter chain as navigation** (Dept → Course → Section → Subject → Year → Month → Date) |
| 3 | `college-office/leave-history/[deptId]/[uid]/history/[type]` | Filter chain as navigation (Dept → Person → Leave type) |
| 3 | `college-office/timings/[departmentId]/[courseId]/[year]/edit` | Config drill (Dept → Course → Year → edit) |
| 3 | `college-staff/timetable-incharge/[courseId]/[year]/[sectionId]` | **Filter chain as navigation** (Course → Year → Section); superseded by `hod/timetable` Load page |
| 3 | `hod/monthly-records/[sectionId]/[year]/[month]` | **Filter chain as navigation** (Dept → Course → Section → Subject → Year → Month → Date) |
| 3 | `hod/timetable/[courseId]/[year]/[sectionId]` | **Filter chain as navigation** (Course → Year → Section); superseded by `hod/timetable` Load page |
| 3 | `management/faculty/[collegeId]/departments/[deptId]/faculty/[facultyId]` | Org drill (Location → College → Dept → Person) |
| 3 | `panel/monthly-records/[sectionId]/[year]/[month]` | **Filter chain as navigation** (Dept → Course → Section → Subject → Year → Month → Date) |
| 3 | `panel/timetable-incharge/[courseId]/[year]/[sectionId]` | **Filter chain as navigation** (Course → Year → Section); superseded by `hod/timetable` Load page |
| 3 | `principal/attendance-history/[departmentId]/[courseId]/[sectionId]` | **Filter chain as navigation** (Dept → Course → Section → Subject → Year → Month → Date) |
| 3 | `principal/attendance-reports/[departmentId]/[courseId]/[sectionId]` | **Filter chain as navigation** (Dept → Course → Section → Subject → Year → Month → Date) |
| 3 | `principal/departments/[id]/courses/[courseId]/academic-year/[year]/edit` | Config drill (Dept → Course → Year → edit) |
| 3 | `principal/departments/[id]/courses/[courseId]/timing/[year]/edit` | Config drill (Dept → Course → Year → edit) |
| 3 | `principal/faculty/[deptId]/[facultyId]/[module]` | Entity → module detail (acceptable: record view, not a filter chain) |
| 3 | `principal/faculty/[deptId]/[facultyId]/[module]/edit` | Entity → module detail (acceptable: record view, not a filter chain) |
| 3 | `principal/leave-history/[deptId]/[uid]/history/[type]` | Filter chain as navigation (Dept → Person → Leave type) |
| 2 | `administration/colleges/[id]/departments/[deptId]` | Detail / edit page |
| 2 | `college-office/documents/[department]/[vacancyId]` | Detail / edit page |
| 2 | `college-office/leave-history/[deptId]/[uid]` | Filter chain as navigation (Dept → Person → Leave type) |
| 2 | `college-office/non-technical-staff/[id]/[module]` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `college-office/non-technical-staff/[id]/[module]/edit` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `college-staff/timetable-incharge/[courseId]/[year]` | **Filter chain as navigation** (Course → Year → Section); superseded by `hod/timetable` Load page |
| 2 | `college-staff/timetable-incharge/[courseId]/[year]/teaching-assignments` | **Filter chain as navigation** (Course → Year → Section); superseded by `hod/timetable` Load page |
| 2 | `evaluation/[batchId]/[candidateId]` | Detail / edit page |
| 2 | `finance/browse/[locationId]/[collegeId]` | Org drill (Location → College → Dept → Person) |
| 2 | `hod/faculty/[id]/[module]` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `hod/faculty/[id]/[module]/edit` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `hod/leave-history/[uid]/history/[type]` | Filter chain as navigation (Dept → Person → Leave type) |
| 2 | `hod/supporting-staff/[id]/[module]` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `hod/supporting-staff/[id]/[module]/edit` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `hod/timetable/[courseId]/[year]` | **Filter chain as navigation** (Course → Year → Section); superseded by `hod/timetable` Load page |
| 2 | `hod/timetable/[courseId]/[year]/teaching-assignments` | **Filter chain as navigation** (Course → Year → Section); superseded by `hod/timetable` Load page |
| 2 | `library/staff/[id]/[module]` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `library/staff/[id]/[module]/edit` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `management/faculty-attendance/[collegeId]/[uid]` | Org drill (Location → College → Dept → Person) |
| 2 | `management/faculty/[collegeId]/departments/[deptId]` | Org drill (Location → College → Dept → Person) |
| 2 | `management/faculty/[collegeId]/principal/[module]` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `management/faculty/[collegeId]/vice-principal/[module]` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `panel/timetable-incharge/[courseId]/[year]` | **Filter chain as navigation** (Course → Year → Section); superseded by `hod/timetable` Load page |
| 2 | `panel/timetable-incharge/[courseId]/[year]/teaching-assignments` | **Filter chain as navigation** (Course → Year → Section); superseded by `hod/timetable` Load page |
| 2 | `principal/attendance-history/[departmentId]/[courseId]` | **Filter chain as navigation** (Dept → Course → Section → Subject → Year → Month → Date) |
| 2 | `principal/attendance-reports/[departmentId]/[courseId]` | **Filter chain as navigation** (Dept → Course → Section → Subject → Year → Month → Date) |
| 2 | `principal/departments/[id]/courses/[courseId]/edit` | Config drill (Dept → Course → Year → edit) |
| 2 | `principal/faculty/[deptId]/[facultyId]` | Detail / edit page |
| 2 | `principal/faculty/[deptId]/[facultyId]/credentials` | Detail / edit page |
| 2 | `principal/faculty/[deptId]/[facultyId]/edit` | Detail / edit page |
| 2 | `principal/leave-history/[deptId]/[uid]` | Filter chain as navigation (Dept → Person → Leave type) |
| 2 | `principal/staff/[uid]/[module]` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `principal/staff/[uid]/[module]/edit` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `principal/staff/non-technical/[id]/[module]` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `principal/staff/non-technical/[id]/[module]/edit` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `purchase/browse/[locationId]/[collegeId]` | Org drill (Location → College → Dept → Person) |
| 2 | `r-and-d/record/[module]/[id]` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `super-admin/users/[uid]/[module]` | Entity → module detail (acceptable: record view, not a filter chain) |
| 2 | `super-admin/users/[uid]/[module]/edit` | Entity → module detail (acceptable: record view, not a filter chain) |

## Appendix B — Filter pages by fetch behaviour

| Behaviour | Pages (heuristic scan of `onValueChange` → effect dependency / Load button) |
|---|---|
| Auto-fetch on filter change | `college-office/offers/new`, `exam-cell/attendance-report`, `exam-cell/configure`, `hod/attendance`, `hod/mid-paper-setter`, `hod/monthly-records/[sectionId]`, `location-dept-head/attendance/reports`, `location-staff-admin/attendance`, `location-staff-admin/departments/[id]`, `management/attendance`, `management/indents`, `panel/attendance`, `panel/monthly-records/[sectionId]`, `principal/attendance`, `principal/internal-marks`, `principal/timetable`, `super-admin/settings` (+ `hod/subjects`, `hod/teaching-assignments` confirmed by reading) |
| Explicit Load / Apply | `academics/course-structure`, `academics/regulation`, `academics/syllabus`, `academics/teaching-assignments`, `college-office/students`, `hod/teaching`, `hod/timetable`, `hod/timetable-view`, `location-staff-admin/reports`, `super-admin/users` |

## Appendix C — Routes with no session guard (8 of 340)

| Route | Why | Note |
|---|---|---|
| `auth/resolve-student-login` | Pre-login lookup | F-08 |
| `public/faculty-public`, `public/candidate-form/**`, `public/student-feedback`, `public/offer-acceptance/**` | Public by design | Capability URLs; F-08, F-13 |
| `college/role-seats`, `[id]`, `convert-legacy` | Guard is `requireSeatManager(request)` (custom) | OK, but not covered by the grep-based guard inventory |

## Appendix D — Routes using raw `verifySession()` (F-05)

`admin/colleges` (GET/POST/PATCH), `location/departments`, `location/departments/[id]`, `location/users`, `location/vacancy-requests`, `location/vacancy-requests/[id]`, `location/offers`, `location/offers/[id]`, `location/interviews`, `location/interviews/[id]`, `location/candidates`, `location/candidates/[id]`, `college/publications`, `college/settings/nav-visibility`, `pdf/image-proxy`.

## Appendix E — `DataTable` without `paginate`

### `DataTable` usages without `paginate` — 70 across 58 files

| File | Tables |
|---|---|
| `admin-office/vacancies/page.tsx` | 1 |
| `administration/interviews/page.tsx` | 1 |
| `administration/offers/page.tsx` | 1 |
| `administration/users/page.tsx` | 1 |
| `administration/vacancies/page.tsx` | 1 |
| `college-accounts/candidates/page.tsx` | 1 |
| `college-office/candidates/page.tsx` | 1 |
| `college-office/email-requests/page.tsx` | 1 |
| `college-office/faculty/page.tsx` | 1 |
| `college-office/non-technical-staff/page.tsx` | 1 |
| `college-office/staff/page.tsx` | 1 |
| `finance/audit/page.tsx` | 1 |
| `finance/budget-cycles/page.tsx` | 1 |
| `finance/budget/page.tsx` | 2 |
| `finance/fund-allocation/page.tsx` | 1 |
| `finance/payments/page.tsx` | 1 |
| `finance/receipts/page.tsx` | 1 |
| `hr-admin/candidates/page.tsx` | 1 |
| `hr-admin/interviews/page.tsx` | 1 |
| `hr-admin/offers/page.tsx` | 1 |
| `hr-admin/vacancies/page.tsx` | 1 |
| `library/staff/page.tsx` | 1 |
| `location-dept-head/candidates/page.tsx` | 1 |
| `location-dept-head/leave/page.tsx` | 1 |
| `location-dept-head/vacancies/page.tsx` | 1 |
| `location-staff-admin/leave/page.tsx` | 1 |
| `management/faculty/[collegeId]/departments/[deptId]/page.tsx` | 1 |
| `management/locations/page.tsx` | 1 |
| `management/users/page.tsx` | 1 |
| `panel/feedback/page.tsx` | 1 |
| `panel/interviews/page.tsx` | 1 |
| `principal/attendance-history/[departmentId]/[courseId]/[sectionId]/page.tsx` | 1 |
| `principal/audit-logs/page.tsx` | 1 |
| `principal/budget/BudgetRequestsList.tsx` | 1 |
| `principal/faculty/[deptId]/page.tsx` | 1 |
| `principal/indents/page.tsx` | 1 |
| `principal/purchase-clearance/page.tsx` | 1 |
| `principal/vacancies/ActionQueueView.tsx` | 1 |
| `principal/vacancies/general-admin/page.tsx` | 1 |
| `r-and-d/citation-metrics/page.tsx` | 2 |
| `r-and-d/consultancy-projects/page.tsx` | 2 |
| `r-and-d/discovery-innovation/page.tsx` | 2 |
| `r-and-d/hackathons/page.tsx` | 2 |
| `r-and-d/innovations/page.tsx` | 2 |
| `r-and-d/phd-supervision/page.tsx` | 2 |
| `r-and-d/publications/page.tsx` | 2 |
| `r-and-d/research-profiles/page.tsx` | 2 |
| `r-and-d/research-services/page.tsx` | 2 |
| `r-and-d/seed-funding/page.tsx` | 2 |
| `r-and-d/sponsored-projects/page.tsx` | 2 |
| `src/components/attendance/AttendanceReportView.tsx` | 1 |
| `src/components/attendance/StudentAttendanceHistoryPicker.tsx` | 1 |
| `src/components/faculty/FacultyTimelineView.tsx` | 1 |
| `super-admin/audit-logs/page.tsx` | 1 |
| `super-admin/colleges/page.tsx` | 1 |
| `super-admin/locations/page.tsx` | 1 |
| `super-admin/vacancies/page.tsx` | 1 |
| `webmaster/users/page.tsx` | 1 |

---

## 11. Navigation remediation status (F-50 – F-53)

| Item | Status | What changed |
|---|---|---|
| F-52 paginate by default | **Done** | `DataTable` paginates by default (`paginate={false}` opts out; the 3 `groupBy` tables opt out). Bar hidden while ≤ 10 rows. Custom card lists were paginated on HOD pages earlier. |
| F-50 drill-down → filter + Load (attendance) | **Done** | New `SectionFilterBar` (Department → Course → Year → Section on one page). Principal/HOD Attendance Reports: **Reports** and **By Student** are Load pages. Faculty (`panel/monthly-records`): one `FacultyAttendanceReportView` (Section + Day/Month/Period/Semester/Till now + Load). Retired the `principal/attendance-reports/[dept]/…`, `principal/attendance-history/[dept]/…`, `hod/monthly-records/…`, `panel/monthly-records/[section]/…` trees; old URLs redirect. |
| F-50 filter + Load (timetable) | **Done** for the Principal/VP/Academics Timetable View (Load button added). HOD Timetable already used Load. |
| F-51 duplicate timetable trees | **Partly done** | One shared `InchargeTimetableWorkspace` replaces the duplicated panel/college-staff landing + section-picker pages; `hod/timetable/[courseId]` year picker redirects; `hod/timetable/[courseId]/[year]` is now only the Timetable Incharge management page. Section grid and teaching-assignment routes remain as deep-link targets (assignment-request links, `requesterTimetableLink`). |
| F-53 merged attendance tabs | **Partly done** | Each tab is now a Load page. Splitting them into separate sidebar items needs a `navConfig.ts` change (protected file) — not done. |
| Still auto-fetching on filter change | **Left** | `hod/subjects`, `hod/teaching-assignments`, `exam-cell/configure`, `principal/internal-marks`, `hod/mid-paper-setter`: their later filters (semester, regulation) are derived from the data the first filters fetch, so a Load button changes their flow and needs a product decision. |
| Remaining multi-segment pages | **Left** | `*/leave-history/[dept]/[uid]/history/[type]`, `college-office/timings/…/edit`, `principal/departments/…/timing|academic-year/[year]/edit`, `management/faculty/[college]/…`, `finance|purchase/browse/[location]/[college]` — organisation/config drills, not report filter chains. |
