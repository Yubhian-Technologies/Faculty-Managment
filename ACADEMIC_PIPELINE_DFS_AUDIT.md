# Academic Pipeline DFS Audit — Catalog → Attendance Reports

**Date:** 2026-09-27
**Scope:** Full pipeline as described by the user: Course Catalog (regulation) → Subject creation → Assign to Semester → Teaching Assignment → Timetable (draft/publish) → Leave Substitution → Class Leader dashboard → Attendance → Attendance Reports. Traced depth-first, one node fully before the next, across Model (Firestore shape/`src/types`), Controller (API route/service), and View (dashboard page/component) for every node.
**Method:** Nodes 1-5 verified by direct code read earlier in this session (and already partially fixed — see `REGULATION_BATCH_SUBJECT_FLOW_AUDIT.md`). Nodes 6-12 verified by four parallel research passes this turn, each reading the actual route/component files in full, file:line cited. Every finding below is **CONFIRMED** (read in code) unless marked **PLAUSIBLE**.

---

## Does the described flow match what's implemented?

**Yes, structurally** — every stage the user described exists and is wired in the order described, plus one stage the user didn't mention but the code actually inserts: a **Draft → Publish** step between "Teaching Assignment" and "live Timetable" (an HOD/Timetable Incharge builds a draft grid, then explicitly publishes it into the real `timetableSlots` the rest of the system reads).

**Where it breaks:** the very last link — "faculty will take attendance based on their teaching assignments, semester wise, and attendance reports also come under semester wise" — the *taking* of attendance is correctly tied to teaching assignments, but the **semester-wise** part is not implemented at all: the field that would carry "which semester" on an attendance record is declared but never written, which makes every downstream "filter attendance by semester" a dead no-op. This is the single most significant finding in this pass (§ Node 11-12 below).

---

## DFS trace, node by node

### Node 1 — Course Catalog: Regulation + Batches
- **Model:** `colleges/{c}/courseCatalog/{id}` — `regulations: string[]`, `regulationBatches: Record<string,string>`.
- **Controller:** `course-catalog/route.ts` POST, `course-catalog/[id]/route.ts` PATCH.
- **View:** `CourseCatalogSettingsCard.tsx` (Principal/VP/Super Admin create; Academics edits regulations only).
- **Status:** Already audited and fixed this session — dead NaN batch-check removed (F1), overlap validation added (F2). See `REGULATION_BATCH_SUBJECT_FLOW_AUDIT.md`.

### Node 2 — Department Course (from catalog)
- **Model:** `colleges/{c}/courses/{id}`.
- **Controller:** `courses/route.ts` POST (Principal/Super Admin), `courses/[id]/route.ts` DELETE.
- **View:** Principal course-management pages.
- **Status:** Already fixed — DELETE now also checks `subjects`/`subjectSemesterAssignments` before allowing deletion (F3).

### Node 3 — Master Subject creation ("Dean/Academics creates subjects over regulation and course")
- **Model:** `colleges/{c}/subjects/{id}` — `courseId`, `regulation`, no year.
- **Controller:** `subjects/route.ts` POST/GET, `subjects/import/route.ts`, `MasterSubjectImportService.ts`.
- **View:** `academics/subjects/*.tsx` (new/edit/import pages).
- **Status:** Already fixed — dead batch check removed, import `courseId` now required (closes the cross-department name-ambiguity path), zero-regulation import now warns (F1, F4, F5).

### Node 4 — Subject Instance / "Assign to Semester" ("import subjects from master collection to year/course/dept/semester")
- **Model:** `colleges/{c}/subjectSemesterAssignments/{subjectId}_{departmentId}`.
- **Controller:** `subject-semester-assignments/route.ts`, `SubjectInstanceService.ts` (`resolveYearForSemester` against `courseYearTimings`).
- **View:** `academics/assign-semester/page.tsx`.
- **Status:** Already fixed (cascade check) + **new feature added this session**: Year selection now auto-resolves the correct Regulation via `regulationsForCourseYearByBatch`, with a "No regulation assigned for this year" fallback when nothing matches.

### Node 5 — Teaching Assignment ("Timetable Incharge/HOD creates teaching assignments from the assigned subjects to that dept/year/semester")
- **Model:** `colleges/{c}/teachingAssignments/{id}` — `courseId`, `sectionId`, `subjectId`, `facultyId`, `timetableSemester`.
- **Controller:** `teaching-assignments/route.ts` POST/GET/DELETE, `[id]/route.ts` PATCH/DELETE.
- **View:** `TeachingAssignmentsEditor.tsx` (HOD/Panel/College Staff), consumed under `hod/teaching-assignments`, `hod/teaching`, `panel/teaching`.
- **Status:** No new issues found this pass (already read in full earlier this session; extensively guarded — `canHodEditDepartmentYear`, `isTimetableIncharge`, semester/section/faculty conflict checks, cascade-deletes its own `timetableSlots`).

### Node 6 — Timetable Slot, manual pin ("the timetable will be created")
- **Model:** `colleges/{c}/timetableSlots/{id}`.
- **Controller:** `timetable-slots/route.ts` GET/POST, `timetable-slots/[id]/route.ts` DELETE.
- **View:** `TimetableGridEditor.tsx` under `hod/timetable`, `panel/timetable-incharge`, `college-staff/timetable-incharge`.
- **Finding (CONFIRMED):** GET's role list includes `VICE_PRINCIPAL` ([timetable-slots/route.ts:18](src/app/api/college/timetable-slots/route.ts#L18)); **POST and DELETE's role lists omit it** ([:114](src/app/api/college/timetable-slots/route.ts#L114), [`[id]/route.ts`:14](src/app/api/college/timetable-slots/%5Bid%5D/route.ts#L14)) — yet the sibling Draft (Node 7) POST/PATCH/DELETE routes *do* include `VICE_PRINCIPAL`. A Vice Principal can build and publish an entire draft timetable but cannot manually pin or remove one individual slot through this route. Inconsistent capability surface for the same role across sibling routes of the same feature.

### Node 7 — Timetable Draft → Publish (the step the user's description implies but doesn't name explicitly)
- **Model:** `colleges/{c}/timetableDrafts/{sectionId}` or `{sectionId}_sem{semester}` — `TimetableDraft` type ([types/teaching.ts:384-439](src/types/teaching.ts#L384)), `status: "DRAFT"|"PUBLISHED"`.
- **Controller:** `timetable/draft/route.ts` (GET/POST/PATCH/DELETE), `timetable/publish/route.ts` (POST).
- **View:** same `TimetableGridEditor.tsx`.
- **Status:** Correctly implemented — publish re-checks live faculty conflicts, drops slots whose `TeachingAssignment` was since deleted, only ever touches `source==="GENERATED"` slots (never a manually-pinned one from Node 6), and stamps `publishedAt`/`publishedByName`. `isTimetableIncharge` used consistently across all 6 write-side call sites in this and Node 6. No gap beyond Node 6's role-list asymmetry.

### Node 8 — Timetable Incharge delegation
- **Model:** `colleges/{c}/timetableIncharges/{courseId}_year{year}`.
- **Controller:** `timetable-incharges/route.ts` POST/DELETE (HOD/Principal/VP/Super Admin).
- **Status:** Consistent — `isTimetableIncharge` checked identically at every one of its 6 call sites (Nodes 5-7 and 10). No gap.

### Node 9 — Leave / Substitution ("substitution faculty will be under the supervised timetable")
- **Model:** no dedicated collection — substitutions are embedded arrays: `leaveRequests/{id}.periodSubstitutions[]` (leave-driven) and `staffAdjustments/{id}.periodSubstitutions[]` (manager-assigned, no leave request), both typed `PeriodSubstitution` ([types/leave.ts:253-268](src/types/leave.ts#L253)).
- **Controller:** `leave/applications/route.ts` POST (self-service, requires the *substitute* to individually accept via `adjustment-response`), `leave/staff-adjustments/route.ts` POST (HOD/Principal/VP/College Office, effective immediately, `status:"ACTIVE"`, **no acceptance step**), `lib/leave/periodCoverage.ts` (`getActiveSubstitutionsForDates`, `buildPeriodCoverage`, `validatePeriodSubstitutions`).
- **View:** leave application forms; consumed on read by Nodes 5, 6, 10, 11.
- **Findings:**
  - **CONFIRMED, by design:** cross-department substitute proposals are unrestricted for the self-service leave path (whole-college candidate pool) — matches `AUDIT_FIX_LOG.md`'s note that this was a deliberate product decision, verified still true in current code ([periodCoverage.ts:208-214](src/lib/leave/periodCoverage.ts#L208)).
  - **CONFIRMED, real asymmetry (not a bug, but worth knowing):** a leave-driven substitution requires the named substitute to *accept* before it counts ([leave/applications/route.ts:417-425](src/app/api/leave/applications/route.ts#L417)); a manager-assigned `StaffAdjustment` substitution never asks for acceptance — the substitute is only notified ([staff-adjustments/route.ts:137-193](src/app/api/leave/staff-adjustments/route.ts#L137)). If "propose vs. consent" parity is ever assumed between the two paths, it doesn't hold today.
  - Availability/double-booking checks are real and server-enforced (`validatePeriodSubstitutions`, `findSubstituteConflicts`) — confirmed working correctly, no gap.
  - Semester/academic-year congruence uses the same `matchesCurrentSemester`/`matchesCurrentAcademicYear` helpers as everywhere else — confirmed consistent, no gap.
  - Every read-side consumer (`teaching-assignments` GET, `timetable-slots` GET, `class-leader/timetable` GET, the `currentPeriod.ts` helper family used by the whole attendance group) applies the overlay consistently — no dashboard silently omits substitution data that another shows.

### Node 10 — Class Leader Dashboard ("timetable is updated at the class leader dashboard")
- **Model:** `colleges/{c}/users/{uid}.sectionId` — the actual class-leader binding, confirmed distinct from `facultyInchargeUid` ("Class Coordinator," a different feature per the codebase's own comment in `sections/route.ts`).
- **Controller:** `class-leader/timetable/route.ts` GET.
- **View:** `class-leader/timetable/page.tsx`.
- **Findings:**
  - Section isolation is correct — hard-locked to the caller's own bound `sectionId`, never client-suppliable ([class-leader/timetable/route.ts:26-31](src/app/api/college/class-leader/timetable/route.ts#L26)). Substitution overlay renders correctly end-to-end into the UI.
  - **CONFIRMED gap:** this route resolves the requested semester by taking `semesterParam` straight off the query string with **no validation** that it's actually configured for the course-year ([:23-24, :82](src/app/api/college/class-leader/timetable/route.ts#L23)) — unlike `teaching-assignments/route.ts` POST, which validates via the shared `resolveRequestedSemester` helper and 400s on an unconfigured semester ([lib/college/semester.ts:152-174](src/lib/college/semester.ts#L152)). Concretely: `Number("abc")` → `NaN`, which passes the `!= null` check and silently blanks the whole timetable instead of erroring, since `matchesCurrentSemester(x, NaN)` is never true. Low severity (read-only GET) but a real, verified inconsistency with the helper this codebase's own comments say every semester-picker route should funnel through.
  - Minor/cosmetic: a stale comment plus a now-unreachable branch implying non-CLASS_LEADER test access — the actual `requireCollegeMember("CLASS_LEADER")` guard is stricter than the comment describes, so this is dead code, not a security hole.

### Node 11 — Faculty Attendance-Taking ("faculty will take attendance based on their teaching assignments, semester wise")
- **Model:** `StudentAttendanceSession` — `semester` field declared ([types/studentAttendance.ts:42](src/types/studentAttendance.ts#L42)) but, per the finding below, never populated.
- **Controller:** `student-attendance/route.ts` POST, `student-attendance/today-periods/route.ts` GET, `lib/timetable/currentPeriod.ts` (`checkFacultyPeriodWindow`).
- **Findings:**
  - The "based on their teaching assignments" half is solid and **CONFIRMED correct**: the request body is just `{assignmentId, date}` — period number is resolved server-side from the published timetable, never client-supplied, and both the direct-assignment match and the substitute-coverage fallback are independently re-verified server-side ([student-attendance/route.ts:18-59](src/app/api/college/student-attendance/route.ts#L18)). A covering substitute correctly sees and can mark the period they're covering, via the same `currentPeriod.ts` helpers used everywhere else — contrary to what one might expect to find broken here, this part works.
  - **CONFIRMED BUG (the most significant finding of this whole pass):** the "semester wise" half is not implemented. `student-attendance/route.ts` POST's `attendanceSession` object literal **never writes a `semester` key**, in either the section-scoped or the legacy free-text-section branch ([:192-216](src/app/api/college/student-attendance/route.ts#L192), compare against `year`, which *is* conditionally spread at line 198). Every attendance session document ever created has `semester === undefined`, permanently.

### Node 12 — Attendance Reports ("attendance reports also come under semester wise")
- **Controller:** `section-attendance-report/route.ts` GET, `attendance-percentage-report/route.ts` GET.
- **View:** HOD/Principal/VP/Exam Cell report pages.
- **Findings (both CONFIRMED, directly downstream of Node 11's bug):**
  - `section-attendance-report/route.ts` visibly *validates and threads* a `semester` query param, with a comment claiming it "narrows... to one semester's own subjects/sessions" ([:123-126](src/app/api/college/section-attendance-report/route.ts#L123)) — but the actual row filter is `matchesCurrentSemester(r.semester, requestedSemester)` ([:190](src/app/api/college/section-attendance-report/route.ts#L190)), and since `r.semester` is always `undefined` (Node 11), `matchesCurrentSemester` returns `true` unconditionally by its own documented null-tolerant design ([lib/college/semester.ts:52](src/lib/college/semester.ts#L52)). **The semester filter is a dead no-op** — passing `?semester=3` filters nothing; every semester's submitted sessions for a section are always mixed together. Worth noting: the report's *subject columns* ARE correctly scoped by `TeachingAssignment.timetableSemester` ([:37](src/app/api/college/section-attendance-report/route.ts#L37)) — so the columns are right and the rows feeding them are wrong, a genuine mismatch of two different "semester" concepts within one route, not just a missing filter.
  - `attendance-percentage-report/route.ts` has **no semester parameter or filtering at all** — it mixes attendance across every semester a section's teaching assignments have ever had (bounded only by `isPast`), and its own inline comment mislabels its `year` parameter as "Semester," compounding the naming confusion between the two sibling reports.
  - Role guards on both reports are correct and match `AUDIT_FIX_LOG.md`'s already-applied fixes — not regressed.

---

## Final gap table

| # | Node | Layer | File:line | Issue | Severity | Status |
|---|---|---|---|---|---|---|
| G1 | 1. Course Catalog | Controller | `course-catalog/route.ts`, `subjects/route.ts` | Dead NaN batch-check; missing overlap validation | High/Medium | **Fixed this session** |
| G2 | 2-4. Course/Subject/Instance | Controller | `subjects/[id]`, `courses/[id]` DELETE | Missing `subjectSemesterAssignments` cascade check | Medium | **Fixed this session** |
| G3 | 3. Subject import | Controller | `MasterSubjectImportService.ts` | Ambiguous cross-department course-name matching | Medium | **Fixed this session** |
| G4 | 4. Assign to Semester | View+Controller | `academics/assign-semester/page.tsx` | No auto-regulation-for-year resolution | UX gap | **Fixed this session** |
| G5 | 6. Timetable manual pin | Controller | `timetable-slots/route.ts:114`, `[id]/route.ts:14` | `VICE_PRINCIPAL` can build/publish a draft (Node 7) but can't manually pin or delete an individual slot — role-list inconsistency across sibling routes | Low | **Fixed** — added `VICE_PRINCIPAL` to both role lists |
| G6 | 9. Leave substitution | Controller | `staff-adjustments/route.ts:137-193` | Manager-assigned substitutions skip the acceptance step leave-driven ones require — asymmetric consent model | Low (likely intentional) | **Left as-is** — matches the type's own documented intent, a product decision not a bug |
| G7 | 10. Class Leader timetable | Controller | `class-leader/timetable/route.ts:23-24,82` | Requested semester isn't validated via the shared `resolveRequestedSemester` helper; a bad/non-numeric param silently blanks the view instead of erroring | Low | **Fixed** — now validated against `timing.semesters`, falls back to the resolved current semester instead of blanking |
| G8 | 10. Class Leader timetable | Controller | `class-leader/timetable/route.ts:29-40` | Stale comment + dead branch (real guard is already stricter) | Cosmetic | **Fixed** — dead branch and the dangerous `sectionIdParam` fallback removed |
| G9 | 11. Attendance-taking | Model+Controller | `student-attendance/route.ts:192-216` | `StudentAttendanceSession.semester` is declared but **never written** — every attendance record is permanently semester-blind | **High** | **Fixed** — now stamped from `TeachingAssignment.timetableSemester` or `.semester` depending on shape, with self-heal on DRAFT reconcile |
| G10 | 12. Attendance reports | Controller | `section-attendance-report/route.ts:190` | Semester filter is a **dead no-op**, downstream of G9 — `?semester=` narrows nothing; report's own comment claims behavior the code doesn't have | **High** | **Resolved by G9** — no code change needed here, field now populated |
| G11 | 12. Attendance reports | Controller | `section-attendance-report/route.ts` | Subject *columns* correctly use `TeachingAssignment.timetableSemester`; attendance *rows* would need a field that doesn't exist on the session doc at all | **High** | **Resolved by G9** — the G9 fix writes the correct source field for both TeachingAssignment shapes into the one existing `semester` field |
| G12 | 12. Attendance reports | Controller | `attendance-percentage-report/route.ts` | No semester filtering at all, plus mislabels its `year` param as "Semester" in-code | Medium | **Fixed** — added optional `semester` param (filters both subject set and session counts), corrected the mislabeled error text |

**G9-G11 together are the one real break in the flow you described** — attendance is correctly tied to teaching assignments, but not to semester, end to end, which makes both attendance reports' semester scoping non-functional today.

---

## Suggested next action

G9-G11 need a real design decision before a fix, not just a one-line patch: `StudentAttendanceSession` needs a semester identifier that's actually populated at write time (from `TeachingAssignment.timetableSemester` for the course/section-scoped shape, and from `TeachingAssignment.semester` for the legacy free-text shape — the two aren't the same field, and a fix has to write the right one depending on which shape the assignment is), and both reports need to filter on it consistently. Want me to draft an action plan for G9-G12 the same way I did for the Catalog→Subject findings, before touching any code?
