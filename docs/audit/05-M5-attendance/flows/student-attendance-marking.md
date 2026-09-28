# Flow — M5-F2: Mark Student Period Attendance

- **Flow ID:** M5-F2
- **Actors:** assigned faculty, substitute faculty, PANEL_MEMBER (per module map — page `/panel/mark-attendance`), HOD (corrections)
- **Trigger:** period window opens (IST) for a timetable slot
- **Preconditions:** slot exists for today/period (or substitute covers); section roster resolvable (primary + secondaryDepartment merge; labBatch-scoped for split labs)
- **Main success scenario:**
  1. `GET /api/college/student-attendance/today-periods` → periods with `isOpen` windows, substitute-aware (`resolveSubstituteSlotsForDate` currentPeriod.ts:106), lab batches split.
  2. Faculty marks roster → `POST /api/college/student-attendance` {assignmentId, date, period, entries}.
  3. Server: early-return if session already SUBMITTED; else transaction: read roster (merge primary+secondary, labBatch filter), write doc id `assign_date_period` (types/studentAttendance.ts).
  4. Edits: `PATCH /api/college/student-attendance/[id]` with `expectedUpdatedAt` → 409 on conflict; 0-student session allowed with notes; status transitions via `periodAttendanceStatus.ts:9` (IN_PROGRESS→SUBMITTED).
  5. HOD fix: `POST /api/college/student-attendance/office-correction` (+`[id]` approval).
- **Alternate/error:** WRONG_DATE / NOT_SCHEDULED / OUTSIDE_WINDOW / PERIOD_MISMATCH gates (AGENTS.md write gates); blank section → 400.
- **UI:** faculty today-periods view, `/panel/mark-attendance`, `/panel/monthly-records/**` (history drill).
- **API:** 5 routes (today-periods, POST, `[id]`, office-correction, office-correction/[id]).
- **Backend:** currentPeriod.ts, studentAttendance libs.
- **DB:** studentAttendance; indexes 4 COLLECTION_GROUP composites.
- **Permissions:** assignment/faculty match (or substitute) `[UNVERIFIED exact route guard]`; HOD for corrections.
- **Validation:** entries reference roster students; period within timings.
- **State transitions:** IN_PROGRESS→SUBMITTED (locked after? `[UNVERIFIED reopen path]`).
- **Side effects:** none async; feeds shortage/percentage reports.
- **Concurrency:** expectedUpdatedAt optimistic locking; tx prevents lost roster merges.
- **Code evidence:** cited; tests percentage/shortage; e2e academics-attendance.spec.ts.
