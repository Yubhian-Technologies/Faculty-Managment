# M1 — Permissions (as-is)

## Role-by-action matrix

| Action | SUPER_ADMIN | MANAGEMENT | ADMINISTRATION | PRINCIPAL/VP | COLLEGE_OFFICE | HOD | WEBMASTER |
|---|---|---|---|---|---|---|---|
| Create/edit locations | ✅ (requireSuperAdmin) | 🔎 read | ➖ | ➖ | ➖ | ➖ | ➖ |
| Create/edit colleges | ✅ | 🔎 | ✅ (location route) | ➖ | ➖ | ➖ | ➖ |
| Create global users | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Create location users | ➖ | ➖ | ✅ (requireLocationMember) | ➖ | ➖ | ➖ | ➖ |
| Create college users | ➖ | ➖ | ➖ | ✅ | ✅ (subset) | ✅ (dept-scoped; office head exception via isDepartmentOffice) | ➖ |
| Create office roles (ACADEMICS, IQAC, T&P, R&D, PLACEMENT, LIBRARY, EXAM_CELL, WEBMASTER) | ➖ | ➖ | ➖ | ✅ per college type (getCreatableOfficeRoles) | ⚠️ limited | ➖ | ➖ |
| Appoint Principal seat | ✅ | ✅ (documented exception) | ✅ | ➖ (not own seat) | ➖ | ➖ | ➖ |
| Appoint dept seats (HOD etc.) | 🔎 via SA routes | 🔎 | ➖ | ✅ | ➖ | ➖ (cannot appoint own office head — realRole fence) | ➖ |
| Reset member password | ➖ | ➖ | ➖ | ➖ (removed from College Admin per navConfig comment) | ➖ | ➖ | ✅ (webmaster/reset-password) |
| Edit college settings/general | ➖ | ➖ | ➖ | ✅ | ➖ | ➖ | ➖ |
| Toggle nav visibility | 🔎 (global defaults) | ➖ | ➖ | ✅ (college) | ➖ | ➖ | ➖ |
| Read audit logs (college) | ✅ (global) | ➖ | ➖ | ✅ | ➖ | ➖ | 🔎 own history `[UNVERIFIED]` |

## College/location scoping
- Admin routes: platform-wide. Administration routes: pinned to session.locationId (`requireLocationMember`). College routes: pinned to session.collegeId (`requireCollegeMember`); HOD further narrowed by department scope (`lib/departments/scope.ts`).

## Seat limits
- No numeric seat-limit enforcement found (e.g., "1 HOD per department" enforced by convention in route logic `[UNVERIFIED]`) `[GAP — verify unique-seat constraint]`.

## Module/nav visibility rules
- College visibility doc hides sidebar items (`filterVisibleNavItems`); defaults `lib/navVisibilityDefaults.ts`; Super Admin global view separate. UI-only.

## Backend vs frontend enforcement
- Backend: guards + inline role checks (verified for admin/college users/role-seats via referencedBy).
- Frontend: navConfig roles arrays; per-user assigned modules hide items (`NavItem.module`).
- Mismatch risk: hiding nav ≠ blocking API; deep-link to college settings by non-Principal → 403 by guard (verified requireRole on settings/general).

## Gaps
1. Unique-seat constraint (one HOD per dept) not verified.
2. Login/session issuance not audit-logged.
3. `api/administration/settings` referenced by UI page but no backing route found in inventory `[GAP — confirm]`.
