<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Commands

```bash
npm run dev      # start dev server (Next.js 16 Turbopack)
npm run build    # production build (Turbopack, ~180s)
npm run lint     # eslint (9)
npm run test     # vitest run (unit)
npm run test:e2e # playwright test (e2e)
```

* `node scripts/bootstrap-admin.mjs` — one-time SUPER_ADMIN promotion (edit UID/EMAIL + service-account path first). `scripts/` now trimmed to 4 files (`ensure-deps.mjs`, `bootstrap-admin.mjs`, `create-admin.mjs`, `lib/departmentRefs.mjs`); historical migrate/backfill/diagnose scripts archived/deleted per 2026-09 cleanup.
* Firestore rules/indexes + Storage rules: `firebase deploy --only firestore:rules` etc.; config in `firebase.json` / `firestore.rules` / `firestore.indexes.json` / `storage.rules`. Indexes now include 8 composites for `studentAttendance` (status+sectionId/date, facultyId/date, subjectId/date, department/date, date).

## Stack

Next.js 16 (App Router, `src/proxy.ts` replaces `middleware.ts` → `proxy()` + `config.matcher`) + React 19 + TypeScript, Tailwind CSS 4, Radix/shadcn `src/components/ui`, Firebase (Auth, Firestore, Storage) via `firebase-admin` server-side, Zustand (`src/store`) + TanStack Query, `nodemailer`, `exceljs`, `jspdf`/`html2canvas` (PDF), `face-api.js` + `leaflet` (attendance), `react-hook-form`/`zod`, `zustand`.

## Architecture

Multi-tenant FMS for a group of colleges — two tenancy axes:

* **Locations** (campus/city) - contain **location-scoped roles**: `ADMINISTRATION`, `HR_ADMIN`, `ADMIN_OFFICE`, `LOCATION_DEPT_HEAD`. Their user profiles live at `locations/{id}/locationUsers/{uid}`.
* **Colleges** (belong to a location) - contain **college-scoped roles**: `PRINCIPAL`, `VICE_PRINCIPAL`, `DIRECTOR`, `HOD`, `COLLEGE_OFFICE`, `PANEL_MEMBER`, `ACCOUNTS`, `FINANCE`, `STUDENT`. Profiles live at `colleges/{id}/users/{uid}`. `DIRECTOR` (like `COLLEGE_ADMIN`) is normalized to `PRINCIPAL` at session time - same dashboard, same permissions, real role preserved via `realRole` - but is Super Admin-provisioned (Add User, L3) rather than Principal-appointed.
* `SUPER_ADMIN` sits above both. A global `systemUsers/{uid}` collection maps uid → role/collegeId/locationId.

All roles, labels, dashboard paths in `src/types/core.ts` (`UserRole`, `ROLE_LABELS`, `ROLE_DASHBOARD_PATHS`, `LOCATION_SCOPED_ROLES`). Domain types in `src/types/*.ts`: `core`, `recruitment`, `attendance`, `studentAttendance`, `circular`, `teaching`, `budget` etc.

**Level-wise login flow (L0–L6).** `src/types/core.ts` also defines a seniority hierarchy: `ROLE_LEVEL` (0=SUPER_ADMIN, 1=MANAGEMENT/FINANCE/PURCHASE_DEPT, 2=location roles + ACCOUNTS, 3=PRINCIPAL/VICE_PRINCIPAL/COLLEGE_ADMIN/DIRECTOR, 4=HOD/COLLEGE_OFFICE, 5=PANEL_MEMBER, 6=STUDENT) and `ROLE_SCOPE` (`GLOBAL`/`LOCATION`/`COLLEGE` - the single source of truth from which `LOCATION_SCOPED_ROLES` is derived; the old duplicated `LOCATION_ROLES` literals now all import this). A higher level **inherits access** to lower-level roles within its own-or-narrower scope: `rolesInheritedBy(role)` and `canRoleAccessRole(actor, target)` express this. This drives coarse path gating in `src/proxy.ts` (via `allowedPathsForRole`) and the opt-in `requireRoleOrHigher(...)` guard - real tenant/data isolation is still enforced by the per-route API guards. Label-only groupings (Academics, T&P, Internal offices, Workers) reuse existing roles and are **not** separate `UserRole` values. NOTE: `ROLE_SCOPE` marks FINANCE/PURCHASE_DEPT as `COLLEGE` and ACCOUNTS as `COLLEGE` because their profile docs still live college-scoped; these flip to `GLOBAL`/`LOCATION` only once the corresponding tenancy migration (Phase 2/3) moves the data - keep `ROLE_SCOPE` in lockstep with where profiles actually live.

### Auth flow

1. Client Firebase Auth (`src/lib/firebase/client.ts`) → `POST /api/auth/session` verifies ID token, resolves role/collegeId/locationId, sets httpOnly `fms-session` cookie (24h base64 JSON, not signed).
2. `src/proxy.ts` gates dashboard pages via `ROLE_PATH_MAP`; does NOT protect `/api/*`.
3. Every API route self-guards via `src/lib/auth/verifySession.ts` (`requireRole`, `requireCollegeMember`, `requireLocationMember`, `requireSuperAdmin`). Bearer routes use `verifyFirebaseToken.ts`.

### Route layout

* `src/app/(dashboard)/<role-path>/…` per role: `super-admin`, `administration`, `hr-admin`, `admin-office`, `location-dept-head`, `principal` (incl. `principal/budget`), `vice-principal`, `hod`, `college-office`, `panel`, `accounts`, `finance`, `circulars/[id]` (dashboard), etc. All fetch from `/api/*`.
* `src/app/api/` split by scope: `admin/` (colleges, locations, users, settings), `college/` (faculty, departments, sections, students, candidates, hiring-batches, attendance `attendance/*`, `student-attendance/*` (now 5 routes: `today-periods`, `route`, `[id]`, `office-correction`, `office-correction/[id]`), `circulars`, `circular-settings`, `circular-permissions`, `section-attendance-report`, `faculty-attendance-completion`, teaching/timetable, leave, budget/finance…), `location/`, `upload/circular` + 15 other upload routes, `auth/`, `pdf/`, `public/`. `student-attendance/current-period` **deleted 2026-09** (replaced by `today-periods`).
* `src/app/(auth)/` `login`; public `login`, `careers/[collegeId]`, `feedback/[id]`, `location-interview/[id]`, `candidate-form/...`, `circulars/[id]` (viewer, print/download).
* Shared `panel/interviews`, `coordinator` (HOD+PANEL_MEMBER).

### Server-side Firebase

`getAdminDb()` / `getAdminAuth()` / `getAdminStorage()` from `src/lib/firebase/admin.ts` in API routes — never client SDK. Creds via `FIREBASE_ADMIN_*`, client via `NEXT_PUBLIC_FIREBASE_*`, email via `SMTP_*`/`EMAIL_FROM`.

### PDF generation

`POST /api/pdf/generate` builds HTML via `src/lib/pdf/` templates and dynamic `puppeteer` (not in `package.json`, absent on Vercel → fallback returns raw HTML download).

### Domain notes

* **Recruitment pipeline** (largest): vacancy → HR/Admin → hiring batch + interviews (panel scoring) → offer letter (PDF) → faculty provisioning. Shared `src/lib/firestore/hiring.ts`, statuses `WorkflowStatus` `src/types/core.ts:241`.
* **Budget/finance**: HOD → Principal freeze → Finance approve/returns + allocation/expense/purchase. Excel via `src/lib/finance/exportExcel.ts`.
* **FacultyMember** (`src/types/core.ts`) central; attendance/payroll/appraisal reference `facultyId`.
* **Supporting Staff** (`src/types/supportingStaff.ts`) is split by `staffCategory`, per college type (`src/lib/designations/config.ts`'s `getHodTechnicalDesignations`/`getNonTechnicalDesignations`/`hasSupportingStaffSplit`): **Technical** is owned by **HOD**, department-scoped, at `hod/supporting-staff/*` (Engineering/Pharmacy/Dental: the 4 `LEGACY_TECHNICAL_DESIGNATIONS`; Degree: Lab Assistant/Programmer/Network I-C; Polytechnic: Sr. Lab Technician/Drawing Assistant/Lab Assistant/Programmer/Computer Operator/Lab Technician). **Non-Technical** (everything else) is owned by **College Office** (`college-office/non-technical-staff/*`, college-wide) and **Principal/VP** (folded into the bottom of `principal/staff`, `principal/staff/non-technical/*`). **School has no split at all** - `hasSupportingStaffSplit` returns `false`, HOD gets no Supporting Staff nav entry/module (`Sidebar.tsx` hides it, the API 403s a Technical create attempt), and all of School's supporting designations (AO/AAO/Clerk/Vehicle In-Charge/Stores In-Charge/Receptionist/Office Assistant) are Non-Technical only. `FacultyMember` (`facultyMembers` collection) is teaching-only - its designation picklist and the Faculty Register's read query both exclude every college type's Technical designations. This split has been reverted and re-decided several times (git history around `9695e9d`/`d60832e`/`2bdebaf`/`192309d`/`426f2e8`) - treat re-opening it as a deliberate decision, not a quick fix.
* **Internal office roles** (`ACADEMICS`, `IQAC_COORDINATOR`, `T_AND_P`, `R_AND_D`, `PLACEMENT_DEPT`, `LIBRARY`, `EXAM_CELL`, `WEBMASTER` - each a real `UserRole` with its own login/dashboard, not just a designation label; `ACADEMICS` was renamed from `DEAN` - see the `dean/*` → `academics/*` route rename) gated by college type via `src/lib/roles/officeRoles.ts`'s `getCreatableOfficeRoles`: Engineering/Pharmacy/Dental get all 8; Degree gets IQAC Coordinator/Placement Dept/Library/Exam Cell; Polytechnic gets Placement Dept/Library; School gets none. Enforced both client-side (role pickers) and server-side (`api/college/users` POST) - keep both in sync if this list changes.
* **Academic structure** derived, never stored - `src/lib/college/academicStructure.ts` (`getAcademicStructure` server-side, `structureFromDepartments` for callers that already hold the departments list) is the single source of truth. A college runs a **shared first year** when some active top-level department claims year 1 in `assignedYears` *and* acts as a shared parent (`hasSubDepartments` or a non-empty `secondaryDepartments`) - e.g. "Basic Science" split into BS-Maths/BS-English sub-departments, each given whole branches via `managedDepartments`. Everything else is **department-direct**. A first-year student **always keeps their real branch** in `student.department`; a sub-department is a *management view* only (`getHodDepartmentScope`), never the student's own department. **A branch may be grouped under at most ONE sub-department** (`src/lib/departments/managedBranches.ts`, 409 + transaction). `commonYearStart/commonYearEnd` advisory only. Cohort ops: `students/distribute-cohort`, `advance-year` (409 naming every missing target section, `dryRun` preflight), `promote` share `evenSplit.ts`/`departmentHistory.ts`/`ChunkedBatch`.
* **Attendance — faculty self** (`src/types/attendance.ts`, `src/lib/attendance/istTime.ts` IST `Asia/Kolkata` truth, `faceMatch.ts` EAR 0.92/yaw 0.12 + liveness, `geofence.ts` haversine/polygon, `workingDays.ts` per-role Sunday override now `istMidnightUTC`/`istDateKey` fixed 2026-09 `report/route.ts:147` no longer mislabels overridden Sunday HOLIDAY, `fillMissingDays.ts`, `closeMissedCheckouts.ts`, `lateStatus.ts` 09:05 cutoff `recordLateCheckIn` transactional `lateAttendancePenalty.ts` now idempotent via `runTransaction` in `check-in/route.ts:79`, `check-in-permission` now `PRINCIPAL/VP→HOD/unit-head` cascade): `POST check-in/check-out` (geofence+leave/holiday/Sunday gates + `recordLateCheckIn` try/catch), `GET report` (HOD dept tree vs Principal college-wide), `POST manual` (1-tier cascade + 25th payroll lock + audit+notify).
* **Attendance — student** (`src/types/studentAttendance.ts` `id=assign_date_period`, `src/types/teaching.ts` `TimetableSlot`): `today-periods` (all today periods with `isOpen` IST, substitute-aware `resolveSubstituteSlotsForDate` in `currentPeriod.ts:106`, and split-lab `labBatch` awareness), `POST` (early-return for an already-SUBMITTED session, transactional read+roster-merge+write `db.runTransaction`, blank-section explicit 400), `PATCH [id]` (version `expectedUpdatedAt` →409, 0-student allow with notes, `IN_PROGRESS` `periodAttendanceStatus.ts:9`), `office-correction` (HOD on-behalf). Reports `section-attendance-report` now `absentOnly/shortage/threshold/consolidated/dailyPercent`, `faculty-attendance-completion` now supports `from/to|allTime|year+month` ranges. Student DAG `StudentRecord` → `fetchSectionStudents` (primary + `secondaryDepartment` merge, `labBatch`-scoped for split lab periods) → `StudentAttendanceSession` → `today-periods` → write gates (`WRONG_DATE/NOT_SCHEDULED/OUTSIDE_WINDOW/PERIOD_MISMATCH`).
* **Circulars** (new 2026-09, SOLID decoupled `src/types/circular.ts`, `src/lib/circular/`): `Circular {subject, body, date, audience{employeeType:TEACHING|NON_TEACHING|ALL, departmentIds}, messageFrom, attachments, status:DRAFT|PUBLISHED}`, `CircularSettings {messageFromOptions: default Management/Principal/Academics/HOD, editable by Principal}`, `CircularPermissionsDoc {allowedUids, allowedRoles}` (PRINCIPAL/VP always allowed, others via allow-list). Routes `circulars` (list/create), `circulars/[id]` (view), `circulars/[id]/publish` (flip + `notifyAudience` `CIRCULAR_PUBLISHED` → `/circulars/{id}`), `circular-settings`, `circular-permissions`, `upload/circular` (Storage `colleges/{id}/circulars/`). UI `CircularCard` (abstraction over Card), `CircularForm` (`employeeType`/`departments`/`date`/`subject`/`body`/`messageFrom`/`FileUpload onFileSelect` + Save Draft/Publish), `CircularViewer` (subject as notification title, click → page with `print`/`download` same HTML). Nav `Megaphone` for `PRINCIPAL/HOD/PANEL_MEMBER` (`navConfig.ts`).
* **Timetable**: `CourseYearTiming id=courseId_yearN` (collegeStart/End, `periods[]`, `semesters[]`), `TeachingAssignment` (course/section vs semester shapes, `semester` vs `assignmentSemester` distinct), `TimetableSlot {day MON-SAT, periodNumber, semester/academicYear, labBatch}` + `TimetableDraft` (outside `timetableSlots` until `publish`), `TimetableRules` (workingDays, maxPerDay…). Authority `timetableSlots` where `facultyId==facultyMemberId` OR `substituteFacultyId` per `periodCoverage.ts`.

Cross-cutting writes create `AuditLog` + `AppNotification` per `src/types/core.ts` unions (each domain module - recruitment, payroll, appraisal, grievance, budget - adds its own variants to these unions).

### UI conventions

`src/components/shared` (`DataTable`, `PageHeader`, `StatusBadge`, `FileUpload`, …), `src/components/circular` (`CircularCard`, `CircularForm`, `CircularViewer`), layout `src/components/layout` (`Sidebar`, `TopBar`, `BottomNav`, `MobileDrawer`) via `navConfig.ts` (now `Circulars`, `Absent/Shortage/Faculty Not Posted` for HOD/Principal), finance in `src/components/finance`, notifications in `src/components/notifications`. Toasts `useToast()`, auth `useAuth()`+`authStore` (Zustand). Mobile via `useMobile`/`MobileCard`. Previous `docs/` (`docs/hiring/*.doc`) and root `*.excalidraw`/`ATTENDANCE_MODULE_COMPLETE_ARCHITECTURE.md` archived/deleted 2026-09; `scripts/` trimmed to `ensure-deps.mjs`/`bootstrap-admin.mjs`/`create-admin.mjs`/`lib/departmentRefs.mjs` (historical migrate/backfill removed).

### Docs

Root context is this `AGENTS.md` (single source). `CLAUDE.md` (hiring pipeline) and `PROJECT_OVERVIEW.md` removed 2026-09 — see git history `git log --follow -- CLAUDE.md`. No `README.md` at root.
