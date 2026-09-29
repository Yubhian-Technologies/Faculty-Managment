# Flow — M3-F1: Timetable Draft → Publish

- **Flow ID:** M3-F1
- **Actors/Roles:** timetable-incharge (delegated faculty for courseId+year), HOD
- **Trigger:** incharge opens `/hod/timetable/[courseId]/[year]/[sectionId]` (or staff twin)
- **Preconditions:** teachingAssignments exist for section; courseYearTimings configured; rules set (else defaults)
- **Main success scenario:**
  1. `GET/POST /api/college/timetable/draft` — load context (loadContext.ts:49-85), stage manual slots or run generator under TimetableRules (hard: maxPeriodsPerFacultyPerDay, maxConsecutive, maxPerSubjectPerDay, labBlockSize; soft: preferTheoryInMorning, spreadSubjects — teaching.ts:344-371).
  2. Rule violation → diagnostics returned, draft not saved.
  3. Split labs: two rows same section+day+period different labBatch allowed (allowSplit).
  4. `POST /api/college/timetable/publish` — resolve semester (resolveCurrentSemester) + academicYear; write `timetableSlots` (source GENERATED/MANUAL); stale-generated cleanup scoped to current cohort (session/semester stamps prevent cross-cohort deletion — teaching.ts:296-309); prior semester/session slots remain as history.
  5. Live reads (timetable-slots GET, class-leader, teaching-assignments) filter to current semester+year (matchesCurrentSemester/matchesCurrentAcademicYear) and overlay substitutions.
- **Alternate/error:** no timings configured → publish blocked `[ASSUMPTION]`; incharge not authorized → 403; concurrent publish → last-write `[GAP — verify lock]`.
- **UI:** `/hod/timetable/**`, `/college-staff/timetable-incharge/**`, `/panel/timetable-incharge/**`.
- **API:** `timetable/draft`, `timetable/publish`, `timetable-slots` (+`[id]`), `timetable-incharges`.
- **Backend:** lib/timetable/{buildGrid,loadContext,hoursMatch}.ts, lib/college/semester.ts, departments/timetableIncharge.ts.
- **DB:** `timetableDrafts/{sectionId}`, `timetableSlots`, `timetableIncharges/{courseId_yearN}`, `settings/timetableRules`.
- **Permission checks:** incharge doc authority (facultyId match) or HOD role `[UNVERIFIED route guard exact]`.
- **Validation:** day∈MON–SAT per rules, periodNumber within timings, assignment valid, no double-booking (solver/manual checks).
- **State transitions:** draft DRAFT → PUBLISHED (TimetableDraftStatus teaching.ts:384).
- **Side effects:** none async; notifications on publish `[UNVERIFIED]`.
- **Reports:** printable grid.
- **Concurrency:** per-section draft doc; publish idempotent by stamping.
- **Code evidence:** as cited; tests hoursMatch.test.ts, semester-propagation.test.ts, timetable-slots.spec.ts.
