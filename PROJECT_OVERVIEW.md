# FMS Project Overview — Prompt for Claude

*Paste this into a new Claude conversation to give it full context on the codebase before asking for changes.*

## What this is

**fms-app** — a multi-tenant SaaS platform ("Faculty Management System") for running college administration: hiring, HR, attendance, leave, finance, exams, research output, library, placement, and more. Repo: `github.com/Yubhian-Technologies/Faculty-Managment`.

**Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Firebase client SDK (public/candidate-facing writes) + firebase-admin (all authenticated server routes), TanStack Query, Zustand, react-hook-form + zod. PDF generation via an HTML-template convention (`src/lib/pdf/`). No top-level README or `/docs` — the root `CLAUDE.md` (hiring pipeline only) was the only written doc before this one.

## Tenancy hierarchy

Not a flat SaaS — it's **GLOBAL → LOCATION → COLLEGE**:
- Top-level `colleges` Firestore collection holds `College` docs (`type`: ENGINEERING/SCHOOL/DENTAL/PHARMACY/POLYTECHNIC/DEGREE; `campusLocation` = a geofence circle/polygon for face+GPS attendance, Super-Admin-settable).
- A `Location` sits above colleges, owning LOCATION-scoped roles (Administration, HR Admin, Admin Office, Location Dept Head, Accounts).
- Nearly everything hiring/academic/HR-related lives under `colleges/{collegeId}/...` subcollections, written via the Admin SDK.

## Auth model

- Session = a **base64-JSON cookie** (`fms-session`): `{uid, email, role, realRole?, collegeId, locationId, exp}`. It is decoded, not cryptographically verified, in both `src/lib/auth/verifySession.ts` and `src/proxy.ts` — worth flagging if a task touches session trust boundaries.
- `realRole` exists only to alias two session roles down to a simpler one for ~500 call sites: `COLLEGE_ADMIN` sessions carry `role: "PRINCIPAL"`, `DEPARTMENT_OFFICE` sessions carry `role: "HOD"`. `realRole` is consulted only for narrow carve-outs (e.g. Dept Office can't appoint/remove HOD leadership).
- Guards in `verifySession.ts`: `requireSuperAdmin()`, `requireManagement()`, `requireRole(...)`, `requireRoleOrHigher(...)`, `requireCollegeContext()` (college-scoped OR global Finance/Purchase via `?collegeId=`), `requireCollegeMember(...)` (the whole hiring pipeline uses this), `requireLocationMember(...)`, `requireLocationOrAdmin(...)`.
- `src/proxy.ts` does **coarse path gating only** (`ROLE_PATH_MAP` + role inheritance via `rolesInheritedBy()`). Real tenant/data isolation is enforced per-route by the guards above, not by the proxy.

## Roles (`src/types/core.ts` → `UserRole`, 29 total)

By level (L0 highest) and scope:
- **L0 global:** `SUPER_ADMIN`
- **L1 global:** `MANAGEMENT`, `FINANCE`, `PURCHASE_DEPT`
- **L2 location:** `ADMINISTRATION`, `HR_ADMIN`, `ADMIN_OFFICE`, `LOCATION_DEPT_HEAD`, `ACCOUNTS`
- **L3 college:** `PRINCIPAL`, `VICE_PRINCIPAL`, `COLLEGE_ADMIN`
- **L4 college (dept/office):** `HOD`, `DEPARTMENT_OFFICE`, `COLLEGE_OFFICE`, `COLLEGE_STAFF`, `ACADEMICS`, `IQAC_COORDINATOR`, `T_AND_P`, `R_AND_D`, `PLACEMENT_DEPT`, `LIBRARY`, `EXAM_CELL`, `WEBMASTER`, `COLLEGE_ACCOUNTS`
- **L5 college:** `PANEL_MEMBER` (UI label **"Faculty"** — there is no separate FACULTY role)
- **L6 college:** `STUDENT`, `CLASS_LEADER`

A role inherits every strictly-lower-level role at the same-or-narrower scope (`rolesInheritedBy()`) — e.g. Principal automatically reaches HOD-adjacent dashboards.

## Dashboard map (`src/app/(dashboard)/`)

One folder per role's own view: `accounts`, `admin-office`, `administration`, `candidate-profile` (shared read-only dossier), `class-leader`, `college-accounts`, `college-office`, `college-staff`, `coordinator`, `academics`, `evaluation` (shared), `exam-cell`, `finance`, `hod`, `hr-admin`, `iqac-coordinator`, `leave` (shared adjustment/handover pages), `library`, `location-dept-head`, `management`, `panel` (shared interview pages — any role can be a hiring panelist), `placement-dept`, `principal`, `purchase`, `r-and-d`, `super-admin`, `t-and-p`, `vice-principal`, `webmaster`.

## Major functional modules (`src/app/api/college/`, ~68 route groups)

- **Hiring pipeline (14 stages)** — fully documented in root `CLAUDE.md`. Don't re-derive it; point Claude there directly.
- **Finance** — `finance-budgets`, `finance-budget-requests`, `finance-expense-requests`, `finance-payments`, `finance-receipts`, `finance-audit-logs`, `finance-reports`, `finance-fund-allocations`, `finance-purchase-clearance`, `salary-structures`/`salary-records`, `budget-cycles`/`budget-requests`. Uses `requireCollegeContext()`; global `FINANCE`/`PURCHASE_DEPT` pass `?collegeId=`.
- **Attendance** — face recognition (`face-api.js`, `src/lib/attendance/faceMatch.ts`) + geofencing (`leaflet`, against the College's `campusLocation` polygon/circle). Routes: `attendance`, `student-attendance`(+`-history`), `section-attendance-report`, `faculty-attendance-completion`.
- **Leave** — a standalone engine at `src/lib/leave/`: `categoryEngine`, `balanceEngine`, `dayCounter`, `holidaysCount`, `lateAttendancePenalty`, `adjustmentRequests`, `odProof`(+`Notify`), `decideFinalStage`, `monthlySummary`, `identity`, `access`. Has real Vitest unit tests (`adjustmentRequests.test.ts`, `odProof.test.ts`).
- **Exam cell** — `exam-configurations`, `internal-exam-marks`, `leave-history-report`.
- **R&D / Research** — `research-profile`, `research-services`, `publications` (typed model: journal/conference/book-chapter/textbook, SDG goals, quartile/indexing, author categories), `citation-metrics`, `consultancy-projects`, `discovery-innovation` (IPR), `innovations`, `hackathons`, `phd-supervision`, `sponsored-projects`, `seed-funding`.
- **Library, Purchase (`indent-requests`), Placement/T&P, IQAC** — mostly dashboard-only, consuming shared leave/attendance/profile APIs rather than dedicated routes.
- **HR Admin** — location-scoped, not college-scoped.
- **Class leader / class-work** — `class-work-records`; `CLASS_LEADER` is bound to one `sectionId`.
- **Notifications** — single shared college-scoped route.
- **Cross-college:** `GET /api/college/colleges-directory` deliberately reads outside the caller's own `collegeId` — gated to publication-eligible roles, powers the co-author affiliation picker in Publications.

## Super-admin (`src/app/(dashboard)/super-admin/`)

Manages `colleges`, `locations`, cross-tenant `users` (any user in any college), a global `vacancies` view, global `audit-logs`, and platform `settings` — confirms this is a true multi-tenant SaaS, not single-college software.

## Conventions worth knowing before editing

- **`src/types/core.ts`** — a single ~2,885-line file holding nearly the entire domain model (roles, College/Department/Course/Designation catalogs, `FacultyMember`, `FMSUser`, publication types, etc.). Too large to paste whole into a prompt — grep it or read by section.
- **Designation & Course Catalog** are college-admin-curated picklists, not hardcoded enums — the "add once, pick everywhere" pattern repeats across the codebase.
- **Departments** support a 2-level sub-department tree (`parentDepartmentId`/`hasSubDepartments`/`managedDepartments`/`secondaryDepartments`), scope resolved via `src/lib/departments/scope.ts`.
- **PDF generation** (`src/lib/pdf/`) is template-based (`htmlToPdf.ts` is the shared renderer), reused for offer/appointment letters, finance reports, candidate profiles, and resumes.
- **Firestore admin access** — `src/lib/firebase/admin.ts`: lazy singleton with `getAdminAuth()`/`getAdminDb()`/`getAdminStorage()` plus an `adminDb` Proxy export for convenience.

## Where to point Claude for depth

| Topic | File(s) |
|---|---|
| Hiring pipeline (stages 1–14) | root `CLAUDE.md` — already fully detailed |
| Domain/data model | `src/types/core.ts` |
| Leave engine | `src/lib/leave/` |
| PDF/letter generation | `src/lib/pdf/` |
| Auth & session | `src/lib/auth/verifySession.ts`, `src/proxy.ts` |
| Firestore helpers | `src/lib/firestore/*.ts` (note: `hiring.ts`/`useHiring.ts` are explicitly NOT part of the documented hiring flow) |

---

*This doc is a living reference — update it as modules change. If something here turns out stale, fix it here rather than re-deriving from scratch next time.*
