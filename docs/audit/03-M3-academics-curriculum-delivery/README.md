# M3 — Academics: Curriculum & Delivery (as-is)

## Purpose
Defines what is taught (catalog, courses, subjects), who teaches it (teaching assignments + cross-department requests), when (timetable draft/publish with rules engine, course-year timings), and internal assessment (exam configs, internal marks, mid-paper setters).

## Status: Implemented; recently rebuilt chain (subjects→assignments→timetable→attendance) per branch context + `run-tests` gap notes resolved (subjects-to-attendance pipeline e2e exists).

## Submodules
| ID | Submodule | Status |
|---|---|---|
| M3-SM1 | Course Catalog & Courses | Implemented (catalog shared with M1-SM5 custody) |
| M3-SM2 | Subjects (master vs semester-scoped) & Import | Implemented (+ categories, validation tests) |
| M3-SM3 | Assign to Semester (subject-semester-assignments) | Implemented (recently fixed — route.ts modified on branch) |
| M3-SM4 | Sections & Sub-Departments | Implemented (rich dept model + tests) |
| M3-SM5 | Teaching Assignments + Assignment Requests | Implemented |
| M3-SM6 | Timetable (Draft/Publish, Rules, Incharge delegation, substitutions overlay) | Implemented |
| M3-SM7 | Course-Year Timing / Semester Timings | Implemented |
| M3-SM8 | Internal Exam / Internal Marks / Mid-Paper-Setter (+ exam circulars/guidelines) | Implemented |

## Dashboards/roles
Principal (courses/departments/sections/timetable/internal-marks), VP (shares principal), HOD (subjects/sections/teaching/timetable/internal-exam/mid-paper-setter), Academics office (12 pages: subjects, import, assign-semester), College Office (timings), College Staff/Panel (timetable-incharge, assignment-requests), Exam Cell (15 pages), Class Leader (timetable read), Panel (mid-bank).

## Dependencies
- Depends on M1 (users, roles, settings/academic-years), M4 (sections populated by students), M6 (substitutions overlay).
- Depended on by M5 (timetableSlots drive period detection), M4 (section rosters), M9 (exam circulars).

## Key code locations
- Types: `src/types/teaching.ts` (497 lines: Subject:34, SubjectSemesterAssignment:103, TeachingAssignment:141, FacultyAssignmentRequest:210, TimetableSlot:256, TimetableRules:344, TimetableDraft:401), `src/types/examConfig.ts:31`, `src/types/exams.ts:21` (InternalExamMarksBatch), `src/types/midPaper.ts:17`, `src/types/core.ts:780` (CourseYearTiming), `:825` (TimetableIncharge), `:2651` (Section).
- Libs: `src/lib/timetable/*` (currentPeriod, buildGrid, loadContext:49-85, hoursMatch, sharedYearTiming), `src/lib/subjects/services/SubjectInstanceService.ts` (master→instance:52-273), `src/lib/college/{semester,academicStructure,academicSession}.ts`, `src/lib/departments/{timetableIncharge,managedBranches,scope,courseSelections,renameCascade}.ts`, `src/lib/exams/internalExamMarks.ts`, `src/lib/leave/periodCoverage.ts` (substitution overlay at read time — TimetableSlot doc comment teaching.ts:310-330).
- API: `api/college/courses*`, `course-catalog*`, `subjects*`, `subject-semester-assignments`, `sections*`, `teaching-assignments*`, `faculty-assignment-requests*`, `timetable-slots*`, `timetable/draft|publish`, `timetable-incharges`, `course-year-timings`, `exam-configurations`, `internal-exam-marks*`, `mid-paper-assignments`, `exam-circulars*`, `exam-guidelines*`.
- UI: `/academics/**` (12), `/hod/{subjects,sections,teaching,timetable,internal-exam,mid-paper-setter}`, `/principal/{courses,departments,sections,timetable,internal-marks}`, `/college-staff/timetable-incharge/**`, `/panel/{timetable-incharge,internal-exam,mid-bank,assignment-requests}`, `/exam-cell/{configure,guidelines}`.

## Key APIs / stores / jobs
- Stores: `courses`, `courseCatalog`, `subjects`, `subjectSemesterAssignments`, `sections`, `departments`, `teachingAssignments`, `facultyAssignmentRequests`, `timetableSlots`, `timetableDrafts/{sectionId}` (teaching.ts:378-380), `timetableIncharges` (doc id `courseId_yearN` — departments/timetableIncharge.ts:22-23), `courseYearTimings`, `examConfigurations`, `internalExamMarks`, `midPaperAssignments`, `examCirculars`, `examGuidelines`, `settings/timetableRules` (teaching.ts:349-351).
- Jobs: none scheduled.

## Major gaps
1. Timetable publish authority check details (incharge vs HOD) `[UNVERIFIED per-route]`.
2. Solver diagnostics surface (rules failures) UI `[UNVERIFIED]`.
3. Mid-paper `status: "ASSIGNED"` single-state (midPaper.ts:15) — no completion state `[GAP]`.
