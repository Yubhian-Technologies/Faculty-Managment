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

| Role               | Dashboard             | Scope                    |
| ------------------ | --------------------- | ------------------------ |
| SUPER_ADMIN        | `/super-admin`        | system                   |
| MANAGEMENT         | `/management`         | cross-college, read-only |
| ADMINISTRATION     | `/administration`     | location                 |
| HR_ADMIN           | `/hr-admin`           | location                 |
| ADMIN_OFFICE       | `/admin-office`       | location                 |
| LOCATION_DEPT_HEAD | `/location-dept-head` | location                 |
| PRINCIPAL          | `/principal`          | college                  |
| VICE_PRINCIPAL     | `/vice-principal`     | college                  |
| HOD                | `/hod`                | college                  |
| COLLEGE_OFFICE     | `/college-office`     | college                  |
| PANEL_MEMBER       | `/panel`              | college                  |
| ACCOUNTS           | `/accounts`           | college                  |
| FINANCE            | `/finance`            | college                  |
| STUDENT            | `/feedback`           | public/no-login          |

## Auth Flow

1. Client signs in with Firebase Auth (`src/lib/firebase/client.ts`), POSTs the ID token to `/api/auth/session`.
2. That route verifies the token, resolves role/collegeId/locationId (custom claims fast path → `systemUsers` Firestore fallback → backfills custom claims), sets an httpOnly `fms-session` cookie (24h). The cookie is base64 JSON in JWT-shaped wrapping — **not** cryptographically signed.
3. `src/proxy.ts` gates dashboard pages by role via `ROLE_PATH_MAP` (prefix-matched, e.g. `PRINCIPAL: ["/principal", ...]` covers every `/principal/*` subroute) and redirects unauthenticated users to `/login`. It does **not** protect `/api/*`. Higher levels additionally inherit lower dashboards within scope via `allowedPathsForRole` (see Level-wise flow below).

**Level-wise login flow (L0–L6).** `src/types/core.ts` defines `ROLE_LEVEL` (seniority rank), `ROLE_SCOPE` (`GLOBAL`/`LOCATION`/`COLLEGE`, the single source `LOCATION_SCOPED_ROLES` is derived from), and helpers `rolesInheritedBy` / `canRoleAccessRole`. A higher-level role inherits access to lower-level roles in its own-or-narrower scope, wired into `proxy.ts` (`allowedPathsForRole`) and the opt-in `requireRoleOrHigher()` guard in `verifySession.ts`. Existing explicit `requireCollegeMember`/`requireLocationMember` guards are unchanged. `ROLE_SCOPE` tracks where profile docs actually live (FINANCE/PURCHASE_DEPT/ACCOUNTS still `COLLEGE` until their Phase 2/3 tenancy migration). 4. Every API route must protect itself via `src/lib/auth/verifySession.ts`: `requireRole`, `requireCollegeMember`, `requireLocationMember`, `requireSuperAdmin`. This is the pattern to follow for any new route — the proxy alone is not sufficient.

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

An approved (non-emergency-Non-Goods) `FINANCE_APPROVED` budget request auto-creates a linked `financePurchaseClearance` doc (see Indent module below) inside the same transaction that creates the `FinanceBudget`, pre-attributed to the requesting HOD and pre-linked via `budgetId`/`sourceRequestId` — this is how an approved department budget actually turns into spendable procurement.

## Indent Module — Deep Dive

`colleges/{collegeId}/indentRequests/{id}` (HOD raises against a category) and the closely-related `colleges/{collegeId}/financePurchaseClearance/{id}` (raised manually by an HOD, or auto-created from an approved budget request — see above) share the same shape and state machine, implemented in parallel in `src/types/indent.ts` + `src/app/api/college/indent-requests/` and `src/types/finance.ts` (`FinancePurchaseClearance`) + `src/app/api/college/finance-purchase-clearance/`.

**Approval state machine** (`IndentStatus` in `src/types/indent.ts`):

```
HOD submits, category picked → GOODS: PENDING_PURCHASE_REVIEW           NON_GOODS: PENDING_FINANCE_REVIEW (skips Purchase Dept)
   GOODS only:
   → Purchase Dept: REJECT → REJECTED_BY_PURCHASE (terminal)
   → Purchase Dept: RETURN → RETURNED_TO_HOD (HOD edits, resubmits)
   → Purchase Dept: SEND_TO_FINANCE (>=3 quotations, 1 selected) → PENDING_FINANCE_REVIEW
   → Finance: RETURN → RETURNED_TO_PURCHASE (Purchase Dept revises quotations, resubmits)
   Both GOODS and NON_GOODS:
   → Finance: REJECT  → REJECTED (terminal)
   → Finance: APPROVE → GOODS: APPROVED (FinancePayment auto-created; Purchase Dept buys, then UPLOAD_RECEIPT → COMPLETED)
                        NON_GOODS: COMPLETED directly (FinancePayment auto-created, no further step)
```

`FinancePurchaseClearance` follows the identical GOODS branch (PENDING_PURCHASE_REVIEW → quotations → PENDING_FINANCE_REVIEW → APPROVED → GOODS_PURCHASED → HOD uploads GRN → COMPLETED) since it's always goods procurement — no NON_GOODS shortcut exists for it.

API: `src/app/api/college/indent-requests/[id]/route.ts` and `src/app/api/college/finance-purchase-clearance/[id]/route.ts` — role-branched PATCH state machines, mirroring the budget module's pattern (Finance approval in both runs inside a Firestore transaction with a fresh status re-read, guarding against double-approval races and auto-creating the downstream `FinancePayment`). Cross-college "all requests" views for the GLOBAL Purchase Dept/Finance roles live in `src/app/api/purchase/indents/overview/` and `src/app/api/finance/budget-requests/overview/` — these fan out with one read per college (deliberately not a `collectionGroup` query, since no composite index is deployed for one — see comments in those files) rather than a single indexed query.

**Shared notification bug (fixed)**: `src/app/api/college/indent-requests/[id]/route.ts` had correct `notifyRole()` logic that branches on `ROLE_SCOPE` — GLOBAL roles (`FINANCE`, `PURCHASE_DEPT`) live in `systemUsers`, not a college's `users` subcollection, so notifying them requires querying `systemUsers` instead. Three sibling files (`college/finance-purchase-clearance/route.ts`, `college/finance-purchase-clearance/[id]/route.ts`, `college/budget-requests/[id]/route.ts`) each carried their own copy-pasted `notifyRole()` **without** that branch, so every `notifyRole(db, collegeId, "FINANCE", ...)` / `notifyRole(db, collegeId, "PURCHASE_DEPT", ...)` call in those three files silently queried zero recipients — e.g. Finance was never notified when Purchase Dept forwarded a purchase-clearance request for review, and Purchase Dept was never notified of new/resubmitted clearance requests or of the auto-created clearance after a budget request is approved. Fixed by extracting one shared, `ROLE_SCOPE`-aware `notify()`/`notifyRole()` pair into `src/lib/notify.ts` and switching all four route files to import it instead of maintaining separate copies — new call sites for these roles should import from there rather than re-implementing the college-users-only version.

**Other fixes applied**: the `finance-purchase-clearance/[id]/route.ts` `RESUBMIT` branch (HOD editing and resubmitting a returned request) was the only transition in that file that didn't write an `AuditLog` entry — added one (`PURCHASE_CLEARANCE_RESUBMITTED`, now in the `AuditAction` union in `core.ts`) for parity with every other transition and with the equivalent HOD-resubmit flow in `indent-requests`.

## Reliability / Scalability / Accessibility — Known Gaps & Suggestions

Findings from an audit of the budget + indent/purchase-clearance flows, beyond the notification bug above (fixed) — noted here rather than fixed outright where the fix needs a deploy/verification step this session couldn't do safely (e.g. a new Firestore composite index):

- **Accessibility (fixed)**: `src/components/shared/DataTable.tsx`'s clickable-row pattern (used by every list page across both flows — HOD's indent/budget tables, Finance's approval queues, Purchase Dept's request lists, and beyond) rendered `<tr onClick=...>` with no `tabIndex`, `role`, keyboard handler, or focus style — keyboard/screen-reader users could not open a row's detail view anywhere in the app. Fixed once at the shared component: rows with `onRowClick` are now focusable (`tabIndex=0`, `role="button"`), respond to Enter/Space, and show a visible focus ring.
- **Accessibility (not yet fixed)**: form fields across the indent/budget entry forms (`IndentForm`, `IndentItemsTable`, `BudgetCategorySection`, quotation-entry forms) use `<Label>` without an `htmlFor`/`id` pairing to their `<Input>`/`<Select>`, so clicking a label doesn't focus its field and the programmatic name isn't reliably exposed to assistive tech. Fixing this app-wide (shared `Label`/`Input`/`Select` components, not just budget/indent) is a larger follow-up than fits in this pass.
- **Scalability**: `college/indent-requests`, `college/budget-requests`, and `college/finance-purchase-clearance` GET routes always fetch the *entire* per-college subcollection and filter/sort in memory (no pagination, no server-side `limit()`); the cross-college overview routes (`purchase/indents/overview`, `finance/budget-requests/overview`) multiply that by one full-collection read per college in the system. This is deliberate today (avoids needing composite indexes that aren't deployed — see comments in those files) but won't hold up once any single college accumulates thousands of requests. The lowest-risk next step is adding `.limit()` + cursor-based pagination to the list endpoints and their `DataTable` callers, or deploying the composite indexes (`status` + `createdAt`, `department` + `createdAt`) needed to push filtering into Firestore instead of the API layer.
- **Reliability**: both Finance-approval PATCH handlers (`indent-requests/[id]`, `budget-requests/[id]`, `finance-purchase-clearance/[id]`'s equivalent) already guard against double-approval races via a transaction + fresh status re-read — this pattern is solid and should be the template for any new terminal-approval action. Non-Finance transitions (HOD resubmit, Purchase Dept forward-to-Finance) are plain `ref.update()`s without a transaction; low risk today since each is single-actor, but worth revisiting if multi-user editing of the same request becomes common.

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

## Sidebar Tabs Per Role

Source of truth: `src/components/layout/navConfig.ts` (`NAV_ITEMS` = full desktop sidebar, `BOTTOM_NAV_ITEMS` = mobile bottom-nav subset per role). Items are grouped under the `section` header they declare (unlabeled items fall under the previous section or none).

- **MANAGEMENT** (`/management`) — Dashboard; _Organization_: Locations, Add Administrator; _Reports_: Budget, Faculty Details.
- **SUPER_ADMIN** (`/super-admin`) — Dashboard, Locations, Colleges, All Users, Add User, Audit Logs, Settings.
- **ADMINISTRATION** (`/administration`) — Dashboard; _Management_: Location Staff, Departments, Colleges; _Hiring_: Hiring Requests, Interview Plans, Offer Letters.
- **HR_ADMIN** (`/hr-admin`) — Dashboard; _Hiring_: Hiring Requests, Candidates, Interviews, Offer Letters.
- **ADMIN_OFFICE** (`/admin-office`) — Dashboard only.
- **LOCATION_DEPT_HEAD** (`/location-dept-head`) — Dashboard; _Hiring_: Hiring Requests, My Candidates, My Interviews.
- **VICE_PRINCIPAL** (`/vice-principal`) — Dashboard; _Hiring_: General Admin Vacancies; then shares the entire Principal block below (Hiring Requests → Reports) since VP has equal authority to Principal.
- **PRINCIPAL** (`/principal`, shared with VICE*PRINCIPAL) — Dashboard; \_Institution*: Hiring Requests, Departments, Staff, Interview Plans, Hiring Decisions; _Administration_: Leave Approvals, Attendance Report, Payroll, Budget, Budget Report, Training Approvals, Grievance Desk, Documents, Reports.
- **HOD** (`/hod`) — Dashboard; _Department_: Faculty, Sections; Leave Approvals, Leave Profiles; _My Work_: My Leave, My Attendance, Teaching Load, Teaching Assignments, My Payslips, Budget, Indents, Purchase Clearance, My Appraisal, Training, Grievance, My Documents; _Hiring_: Hiring Pipeline, Candidates.
- **COLLEGE_OFFICE** (`/college-office`) — Dashboard, Documents, Candidates.
- **COLLEGE_STAFF** (`/college-staff`, dynamic-title roles: Dean, IQAC Coordinator, T&P, etc.) — Dashboard only.
- **PANEL_MEMBER** (`/panel`, "Faculty" in UI) — Dashboard, Leave, Attendance, Teaching Load, Students, Payslips, My Feedback, Appraisal, Training, Grievance, My Documents. ("My Interviews" is injected dynamically into the sidebar only when the user is assigned to an interview panel — see `Sidebar.tsx`.)
- **ACCOUNTS** (`/accounts`) — Dashboard, Salary Records, Offer Letters.
- **FINANCE** (`/finance`) — Dashboard; _Budgets_: Budget Management, Budget Approvals, Budget Report; _Approvals_: Fund Allocation, Expense Requests, Purchase Finance Clearance, Indent Approvals; _Payments_: Payments, Receipts; _Reports_: Financial Reports, Audit & Compliance.
- **PURCHASE_DEPT** (`/purchase`) — Dashboard, Pending Requests, Latest Requests, All Requests; _Organization_: Browse by Location.
- **STUDENT** — no dashboard/sidebar; public feedback flow only (`/feedback/[id]`).

Mobile `BottomNav` shows an abbreviated 3–5 item subset of each role's sidebar (e.g. Finance's bottom nav is just Home/Approvals/Payments/Reports); see `BOTTOM_NAV_ITEMS` in `navConfig.ts` for the exact per-role list.
