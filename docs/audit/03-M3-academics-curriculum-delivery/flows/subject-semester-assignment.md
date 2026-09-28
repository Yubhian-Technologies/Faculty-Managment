# Flow — M3-F2: Assign Subjects to Semester (master → instance)

- **Flow ID:** M3-F2
- **Actors:** ACADEMICS office role (primary), HOD (view/assist)
- **Trigger:** `/academics/assign-semester`
- **Preconditions:** course + year timings exist; master subjects defined (courseId+regulation)
- **Main success scenario:**
  1. Pick course → year → semester; list master subjects for course (`subjects?courseId=` — subjects/route.ts:234 comment re manual compound queries).
  2. `POST /api/college/subject-semester-assignments` — SubjectInstanceService.expandInstances: read `courseId_yearN` timings (:52-81), master doc (:84), dept+course context (:112-113), parent-department name resolution (:160), upsert `subjectSemesterAssignments/{instanceDocId}` (:185).
  3. Assignments listable per course/year/semester (:271-273).
- **Alternate/error:** missing timing → 400/409; master subject missing courseId/regulation → rejected by validation (validation.test.ts).
- **UI:** `/academics/assign-semester`.
- **API:** `subject-semester-assignments` (GET/POST/DELETE).
- **Backend:** `src/lib/subjects/services/SubjectInstanceService.ts`.
- **DB:** `subjectSemesterAssignments`, `subjects`, `courseYearTimings`, `departments`, `courses`.
- **Permissions:** requireCollegeMember + office-role/HOD checks `[UNVERIFIED exact]`.
- **Validation:** instance id uniqueness (courseId_year_semester_subject).
- **State transitions:** none (instance existence = assigned).
- **Side effects:** none async.
- **Concurrency:** upsert by deterministic doc id → idempotent.
- **Code evidence:** service lines above; branch diff touched route.ts (git status) + `subjects-to-attendance-pipeline.spec.ts` e2e.
