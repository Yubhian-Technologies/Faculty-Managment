# College Entity — Gap Analysis & Hardening Plan

**Status:** proposal (nothing implemented)
**Date:** 2026-10-05
**Scope:** the `colleges/{collegeId}` tenant root — creation, validation, lifecycle, provisioning, deletion.
**Related:** a parallel audit of dashboard/notification polling was run separately; its findings are not in this document.

---

## TL;DR

`colleges/{collegeId}` is the root of the entire college-scoped data tree (~100 sub-collections hang off it), but it has **no entity layer**. There is a TypeScript `interface`, a Firestore document, and a read hook — and nothing else. No schema validation, no referential integrity, no lifecycle enforcement, no provisioning, no cascade rules.

Every invariant that a tenant root needs is currently either *absent* or *accidentally* correct in one route and unenforced everywhere else. The result is a college that can be created in an unusable state, deactivated without any effect, and deleted with orphaned sub-data.

The single highest-value change is one file: `src/lib/firestore/colleges.ts`, owning create/read/update/delete for the tenant root, with invariants enforced in one place instead of spread across one route handler.

---

## Part 1 — What "entity" means here, and what exists today

For this codebase, an entity layer means five things:

| # | Capability | Present for College? |
|---|---|---|
| 1 | A declared shape | Yes — `College` interface, `src/types/core.ts:536` |
| 2 | Runtime validation of that shape at every write boundary | **No** |
| 3 | A single module owning all reads/writes of the doc | **No** — inline in the route |
| 4 | Owned invariants (lifecycle, referential integrity, uniqueness) | **No** |
| 5 | Owned relationships (children, provisioning, cascade) | **No** |

What exists instead:

| Layer | Thing | Where |
|---|---|---|
| Type | `interface College` — plain TS, zero runtime validation | `src/types/core.ts:536` |
| Type | `CollegeType` union + `COLLEGE_TYPE_LABELS` | `src/types/core.ts:519`, `:527` |
| Storage | Firestore doc `colleges/{collegeId}`; the **doc id is the id** | written inline |
| Read (admin) | `useAdminColleges()` / `useAdminLocations()` TanStack hooks | `src/hooks/useAdminColleges.ts` |
| Read (college) | `useCollegeInfo()` | `src/hooks/useCollegeInfo.ts` |
| Read (everything else) | raw `fetch("/api/admin/colleges")` in ~25 components/pages | see fan-out below |

### The asymmetry that proves it was an oversight, not a house style

Every sibling in the org tree got a module. College did not.

| Entity | Module |
|---|---|
| Users | `src/lib/firestore/users.ts`, `userProvisioning.ts` |
| Faculty | `src/lib/firestore/facultyProvisioning.ts` |
| College settings | `src/lib/firestore/collegeSettings.ts` |
| Subjects | `src/lib/subjects/services/SubjectInstanceService.ts`, `MasterSubjectImportService.ts`, `CourseStructureImportService.ts` |
| **Colleges** | **none** |

The codebase demonstrably knows how to do this — `SubjectInstanceService` is a full service class with typed reads and validation. College was simply never given the same treatment.

---

## Part 2 — The creation flow as it stands

```
UI (super-admin/colleges/new)  ──┐
   location picker (active only) │
UI (administration/colleges/new) ─┤
   no location field              │
                                  ▼
              POST /api/admin/colleges          src/app/api/admin/colleges/route.ts:80
                                  │
   1. verifySession() + role ∈ {SUPER_ADMIN, ADMINISTRATION}
   2. validate: name.trim().length ≥ 2
                type ∈ COLLEGE_TYPES (optional — "" and undefined both legal)
                locationId non-empty  (ADMINISTRATION: from session; SUPER_ADMIN: from body)
   3. collegeId = crypto.randomUUID().replace(/-/g,"").slice(0,20)
   4. ONE flat .set() ─────────────────────────────────────────────┐
   5. 201 { collegeId }                                            │
                                  │                                 │
                                  ▼                                 ▼
              stored doc                    nothing else is created
              ─────────                    ────────────────────────────
              name                          no Principal / College Admin login
              locationId                    no departments
              type?                         no designations catalog
              address                       no settings/general
              contactEmail                  no academic / financial years
              contactPhone                  no subjects, working days, holidays
              isActive: true                no campusLocation geofence
              logoUrl: ""                   no audit log, no notification
              createdAt / updatedAt
```

Then, **as a separate manual step**, Location Administration bootstraps the first login at `POST /api/administration/college-people` (`src/app/api/administration/college-people/route.ts:43-112`) — a `COLLEGE_OFFICE` login, optionally appointed to the open `COLLEGE_ADMIN` seat.

> That second route is the closest thing this codebase has to entity-level onboarding. It does existence check, location-ownership check, singleton-seat check, Auth user, profile doc, `systemUsers` pointer, audit log, seat appointment, and partial-failure reporting. **It is the template college creation should have followed** (and it has its own bug — see F11).

---

## Part 3 — Findings

Severity: **S1** = data integrity / security · **S2** = correctness / operational · **S3** = hygiene.

### F1 — No entity module; the tenant root is written inline · S2

`src/app/api/admin/colleges/route.ts:114-125` writes the doc field-by-field inline in a route handler. No other module owns `colleges/{id}` writes.

**Fan-out of ad-hoc readers** — each re-derives its own projection and its own `id`-injection, so shape drift is invisible:

| Call site | Reads |
|---|---|
| `api/auth/session/route.ts:122` | tenant root on every login |
| `api/college/info/route.ts:45` | `logoUrl` |
| `api/college/student/me/attendance/route.ts:140,165` | `name`, `logoUrl`, `address`, `contactPhone` |
| `api/college/attendance/check-in/route.ts:70`, `check-out/route.ts:46` | `campusLocation` (security gate) |
| `api/college/colleges-directory/route.ts:25` | `name` where `isActive==true` |
| `api/admin/dashboard-stats/route.ts:38` | listDocuments + child counts |
| `api/administration/college-people/route.ts:59-63` | `locationId` (tenancy check) |
| `api/college/role-seats/route.ts:24-26` | **writes** `seatsConvertedAt` |
| `api/admin/locations/[id]/route.ts:53` | reverse lookup `where locationId` |
| ~25 UI components/pages | via `/api/admin/colleges` |

### F2 — Zero runtime validation at the write boundary · S1

`createCollegeSchema` exists at `src/lib/validations/index.ts:114-120` and is **never imported anywhere** — dead code. Consequences:

- `contactEmail` / `contactPhone` are shape-validated **only in the Super Admin form** (`super-admin/colleges/new/page.tsx:38-44`). The Administration form validates nothing but `name.trim()` (`administration/colleges/new/page.tsx:28`). The server stores whatever string it receives.
- `CollegeType` has no zod mirror, so the `COLLEGE_TYPES` array is duplicated in **three** places (`route.ts:29`, `super-admin/colleges/new/page.tsx:15`, `administration/colleges/new/page.tsx:15`) with no shared source.
- Unknown/extra body fields are silently accepted and ignored.

### F3 — Identity is implicit; no college code · S2

`College.id` is declared on the interface but **never stored**. It is synthesized on read (`route.ts:65`, `{ id: d.id, ...d.data() }`). Any code that `set()`s a `College` object containing `id` silently creates a doc whose stored `id` can drift from its path.

The id itself is `crypto.randomUUID().replace(/-/g,"").slice(0,20)` — 20 hex chars (~80 bits), no collision retry. Note this **diverges from the sibling convention**: `locations` uses Firestore auto-id via `.add()` (`api/admin/locations/route.ts:92`).

There is **no human-facing college code**. The only identifier a human ever sees is the 20-char doc id, surfaced in the admin table at `super-admin/colleges/page.tsx:116` and in the success toast at `super-admin/colleges/new/page.tsx:63`. Real colleges are identified in practice by a code (the student-attendance export test fixture literally carries `"Vishnu Institute of Technology ( Code: PA )"` — `studentReportExport.test.ts:12`).

### F4 — Referential integrity is not enforced · S1

`route.ts:101-108` requires a non-empty `locationId` but **never checks that the location exists**. Super Admin can create a college pointing at a nonexistent location, producing an orphan tenant root that is invisible to `/api/admin/locations`, undeletable through the location cascade, and orphaned in every location-scoped view.

The codebase already knows the right pattern — `api/admin/users/route.ts:235-246` reads the college doc and rejects `"Selected college not found"` plus a location-mismatch check. College creation does neither.

### F5 — `isActive` is a dead field; the UI actively lies about it · S1

`colleges/{id}.isActive` is written at creation, toggled by `PATCH`, rendered as a badge — and **read by nothing that gates access**:

- `verifySession.ts` / `requireCollegeMember` (`src/lib/auth/verifySession.ts:163-171`) never touch the college doc.
- `api/auth/session/route.ts:152` checks `profile.isActive` — the **user** doc, not the college.
- `liveRoles.ts:74` checks `u.isActive` — again the user doc.
- The only functional consumer in the entire app is `api/college/colleges-directory/route.ts:25` (`where isActive == true`).

Meanwhile the confirm dialog at `super-admin/colleges/page.tsx:255` tells the admin:

> "Deactivating *{name}* will prevent all its users from logging in."

**This is false.** Deactivating a college changes nothing about login or API access. An admin who deactivates a college to shut it down will believe they have done so.

### F6 — Creation provisions nothing; the tenant is born unusable · S2

Creation writes one flat document. Every child collection is empty, and none of them are created lazily either (contrast `collegeSettings.ts:31-36`, which *does* merge `DEFAULT_COLLEGE_SETTINGS` on read — the correct pattern). A new college has:

- **no login** until a separate Administration request to `api/administration/college-people`
- **no designations catalog** — `colleges/{id}/designations` is per-college curated (`api/college/designations/route.ts:29-31`), so faculty/supporting-staff picklists are empty until someone hand-builds them. The type-derived lists in `lib/designations/config.ts` are legacy defaults only.
- **no departments** — which means `getAcademicStructure` (`lib/college/academicStructure.ts`) derives nothing, and the whole academic module is inert.

There is no onboarding checklist, no progress state, and no way for an operator to see "this college is 20% configured".

### F7 — Asymmetric with location creation · S2

`POST /api/admin/locations` (`api/admin/locations/route.ts:102-121`) provisions its Administrator **in the same request** via `provisionLocationUser`, and returns **207** with a `provisioned[]` array on partial failure so the caller can retry just the missing user instead of re-creating the location.

College creation provisions nobody and has no partial-success concept. The two halves of the tenancy axis behave inconsistently.

### F8 — Deletion is under-guarded and non-cascading · S1

`route.ts:151-157` refuses deletion only when `colleges/{id}/users` is non-empty. It does **not** check `departments`, `facultyMembers`, `students`, `sections`, `subjects`, `budgetRequests`, `attendance` records, `notifications`, `auditLogs` — any of ~100 sub-collections. Firestore does not cascade, so deleting a college that has departments silently destroys them.

`api/admin/locations/[id]/route.ts:53` uses the correct pattern for locations (`where locationId == id, limit 1` → refuse). The college guard is the one that was skipped.

### F9 — `logoUrl` is write-only · S3

Written as `""` at creation (`route.ts:122`), never populated by any upload route, and read by four consumers (`college/info`, `student/me/attendance`, `timetable/logoAsset.ts`, `studentReportExport.ts:93`). It is permanently empty unless someone edits Firestore by hand. Every consumer already has a fallback (`/vishnulogo.png`), so the field is pure dead weight — or, read charitably, an unfinished feature with no owner.

### F10 — A tenant-creating write leaves no audit trail · S2

Cross-cutting writes in this codebase create an `AuditLog` + `AppNotification` (per `AGENTS.md`). College creation does neither. Compare `userProvisioning.ts:95-101`, which writes `USER_CREATED` to `colleges/{id}/auditLogs` — *into the new tenant*. The tenant-creating write itself is the one write with no record, and it cannot write into the tenant it is creating without a special case. `super-admin/audit-logs/page.tsx` therefore cannot show who created a college.

### F11 — Sibling bugs found while auditing (adjacent, worth fixing) · S2

- `api/administration/college-people/route.ts:82-92` calls `createFirebaseUser` **directly**, not via `withAuthUser` (`lib/firebase/withAuthUser.ts`, used by both provisioning functions). If the profile `set()` throws, the Auth account is **orphaned** — it exists in Firebase Auth with no profile doc and no way to log in. This is precisely the bug `withAuthUser` exists to prevent.
- `lib/firestore/userProvisioning.ts:6` claims DIRECTOR is "Super Admin-provisioned" via this module, but `SUPER_ADMIN_CREATABLE` (`src/lib/roles/superAdminCreatable.ts:6-12`) is L1–L2 only and contains no COLLEGE-scope role; `admin/users/route.ts:263` even comments *"no creatable role remains after DIRECTOR removal"*. The doc comment and `AGENTS.md` ("DIRECTOR … is Super Admin-provisioned (Add User, L3)") are both stale.

### F12 — Declared shape ≠ persisted shape · S2

`colleges/{id}` carries `seatsConvertedAt`, written by a **college-scoped** route (`api/college/role-seats/route.ts:24-26`), and it is **not declared** on the `College` interface. This is schema drift already happening in production data, caused by F1: no single module owns the doc, so ad-hoc writers add fields nobody declares.

---

## Part 4 — Target design

### 4.1 The module contract

`src/lib/firestore/colleges.ts` becomes the only writer and the canonical reader:

```ts
// ── reads ────────────────────────────────────────────────────────────────
collegeRef(db, collegeId): DocumentReference<CollegeDoc>
getCollege(db, collegeId): Promise<College | null>            // id injected, never stored
listColleges(db, opts?: { locationId?; activeOnly?; limit? }): Promise<College[]>

// ── writes (all invariants enforced here, nowhere else) ─────────────────
createCollege(db, input: CreateCollegeInput, actor): Promise<{ collegeId: string }>
updateCollege(db, collegeId, patch: CollegePatch, actor): Promise<void>
setCollegeActive(db, collegeId, isActive: boolean, actor): Promise<void>
deleteCollege(db, collegeId, actor): Promise<void>            // refuse unless empty
```

Every one of these takes `db` as its first argument (house convention — see `provisionLocationUser`, `loadCollegeSettings`, `collegeSettingsRef`) so it is testable against `src/test-support/fakeFirestore.ts`.

### 4.2 Invariants, and where each should live

| # | Invariant | Today | Target |
|---|---|---|---|
| I1 | `name` ≥ 2 chars after trim | route only | schema + module |
| I2 | `type` ∈ `CollegeType` | 3 duplicated arrays | one `COLLEGE_TYPES` export |
| I3 | `contactEmail` valid email-or-empty | client only (SA form) | schema |
| I4 | `contactPhone` 10 digits-or-empty | client only (SA form) | schema |
| I5 | `locationId` references an existing location | **unenforced** | module, pre-write read |
| I6 | `locationId` immutable after creation | mutable via any writer | module rejects the patch |
| I7 | name unique per location (case-insensitive) | **unenforced** | module, transactional |
| I8 | `id` never stored in the doc | unenforced | module omits it |
| I9 | inactive college ⇒ no login, no API access | **unenforced** (F5) | session + `requireCollegeMember` |
| I10 | delete refused if any child data exists | users only | module, `listDocuments`-style probe |
| I11 | every write emits an audit log | **none** (F10) | module, `actor` param |
| I12 | `updatedAt` always bumped | route only | module |

### 4.3 `isActive` enforcement (F5) — the design question

I9 is the one invariant that is not purely local; it needs a decision:

- **Option A — enforce at session issue.** `api/auth/session/route.ts` reads the college doc for college-scoped logins and rejects `isActive === false`. One extra doc read per login (or fold it into the existing user-doc read). Honest to the UI copy; cheap.
- **Option B — enforce in `requireCollegeMember`.** Broader coverage (kills API access too, not just login) but adds a read to *every* college-scoped API call — unacceptable without a cache.
- **Option C — cascade on deactivate.** PATCH `isActive: false` → walk `colleges/{id}/users` and set each `isActive: false`. No read cost on the hot path, and deactivation becomes genuinely effective. Reactivation is then ambiguous (which users were deactivated *by the college* vs individually?) unless a marker field is written — which is why this is not free.

**Recommendation: Option A now** (it makes the UI copy true and costs one read per login), with Option C as a follow-on if bulk deactivation is a real requirement. Option B should be avoided at all costs on the request hot path.

---

## Part 5 — Phased plan

Each phase is independently shippable and independently valuable. Effort in dev-days.

### Phase 0 — Stop the bleeding · ~0.5d · no behaviour change

| # | Change | Fixes |
|---|---|---|
| 0.1 | Export `COLLEGE_TYPES` from `src/types/core.ts`; import in all three consumers | F2 |
| 0.2 | Delete `createCollegeSchema` **or** wire it in — decide, don't leave it dead | F2 |
| 0.3 | Add `seatsConvertedAt` to `College` (or document it as unmanaged) | F12 |
| 0.4 | Delete the unused `WeeklyTimetableMatrix` 30s timer + its orphan import | hygiene |
| 0.5 | Fix the false deactivation copy at `super-admin/colleges/page.tsx:255` — either implement I9 or reword to "hides it from the directory picker" | F5 |

### Phase 1 — The entity module · ~2d

`src/lib/firestore/colleges.ts` with the 4.1 contract, zod-validated input, I1/I2/I3/I4/I8/I12 enforced. Route handlers become thin: parse body → call module → map errors to status codes.

I5 (location existence) and I7 (name uniqueness) land here too. For I7 use a `runTransaction` — this is exactly the check-then-write pattern `api/college/designations/route.ts:96-104` already uses, returning **409** on clash.

### Phase 2 — Lifecycle correctness · ~1.5d

- I9 via **Option A** (session-route check) + a shared short-TTL cache if the read shows up in latency.
- I10 — extend the delete guard from `users` to a genuine emptiness probe across all child collections, returning a *counted, named* list of what blocks it (the codebase's 409 style, cf. `students/advance-year` "naming every missing target section").
- I11 — `createCollege` writes a `COLLEGE_CREATED` audit entry to the global audit trail (`super-admin/audit-logs` reads across colleges; confirm which collection it queries before choosing the target).

### Phase 3 — Onboarding · ~2d

- Move the `college-people` bootstrap **into** `createCollege` as an optional `principalUser` input, mirroring `locations`' `administrationUser` + 207 partial-success contract (F7). Keep the standalone route for backfill.
- Fix F11: route that path through `withAuthUser`.
- Adopt the `collegeSettings.ts` lazy-default pattern for `designations` so a new college has a usable faculty picklist without hand-seeding.

### Phase 4 — Long-term value · ~2-3d

- **Human-facing college code.** Add `code` (e.g. `PA`), unique per location, generated at creation, editable only by Super Admin. Every downstream identifier problem (report headers, email domains, timetable PDFs) gets easier. Requires backfilling existing colleges — do it as a read-time fallback first (`code ?? id.slice(0,6)`), then a migration script.
- **Configuration readiness surface.** A `GET /api/admin/colleges/{id}/readiness` returning per-module `{ configured: boolean, count }` (departments, designations, users, academicYear, campusLocation) so the admin table can show "needs setup" instead of leaving a blank tenant to be discovered by accident.
- **Deactivation → reactivation semantics** (Option C in 4.3) if the product wants it.

### Sequencing note

Phase 0 before anything else (it is free). Phase 1 before Phase 2 — the module is what makes the lifecycle checks a one-line addition rather than another special case. Phase 3 last, because it changes API contracts and needs a migration story for the existing `college-people` callers.

---

## Part 6 — Test strategy

Follow the existing convention: `src/test-support/fakeFirestore.ts` (random latency, real transaction retry semantics, `failWhen` for failure injection), plus emulator tests for the Auth-dependent paths.

| Test | Where | Asserts |
|---|---|---|
| rejects orphan `locationId` | `colleges.test.ts` | 400, no doc written |
| rejects duplicate name in same location | `colleges.test.ts` | 409, no doc written |
| allows same name in different locations | `colleges.test.ts` | 201 |
| `id` never appears in the stored doc | `colleges.test.ts` | `snap.data().id === undefined` |
| invalid email/phone rejected **server-side** | `colleges.test.ts` | 400 (currently only client-checked) |
| `locationId` patch is rejected | `colleges.test.ts` | 400 |
| deactivate ⇒ login refused | `session.route.test.ts` | 403 |
| delete refused when departments exist | `colleges.test.ts` | 409 naming the blocker |
| **control**: naive check-then-write duplicate test | `colleges.test.ts` | naive version fails, transactional version passes |

That last row is the house pattern for race-sensitive code — a "control" test proving the naive version actually loses the race.

---

## Part 7 — Non-goals & risks

**Non-goals.** Not proposing an ORM or a schema-registry framework. Not proposing to denormalize the tenant root. Not changing the Firestore layout — `colleges/{id}/*` stays as it is; this is about the *code* owning it, not the data moving.

**Risks.**

| Risk | Mitigation |
|---|---|
| Location-existence check breaks any existing orphan colleges in prod | The check is on **create** only; existing docs are untouched. Add a read-time warning in the admin table if orphans are found. |
| Enforcing `isActive` at login locks out real users at colleges deactivated "by accident" | Audit current `isActive` values before shipping; announce the change. `super-admin/colleges` already lists the state. |
| Name-uniqueness rejects legitimate duplicates | Two colleges with the same name in one location is almost certainly a mistake, but make the error message explicit and allow Super Admin to override with an explicit `force: true` if ever needed. |
| College code backfill is a migration with no rollback | Read-time fallback first, migrate later, keep the fallback until verified. |

---

## Part 8 — Open questions for the owner

1. **Should duplicate college names be allowed at all?** If no, the transactional dedupe is non-negotiable. If yes (e.g. a college and its "_office campus"), scope uniqueness to `locationId` only.
2. **Is `isActive` meant to be a login gate or just a directory-visibility flag?** The UI copy says the former; the code does the latter. This decides 4.3.
3. **Should college creation provision the first login inline (like locations), or stay a separate explicit step?** Provisioning inline is more consistent; separate is more explicit and avoids a password being chosen in a form that also sets a geofence-free tenant.
4. **Who owns the designation catalog for a brand-new college?** If the answer is "nobody until the Principal is appointed", then a new college silently has empty faculty picklists for the first N days.
5. **Is there a college code / short name in the source data** we should be importing rather than inventing? The `( Code: PA )` fixture suggests one already exists informally.
