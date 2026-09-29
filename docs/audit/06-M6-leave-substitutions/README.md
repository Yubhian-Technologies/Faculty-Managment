# M6 — Leave & Substitutions (as-is)

## Purpose
Leave lifecycle for every employee category: applications (CL/SL/SCL/EL/OD/SH), approvals with dept routing, balance engine + profiles, history/reports, manager-assigned staff adjustments, self-service adjustment requests (consent), short-leave "permissions", OD proofs.

## Status: Implemented (well-tested lib layer).

## Submodules
| ID | Submodule | Status |
|---|---|---|
| M6-SM1 | Leave Applications & Approvals | Implemented |
| M6-SM2 | Leave Profiles, Balances & History | Implemented |
| M6-SM3 | Staff Adjustments (manager-assigned) | Implemented |
| M6-SM4 | Adjustment Requests (self-service consent) | Implemented |
| M6-SM5 | Permissions (short-leave) + OD proofs | Implemented |

## Dashboards/roles
Every staff role self-service (`/leave/apply`, `/leave/history/[type]` under each role root), HOD/Principal/VP (approvals + profiles + history + adjustments), College Office (college-wide leave-history, profiles, import), Management (Principal's own leave decisions), shared `/leave/adjustments`, `/leave/revise/[id]`, `/leave/od-proof/[id]`.

## Dependencies
- Depends on M1 (identity/categories), M3 (timetableSlots for coverage/handover), M5 (check-in blocks), M9 (notifications).
- Depended on by M5 (leave blocks check-in; substitutions overlay), M7 (leave data in payroll exports), M9 (audit).

## Key code locations
- Types: `src/types/leave.ts` (LeaveTypeCode:31 — CL|SL|SCL|EL|OD|SH; StaffAdjustmentStatus:296 ACTIVE|CANCELLED), `src/types/permission.ts:19`.
- Libs: `src/lib/leave/*` — balanceEngine (leaveBalances/leaveRequests/employeeLeaveProfiles refs :37-43), approvalRouting, decideFinalStage (audit :93), availability (LIVE_LEAVE_STATUSES :117-120), staffAdjustmentScope (:60), periodCoverage (:135-429 — slots where facultyId, section chunks 30, substitutes), adjustmentRequests, staffCategoryRouting, odProofNotify, permissionNotify, holidaysCount, reportRoster, identity (faculty vs supportingStaff :64-114).
- API: `api/leave/*` (15 routes: applications, [id], adjustment-response, adjustment-requests, balances, handover-candidates, other-categories, period-coverage, permissions(+[id]), profile, profiles, seed, staff-adjustments(+[id], options), types), `api/college/leave-history-report*` (incl. absent-today, active-now, yearly, import), `api/management/leave-approvals*`.
- UI: per-role leave trees + shared pages listed above.

## Key stores
`leaveRequests`, `leaveBalances`, `employeeLeaveProfiles`, `staffAdjustments`, `otherLeaveCategories`, `permissionRequests`, `onDutyRequests`, `holidays`.

## Jobs
None scheduled (leave lifecycle is user-driven).

## Major gaps
1. `leave/seed` route (SUPER_ADMIN) — production seeding guardrail unclear.
2. Leave balances `allow write: if false` rules no-op history (SHARED_FILES.md) — rules deploy lag.
3. Panel/College-Office approval scopes per college type (`staffCategoryRouting`) — tests exist; route parity `[UNVERIFIED]`.
