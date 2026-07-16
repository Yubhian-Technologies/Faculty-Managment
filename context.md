# Faculty Management System (FMS) — Repository Context

A multi-tenant Faculty Management System for a group of colleges, covering recruitment,
leave, payroll, appraisal, grievance, attendance, teaching load, training, budget, and a
read-only faculty-analytics "Management" dashboard.

## Tech Stack

- **Framework**: Next.js 16.2.9 (App Router, Turbopack), React 19.2.4, TypeScript 5
- **Styling/UI**: Tailwind CSS 4, Radix primitives wrapped as shadcn-style components in `src/components/ui`
- **Backend/Data**: Firebase Auth + Firestore + Storage; `firebase-admin` on the server, `firebase` client SDK in the browser
- **State**: Zustand (`src/store`) for client/auth state, TanStack Query for server-state caching
- **Other**: nodemailer (email), puppeteer/pdf templates (offer letters, finance reports), exceljs (finance export), react-hook-form + zod

> **Next.js 16 has breaking changes vs. older versions/training data** — `src/proxy.ts` replaces `middleware.ts` (exports `proxy()` + `config.matcher`). Check `node_modules/next/dist/docs/` before assuming an API behaves like older Next.js.

### Commands

```bash
npm run dev      # dev server
npm run build    # production build
npm run lint     # eslint
```

No test framework is configured — don't invent test commands. Verification for changes is `npx tsc --noEmit` + `npm run build` + manual browser walkthrough.

- `node scripts/bootstrap-admin.mjs` — one-time script to promote a Firebase Auth user to SUPER_ADMIN.
- Firestore rules/indexes/Storage rules deploy via Firebase CLI (`firebase deploy --only firestore:rules`); config in `firebase.json` / `firestore.rules` / `firestore.indexes.json`.

## Tenancy Model

Two axes of tenancy, plus a system layer above both:

- **Locations** (campus/city) — contain **location-scoped roles**: `ADMINISTRATION`, `HR_ADMIN`, `ADMIN_OFFICE`, `LOCATION_DEPT_HEAD`. Profiles at `locations/{id}/locationUsers/{uid}`.
- **Colleges** (belong to a location) — contain **college-scoped roles**: `PRINCIPAL`, `VICE_PRINCIPAL`, `HOD`, `COLLEGE_OFFICE`, `PANEL_MEMBER`, `ACCOUNTS`, `FINANCE`, `STUDENT`. Profiles at `colleges/{id}/users/{uid}`.
- **`SUPER_ADMIN`** sits above both; a global `systemUsers/{uid}` collection maps uid → role/collegeId/locationId.
- **`MANAGEMENT`** is a read-only cross-college analytics role (added most recently) — views faculty/staff/department data across colleges without belonging to a specific tenant.

All roles, labels, and dashboard home paths: `UserRole`, `ROLE_LABELS`, `ROLE_DASHBOARD_PATHS`, `LOCATION_SCOPED_ROLES` in `src/types/core.ts`.

| Role | Dashboard | Scope |
|---|---|---|
| SUPER_ADMIN | `/super-admin` | system |
| MANAGEMENT | `/management` | cross-college, read-only |
| ADMINISTRATION | `/administration` | location |
| HR_ADMIN | `/hr-admin` | location |
| ADMIN_OFFICE | `/admin-office` | location |
| LOCATION_DEPT_HEAD | `/location-dept-head` | location |
| PRINCIPAL | `/principal` | college |
| VICE_PRINCIPAL | `/vice-principal` | college |
| HOD | `/hod` | college |
| COLLEGE_OFFICE | `/college-office` | college |
| PANEL_MEMBER | `/panel` | college |
| ACCOUNTS | `/accounts` | college |
| FINANCE | `/finance` | college |
| STUDENT | `/feedback` | public/no-login |

## Auth Flow

1. Client signs in with Firebase Auth (`src/lib/firebase/client.ts`), POSTs the ID token to `/api/auth/session`.
2. That route verifies the token, resolves role/collegeId/locationId (custom claims fast path → `systemUsers` Firestore fallback → backfills custom claims), sets an httpOnly `fms-session` cookie (24h). The cookie is base64 JSON in JWT-shaped wrapping — **not** cryptographically signed.
3. `src/proxy.ts` gates dashboard pages by role via `ROLE_PATH_MAP` (prefix-matched, e.g. `PRINCIPAL: ["/principal", ...]` covers every `/principal/*` subroute) and redirects unauthenticated users to `/login`. It does **not** protect `/api/*`. Higher levels additionally inherit lower dashboards within scope via `allowedPathsForRole` (see Level-wise flow below).

**Level-wise login flow (L0–L6).** `src/types/core.ts` defines `ROLE_LEVEL` (seniority rank), `ROLE_SCOPE` (`GLOBAL`/`LOCATION`/`COLLEGE`, the single source `LOCATION_SCOPED_ROLES` is derived from), and helpers `rolesInheritedBy` / `canRoleAccessRole`. A higher-level role inherits access to lower-level roles in its own-or-narrower scope, wired into `proxy.ts` (`allowedPathsForRole`) and the opt-in `requireRoleOrHigher()` guard in `verifySession.ts`. Existing explicit `requireCollegeMember`/`requireLocationMember` guards are unchanged. `ROLE_SCOPE` tracks where profile docs actually live (FINANCE/PURCHASE_DEPT/ACCOUNTS still `COLLEGE` until their Phase 2/3 tenancy migration).
4. Every API route must protect itself via `src/lib/auth/verifySession.ts`: `requireRole`, `requireCollegeMember`, `requireLocationMember`, `requireSuperAdmin`. This is the pattern to follow for any new route — the proxy alone is not sufficient.

Server-side Firebase access: `getAdminDb()` / `getAdminAuth()` / `getAdminStorage()` (or lazy `adminDb`/`adminStorage` proxies) from `src/lib/firebase/admin.ts` — never the client SDK in API routes. Env vars: `FIREBASE_ADMIN_*` (admin), `NEXT_PUBLIC_FIREBASE_*` (client), `SMTP_*`/`EMAIL_FROM` (email).

## Route Layout

- `src/app/(dashboard)/<role-path>/…` — one route group per role: `accounts`, `admin-office`, `administration`, `college-office`, `finance`, `hod`, `hr-admin`, `location-dept-head`, `management`, `panel`, `principal`, `super-admin`, `vice-principal`. Pages are client components fetching from API routes.
- `src/app/api/` mirrors tenancy: `admin/` (super admin), `college/` (college-scoped — the largest group, includes all budget/recruitment/leave/attendance/payroll routes), `location/` (location-scoped), `management/` (cross-college read views), plus `leave/`, `auth/`, `email/`, `pdf/`, `upload/`, `public/`.
- Public (no-login) pages: `/login`, `/careers/[collegeId]` (candidate application), `/feedback/[id]` (student feedback), `/location-interview/[id]`.
- `/panel/interviews` is shared: any staff role added to an interview panel can access it (see `ROLE_PATH_MAP` in `src/proxy.ts`).

Nav is centrally defined in `src/components/layout/navConfig.ts` (`NAV_ITEMS`, `BOTTOM_NAV_ITEMS` keyed by role), rendered by the Sidebar/TopBar/BottomNav shell in `src/components/layout`.

## Domain Modules

Types live in `src/types/*.ts`, barrel-exported via `src/types/index.ts`. `FacultyMember` (`core.ts`) is the central entity — leave, attendance, payroll, and appraisal records all reference `facultyId`.

- **Recruitment** (`recruitment.ts`) — the largest module: vacancy request → HR/Admin approval → hiring batch + interviews (panel scoring) → decision → offer letter (PDF, emailed) → faculty provisioning. Shared logic: `src/lib/firestore/hiring.ts`, `src/hooks/useHiring*.ts`. Statuses: `WorkflowStatus` (`core.ts`).
- **Leave** (`leave.ts`) — leave math lives in `src/lib/leave/` (`balanceEngine`, `ruleEngine`, `dayCounter`, `seedData`), not in routes/pages.
- **Attendance** (`attendance.ts`), **Payroll** (`payroll.ts`), **Appraisal** (`appraisal.ts`), **Grievance** (`grievance.ts`), **Teaching** (`teaching.ts`), **Training** (`training.ts`), **Documents** (`documents.ts`) — each self-contained under its type file + matching API/page routes.
- **Finance** (`finance.ts`) — Finance-internal: `FinanceBudget` (allocation ledger), `FinanceBudgetRequest` (a separate manual "log a request" flow, unrelated to the HOD budget workflow below), expense requests, fund allocation, purchase clearance, receipts, reports. PDF/Excel export helpers in `src/lib/pdf/financeReportTemplate.ts` and `src/lib/finance/exportExcel.ts`.
- **Budget** (`budget.ts`) — the HOD → Principal → Finance department budget-proposal workflow. See dedicated section below; this is the most recently built/iterated module.
- **Management dashboard** (cross-college faculty analytics) — read-only views under `/management/[collegeId]/...` (departments, faculty profiles, HOD/Principal/Vice-Principal rosters), backed by `src/app/api/management/`. Added via the `Management_dashboard` branch/PR; extends `FacultyMember`/`FMSUser` with an `academicProfile: FacultyProfileFields` block (Modules 1–5: qualifications, teaching load, publications, grants/patents, mentorship) shared across `src/components/faculty/AcademicProfileFields.tsx` and `ProfileFieldsView.tsx`.

Cross-cutting writes should create an `AuditLog` entry and `AppNotification`s, matching the `AuditAction`/`NotificationType` unions in `core.ts`.

## Budget Module — Deep Dive

The most complex and recently-iterated module. `colleges/{collegeId}/budgetRequests/{id}` — one composite department proposal per submission, not one request per line item.

**Approval state machine** (`BudgetRequestStatus` in `src/types/budget.ts`):

```
HOD submits → PENDING_PRINCIPAL_VERIFICATION
   → Principal/VP: VERIFY → L1_FROZEN → Finance: APPROVE → FINANCE_APPROVED (creates FinanceBudget)
                                        → Finance: REJECT  → FINANCE_REJECTED (terminal)
                                        → Finance: RETURN  → RETURNED_TO_HOD (HOD edits, resubmits)
   → Principal/VP: REJECT → PRINCIPAL_REJECTED (terminal)
   → Principal/VP: RETURN → RETURNED_TO_HOD (HOD edits, resubmits)
```

API: `src/app/api/college/budget-requests/route.ts` (list/create) and `[id]/route.ts` (get/patch — role-branched state machine, Finance approval runs in a Firestore transaction with a fresh status re-read to avoid double-approval races). Every transition writes `history[]`, an `AuditLog`, and notifies the next role.

**Data shape**: `BudgetRequest` has `nonRecurring`/`recurring` arrays of `BudgetCategoryGroup { category, items }`, mirroring the Annexure-2-style department report structure (Non Recurring: Lab Equipment, Other Equipment, Furniture; Recurring: Staff Salaries, Workshops/Seminars, Guest Faculty/Lectures, Dept Forum Activities, Inhouse R&D, Equipment Maintenance, Printing & Stationery, Miscellaneous, plus "Other" in both).

**Dynamic per-category item fields** — the newest, most distinctive part of this module. Every `BudgetRequestItem` always has base `title`/`description`/`price`; each category additionally declares its own extra fields via `CATEGORY_FIELD_CONFIG` (e.g. Quantity+Specification for Lab Equipment, Number-of-Staff-with-×12-yearly-total for Staff Salaries, nothing extra for lump-sum categories like Workshops). HODs can also bolt on ad-hoc per-item custom fields (Text or Number, optionally marked as that item's total multiplier) via "+ Add Field" — these are item-scoped (`item.customFields`), not category-scoped, so two items in the same category can carry different ad-hoc fields. Totals compute via `itemTotal → categoryGroupTotal → sectionTotal → budgetRequestTotal`, all in `src/types/budget.ts`.

Key components (all under `src/components/shared/budget/`, reused identically in edit and read-only modes across every role):
- `BudgetItemsTable.tsx` — renders the schema-driven columns for one category group's items.
- `BudgetCategorySection.tsx` — one section (Non Recurring/Recurring): category picker + list of `BudgetItemsTable`s, handles category-switch field reconciliation.
- `BudgetDepartmentReport.tsx` — Annexure-2-style department-wise rollup (used by both Principal's and Finance's `/budget/report` pages).

Role UIs: HOD (`/hod/budget` — submit/edit), Principal/VP (`/principal/budget` — verify/reject/return, `/principal/budget/report` — dept rollup), Finance (`/finance/budget-approvals` — approve/reject/return at L1_FROZEN, `/finance/budget` — FinanceBudget ledger CRUD + view source request, `/finance/budget/report` — dept rollup).

**Known gap**: no data-migration script. The `BudgetRequestItem`/`BudgetRequest` shape has changed twice in the same session (flat → sectioned → dynamic-fields); `normalizeBudgetRequest()` defensively defaults missing `nonRecurring`/`recurring` arrays so pre-restructure docs don't crash the UI, but any budget requests created under an earlier shape render empty and need re-entry.

## UI Conventions

Shared building blocks: `src/components/shared` (`DataTable`, `PageHeader`, `StatusBadge`, `ConfirmDialog`, `FileUpload`, `EmptyState`, `SkeletonLoader`, …). Layout shell (Sidebar/TopBar/BottomNav) in `src/components/layout`, driven by `navConfig.ts`. Toasts via `useToast()`; auth state via `useAuth()` + `authStore`. Mobile-responsive via `useMobile()` + `MobileCard`. No dedicated Firestore-helper layer for most modules — business logic lives inline in the API routes (`src/app/api/**/route.ts`), not in `src/lib/firestore/*` (only `colleges.ts`, `departments.ts`, `hiring.ts`, `users.ts` exist there).

## Git / Team Workflow

- Remote: `https://github.com/Yubhian-Technologies/Faculty-Managment.git`. `main` is the integration branch; contributors work on personal branches (`guna`, `prasad-dev`, `siva`, `Management_dashboard`, …) and merge via PR.
- Branch protection guidance for `main` documented in `.github/branch-protection.md`: require PR + 1 approval, dismiss stale approvals, require Lint/Type check/Build status checks from `.github/workflows/ci.yml`.
- Recent history on `main`: PR #6 (siva), PR #7 (prasad-dev — initial budget pages), PR #10 (guna — HOD→Principal→Finance budget flow), PR #11 (Management_dashboard — faculty analytics dashboard).
- No test suite exists yet; CI enforces lint/typecheck/build only.

## Firestore Collections (non-exhaustive, budget-adjacent shown in full)

- `systemUsers/{uid}`, `colleges/{id}`, `colleges/{id}/users/{uid}`, `locations/{id}`, `locations/{id}/locationUsers/{uid}`
- `colleges/{id}/budgetRequests/{id}` — HOD→Principal→Finance proposals (see Budget section)
- `colleges/{id}/financeBudgets/{id}`, `colleges/{id}/financeBudgetRequests/{id}` — Finance-internal ledger/manual-request flow
- `colleges/{id}/auditLogs/{id}`, `colleges/{id}/financeAuditLogs/{id}`, `colleges/{id}/notifications/{id}`
- Recruitment/leave/attendance/payroll/appraisal/grievance/teaching/training collections nested under `colleges/{id}/...`, one per module, matching the type files in `src/types/`.

Firestore security rules (`firestore.rules`) generally allow direct client reads/writes gated by role for simpler collections, but Finance's ledger collections (`financeBudgets`, `financeBudgetRequests`) explicitly block all client writes (`allow write: if false`) — mutations there are server-route-only via the Admin SDK.
