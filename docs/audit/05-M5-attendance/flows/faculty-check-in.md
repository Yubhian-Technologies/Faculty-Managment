# Flow — M5-F1: Faculty Self Check-in (face + geofence + late penalty)

- **Flow ID:** M5-F1
- **Actors:** any staff role
- **Trigger:** arrival; opens attendance page
- **Preconditions:** face registered (`face-registration`); campus location configured; within check-in permission (cascade PRINCIPAL/VP→HOD/unit-head — `checkInPermission.ts:8`)
- **Main success scenario:**
  1. Client loads campus geofence (`attendance/campus-location`) + face models (`/models`).
  2. Capture selfie + coords → `POST /api/college/attendance/check-in`.
  3. Server gates: geofence (haversine/polygon) → holiday/summer-holiday → Sunday override (workingDays per role) → approved leave → face match (EAR 0.92 / yaw 0.12 liveness).
  4. Late check-in (> 09:05 IST) → `lateAttendancePenalty` transaction increments `lateAttendanceCounters` (idempotent — check-in/route.ts:79).
  5. Write `attendanceRecords {checkIn, source}`; return status.
- **Alternate/error:** OUTSIDE_GEOFENCE / ON_LEAVE / HOLIDAY / FACE_MISMATCH / NO_PERMISSION → 4xx with reason; offline → queued locally (offlineSubmitQueue) and replayed.
- **UI:** role attendance pages (`/hod/attendance`, `/principal/attendance`, every role's attendance page).
- **API:** `check-in`, `check-out`, `today-status`, `face-registration` (+`/reset`), `reference-photo`, `campus-location`, `check-in-permission`.
- **Backend:** lib/attendance/{geofence,faceMatch,istTime,workingDays,lateStatus,lateAttendancePenalty,checkInPermission,registration,offlineSubmitQueue}.ts.
- **DB:** attendanceRecords, lateAttendanceCounters, attendanceCheckInPermissions, workingDays, holidays, summerHolidays, users (face refs).
- **Permissions:** college member; resets cascading (HOD/Principal/VP reset each other one tier down; Management resets Principal — management/principal-attendance/reset).
- **Validation:** coords within polygon; image present; time via istTime (never ambient Date).
- **State transitions:** absent → checked-in → checked-out; missed checkout → closed (closeMissedCheckouts).
- **Side effects:** late penalty (payroll-facing counter); notifications on manual entries; audit on manual.
- **Reports:** monthly-export; report (HOD dept tree vs Principal college-wide; `report/route.ts:147` Sunday-override fix).
- **Concurrency:** idempotent penalty tx; duplicate check-in guarded by existing record `[ASSUMPTION]`.
- **Code evidence:** cited libs/routes; tests offlineSubmitQueue.test.ts; AGENTS.md attendance section.
