# Flow Audit: Subjects Import → Fan-out → Teaching Assignments → Timetable → Student Attendance → Reports

**Date:** 2026-10-05 · **Scope:** read-only code audit, nothing was run or changed.
**Method:** every route and lib named below was read in full or by its Firestore call sites. Items are tagged **[V]** verified in code, **[P]** plausible and needs a live check, **[E]** estimate.

## 1. Verdict

The **write paths are well built**, the **read paths are the problem**. The chain works as designed and has strong integrity controls. The risks are cost and data growth on reads, plus a few permission gaps.

| Stage | Works as intended? | Notes |
|---|---|---|
| Import (`subjects/import-and-assign`) | Yes | validate → one transaction → read-back verify. Deterministic master ids stop twin masters. UI shows `verification.problems`. |
| Fan-out to dept / year / sem | Yes | instance id `master_dept_sem`. Year is cross-checked against CourseYearTimings and dept scope. |
| Teaching assignment | Yes | Transaction under a per-section guard doc. Checks that the subject was assigned to the dept/year/sem first. |
| Timetable draft → publish | Yes | One transaction with section + faculty guards. Deterministic slot ids. Capped at 450 writes. |
| Mark attendance | Yes | Window check against the published timetable. Roster merge in a transaction. Locks ON_DUTY entries. |
| Reports | Correct but expensive | Counting is shared (`counting.ts`). Cost scales with total history, not the requested range. |

## 2. Data layer map

Counts are per call. `R/W/D` = Firestore document reads, writes, deletes. `N`≈60 students per section.

| Operation | Reads | Writes | Deletes | Source |
|---|---|---|---|---|
| Import validate | ~250–600 (depts, all course instances, all course-group masters, categories, timings) | 0 | 0 | CourseStructureImportService.loadContext [V] |
| Import commit | validate + ~500–1.5K (tx re-read + verify) | masters + instances (≤500) | legacy keys | same [V] |
| Assign / unassign subject | ~6 (+1 per timing year) / full TA scan by subjectId + all depts | 1–2 | 1–2 | SubjectInstanceService [V] |
| Teaching assignment POST | ~120 (**all depts read up to 3×**, instances, tx queries) | ~6 (assignment, slots, guard, audit) | 0 | teaching-assignments/route.ts [V] |
| Teaching assignment DELETE | ~5 + slots | 2 + guard | slots + 1 | deleteAssignment.ts [V] |
| Timetable-slots GET (grid) | slots of section (all years) + **every master subject of the course** (~100–300) | 0 | 0 | timetable-slots/route.ts:74 [V] |
| Publish draft | ~400 (section slots + **all slots of each involved faculty, all history**) | slots + guards + draft | stale slots | publishDraft.ts [V] |
| Attendance create (POST) | ~75 (N roster + ~15) | 1 | 0 | student-attendance/route.ts [V] |
| Attendance save/submit (PATCH) | ~10 | 1 per save | 0 | student-attendance/[id]/route.ts [V] |
| `today-periods` | ~60 (**all of the faculty's slots, all history**, + TA/session batch) | 0 | 0 | currentPeriod.ts:190 [V] |
| Section report, month / till-now | ~250 / ~1.3K (one doc per period, each with the full roster) | 0 | 0 | section-attendance-report [V] |
| Percentage report | ~1.4K per section × sections in scope (~14K for 10) | 0 | 0 | attendance-percentage-report [V] |
| Per-student history (staff) | whole dept's SUBMITTED sessions in range (~3K month, ~20K/yr, all years if unbounded) | 0 | 0 | history.ts:loadSessionsInRange [V] |
| Student self-view | 0 on cache hit, **whole-dept scan on miss** | 0 | 0 | history.ts:getDepartmentTallies [V] |
| Not-posted sweep, per college per day | ~4K (all weekday slots) + ~45 × faculty (~95K at 2K faculty) | markers (~few K) | 0 | notPostedSweep.ts [V] |

## 3. Cost estimate (Firestore only)

**Scenario** (same as `COST_ESTIMATION.md`): 30K students, 2K faculty, ~500 sections, 8 periods/day, 25 teaching days/month → **~4,000 attendance sessions/day, 100K/month**.
**Rates:** US multi-region list price, $0.06 / $0.18 / $0.02 per 100K R/W/D. Your region may differ. Free tier and egress are excluded.

| Layer (monthly, steady state) | Reads | Writes | Cost |
|---|---|---|---|
| Mark attendance: create (100K × ~75) | 7.5M | 100K | $4.5 + $0.18 |
| Mark attendance: save/submit (3 saves × 100K) | 3.0M | 300K | $1.8 + $0.54 |
| `today-periods` (2K faculty × 4 opens × 25 × ~60) | 12M | 0 | $7.2 |
| Not-posted sweep | 2.6M | ~5K | $1.6 |
| Timetable grid reads + TA reads *(carried from COST_ESTIMATION.md, not re-derived)* | 31.7M | 80K | $19 + $0.14 |
| Staff reports: section (1.2M) + percentage (2.8M; up to 14M at exam time) + per-student history (7.5M) | 11.5M | 0 | $6.9 |
| **Subtotal without student self-view** | **~68M** | **~485K** | **~$41 + ~$0.9 ≈ $42/mo** |
| **Student self-view** (30K students, dept scans, see F-1) | **~200M (60M–1.5B)** | 0 | **~$120 ($36–$900)** |
| **Total** | **~270M** | **~485K** | **~$160/mo (range ~$80–$950)** |

**Storage:** an attendance session is ~8–10 KB (roster embedded) → ~0.9 GB added per month, ~10 GB per year → ~$1.7/mo more each year, plus index overhead. Cheap in dollars, but see F-6.
**One-off:** an import is ~2K reads and ~130 writes per department file, so a regulation rollout across 30 departments is under $0.05. Setting up a term's teaching assignments (4,000 × ~120 reads) is ~0.5M reads, about $0.30.

**Takeaway:** writes are almost free. Over 95% of spend is reads, and the self-view scan alone is about three-quarters of the total. `COST_ESTIMATION.md` stops at timetable reads (~$0.46) and misses the attendance and self-view layers. Its dollar signs were also stripped, so figures read `.46` instead of `$0.46`.

## 4. Findings, ranked

### High

**F-1. Student self-view scans the whole department's history; the cache is per server instance. [V + E]**
`student/me/route.ts:38` calls `computeStudentAttendanceHistory(..., {}, {cacheMs})`. The empty range makes `loadSessionsInRange` read every SUBMITTED session of the department across all years, each with its full roster. The 3-minute `tallyCache` is an in-process `Map` (max 40 keys). On Vercel serverless it is per warm instance and is lost on cold start. `student/me/attendance` builds a different cache key (different `depts` and range), so the same student can trigger two scans.
*Fix:* always bound by the academic-year window (`academicYearWindow.ts` already exists). Use a 15-minute TTL, or a Firestore-stored per-dept tally doc rebuilt on submit or by cron. Longer term, keep a per-student rollup.

**F-2. Firestore rules let any staff role read all attendance, assignments and slots. [V in repo rules, P live]**
`firestore.rules:555-602`: `read: if isStaff(collegeId)` for `studentAttendance`, `teachingAssignments` and `timetableSlots`. `isStaff` includes `PANEL_MEMBER` (every faculty login), `ACCOUNTS`, `FINANCE`, `PURCHASE_DEPT` and `WEBMASTER`. With the client SDK, any of them can read every student's name, roll number and marks across all departments. That bypasses the HOD scope check and the class-incharge check in `section-attendance-report`. CLAUDE.md says the repo file is ahead of the live ruleset, so check what is deployed.
*Fix (needs your approval, `firestore.rules` is a protected boundary):* set `studentAttendance` read to `isHODorAbove`, or `false` since every reader is a server route.

### Medium

**F-3. `today-periods`, `checkFacultyPeriodWindow` and the sweep read all of a faculty's slots, including past semesters and years. [V]**
`currentPeriod.ts:190` queries `facultyId == X` and filters `day` in memory. Published slots from older semesters and years are kept "as history" (`publishDraft.ts`, `timetable-slots/route.ts:84`), so this gets bigger every year. `resolvePeriodWindow` filters by semester but **not by academic year**. [P] If the same semester number is republished next year under the same assignment, two slots could match one day and period, which would show a duplicate row in the faculty's list and in the sweep.
*Fix:* `.where("facultyId","==",x).where("day","==",day)`. Two equality filters need no composite index and cut reads ~6×. Then add an academic-year check next to the semester check.

**F-4. ~~`office-correction` writes no audit log~~ — CORRECTED, mostly wrong. [V]**
The submit step (`office-correction/[id]/route.ts:133`) does write a `STUDENT_ATTENDANCE_OFFICE_CORRECTED` audit log. Only the draft-creation POST (`office-correction/route.ts`) writes none. That is low risk, since a draft is not a submitted record. An earlier version of this report said the whole path was unaudited because only the POST file was checked.

**F-5. Timetable slot POST/DELETE skip the managed-branch year gate. [V]**
`timetable-slots/route.ts:193` and `[id]/route.ts:28` use `canHodEditDepartment`, which includes managed branches for all years. `teaching-assignments` POST/DELETE use `canHodEditDepartmentYear`. A shared-first-year manager HOD (e.g. Basic Science) can therefore pin or delete slots in a managed branch's own later years, which the assignment routes explicitly forbid.

**F-6. Unbounded growth. [V]**

| Collection | Growth | Cleanup |
|---|---|---|
| `studentAttendance` | ~1M docs/yr, ~10 GB/yr, roster embedded in each | none. History and report cost grow with it. |
| `timetableSlots` | ~56 per section per semester per year, old ones kept | none |
| `teachingAssignments` | `isPast` kept, sections reused every year | manual |
| `attendanceNotPostedSent` | one marker per missed period per day | none |
| `timetableDrafts` | PUBLISHED drafts kept, each holds a slots array | none found |
| `timetableGuards` | 1 per section and per faculty, bounded (~2.5K) | n/a |

*Fix:* year-end job that rolls attendance sessions into per-student tallies and archives or deletes sessions older than N years. Delete slots, markers and drafts older than 2 academic years.

**F-7. N+1 and over-read patterns. [V]**
- `teaching-assignments` POST reads the full `departments` collection up to 3× per call (`:412`, `:517`, `loadDepartmentIndex`). The HOD GET reads `departments` and `courses` in full. Reuse the one index already loaded.
- `timetable-slots` GET (`:74`) loads **every master subject of the course** to join `type` onto ~56 slots. A `getAll` of the slots' own `subjectId`s would read ~10.
- `subject-semester-assignments` GET reads every instance of a course and filters department, year and semester in memory. Add `.where("departmentId","==",…)`. It is two equalities, so no new index.
- `teaching-assignments` GET resolves the current semester sequentially per course-year and chunks subject lookups with sequential `await`s in a loop. Use `Promise.all`.
- `attendance-percentage-report` loops sections sequentially, with three queries per section. 10–30 sections is serial latency, and each section reads a year of full-roster sessions.
- `import-and-assign` reads all departments, all categories and all course instances on every validate and again on commit.

### Low

- **F-8. TOCTOU in unassign.** `unassignSubjectInstance` checks for live assignments, then deletes, outside a transaction. An assignment created between the two points at a removed instance. Wrap both in one transaction, or lock the section guard.
- **F-9. Legacy semester-scoped assignment shape is likely dead for HODs.** The POST branch at `teaching-assignments/route.ts:675` checks `subject.department`, but masters created by import never carry that field. `canHodEditDepartment("")` returns false, so HODs always get 403 there. That is safe, but it is a UI dead end. Confirm and remove, or fix.
- **F-10. Read endpoints with no per-role scope.** `teaching-assignments` GET (`sectionId`, or `courseId`+`year`) and `subject-semester-assignments` GET let any `PANEL_MEMBER` or `COLLEGE_STAFF` read other departments' assignments, bypassing `isTimetableIncharge`. Intra-college disclosure only.
- **F-11. Import has no audit log.** Creating masters and instances for a whole course is unaudited (`CourseStructureImportService`, `subjects/[id]`, `subject-semester-assignments`).
- **F-12. `classNotes` has no length cap** on attendance PATCH, so it can inflate a session doc.
- **F-13. Error leakage.** `subject-semester-assignments` POST returns `err.message` with a 400.
- **F-14. `attendance-percentage-report` roles** are `EXAM_CELL`, `PRINCIPAL`, `VICE_PRINCIPAL`, `SUPER_ADMIN`, so HOD cannot use it. Confirm that is intended. The in-route `READ_ROLES.includes` re-check is redundant.

### UI fallbacks and silent failures [V in API, UI not audited]

- `today-periods` returns `periods: []` when the login isn't linked to a faculty record, so the faculty sees "no classes" rather than "profile not linked". The student route does return an explanatory message.
- `studentDepartmentsForHistory` swallows `departmentHistory` read errors (console only). A promoted student's earlier years are then silently dropped from the report.
- Import commit returns **201 with `ok:true`** even when `verification.problems` is non-empty. The page does render it (`course-structure/page.tsx:706`), but any other consumer would miss it.
- `subject-semester-assignments` accepts `year == null` as a match for any year, so instances without a year show under every year.

### Verified controls (no action)

Attendance PATCH blocks edits after SUBMITTED, locks ON_DUTY entries, checks the period window and `facultyId` ownership, and uses optimistic concurrency. Assignment create and delete are transactional with guard docs. Publish is a single transaction. Deleting or unassigning a subject or master is blocked while it is in use. Student attendance rules are server-write-only. Cron uses a constant-time bearer compare.

## 5. Suggested order

1. F-3 one-line query change (biggest cheap read saving).
2. F-1 bound and extend the self-view cache (biggest dollar saving).
3. F-2 confirm live rules, then tighten (needs your sign-off).
4. F-4 and F-5 permission and audit consistency.
5. F-7 N+1 clean-ups.
6. F-6 retention job, before year-end.

## 6. Not covered

UI components were only spot-checked. `timetable/draft`, `office-correction` and `section-attendance-report` bodies were read for guards and queries, not every branch. Nothing was run, and e2e needs a seeded environment. Live Firestore rules, deployed indexes, real traffic and real region pricing were not checked, so section 3 is a model, not a bill. Plug your actual volumes into the section 2 table for a firmer number.
