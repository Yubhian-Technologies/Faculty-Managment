<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Commands

```bash
npm run dev      # start dev server (Next.js)
npm run build    # production build
npm run lint     # eslint
```

There is no test framework configured - do not invent test commands.

- `node scripts/bootstrap-admin.mjs` - one-time script to promote a Firebase Auth user to SUPER_ADMIN (edit the UID/EMAIL constants and the service-account path inside it first).
- Firestore rules/indexes and Storage rules deploy via the Firebase CLI (`firebase deploy --only firestore:rules` etc.); config is in `firebase.json` / `firestore.rules`.

## Stack

Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS 4, Radix/shadcn-style UI in `src/components/ui`, Firebase (Auth, Firestore, Storage) with `firebase-admin` on the server, Zustand (`src/store`) + TanStack Query for client state, `nodemailer` for email, `exceljs` for spreadsheet export, Puppeteer for PDF generation (optional-at-runtime - see PDF generation below).

**Next.js 16 breaking changes apply.** Notably, `src/proxy.ts` is this version's replacement for `middleware.ts` (exports `proxy()` + `config.matcher`). Read `node_modules/next/dist/docs/` before assuming an API works like older Next.js.

## Architecture

This is a multi-tenant Faculty Management System (FMS) for a group of colleges. Tenancy has two axes:

- **Locations** (campus/city) - contain **location-scoped roles**: `ADMINISTRATION`, `HR_ADMIN`, `ADMIN_OFFICE`, `LOCATION_DEPT_HEAD`. Their user profiles live at `locations/{id}/locationUsers/{uid}`.
- **Colleges** (belong to a location) - contain **college-scoped roles**: `PRINCIPAL`, `VICE_PRINCIPAL`, `HOD`, `COLLEGE_OFFICE`, `PANEL_MEMBER`, `ACCOUNTS`, `FINANCE`, `STUDENT`. Profiles live at `colleges/{id}/users/{uid}`.
- `SUPER_ADMIN` sits above both. A global `systemUsers/{uid}` collection maps uid → role/collegeId/locationId.

All roles, their labels, and their dashboard home paths are defined in `src/types/core.ts` (`UserRole`, `ROLE_LABELS`, `ROLE_DASHBOARD_PATHS`, `LOCATION_SCOPED_ROLES`). Domain types for each module live in `src/types/*.ts`: `core`, `recruitment`, `attendance`, `payroll`, `appraisal`, `grievance`, `teaching`, `training`, `budget`, `finance`, `documents`.

**Level-wise login flow (L0–L6).** `src/types/core.ts` also defines a seniority hierarchy: `ROLE_LEVEL` (0=SUPER_ADMIN, 1=MANAGEMENT/FINANCE/PURCHASE_DEPT, 2=location roles + ACCOUNTS, 3=PRINCIPAL/VICE_PRINCIPAL, 4=HOD/COLLEGE_OFFICE, 5=PANEL_MEMBER, 6=STUDENT) and `ROLE_SCOPE` (`GLOBAL`/`LOCATION`/`COLLEGE` - the single source of truth from which `LOCATION_SCOPED_ROLES` is derived; the old duplicated `LOCATION_ROLES` literals now all import this). A higher level **inherits access** to lower-level roles within its own-or-narrower scope: `rolesInheritedBy(role)` and `canRoleAccessRole(actor, target)` express this. This drives coarse path gating in `src/proxy.ts` (via `allowedPathsForRole`) and the opt-in `requireRoleOrHigher(...)` guard - real tenant/data isolation is still enforced by the per-route API guards. Label-only groupings (Deans, T&P, Internal offices, Workers) reuse existing roles and are **not** separate `UserRole` values. NOTE: `ROLE_SCOPE` marks FINANCE/PURCHASE_DEPT as `COLLEGE` and ACCOUNTS as `COLLEGE` because their profile docs still live college-scoped; these flip to `GLOBAL`/`LOCATION` only once the corresponding tenancy migration (Phase 2/3) moves the data - keep `ROLE_SCOPE` in lockstep with where profiles actually live.

### Auth flow

1. Client signs in with Firebase Auth (`src/lib/firebase/client.ts`), then POSTs the ID token to `/api/auth/session`.
2. The route verifies the token, resolves role/collegeId/locationId (custom claims fast path, `systemUsers` Firestore fallback, then backfills custom claims), and sets an httpOnly `fms-session` cookie (24h). The cookie is a base64 JSON payload in JWT-shaped wrapping - it is **not** cryptographically signed or verified.
3. `src/proxy.ts` gates dashboard pages by role via `ROLE_PATH_MAP` and redirects unauthenticated users to `/login`. It does NOT protect `/api/*`.
4. Every API route protects itself with helpers from `src/lib/auth/verifySession.ts`: `requireRole`, `requireCollegeMember` (college-scoped), `requireLocationMember` (location-scoped), `requireLocationOrAdmin`, `requireSuperAdmin`. Follow this pattern in any new API route. Non-session (bearer-token) requests, e.g. from the PDF route, verify via `src/lib/auth/verifyFirebaseToken.ts` instead.

### Route layout

- `src/app/(dashboard)/<role-path>/…` - one route group per role: `super-admin`, `administration`, `hr-admin`, `admin-office`, `location-dept-head`, `principal` (incl. `principal/budget` for Vice Principal budget freeze), `vice-principal`, `hod`, `college-office`, `panel`, `accounts`, `finance`, `coordinator`. Pages are client components that fetch from the API routes.
- `src/app/api/` is split by scope, mirroring tenancy: `admin/` (super admin - colleges, locations, users, settings, audit-logs, general-admin-vacancies), `college/` (college-scoped - faculty, departments, sections, candidates, hiring-batches, vacancy-requests, offer-letters, leave-applications, attendance, teaching-assignments, salary-records, notifications, budget-requests, finance-* endpoints), `location/` (location-scoped - users, departments, candidates, vacancy-requests, interviews, offers), `administration/principals`, plus `leave/`, `auth/`, `email/`, `pdf/`, `upload/`, `public/`.
- `src/app/(auth)/` - the `/login` page.
- Public (no-login) pages: `/login`, `/careers/[collegeId]` (candidate application), `/feedback/[id]` (student feedback), `/location-interview/[id]`, `/candidate-form/[collegeId]/[candidateId]` (candidate self-service bio-data/certificates, linked from the interview call letter).
- `/panel/interviews` is intentionally shared: any staff role added to an interview panel may access it (see `ROLE_PATH_MAP` in `src/proxy.ts`). `/coordinator` is similarly shared between `HOD` and `PANEL_MEMBER`.

### Server-side Firebase

Use `getAdminDb()` / `getAdminAuth()` / `getAdminStorage()` (or the lazy `adminDb` / `adminStorage` proxies) from `src/lib/firebase/admin.ts` in API routes - never the client SDK. Credentials come from `FIREBASE_ADMIN_*` env vars; client SDK config from `NEXT_PUBLIC_FIREBASE_*`; email from `SMTP_*` / `EMAIL_FROM` (see `.env`).

### PDF generation

`POST /api/pdf/generate` (`src/app/api/pdf/generate/route.ts`) builds HTML via templates in `src/lib/pdf/` (`offerLetterTemplate.ts`, `financeReportTemplate.ts` - offer/appointment letters, finance reports/receipts) and renders it with a **dynamically imported** `puppeteer` (not a `package.json` dependency, so it's absent on serverless hosts like Vercel). If the import fails, the route falls back to returning the raw HTML as a downloadable file instead of a PDF - keep that fallback in mind when changing this route.

### Domain notes

- **Recruitment pipeline** is the largest module: vacancy request → approval (HR/Admin) → hiring batch + interviews (panel scoring) → decision → offer letter (PDF, emailed) → faculty provisioning. Shared logic in `src/lib/firestore/hiring.ts` and `src/hooks/useHiring*.ts`; statuses in `WorkflowStatus` (`src/types/core.ts`).
- **Budget/finance module** (newest module): HOD submits a budget request → Principal reviews/freezes it (L1, under `/principal/budget`; Vice Principal shares this path) → Finance approves/rejects/returns and manages fund allocation, expense requests, purchase clearance, payments, and receipts (`FINANCE` role, `/finance/*` pages and `college/finance-*` API routes). Excel export via `src/lib/finance/exportExcel.ts`.
- **FacultyMember** (`src/types/core.ts`) is the central entity; attendance, payroll, and appraisal records all reference `facultyId`.
- **Supporting Staff** (`src/types/supportingStaff.ts`) is split by `staffCategory`, per college type (`src/lib/designations/config.ts`'s `getHodTechnicalDesignations`/`getNonTechnicalDesignations`/`hasSupportingStaffSplit`): **Technical** is owned by **HOD**, department-scoped, at `hod/supporting-staff/*` (Engineering/Pharmacy/Dental: the 4 `LEGACY_TECHNICAL_DESIGNATIONS`; Degree: Lab Assistant/Programmer/Network I-C; Polytechnic: Sr. Lab Technician/Drawing Assistant/Lab Assistant/Programmer/Computer Operator/Lab Technician). **Non-Technical** (everything else) is owned by **College Office** (`college-office/non-technical-staff/*`, college-wide) and **Principal/VP** (folded into the bottom of `principal/staff`, `principal/staff/non-technical/*`). **School has no split at all** - `hasSupportingStaffSplit` returns `false`, HOD gets no Supporting Staff nav entry/module (`Sidebar.tsx` hides it, the API 403s a Technical create attempt), and all of School's supporting designations (AO/AAO/Clerk/Vehicle In-Charge/Stores In-Charge/Receptionist/Office Assistant) are Non-Technical only. `FacultyMember` (`facultyMembers` collection) is teaching-only - its designation picklist and the Faculty Register's read query both exclude every college type's Technical designations. `DesignationOptions`' `kind="non-technical"` (vs `"supporting"`, the full list - still used by Salary Structures/Budget) is what actually excludes the Technical subset from College Office/Principal's Add-staff picker. This exact split has been reverted and re-decided several times (see git history around commits `9695e9d`/`d60832e`/`2bdebaf`/`192309d`/`426f2e8`) - treat re-opening it as a deliberate decision, not a quick fix, and update this paragraph if it changes again.
- **Internal office roles** (`DEAN`, `IQAC_COORDINATOR`, `T_AND_P`, `R_AND_D`, `PLACEMENT_DEPT`, `LIBRARY`, `EXAM_CELL`, `WEBMASTER` - each a real `UserRole` with its own login/dashboard, not just a designation label) are also gated by college type via `src/lib/roles/officeRoles.ts`'s `getCreatableOfficeRoles`: Engineering/Pharmacy/Dental get all 8; Degree gets IQAC Coordinator/Placement Dept/Library/Exam Cell; Polytechnic gets Placement Dept/Library; School gets none. Enforced both client-side (`principal/staff/new/page.tsx`'s role picker, `administration/colleges/[id]/staff/new/page.tsx`'s) and server-side (`api/college/users` POST, `api/administration/college-staff` POST) - keep both in sync if this list changes.
- **Academic structure** comes in two shapes, and is **derived, never stored** - `src/lib/college/academicStructure.ts` is the single source of truth (`getAcademicStructure` server-side, `structureFromDepartments` for callers that already hold the departments list, including the client). A college runs a **shared first year** when some active top-level department claims year 1 in `assignedYears` *and* acts as a shared parent (`hasSubDepartments` or a non-empty `secondaryDepartments`) - e.g. "Basic Science" split into BS-Maths/BS-English sub-departments, each given whole branches via `managedDepartments`. Everything else is **department-direct** (each branch runs all its own years). Never re-infer this rule inline - if it must change, change that helper.
  - A first-year student **always keeps their real branch**: `student.department` stays `"IT"` and they sit in an `"IT"` section. A sub-department is a *management view* reaching them through `Department.managedDepartments` → `getHodDepartmentScope`, never their department. This is what keeps the `(department, section, year)` triple that students/sections/attendance/internal-marks all join on intact.
  - **A branch may be grouped under at most ONE sub-department.** Enforced in `college/departments` POST/PATCH via `src/lib/departments/managedBranches.ts` (409), re-checked inside a `runTransaction` so concurrent claims can't both win, and mirrored client-side (already-claimed branches render disabled) on `hod/settings/sub-departments`.
  - `Department.commonYearStart`/`commonYearEnd` (yyyy-mm-dd) hold the approximate shared-first-year period. **Advisory only** - they give the Principal's cohort-advance panel its context and never gate a write.
  - Cohort operations: `college/students/distribute-cohort` sections a whole shared year in one action (each student into their *own* branch's sections; branches with no sections are reported, not failed), and `college/students/advance-year` moves a whole year up keeping branch **and** section letter, refusing with a 409 that names every missing target section rather than creating any (`dryRun: true` returns the same report as a 200 to preflight). `college/students/promote` remains the per-student override and the graduation path. All three share `src/lib/students/evenSplit.ts` / `departmentHistory.ts` / `ChunkedBatch`.
- Cross-cutting writes should create an `AuditLog` entry and `AppNotification`s, matching the existing `AuditAction` / `NotificationType` unions in `src/types/core.ts` (each domain module - recruitment, payroll, appraisal, grievance, budget - adds its own variants to these unions).

### UI conventions

Shared building blocks in `src/components/shared` (`DataTable`, `PageHeader`, `StatusBadge`, `ConfirmDialog`, `FileUpload`, …); layout shell (`Sidebar`, `TopBar`, `BottomNav`, `MobileDrawer`, role-based nav) in `src/components/layout` driven by `navConfig.ts`; finance-specific components in `src/components/finance`, notification UI in `src/components/notifications`. Toasts via `useToast()`; auth state via `useAuth()` + `authStore` (Zustand, `src/store`). Pages are mobile-responsive (`useMobile`, `MobileCard`).
