# M3 — Test Coverage & Gaps (as-is)

## Existing tests (strongest module)
| Test | Covers |
|---|---|
| `src/app/api/college/subjects/__tests__/validation.test.ts` | subject dual-model validation (6) |
| `src/lib/college/__tests__/semester.test.ts` | resolveCurrentSemester (12) |
| `src/lib/college/__tests__/semester-propagation.test.ts` | slot visibility incl. legacy nulls (11) |
| `src/lib/college/__tests__/academic-session.test.ts` | session labels (5) |
| `src/lib/college/__tests__/academic-structure.test.ts` | regulations from batch (4) |
| `src/lib/college/{academicSession,academicYearStart,semester}.test.ts` | year/session helpers |
| `src/lib/departments/*.test.ts` (10 files) | scope, keys, resolve, stampIds, subDepartmentCourses, sectionEditOwnership, noOwnSectionsFlow, refFields |
| `src/lib/timetable/hoursMatch.test.ts` | load matching |
| E2E: subjects, course-catalog, subject-semester-assignments, teaching-assignments, timetable-slots, sections, course-year-timings, exam-configurations, mid-paper-assignments, integration, system-integration, subjects-to-attendance-pipeline; UI specs for academics pages |

## Missing tests
1. Publish route: stale-generated cleanup correctness across cohorts (history preservation).
2. Incharge authority check (publish/DELETE).
3. Generator diagnostics when hard rules unsatisfiable.
4. SubjectInstanceService (pure-ish, no direct test file found).
5. Exam marks batch transitions (DRAFT→SUBMITTED guards).

## Risky untested flows
- Cross-cohort publish deletion logic (was a historical bug class per teaching.ts comments).
- Concurrent publishes to same section.
