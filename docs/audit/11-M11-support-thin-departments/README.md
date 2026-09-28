# M11 — Support / Thin Departments (as-is)

## Purpose
Dashboard+profile shells for four office roles with minimal module surfaces: Library, T&P (Training & Placement), IQAC Coordinator, Placement Dept. Each reuses M5 staff attendance, M6 leave, and profile module editing; no domain backend of their own.

## Status: Implemented (thin, by design).

## Submodules
| ID | Submodule | Status |
|---|---|---|
| M11-SM1 | Library | Implemented |
| M11-SM2 | Training & Placement | Implemented |
| M11-SM3 | IQAC Coordinator | Implemented |
| M11-SM4 | Placement Dept | Implemented |

## Dashboards/roles
`/library` (11 pages), `/t-and-p` (11), `/iqac-coordinator` (7), `/placement-dept` (7) — each: home, attendance (+import), staff-attendance (+[uid]), leave (+apply, history/[type]), profile (+[module], [module]/edit). IQAC/Placement omit staff-attendance twins (7 pages vs 11).

## Dependencies
- Depends on M1 (roles; college-type gating of office roles — Library/Placement not for School etc.), M5 (attendance APIs), M6 (leave APIs), M8 (profile modules for research where applicable).
- Depended on by: nothing (leaf).

## Key code locations
- Roles: `src/types/core.ts` (LIBRARY, T_AND_P, IQAC_COORDINATOR, PLACEMENT_DEPT; college-type gating via `src/lib/roles/officeRoles.ts getCreatableOfficeRoles` — Degree gets IQAC/Placement/Library/ExamCell; Polytechnic gets Placement/Library; Engineering/Pharmacy/Dental all 8; School none — AGENTS.md).
- APIs: reuse `api/college/attendance/*`, `api/leave/*`, `api/college/faculty/me`, profile modules.
- UI: role dirs above; no dedicated components folder beyond shared.

## Key stores
`attendanceRecords` (own uid + dept reads), `leaveRequests` etc. — all shared.

## Jobs
None.

## Major gaps
1. No domain modules (library catalog, placement drives) — map says "mostly dashboard + attendance + leave + profile" and that matches reality; anything more is out of scope `[CONFIRMED GAP by design]`.
2. T&P/Placement often conflated — both exist as separate roles `[NOTE]`.
