# Optimization Action Plan
**Target:** Timetable → Attendance Taking → Attendance Reports
**Scope:** 30K students / 2K faculty / 8 periods/day
**Priority:** P0 (correctness-critical, cost/blockers), P1 (high ROI), P2 (nice-to-have)

## 1. Timetable (Publish → Slots)
**Current bottleneck:** Publish does 2×N_s queries inside transaction (section+faculty cell per slot). N_s=7,000 → ~14,000 queries/ publish.

### 1.1 Windowed reads on publish (P0)
- **Files:** src/lib/timetable/publishDraft.ts
- **Change:** Read section live cells (current semester+AY) in 1 query: timetableSlots where sectionId==sectionId and semester==s and academicYear==ay (if present) OR fallback. Read faculty live cells for F_d faculty in m_f=⌈F_d/30⌉ queries (or 1 query with in+filters) for same (semester,AY,day,period) set from draft. Build in-memory maps (day,period)->slot.
- **Gain:** -90%+ queries per publish (14k→~1+m_f), lower tx latency/ retries.
- **Effort:** S (2–4h)

### 1.2 Composite indexes for timetableSlots (P0, prereq for 1.1 + reads)
- **Index 1:** (sectionId, academicYear, semester)
- **Index 2:** (facultyId, academicYear, semester, day, periodNumber)
- **File:** firestore.indexes.json
- **Gain:** Enables server-side filtering, query count reduction.
- **Effort:** S (deploy)

### 1.3 Add semester/AY filters to section-slots reads (P1)
- **File:** src/app/api/college/timetable-slots/route.ts
- **Change:** When not browsing past, query with (sectionId, academicYear, semester) using index 1; filter legacy untagged in-mem only as fallback.
- **Gain:** Reduces history scan (server-side). Cuts read cost as history grows.
- **Effort:** S

## 2. Teaching Assignments (Roster Fan-out)
**Bottleneck:** GET deptView with r=2000 → m=⌈r/30⌉=67 assignment queries (year-gated JS).

### 2.1 Narrow roster assignment queries by AY/sem + scope (P1)
- **Files:** src/app/api/college/teaching-assignments/route.ts
- **Change:** Add where('academicYear','==',currentAY) to roster queries when viewing current context; prefer tighter rosterDeptNames (exclude unmanaged). Keep year-gate as safety.
- **Gain:** -20–40% lent-out doc reads.
- **Effort:** S (1–2h)

### 2.2 TA indexes (P1)
- (department, academicYear)
- (facultyId, academicYear, semester)
- (sectionId, academicYear, semester)
- **File:** firestore.indexes.json
- **Gain:** Better server-side filtering for dept/faculty/section views.
- **Effort:** S

## 3. Attendance Taking (Today Periods + POST student-attendance)
**Focus:** Read-efficiency (today-periods uses db.getAll + small queries). Writes: transactional POST per session.

### 3.1 Cache 'no class/holiday' + today periods (P1)
- **Files:** src/app/api/college/student-attendance/today-periods/route.ts, src/lib/studentAttendance/classDay.ts
- **Change:** Short-TTL in-memory/edge cache (collegeId+date) for getNoClassReason + maybe resolved slots (5–60s). Avoid recomputing per concurrent faculty poll.
- **Gain:** Cuts repeat reads on high poll cadence (PERIOD_POLL_MS 60s). Low write risk (read-only).
- **Effort:** S (1–2h)

### 3.2 Batch roster fetch earlier (P2)
- **File:** student-attendance/route.ts
- **Change:** Keep fetchSectionStudents before tx (already done) and avoid any per-student extra queries in hot path. Consider caching section roster by (sectionId,academicYear,labBatch?) with short TTL if many sessions opened same time.
- **Gain:** Marginal (already batched). 
- **Effort:** XS

## 4. Attendance Reports (section-attendance-report, percentage-report, faculty-completion)
**Bottleneck:** Large scans across history; unfiltered queries then in-mem.

### 4.1 Enforce academic-year window by default + server-side filters (P0)
- **Files:** src/app/api/college/section-attendance-report/route.ts, src/app/api/college/attendance-percentage-report/route.ts
- **Change:** Default to current academic year (not 'all') for unbounded modes; require explicit 'all' only when needed. Query studentAttendance by (collegeId, sectionId?, academicYear) where possible.
- **Gain:** Prevents cross-cohort bleed + huge history reads (biggest cost driver in reports).
- **Effort:** M (2–4h) – keep strict-equality for past (existing behavior).

### 4.2 studentAttendance indexes (P0, enables 4.1)
- (collegeId, sectionId, academicYear, date)
- (collegeId, sectionId, date)
- (collegeId, facultyId, date) (for completion/not-posted lookups)
- (collegeId, academicYear, date) (cross-section percentage)
- **File:** firestore.indexes.json
- **Gain:** Server-side filter by AY/date; replaces full scans.
- **Effort:** S (deploy, may take time to build).

### 4.3 Held-denom: index timetableSlots used for 'not posted' (P1)
- (collegeId, sectionId, academicYear, semester, date?) or (collegeId, facultyId, academicYear, date, periodNumber)
- **Files:** lib/studentAttendance/heldDenominator.ts, lib/studentAttendance/notPostedAggregation.ts
- **Change:** Query timetableSlots by sectionId+AY(+semester) instead of scanning large sets; build not-posted index efficiently.
- **Gain:** Cuts held-denom computation (compare=true) cost.
- **Effort:** M (2–3h)

### 4.4 Pagination/windowing for large section lists (P1)
- **Files:** attendance-percentage-report/route.ts, section-attendance-report (heavy result sets)
- **Change:** Add limit/offset or 'maxSections' + streaming; return totals separately. Avoid returning 1000s of students in one response if UI can paginate.
- **Gain:** Network+read shaping, TTFB.
- **Effort:** M

### 4.5 Faculty completion: prefilter by faculty teaching course (P2)
- **File:** faculty-attendance-completion/route.ts
- **Change:** Already resolves courseId group; add AY filter to assignments queries (teachingAssignments where department+courseIds+academicYear) to shrink result.
- **Gain:** Small (assignment set smaller).
- **Effort:** XS

## 5. Cross-cutting
### 5.1 Subjects semester-scoped duplicate guard (P0 correctness)
- **File:** src/app/api/college/subjects/route.ts (semester-scoped POST)
- **Change:** Pre-check existing subject with same (collegeId, department, semester, codeUpper) before add (limit 1). Or tx key doc.
- **Gain:** Prevents duplicates (TOCTOU gap noted).
- **Effort:** S

### 5.2 Config reads caching (P2)
- **Files:** deptView paths (teaching-assignments GET) doing departments.get()/courses.get() each call
- **Change:** Per-college request-level cache (Map<cid, {depts,courses,ts}>) with 30–60s TTL.
- **Gain:** Saves small reads on repeated admin views.
- **Effort:** XS

### 5.3 Telemetry/alerts (P1)
- **Add:** Log m=⌈r/30⌉ (roster fan-out) and 2×N_s (publish queries) when thresholds exceeded (e.g. m>40, N_s>8000). Track p95 publish tx time.
- **Gain:** Catch regressions early.
- **Effort:** XS

## 6. Implementation Order (Dependency-aware)
| Phase | Items | Risk | Outcome |
|---|---|---|---|
| Phase 1 (P0) | 1.2 indexes (timetableSlots, studentAttendance), 4.2 studentAttendance indexes, 1.1 windowed publish, 4.1 default AY window, 5.1 semester-subject guard | Low–Med (tx changes tested) | Biggest cost/read-safety wins; publish query count -90%+, report history bounded |
| Phase 2 (P1) | 1.3 slots AY filter, 2.1 narrow roster+2.2 TA indexes, 4.3 held-denom indexes+logic, 3.1 today-periods cache, 5.3 telemetry | Low | Steady-state reads down, better scalability |
| Phase 3 (P2) | 4.4 pagination, 4.5 minor filter, 5.2 config cache, 3.2 roster cache | Low | UX/perf polish

## 7. Expected Impact (30K/2K/30d)
| Area | Before | After (target) | Est. $/month |
|---|---|---|---|
| Publish queries/reads | 2×N_s (~14k queries/publish) | ~1+m_f (~1+17) | -~– |
| Report history scans | Unbounded (all AYs) | Default current AY (server-filtered) | -~– |
| Roster fan-out (deptView heavy) | m=⌈2000/30⌉=67 | m smaller + AY filter | -~.50– |
| Timetable reads (history) | in-mem filter (sectionId only) | server-filter (AY+sem) | -~– |
| **Total est. reduction** | | | **-~–/month** (steady-state) + lower p95 latency, less tx contention

## 8. Validation & Rollout
- **Indexes:** Deploy firestore.indexes.json in stages (timetableSlots first, then studentAttendance). Expect build time.
- **Feature flags:** None needed for index/query changes (read paths backward compatible). Windowed publish keeps same semantics (section+faculty cell clash checks).
- **Tests:** Run fakeFirestore tests (guards/concurrency) for publish/pin/create/delete; add regression tests for 'all' vs AY default in reports.
- **Metrics:** Track reads/writes per operation (publish, section-attendance-report, percentage-report, today-periods) for 7–14 days pre/post.
- **Rollback:** Revert query changes; indexes remain (no harm).

---

# 9. Student Dashboard & Attendance Reads (added 2026-10-05, from FLOW_AUDIT_REPORT.md)

**Why this section exists:** sections 1–8 stop at faculty/staff paths. The student self-view is the largest single read cost (~$120 of ~$160/month in the audit model, range $36–$900), and the plan above does not touch it.

## 9.1 What actually happens today [verified in code]
- The live student attendance screen is `components/attendance/StudentAttendanceReport.tsx` → `GET /api/college/student/me/attendance` (Month / Period / Semester / Till now).
- Every cache miss calls `computeStudentAttendanceHistory` → `loadSessionsInRange`: **all SUBMITTED sessions of the student's department in the range, each with its full roster** (~20K docs per department per academic year).
- "Till now" has no date bound at all, so it reads **every year ever stored**. The cost grows every year.
- The cache (`tallyCache`, 3 min, max 40 keys) is an in-process `Map`. On Vercel it is per warm instance and is lost on cold start.
- `GET /api/college/student/me` (base route) runs the same unbounded scan, but **no caller exists in `src/`**. It is dead code that can still be hit directly.
- Each call also repeats: student lookup, section lookup, timings for years 1..N, course, department and college docs (~10 small reads). Minor.

## 9.2 Why "just cache it longer" does not work
One scan is ~20K reads. With 30 departments and traffic spread through the evening, almost every window has an open, so the scans never stop:

| TTL | Max scans/month (30 depts, 14 active h/day, 25 days) | Reads at 20K/scan |
|---|---|---|
| 3 min (today) | ~63K × instances | ~1.2B |
| 10 min | ~21K | ~420M |
| 60 min | ~10K | ~210M |

Caching only shifts the cost by a constant factor. The scan itself has to go.

## 9.3 Plan

### S-0 (P0, ~2h, no schema change): stop the bleeding
- **Bound every self-view range to the current academic year** unless the student picks a Semester or Period inside an older one. Use `loadAcademicYearConfig` / `windowForAcademicYear` (already used by the staff reports). Apply to `student/me/attendance` ("Till now") and delete or bound the dead `student/me/route.ts`.
- **One cache key per department+range**: the route passes `departments[]` while the base route passes a single string, so they never share an entry.
- **Client**: React Query `staleTime` 5 min, no refetch on focus, so repeat opens never reach the server. Add `Cache-Control: private, max-age=120`.
- **Gain:** removes the multi-year multiplier (2–3× from year 2 onward) and the dead route's duplicate scans.
- **Files:** `student/me/attendance/route.ts`, `student/me/route.ts`, `StudentAttendanceReport.tsx`, `lib/studentAttendance/history.ts`.

### S-1 (P0, ~1.5 days): per-section monthly tally docs (the structural fix)
- **New collection:** `colleges/{c}/attendanceMonthlyTally/{sectionId}_{YYYY-MM}` holding `{ academicYear, students: { [studentId]: { [subjectId]: [held, attended] } }, subjects: {id: {name, code}}, computedAt }`. ~60 students × ~6 subjects ≈ 10 KB.
- **Idempotent recompute, not deltas:** the tally is rebuilt from that section-month's SUBMITTED sessions (~175 docs) using the existing `counting.ts` (`indexSessions` / `tallyStudentBySubject`), so on-duty changes and office corrections can never drift the counters.
- **Freshness:** submit, office correction and on-duty changes write a tiny `dirty` marker on the tally doc (1 write). A read serves the doc, and rebuilds first only if it is dirty and older than ~60 s.
- **Read path:** Month = 1 doc, Semester/Academic year = ≤12 docs. Self-view cost drops from ~20K reads to ~1–12 reads per open.
- **Also serves staff reports:** `section-attendance-report` (month, summary) and `attendance-percentage-report` can read tally docs instead of ~1.3K sessions per section (~14K reads per run → ~10 docs).
- **Risks:**
  - A student who changed section mid-year has history in the old section's docs. Fall back to the live scan when the student has a transfer or promotion marker (`departmentHistory`).
  - Held-denominator mode `TIMETABLE` (not-posted periods) is not in the tally. Keep that path on the live scan.
  - Add a nightly reconcile cron for the previous day's dirty docs.
- **Estimated effect (audit model):** self-view ~$120 → ~$2, plus ~$5/month recompute reads; staff reports ~$7 → ~$1. Total ~$160 → ~$45/month.
- **Files:** new `lib/studentAttendance/monthlyTally.ts`; hooks in `student-attendance/[id]` PATCH, `office-correction/[id]` PATCH, `onDuty.ts`; read switch in `history.ts`, `student/me/attendance`, `section-attendance-report`, `attendance-percentage-report`; index: none needed (doc ids are known).

### S-2 (P1): other student dashboard calls
- `student/me/today`: slots are queried by `sectionId + day` across all years, because a section is reused each year. Add `academicYear`/`semester` filtering (same helper as `timetable-slots`).
- `student/me/timetable` (`getSectionTimetableData`): joins every master subject of the course just to label ~56 slots. Use `getAll` on the slots' own subject ids.
- Resolve the section once: store `sectionId` on the student doc (or cache it in the session) instead of the 2-query `findCurrentSectionDoc` on every call.
- Merge `optionsOnly` into the first report response so the screen makes one call, not two.

### S-3 (P2): retention
- After the year closes, tally docs make old `studentAttendance` sessions replaceable. Archive or delete sessions older than N academic years once their tallies are verified (see FLOW_AUDIT_REPORT.md F-6).

## 9.4 Order and validation
| Order | Item | Risk | Done when |
|---|---|---|---|
| 1 | S-0 | Low | Till-now report shows the current year by default; no unbounded `loadSessionsInRange` from a student route |
| 2 | S-1 behind a flag (`ATTENDANCE_TALLY=1`), shadow-compare tally vs live scan for 1–2 weeks | Medium | Mismatch rate 0 on a sample of students, including on-duty and corrected sessions |
| 3 | S-2 | Low | Student dashboard load ≤ ~15 reads |
| 4 | S-3 | Low | After a full academic year |

Metrics: reads per `student/me/attendance` call (target ≤ 15), department scans per day (target 0), monthly Firestore read count for `studentAttendance` before/after.
Rollback: turn the flag off, the live scan path stays in place.

## 9.5 Corrections to sections 1–8
- 3.1 (cache today-periods / holiday) saves little. The real cost in `today-periods` is reading **all of a faculty's slots across all years** (`currentPeriod.ts:190`). Fix with `.where("facultyId","==",x).where("day","==",day)` plus an academic-year check (FLOW_AUDIT_REPORT.md F-3).
- 4.2: indexes `(status, sectionId, date)`, `(status, department, date)` and `(status, facultyId, date)` already exist on `studentAttendance`. Check before adding duplicates.
- 7 (impact table): dollar figures lost their `$` signs in this file, so read `-~–/month` as missing values.
