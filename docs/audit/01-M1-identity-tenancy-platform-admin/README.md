# M1 — Identity, Tenancy & Platform Admin (as-is)

## Purpose
Owns the platform's tenant topology (locations, colleges), every user account and role/seat assignment, per-college module/nav visibility, audit trails, and college-wide settings (academic year, course catalog custody shared with M3).

## Status: Implemented (core), gaps noted below.

## Submodules
| ID | Submodule | Status |
|---|---|---|
| M1-SM1 | Locations & Colleges management | Implemented |
| M1-SM2 | User/Role Assignments & Seats | Implemented |
| M1-SM3 | Per-college Module/Nav Visibility | Implemented |
| M1-SM4 | Audit Logs (college + global) | Implemented (uneven write coverage) |
| M1-SM5 | College-wide Settings (Academic Year, Course Catalog) | Implemented |

## Dashboards / roles served
- `/super-admin` (SUPER_ADMIN) — 18 pages
- `/administration` (ADMINISTRATION) — 20 pages
- `/webmaster` (WEBMASTER) — 11 pages (credential requests, users, reset password)
- `/management` (MANAGEMENT) — 27 pages (read-only oversight + sanctioned writes)
- Supporting: `/principal/role-assignments`, `/principal/settings`, `/hod/settings/*` (department-level user mgmt)

## Dependencies
- Depends on: none (platform base).
- Depended on by: every module (users/tenancy), M2 (provisioning writes users), M3 (academic years/catalog), M9 (audit), all (nav visibility).

## Key code locations
- API: `src/app/api/admin/**` (locations, colleges, users, settings/nav-visibility, audit-logs, dashboard-stats, general-admin-vacancies→M2), `src/app/api/administration/**` (college-people, principals, college departments), `src/app/api/college/users*`, `src/app/api/college/role-seats*`, `src/app/api/college/settings/**`, `src/app/api/college/academic-years`, `academic-sessions`, `course-catalog*`, `course-academic-years`, `src/app/api/management/**` (oversight), `src/app/api/college/webmaster/reset-password`.
- Libs: `src/lib/firestore/userProvisioning.ts` (provisioning into 3 roots), `src/lib/auth/liveRoles.ts` (live role resolution), `src/lib/roles/seatRoles.ts`, `src/lib/roles/officeRoles.ts` (college-type gated office roles), `src/lib/navVisibilityDefaults.ts`, `src/lib/firestore/collegeSettings.ts` (`settings/general` ref at line 26).
- UI: `src/app/(dashboard)/super-admin/**`, `administration/**`, `webmaster/**`, `management/**`; layout `src/components/layout/{Sidebar,MobileDrawer,BottomNav,LocationDeptSwitcher}.tsx` + `navConfig.ts`.

## Key APIs / tables / jobs
- APIs: `GET/POST /api/admin/locations`, `GET/PATCH /api/admin/locations/[id]`, `GET/POST /api/admin/colleges`, `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/[uid]`, `GET/PUT /api/admin/settings/nav-visibility`, `GET /api/admin/audit-logs`, `GET /api/admin/dashboard-stats`, `GET/POST/PATCH /api/college/users`, `GET/POST /api/college/role-seats` (+`[id]`, `convert-legacy`), `GET/PUT /api/college/settings/general|nav-visibility`, `GET/POST /api/college/academic-years|academic-sessions|course-catalog` (exact verbs per-file `[UNVERIFIED]`).
- Stores: `locations`, `colleges`, `locations/{id}/locationUsers`, `systemUsers`, `colleges/{id}/users`, `roleSeats`, `settings`, `academicYears`, `courseCatalog`, `auditLogs`.
- Jobs: none dedicated (no cron in M1).

## Major gaps
1. Student role has no dashboard pages (`ROLE_DASHBOARD_PATHS` maps it, no pages found) `[GAP]`.
2. `requireCollegeContext` query-param tenant selection on college routes — audit needed (cross-cutting #5).
3. Nav visibility is UI-only; not a security boundary.
4. MANAGEMENT write surface limited to 4 sanctioned routes (documented in code, verifySession.ts:84-91) — good, but seat appointment route uses `requireRole` not `requireManagement` `[UNVERIFIED]`.
