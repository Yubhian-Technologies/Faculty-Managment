# Dashboard — ADMINISTRATION (`/administration`)

- **Role:** ADMINISTRATION (L2, LOCATION) — also reaches `/location-staff-admin` and `/location-dept-head` (proxy ROLE_PATH_MAP line 58).
- **Route root:** `/administration` (20 pages)
- **Guard:** `requireLocationMember` on `api/administration/*`; proxy path map.

## Pages/widgets and data sources
| Page | Widgets/Tables | API | Notes |
|---|---|---|---|
| `/administration` (home) | Location summary cards | `api/administration/college-people` (counts) `[UNVERIFIED]` | |
| `/administration/colleges` | College list | `GET /api/administration/colleges/[collegeId]/departments` variants | dept trees per college |
| `/administration/colleges/[id]/departments` (+`[deptId]`) | Dept table, faculty counts | `api/administration/colleges/[collegeId]/departments*`, `.../faculty` | |
| `/administration/colleges/[id]/edit`, `/colleges/new` | College form | admin routes or administration twins `[UNVERIFIED which]` | |
| `/administration/colleges/[id]/people/new` | Person creator | `api/administration/college-people` | provisioning into locationUsers |
| `/administration/users` (+`new`, `[uid]/edit`) | Location user table/forms | `api/location/users*` | |
| `/administration/principals` | Principal list/appointment | `api/administration/principals` | ties to role-seats |
| `/administration/settings` | Location settings | `[UNVERIFIED — settings route not in admin API list]` | `[GAP — settings API for location not found]` |
| `/administration/vacancies*`, `/interviews*`, `/offers*` | Hiring oversight (M2 boundary) | `api/location/vacancy-requests*`, `location/interviews*`, `location/offers*` | see M2 docs |

## Filters/scopes
- Location-scoped: session.locationId; switcher (`LocationDeptSwitcher`) for college context drill-down `[UNVERIFIED exact behavior for ADMINISTRATION]`.

## Permissions
- Backend `requireLocationMember` (7 routes listed in guard referencedBy).
- Frontend nav `roles:["ADMINISTRATION"]`.

## Drill-downs
- College → departments → faculty (M2 hiring views share these).

## Export/report
- None found `[GAP]`.

## Code evidence
- `src/app/(dashboard)/administration/**`; `src/app/api/administration/**`; `src/app/api/location/users*`.
