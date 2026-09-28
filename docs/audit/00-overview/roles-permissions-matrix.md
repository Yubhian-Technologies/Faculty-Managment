# FMS — Roles & Permissions Matrix (as-is)

Roles defined at `src/types/core.ts:5-61`; levels 0–6 at `:152`; scopes at `:202`; dashboard paths at `:111`. Normalization: `COLLEGE_ADMIN`/`DIRECTOR`→`PRINCIPAL`, `DEPARTMENT_OFFICE`→`HOD` (session route; `src/lib/auth/verifySession.ts:28-38`).

## Role registry

| Role | Level | Scope | Dashboard path | Tenure |
|---|---|---|---|---|
| SUPER_ADMIN | 0 | GLOBAL | `/super-admin` | platform |
| MANAGEMENT | 1 | GLOBAL | `/management` | global, read-only + 4 sanctioned writes (verifySession.ts:84-91) |
| ADMINISTRATION | 2 | LOCATION | `/administration` (+ `/location-staff-admin`, `/location-dept-head`) | location |
| HR_ADMIN | 2 | LOCATION | `/hr-admin` | location |
| ADMIN_OFFICE | 2 | LOCATION | `/admin-office` | location |
| LOCATION_STAFF_ADMIN | 2 | LOCATION | `/location-staff-admin` (+ `/location-dept-head`) | location |
| LOCATION_DEPT_HEAD | 2 | LOCATION | `/location-dept-head` | location |
| PRINCIPAL (mirrors: COLLEGE_ADMIN, DIRECTOR) | 3 | COLLEGE | `/principal` | college |
| VICE_PRINCIPAL | 3 | COLLEGE | `/vice-principal` + `/principal` | college |
| HOD (mirror: DEPARTMENT_OFFICE) | 4 | COLLEGE | `/hod` | department |
| COLLEGE_OFFICE | 4 | COLLEGE | `/college-office` | college |
| COLLEGE_STAFF | 5 | COLLEGE | `/college-staff` | college |
| ACADEMICS | 5 | COLLEGE | `/academics` | college |
| IQAC_COORDINATOR / T_AND_P / R_AND_D / PLACEMENT_DEPT / LIBRARY | 5 | COLLEGE | own roots | college (type-gated) |
| RND_COORDINATOR | seat | COLLEGE | `/rnd-coordinator` | department (faculty + seat) |
| EXAM_CELL | 5 | COLLEGE | `/exam-cell` | college |
| WEBMASTER | 5 | COLLEGE | `/webmaster` | college |
| COLLEGE_ACCOUNTS | 5 | COLLEGE | `/college-accounts` | college |
| PANEL_MEMBER | 5 | COLLEGE | `/panel` + `/coordinator` | college |
| ACCOUNTS | 2 | COLLEGE (ROLE_SCOPE; profile college-scoped) | `/accounts` | college |
| FINANCE | 1 | GLOBAL | `/finance` | global |
| PURCHASE_DEPT | 1 | GLOBAL | `/purchase` | global |
| STUDENT | 6 | COLLEGE | (no dashboard pages found; class-leader has one) | college |
| CLASS_LEADER | 6 | COLLEGE | `/class-leader` | section |

## Permission enforcement points

1. **Edge (pages):** `src/proxy.ts` `ROLE_PATH_MAP` (lines 52-96) + `allowedPathsForRole()` inheritance (99). NOT for APIs.
2. **API guard:** `requireRole`/`requireCollegeMember`/`requireLocationMember`/`requireSuperAdmin`/`requireManagement`/`requireCollegeContext` (`src/lib/auth/verifySession.ts`).
3. **Data scope:** `src/lib/departments/scope.ts` (department tree), `src/lib/budget/departmentScope.ts`, `src/lib/leave/*` routing.
4. **UI:** `navConfig.ts` per-item `roles[]` + per-college nav-visibility toggles; `Sidebar`/`MobileDrawer`/`BottomNav`.
5. **Firestore rules:** coarse `{role, collegeId, locationId}` claims only.

## Matrix (module × role) — as-enforced

Legend: ✅ enforced (backend+frontend), ⚠️ frontend-only gate observed, 🔎 read-only, ➖ not applicable. Backend enforcement evidence = guard call in route file; UI = navConfig roles list / page guard.

| Capability | Roles allowed (backend evidence) |
|---|---|
| Manage locations/colleges | SUPER_ADMIN (`api/admin/locations`, `api/admin/colleges` — `requireSuperAdmin`); read via MANAGEMENT (`api/management/colleges`) |
| Provision users (Super Admin L3) | SUPER_ADMIN (`api/admin/users*`) |
| Provision college users (roles) | PRINCIPAL/VP/COLLEGE_OFFICE per role matrix in `api/college/users` POST; office-role catalog gated by college type via `src/lib/roles/officeRoles.ts getCreatableOfficeRoles` |
| Provision location users | ADMINISTRATION (`api/location/users`, `api/administration/*` — `requireLocationMember`) |
| Appoint Principal seat | SUPER_ADMIN, MANAGEMENT, ADMINISTRATION via `api/college/role-seats` (verifySession.ts:84-91 comment) |
| Vacancy raise/approve | HOD raise → Principal/VP approve (`api/college/vacancy-requests`); location vacancies ADMINISTRATION/HR_ADMIN (`api/location/vacancy-requests`); general-admin vacancies SUPER_ADMIN (`api/admin/general-admin-vacancies`) |
| Candidates/applications/interviews | HR_ADMIN, ADMIN_OFFICE, HOD, COLLEGE_OFFICE, LOCATION_DEPT_HEAD (+panel scoring via `api/college/panel-feedback` for assigned panel) |
| Offers & provisioning | COLLEGE_OFFICE create offer; Accounts verify (`api/college/offer-letters`); provisioning `firestore/facultyProvisioning.ts` |
| Course catalog / courses | PRINCIPAL/VP (+ACADEMICS for subjects) via `api/college/courses`, `course-catalog` |
| Subjects & semester assignment | ACADEMICS, HOD (`api/college/subjects*`, `subject-semester-assignments`) |
| Sections & students | HOD sections; College Office/Principal students (`api/college/students*`, `api/college/sections`) |
| Teaching assignments | HOD (`api/college/teaching-assignments`); cross-dept via `faculty-assignment-requests` |
| Timetable draft/publish | timetable-incharge (delegated faculty) + HOD oversight (`api/college/timetable/*`, `timetable-incharges`) |
| Internal exams/marks | EXAM_CELL config; HOD/panel entry (`api/college/internal-exam-marks`, `exam-configurations`, `mid-paper-assignments`) |
| Staff attendance self | any staff role (`api/college/attendance/check-in|check-out`) |
| Staff attendance admin | HOD/Principal (report), College Office/Exam Cell/Library/T&P (import/manual per routes' guards) |
| Student attendance marking | faculty via `student-attendance` POST; office correction HOD; PANEL_MEMBER marking per module map (`/panel/mark-attendance` page) ⚠️ backend guard to verify per-route |
| Student attendance reports | HOD/Principal/Exam Cell/Panel (`section-attendance-report`, `attendance-percentage-report`, `faculty-attendance-completion`) |
| Location staff attendance/shifts | LOCATION_STAFF_ADMIN, LOCATION_DEPT_HEAD, ADMINISTRATION (`api/location/staff-attendance*`, `location/shifts*`) |
| Leave apply | every staff role (self pages); STUDENT not found in leave UI roots ➖ |
| Leave approve | HOD → Principal/VP; Management for Principal's own (`api/leave/applications`, `api/management/leave-approvals`) |
| Leave profiles edit | College Office (`/college-office/leave/profiles`), HOD dept-level |
| Staff adjustments | HOD/Principal (`api/leave/staff-adjustments`) |
| Budget request/approve | HOD → Principal/VP (`api/college/budget-requests`); Management emergency approve (`api/management/emergency-budget-requests/[id]` PATCH) |
| Finance ops | FINANCE global (`api/college/finance-*` via `requireCollegeContext`) |
| Indents/purchase clearance | HOD raise → Principal → Purchase → Finance (`api/college/indent-requests`, `finance-purchase-clearance`, `api/purchase/indents/overview`) |
| Salary structures | ACCOUNTS (`/accounts/salary-structures`, `api/college/salary-structures`) |
| Publications/R&D | faculty self + R_AND_D + RND_COORDINATOR review (`api/college/publications*`, `research-review`) |
| Circulars | PRINCIPAL/VP + allow-list roles (`circular-permissions` doc) |
| Audit logs view | SUPER_ADMIN (global), PRINCIPAL (college) |
| Student feedback | students via public route; PANEL_MEMBER recipients |
| Nav visibility toggles | PRINCIPAL/VP (college), SUPER_ADMIN (view/all) |

## Gaps

- STUDENT role: no dashboard pages found (`ROLE_DASHBOARD_PATHS` presumably points somewhere but no `/student` page dir exists) `[GAP — verify intended experience]`.
- PANEL_MEMBER student-marking backend enforcement not verified route-by-route `[UNVERIFIED]`.
- `ACCOUNTS` scope is COLLEGE in ROLE_SCOPE though it acts college-wide; flagged in core.ts comments as pending tenancy migration `[KNOWN]`.
- Nav visibility toggles can hide items but cannot block direct URL access beyond proxy path prefixes `[LIMITATION]`.
