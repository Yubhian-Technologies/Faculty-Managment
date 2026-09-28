# FMS — Cross-Cutting Architecture (as-is)

## 1. Authentication

- Client: Firebase Auth (`src/lib/firebase/client.ts`).
- Session issuance: `POST /api/auth/session` verifies the Firebase ID token, resolves role/tenant, writes httpOnly cookie `fms-session` (24h), HMAC-SHA256-signed via Web Crypto (`src/lib/auth/sessionToken.ts`; test `src/lib/auth/sessionToken.test.ts`).
- Role normalization at issuance: `COLLEGE_ADMIN`/`DIRECTOR` → `PRINCIPAL`; `DEPARTMENT_OFFICE` → `HOD`; truth preserved in `realRole` (`src/lib/auth/verifySession.ts:17-38`).
- Edge: `src/proxy.ts` gates pages via `ROLE_PATH_MAP` + `allowedPathsForRole()` inheritance (`src/proxy.ts:52-96,99-104`); skips `/api/`, `/_next`, public paths (`src/proxy.ts:16-30,104-106`).
- API guards (`src/lib/auth/verifySession.ts`): `verifySession()` (line 66), `requireSuperAdmin()` (73), `requireManagement()` (93, with strict write-route policy comment), `requireRole(...)` (121+; returns session whose `role` is the most senior accepted held role — deliberately rewrites role), `requireCollegeMember`, `requireLocationMember`, `requireCollegeContext` (referenced across 100+ routes; see SHARED_FILES.md).
- Live revocation: `resolveHeldRoles()` re-checks Firestore within cache TTL (`src/lib/auth/liveRoles.ts:42,70-71`).
- Seat roles: a faculty member may hold role seats (e.g., HOD seat); `pickEffectiveRole` (`src/lib/roles/seatRoles.ts`) + `orderHeldRoles` drive `requireRole` and notifications; tests `src/lib/roles/seatRoles.test.ts`.
- HOD multi-department: `ACTIVE_HOD_DEPT_COOKIE` + `decodeActiveHodDepartment` (`src/lib/auth/verifySession.ts:113-121`; `src/lib/roles/activeHodDepartment.ts`).
- Bearer-token routes (cron/public): `verifyFirebaseToken.ts` (`AGENTS.md`).

## 2. Tenancy & data isolation

- Three roots: `colleges/{id}/…`, `locations/{id}/locationUsers`, `systemUsers/{uid}` (`src/lib/firestore/userProvisioning.ts:38-78`).
- API isolation is per-route, not centralized: `requireCollegeMember` binds session.collegeId; `requireCollegeContext` (31 call sites) allows GLOBAL roles to pass `?collegeId=` — intentional for global roles; adding a college-scoped role there would let it pick a tenant (SHARED_FILES.md warning).
- Department scope: `src/lib/departments/scope.ts` — three non-interchangeable functions `editableDepartmentNames ⊃ facultyManageableDepartmentNames ⊃ ownDepartmentNames` (SHARED_FILES.md; file carries bug-history comments). Arrays `.slice(0,30)` — silent cap `[GAP]`.
- Firestore rules are a coarse second layer; JWT claims carry only `{role, collegeId, locationId}`; rules cannot see seats or normalized roles (SHARED_FILES.md). Deployed ruleset lags repo file `[GAP]`.

## 3. RBAC model

- `UserRole` 29 values (`src/types/core.ts:5-61`), `ROLE_LABELS` (62), `ROLE_DASHBOARD_PATHS` (111), `ROLE_LEVEL` 0–6 (152), `ROLE_SCOPE` GLOBAL/LOCATION/COLLEGE (202).
- Inheritance: `rolesInheritedBy`, `canRoleAccessRole` (core.ts) drive proxy path inheritance and `requireRoleOrHigher` — which has **zero call sites** and explicit warnings (`SHARED_FILES.md` "Known gaps"; do-not-adopt note).
- Normalized "mirror" roles: College Admin ≡ Principal, Director ≡ Principal, Department Office ≡ HOD for all permission checks; exceptions gated by `realRole` (`isCollegeAdmin`, `isDepartmentOffice` — verifySession.ts:28-38) e.g. appointing another office head.
- Seat roles (`src/types/roleSeats.ts`, `api/college/role-seats*`): Principal seat appointment may be done by Super Admin/Management/Administration; seat holder's `role` reads as the seat role.

## 4. Module & nav visibility (feature flags, as-is)

- Per-college toggles: `api/college/settings/nav-visibility` + `api/admin/settings/nav-visibility` (Super Admin view); defaults in `src/lib/navVisibilityDefaults.ts`.
- Nav config: `src/components/layout/navConfig.ts` — `NavItem.module` ties items to assigned faculty modules; `hideForRealRoles`/`showOnlyForRealRoles` handle normalized-role exceptions (navConfig.ts:12-38). `computeItemModule` walks backwards to nearest `section` — item placement silently changes visibility mapping (SHARED_FILES.md). `BOTTOM_NAV_ITEMS` is a separate hand-maintained mobile list that drifts.
- Nav visibility is **not security** — APIs guard separately (SHARED_FILES.md; every module doc repeats this).

## 5. Audit logging

- Collections: `colleges/{id}/auditLogs` (college scope: `api/college/audit-logs`; writes sprinkled per-flow, e.g. `src/lib/leave/decideFinalStage.ts:93`, `src/lib/budget/managementApproval.ts:66`) and a global admin stream (`api/admin/audit-logs`).
- Pattern: cross-cutting writes add an `AuditLog` + `AppNotification` per `src/types/core.ts` unions. No centralized interceptor — each route opts in `[GAP: uneven coverage]`.

## 6. Notifications

- `notify()` writes to `colleges/{id}/notifications` (`src/lib/notify.ts:24-37`); `notifyRole()` resolves recipients via `findUsersByRoles` (reaches seat holders and Department Office mirrors) or `systemUsers` for GLOBAL roles (notify.ts:110-128).
- Leadership noise filter: `excludeLeadershipUids` (notify.ts:44-64) for panel-stage prompts.
- Domain-specific notify helpers: `src/lib/notifications/workflowNotifications.ts`, `src/lib/leave/permissionNotify.ts`, `odProofNotify.ts`.
- Emails: `POST /api/email/send` (nodemailer); offer letters/appointment letters produce PDFs via `/api/pdf/generate` (puppeteer; fallback raw HTML when Chromium absent on Vercel).

## 7. File storage & imports/exports

- Upload routes (21+): `src/app/api/upload/*` — circular, budget-circular, budget-report, certificate, consultancy-doc, faculty-document, finance-receipt, hackathon-doc, indent-receipt, ipr-doc, joining-letter, leave-proof, phd-doc, profile-photo, purchase-grn, research-service-doc, resume, seed-funding-doc, sponsored-project-doc, staff-photo, supporting-staff-document → Cloud Storage via admin SDK.
- Excel: `POST /api/college/parse-excel` (shared parser) + module-specific imports: faculty, supporting-staff, students (`import-excel`), subjects, departments, holidays, leave-history, publications. Export: exceljs (`src/lib/finance/exportExcel.ts` per AGENTS.md), attendance monthly-export (csv/xlsx via `api/college/attendance/monthly-export`, `api/management/colleges/[id]/monthly-export`), student attendance CSV (`src/lib/studentAttendance/exportCsv.ts`).
- PDF: client jspdf/html2canvas; server puppeteer via `/api/pdf/generate` + `/api/pdf/image-proxy`.

## 8. Cron / queues / async

- Only scheduled job: `attendanceNotPostedSweep` (15 min IST) → `POST /api/cron/attendance-not-posted` (Bearer CRON_SECRET) → per-college settings gate (`attendance-not-posted-settings`), `lastRunDate` once-per-day (`functions/src/index.ts:20-44`; `src/lib/attendance/notPostedSettings.ts:24`).
- No queue infra; "jobs" are user-triggered request handlers. Offline attendance submits queue client-side (`src/lib/attendance/offlineSubmitQueue.ts` + test).

## 9. State/data-fetching (frontend)

- Zustand stores: `src/store/` authStore, uiStore, workContextStore.
- TanStack Query provider: `src/lib/queryClient.ts`.
- Shared UI: `src/components/shared/DataTable.tsx` (~68 importers), `PageHeader`, `StatusBadge`, `FileUpload`; layout Sidebar/TopBar/BottomNav/MobileDrawer + `LocationDeptSwitcher`; `useToast`, `useAuth`, `useWorkContext`, `useMyDepartments`, `useActiveLocationDept` hooks.

## 10. Known cross-cutting gaps (severity-ranked)

1. `npm run lint` fails on main (128 errors, 118 one React Compiler rule) and CI runs lint first → typecheck/build/test never execute (SHARED_FILES.md) — **HIGH**.
2. Deployed Firestore rules lag repo file; no rules tests — **HIGH**.
3. No tests for `verifySession.ts` / `scope.ts` despite being THE authorization layers (verifySession has one test file now: `src/lib/auth/verifySession.test.ts` — partial) — **HIGH**.
4. `requireCollegeContext` query-param tenant selection — 31 call sites, footgun — **MEDIUM**.
5. Department scope `.slice(0,30)` silent cap — **MEDIUM**.
6. Audit-log coverage opt-in per route — **MEDIUM**.
7. `DataTable` groupBy+paginate interaction bug (SHARED_FILES.md) — **LOW-MEDIUM**.
