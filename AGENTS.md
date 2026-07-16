<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Commands

```bash
npm run dev      # start dev server (Next.js)
npm run build    # production build
npm run lint     # eslint
```

There is no test framework configured — do not invent test commands.

- `node scripts/bootstrap-admin.mjs` — one-time script to promote a Firebase Auth user to SUPER_ADMIN (edit the UID/EMAIL constants and the service-account path inside it first).
- Firestore rules/indexes and Storage rules deploy via the Firebase CLI (`firebase deploy --only firestore:rules` etc.); config is in `firebase.json` / `firestore.rules`.

## Stack

Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS 4, Radix/shadcn-style UI in `src/components/ui`, Firebase (Auth, Firestore, Storage) with `firebase-admin` on the server, Zustand (`src/store`) + TanStack Query for client state, `nodemailer` for email, `exceljs` for spreadsheet export, Puppeteer for PDF generation (optional-at-runtime — see PDF generation below).

**Next.js 16 breaking changes apply.** Notably, `src/proxy.ts` is this version's replacement for `middleware.ts` (exports `proxy()` + `config.matcher`). Read `node_modules/next/dist/docs/` before assuming an API works like older Next.js.

## Architecture

This is a multi-tenant Faculty Management System (FMS) for a group of colleges. Tenancy has two axes:

- **Locations** (campus/city) — contain **location-scoped roles**: `ADMINISTRATION`, `HR_ADMIN`, `ADMIN_OFFICE`, `LOCATION_DEPT_HEAD`. Their user profiles live at `locations/{id}/locationUsers/{uid}`.
- **Colleges** (belong to a location) — contain **college-scoped roles**: `PRINCIPAL`, `VICE_PRINCIPAL`, `HOD`, `COLLEGE_OFFICE`, `PANEL_MEMBER`, `ACCOUNTS`, `FINANCE`, `STUDENT`. Profiles live at `colleges/{id}/users/{uid}`.
- `SUPER_ADMIN` sits above both. A global `systemUsers/{uid}` collection maps uid → role/collegeId/locationId.

All roles, their labels, and their dashboard home paths are defined in `src/types/core.ts` (`UserRole`, `ROLE_LABELS`, `ROLE_DASHBOARD_PATHS`, `LOCATION_SCOPED_ROLES`). Domain types for each module live in `src/types/*.ts`: `core`, `recruitment`, `leave`, `attendance`, `payroll`, `appraisal`, `grievance`, `teaching`, `training`, `budget`, `finance`, `documents`.

**Level-wise login flow (L0–L6).** `src/types/core.ts` also defines a seniority hierarchy: `ROLE_LEVEL` (0=SUPER_ADMIN, 1=MANAGEMENT/FINANCE/PURCHASE_DEPT, 2=location roles + ACCOUNTS, 3=PRINCIPAL/VICE_PRINCIPAL, 4=HOD/COLLEGE_OFFICE, 5=PANEL_MEMBER, 6=STUDENT) and `ROLE_SCOPE` (`GLOBAL`/`LOCATION`/`COLLEGE` — the single source of truth from which `LOCATION_SCOPED_ROLES` is derived; the old duplicated `LOCATION_ROLES` literals now all import this). A higher level **inherits access** to lower-level roles within its own-or-narrower scope: `rolesInheritedBy(role)` and `canRoleAccessRole(actor, target)` express this. This drives coarse path gating in `src/proxy.ts` (via `allowedPathsForRole`) and the opt-in `requireRoleOrHigher(...)` guard — real tenant/data isolation is still enforced by the per-route API guards. Label-only groupings (Deans, T&P, Internal offices, Workers) reuse existing roles and are **not** separate `UserRole` values. NOTE: `ROLE_SCOPE` marks FINANCE/PURCHASE_DEPT as `COLLEGE` and ACCOUNTS as `COLLEGE` because their profile docs still live college-scoped; these flip to `GLOBAL`/`LOCATION` only once the corresponding tenancy migration (Phase 2/3) moves the data — keep `ROLE_SCOPE` in lockstep with where profiles actually live.

### Auth flow

1. Client signs in with Firebase Auth (`src/lib/firebase/client.ts`), then POSTs the ID token to `/api/auth/session`.
2. The route verifies the token, resolves role/collegeId/locationId (custom claims fast path, `systemUsers` Firestore fallback, then backfills custom claims), and sets an httpOnly `fms-session` cookie (24h). The cookie is a base64 JSON payload in JWT-shaped wrapping — it is **not** cryptographically signed or verified.
3. `src/proxy.ts` gates dashboard pages by role via `ROLE_PATH_MAP` and redirects unauthenticated users to `/login`. It does NOT protect `/api/*`.
4. Every API route protects itself with helpers from `src/lib/auth/verifySession.ts`: `requireRole`, `requireCollegeMember` (college-scoped), `requireLocationMember` (location-scoped), `requireLocationOrAdmin`, `requireSuperAdmin`. Follow this pattern in any new API route. Non-session (bearer-token) requests, e.g. from the PDF route, verify via `src/lib/auth/verifyFirebaseToken.ts` instead.

### Route layout

- `src/app/(dashboard)/<role-path>/…` — one route group per role: `super-admin`, `administration`, `hr-admin`, `admin-office`, `location-dept-head`, `principal` (incl. `principal/budget` for Vice Principal budget freeze), `vice-principal`, `hod`, `college-office`, `panel`, `accounts`, `finance`, `coordinator`. Pages are client components that fetch from the API routes.
- `src/app/api/` is split by scope, mirroring tenancy: `admin/` (super admin — colleges, locations, users, settings, audit-logs, general-admin-vacancies), `college/` (college-scoped — faculty, departments, sections, candidates, hiring-batches, vacancy-requests, offer-letters, leave-applications, attendance, teaching-assignments, salary-records, notifications, budget-requests, finance-* endpoints), `location/` (location-scoped — users, departments, candidates, vacancy-requests, interviews, offers), `administration/principals`, plus `leave/`, `auth/`, `email/`, `pdf/`, `upload/`, `public/`.
- `src/app/(auth)/` — the `/login` page.
- Public (no-login) pages: `/login`, `/careers/[collegeId]` (candidate application), `/feedback/[id]` (student feedback), `/location-interview/[id]`.
- `/panel/interviews` is intentionally shared: any staff role added to an interview panel may access it (see `ROLE_PATH_MAP` in `src/proxy.ts`). `/coordinator` is similarly shared between `HOD` and `PANEL_MEMBER`.

### Server-side Firebase

Use `getAdminDb()` / `getAdminAuth()` / `getAdminStorage()` (or the lazy `adminDb` / `adminStorage` proxies) from `src/lib/firebase/admin.ts` in API routes — never the client SDK. Credentials come from `FIREBASE_ADMIN_*` env vars; client SDK config from `NEXT_PUBLIC_FIREBASE_*`; email from `SMTP_*` / `EMAIL_FROM` (see `.env`).

### PDF generation

`POST /api/pdf/generate` (`src/app/api/pdf/generate/route.ts`) builds HTML via templates in `src/lib/pdf/` (`offerLetterTemplate.ts`, `financeReportTemplate.ts` — offer/appointment letters, finance reports/receipts) and renders it with a **dynamically imported** `puppeteer` (not a `package.json` dependency, so it's absent on serverless hosts like Vercel). If the import fails, the route falls back to returning the raw HTML as a downloadable file instead of a PDF — keep that fallback in mind when changing this route.

### Domain notes

- **Recruitment pipeline** is the largest module: vacancy request → approval (HR/Admin) → hiring batch + interviews (panel scoring) → decision → offer letter (PDF, emailed) → faculty provisioning. Shared logic in `src/lib/firestore/hiring.ts` and `src/hooks/useHiring*.ts`; statuses in `WorkflowStatus` (`src/types/core.ts`).
- **Leave engine** lives in `src/lib/leave/` (`balanceEngine`, `ruleEngine`, `dayCounter`, `seedData`) — leave math belongs there, not in routes/pages.
- **Budget/finance module** (newest module): HOD submits a budget request → Principal reviews/freezes it (L1, under `/principal/budget`; Vice Principal shares this path) → Finance approves/rejects/returns and manages fund allocation, expense requests, purchase clearance, payments, and receipts (`FINANCE` role, `/finance/*` pages and `college/finance-*` API routes). Excel export via `src/lib/finance/exportExcel.ts`.
- **FacultyMember** (`src/types/core.ts`) is the central entity; leave, attendance, payroll, and appraisal records all reference `facultyId`.
- Cross-cutting writes should create an `AuditLog` entry and `AppNotification`s, matching the existing `AuditAction` / `NotificationType` unions in `src/types/core.ts` (each domain module — recruitment, leave, payroll, appraisal, grievance, budget — adds its own variants to these unions).

### UI conventions

Shared building blocks in `src/components/shared` (`DataTable`, `PageHeader`, `StatusBadge`, `ConfirmDialog`, `FileUpload`, …); layout shell (`Sidebar`, `TopBar`, `BottomNav`, `MobileDrawer`, role-based nav) in `src/components/layout` driven by `navConfig.ts`; finance-specific components in `src/components/finance`, notification UI in `src/components/notifications`. Toasts via `useToast()`; auth state via `useAuth()` + `authStore` (Zustand, `src/store`). Pages are mobile-responsive (`useMobile`, `MobileCard`).
