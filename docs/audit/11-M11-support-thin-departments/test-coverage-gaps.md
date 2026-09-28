# M11 — Test Coverage & Gaps (as-is)

## Existing
- `staffCategoryRouting.test.ts` (M6) covers leave routing that includes these staff categories.

## Missing
1. College-type gating matrix (officeRoles) — which colleges can create each role.
2. Attendance dept-attribution for office roles (report scope).

## Risky untested
- Creating a disallowed office role via direct API (server-side gate assumed per AGENTS.md, untested).
