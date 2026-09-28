# M3 — Data Flow (as-is)

## M3-SM1/SM2 Catalog → Courses → Subjects

**Actors:** Principal (catalog/courses), Academics office (subjects), HOD (dept subjects view).
**Flow:** catalog entries (with regulations) → courses bound to academic years (`course-academic-years`) → master subjects (courseId+regulation) or semester-scoped (department+semester) via `POST /api/college/subjects` (validation.test.ts asserts the two shapes) → import via Excel.
**Stores:** `courseCatalog`, `courses`, `academicYears`, `subjects`.

## M3-SM3 Assign to Semester

**Actor:** Academics office (`/academics/assign-semester`).
**Flow:** pick course → year → semester → subjects (master filtered by courseId+regulation) → `SubjectInstanceService` upserts `subjectSemesterAssignments/{instanceDocId}` (:185) using `courseId_yearN` timings (:52-81); department context resolved incl. parent-department (:112-160).
**Recently fixed:** route.ts modified on this branch (git status) — old catalogId+year model replaced (report gap #2 resolved) `[ASSUMPTION from diff]`.

## M3-SM4 Sections & sub-departments

**Actors:** HOD (own sections), Principal (college-wide), Academics (import).
**Flow:** departments (with parentDepartmentId/managedDepartments) → sections (courseId+year+section, secondaryDepartments for cross-dept, labBatches) → students distribute-cohort (M4) fills them.
**Guardrails:** branch in ≤1 sub-department (managedBranches, 409 + tx — AGENTS.md); renameCascade updates references.

## M3-SM5 Teaching assignments & requests

**Actors:** HOD (assign), faculty (accept/decline via requests), College Staff/Panel (inboxes).
**Flow:** `POST teaching-assignments` (subject+section+faculty+semester) → cross-dept needs `faculty-assignment-requests` PENDING→ALLOCATED|DECLINED (teaching.ts:208) → assignment created on allocation.
**Stores:** `teachingAssignments` (3 indexes), `facultyAssignmentRequests`.

## M3-SM6 Timetable draft → publish

**Actors:** timetable-incharge (delegated faculty) or HOD.
**Flow:**
1. Load context (loadContext.ts:49-85: section, courseYearTimings, rules, assignments, subjects, existing slots, courses, departments).
2. Stage slots (manual or generator under TimetableRules hard constraints — solver fails with diagnostics rather than violate, teaching.ts:349-359) → `timetableDrafts/{sectionId}`.
3. Publish (`timetable/publish`): resolve semester (resolveCurrentSemester) + academicYear stamps per slot; stale-generated cleanup excludes other cohorts (teaching.ts:296-309 comment); slots written to `timetableSlots`; prior semesters/sessions preserved as history.
4. Lab blocks: PRACTICAL occupies labBlockSize contiguous periods; no straddling breaks unless allowed.
**Split labs:** two rows same section+day+period different labBatch — display-only split (teaching.ts:267-275).
**Substitutions:** APPROVED leave creates PeriodSubstitution → read-time overlay (substituteFacultyId/Name/Date) via periodCoverage — never written to slot.

```mermaid
sequenceDiagram
    actor TI as Timetable Incharge
    participant UI as timetable editor
    participant D as /api/college/timetable/draft
    participant P as /api/college/timetable/publish
    participant FS as timetableDrafts / timetableSlots
    TI->>D: stage slots (manual/generate)
    D->>FS: upsert timetableDrafts/{sectionId}
    D-->>TI: diagnostics (hard-rule failures)
    TI->>P: publish
    P->>P: resolve semester + academicYear
    P->>FS: write timetableSlots (history preserved)
    Note over FS: drafts remain; live reads filter current semester+year
```

## M3-SM7 Course-year timings

**Actor:** College Office / Principal (`/college-office/timings`, principal timing editor).
**Flow:** `POST /api/college/course-year-timings` upserts `courseYearTimings/{courseId}_year{N}` (periods + semesters) → all slot/period resolution depends on it (currentPeriod.ts:63).

## M3-SM8 Internal exams & mid-paper

**Actors:** Exam Cell (configure), HOD (entry, mid-paper-setter), Panel (mid-bank, marks views), Principal (internal-marks).
**Flow:** `examConfigurations` (id `examConfigId(courseId, year, examType)` — internalExamMarks.ts:82) → `InternalExamMarksBatch` DRAFT→SUBMITTED (exams.ts:11) per subject; mid-paper `POST mid-paper-assignments` (status ASSIGNED — midPaper.ts:15) → setter notified.
**Stores:** `examConfigurations`, `internalExamMarks`, `midPaperAssignments`, `examCirculars`, `examGuidelines`.

## Error paths
- Publish violations → diagnostics, no write.
- managedBranches conflict → 409 naming branch.
- distribution errors → 409 listing missing target sections (M4 handoff).
- Semester propagation: legacy null-semester treated as current (semester-propagation.test.ts).
