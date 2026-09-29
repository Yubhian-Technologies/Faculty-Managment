# Dashboard — SUPER_ADMIN (`/super-admin`)

- **Role:** SUPER_ADMIN (L0, GLOBAL)
- **Route root:** `/super-admin` (18 pages; page inventory 2026-09-28)
- **Guard:** `src/proxy.ts` ROLE_PATH_MAP SUPER_ADMIN; APIs `requireSuperAdmin`.
- **Nav section evidence:** `src/components/layout/navConfig.ts` (items with roles:["SUPER_ADMIN"]) + per-college visibility toggles do NOT apply to Super Admin (toggles are college-scoped; SA sees platform view) `[ASSUMPTION — verify filterVisibleNavItems]`.

## Pages/widgets and data sources
| Page | Widgets/Tables | Data source (API) | Notes |
|---|---|---|---|
| `/super-admin` (home) | Platform stat cards | `GET /api/admin/dashboard-stats` | counts colleges/locations/users `[UNVERIFIED fields]` |
| `/super-admin/locations` (+`new`, `[id]/edit`) | Location table + form | `GET/POST /api/admin/locations`, `PATCH /api/admin/locations/[id]` | CRUD |
| `/super-admin/colleges` (+`new`, `[id]/edit`) | College table + form | `GET/POST /api/admin/colleges` | location linkage |
| `/super-admin/users` (+`new`, `[uid]`, `[uid]/edit`, `[uid]/[module]`, `[uid]/[module]/edit`) | Global user table; per-module assignment editor | `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/[uid]`, photos `admin/users/[uid]/photo` | module edit pages suggest per-user module toggles `[UNVERIFIED semantics]` |
| `/super-admin/role-assignments` | Seat/role matrix | `api/college/role-seats*` (via requireRole) | includes Principal-seat appointment |
| `/super-admin/settings` | Nav visibility (global view) | `GET/PUT /api/admin/settings/nav-visibility` | global defaults |
| `/super-admin/audit-logs` | Audit table w/ filters | `GET /api/admin/audit-logs` | global stream |
| `/super-admin/vacancies` (+`[id]/reject`) | General-admin vacancies oversight | `api/admin/general-admin-vacancies*` | M2 boundary |

## Filters/scopes
- Platform-wide; no college scoping (GLOBAL). Location/college filters client-side.

## Permissions
- Backend: `requireSuperAdmin` with live held-role recheck (verifySession.ts:73-91).
- Frontend: proxy path `/super-admin`; nav roles.

## Drill-downs
- College → its people (via administration routes with `requireLocationMember` when acting as Administration through switcher `[UNVERIFIED]`).

## Export/report actions
- None found on these pages `[GAP — no CSV export for audit logs]`.

## Empty/loading/error states
- DataTable shared component renders loading/empty (`src/components/shared/DataTable.tsx`) `[UNVERIFIED specifics]`.

## Code evidence
- Page files under `src/app/(dashboard)/super-admin/**`; APIs `src/app/api/admin/**`; guard `src/lib/auth/verifySession.ts:73`.
