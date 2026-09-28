# Appendix — UI Route Index (570 pages → modules)

Grouped by dashboard root with page counts (2026-09-28 inventory). Full trees per module in each module's `ui-routes.md`.

| Root | Pages | Modules served |
|---|---|---|
| `/principal/**` | 90 | M3 (courses/departments/sections/timetable/internal-marks), M5 (attendance chain), M6 (leave/approvals), M7 (budget/indents/purchase-clearance), M2 (vacancies/interviews/negotiate/decisions/appointment-letters), M9 (circulars/audit-logs), M1 (role-assignments/settings), M4 (students/promotions/graduates) |
| `/hod/**` | 86 | M3 (subjects/sections/teaching/timetable/internal-exam/mid-paper), M5 (attendance suite), M6 (leave/approvals/profiles/adjustments/history), M7 (budget/indents/purchase-clearance), M2 (vacancy/batches/candidates/shortlist/pipeline/faculty-requirement), M9 (circulars), M4 (students), M1 (settings/department-office/designations/sub-departments) |
| `/college-office/**` | 49 | M4 (students/import/graduates), M2 (candidates/offers/documents/pipeline/staff), M5 (staff-attendance/attendance-import), M6 (leave tree + leave-history + adjustments), M3 (timings), M1 (settings/faculty-credentials), supporting-staff trees |
| `/finance/**` | 30 | M7 (full ledger), M6 (leave) |
| `/panel/**` | 28 | M2 (interviews/evaluation via /evaluation, assignment-requests), M3 (timetable-incharge/internal-exam/mid-bank), M5 (mark-attendance/monthly-records), M9 (circulars/feedback), M4 (students/batches), M6 (leave) |
| `/management/**` | 27 | M1 (locations/users/role-assignments), M5 (attendance oversight), M7 (budget/indents read + emergency), M6 (leave-approvals) |
| `/r-and-d/**` | 22 | M8 |
| `/administration/**` | 20 | M1 (colleges/users/principals/settings), M2 (vacancies/interviews/offers) |
| `/location-dept-head/**` | 19 | M2 (candidates/interviews/vacancies), M5/M1 (attendance/shifts/staff) |
| `/super-admin/**` | 18 | M1 (+M2 vacancies) |
| `/location-staff-admin/**` | 17 | M5/M1 (attendance/shifts/staff/departments) |
| `/purchase/**` | 16 | M7 (indents/clearance/browse), M6 (leave) |
| `/exam-cell/**` | 15 | M3 (configure/guidelines), M5 (attendance reports), M9 (circulars), M6 (leave) |
| `/hr-admin/**` · `/college-staff/**` | 13 each | M2 · M3/M5/M6 (timetable-incharge/assignment-requests) |
| `/academics/**` | 12 | M3 (subjects/assign-semester), M6/M1 (leave/profile) |
| `/webmaster/**` · `/t-and-p/**` · `/library/**` · `/accounts/**` | 11 each | M1 (credentials/users), M11 twins, M7 (salary-structures) + M2 pipeline |
| `/college-accounts/**` | 9 | M2 (candidates/hiring), M6 |
| `/placement-dept/**` · `/iqac-coordinator/**` | 7 each | M11 |
| `/admin-office/**` | 5 | M2 (vacancies), M1 (profile) |
| `/leave/**` (shared) · `/class-leader/**` | 3 each | M6 shared · M4 |
| `/rnd-coordinator/**` | 2 | M8 |
| `/vice-principal` · `/evaluation/[batchId]/[candidateId]` · `/coordinator/[batchId]` · `/circulars/[id]` · `/candidate-profile/[id]` | 1 each | M2/M3 shared surfaces |
| Public roots: `/`, `/login`, `/careers/[collegeId]`, `/candidate-form/...`, `/offer-acceptance/...`, `/faculty-public/*`, `/location-interview/[id]`, `/feedback/[id]/[sub]` | — | M10 (+M9 feedback, M2 ingress) |

Shared component pages (not counted above): `/leave/adjustments`, `/leave/revise/[id]`, `/leave/od-proof/[id]` — M6 consent surfaces reachable by all staff roles.
