# M5 — Attendance (as-is)

## Purpose
Two attendance domains + a sweep: (a) staff/faculty self attendance with face+geofence check-in/out, admin imports/manual entries, reports/exports; (b) student period attendance tied to timetable slots with office corrections and shortage/percentage reports; (c) cron sweep notifying faculty who didn't post attendance. Plus location (non-teaching) staff attendance and shift rotation.

## Status: Implemented (most-tested after M3).

## Submodules
| ID | Submodule | Status |
|---|---|---|
| M5-SM1 | Faculty self attendance (check-in/out, face, geo, offline queue) | Implemented |
| M5-SM2 | Staff attendance admin (manual/import/report/monthly-export, check-in permissions) | Implemented |
| M5-SM3 | Student attendance marking (today-periods, POST/PATCH, office-correction) | Implemented (5 routes; current-period deleted 2026-09) |
| M5-SM4 | Student attendance reports (section report modes, percentage, history) | Implemented |
| M5-SM5 | Not-posted cron sweep + settings + completion report | Implemented |
| M5-SM6 | Location staff attendance & shift rotation (cross M1 location tenancy) | Implemented (active branch work) |

## Dashboards/roles
Nearly all roles (self check-in), HOD (attendance, reports, completion, faculty-not-posted, absent), Principal (same, college-wide), College Office (staff-attendance, import), Exam Cell (attendance + reports), Library/T&P (thin twins), Panel (mark-attendance, monthly-records), Management (oversight incl. principal/VP attendance reset), Location roles (staff-admin/dept-head attendance+shifts).

## Dependencies
- Depends on M3 (timetableSlots, courseYearTimings), M6 (approved leave blocks check-in; substitutions), M4 (student roster), M1 (campus locations, roles), M9 (notifications).
- Depended on by M7 (payroll inputs indirectly), M6 (completion drives leave reports).

## Key code locations
- Types: `src/types/attendance.ts`, `src/types/studentAttendance.ts` (id=`assign_date_period`).
- Libs: `src/lib/attendance/*` — istTime (IST truth), faceMatch (EAR 0.92/yaw 0.12), geofence (haversine/polygon), workingDays (Sunday override), lateStatus (09:05 cutoff), lateAttendancePenalty (idempotent via runTransaction), fillMissingDays, closeMissedCheckouts, offlineSubmitQueue, checkInPermission, registration, notPostedSettings, periodAttendanceStatus; `src/lib/timetable/currentPeriod.ts` (today-periods engine:63-273); `src/lib/studentAttendance/{percentage,shortage,absentReport,exportCsv}.ts`.
- API: `api/college/attendance/*` (16 routes), `api/college/student-attendance*` (5), `api/college/faculty-attendance-completion`, `attendance-percentage-report`, `section-attendance-report`, `student-attendance-history`, `attendance-not-posted-settings`, `api/cron/attendance-not-posted`, `api/location/staff-attendance*`, `api/location/shifts*`, `api/management/colleges/[id]/*attendance*`.
- UI: role dirs listed in module map; `src/components/attendance/*`.

## Key stores
`attendanceRecords`, `attendanceCheckInPermissions`, `lateAttendanceCounters`, `workingDays`, `holidays`, `studentAttendance` (COLLECTION_GROUP indexed), `settings` (not-posted), location staff attendance/shift collections `[UNVERIFIED names]`.

## Jobs
`attendanceNotPostedSweep` (15 min, functions/src/index.ts:20-44) → cron route (per-college settings, lastRunDate once/day).

## Major gaps
1. Student attendance import absent (map says "import") — see gaps-and-risks #6.
2. Face model weights are client-side only (public/models) — anti-spoof limited to EAR/yaw heuristics `[LIMITATION]`.
3. Offline queue persistence mechanism undocumented (offlineSubmitQueue.test.ts exists but storage layer unknown).
