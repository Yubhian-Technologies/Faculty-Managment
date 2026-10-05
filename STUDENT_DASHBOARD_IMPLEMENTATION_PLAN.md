# Student Dashboard: Implementation Action Plan

**Date:** 2026-10-05 · **Goal:** make the student attendance dashboard cost ~O(1) reads per open instead of a whole-department scan.
**Supersedes** the S-1 design in `OPTIMIZATION_ACTION_PLAN.md` §9 (a per-section monthly tally). The per-student design below replaces it because it handles section transfers and day-level ranges, and needs no new index. Everything else in §9 stands.
**Baseline (audit model, 30K students):** ~200M reads/month ≈ $120 for the self-view alone. **Target:** ~3M reads + ~$10 maintenance ≈ $12/month.

## 0. Ground rules
- **Protected files untouched:** `verifySession.ts`, `departments/scope.ts`, `firestore.rules`, `DataTable.tsx`, `navConfig.ts`, `academicStructure.ts`, `core.ts` ROLE_SCOPE. New collections are server-only (Admin SDK). The rules catch-all already denies client access (`firestore.rules:176`), so no rules change.
- **Always keep the live scan** (`loadSessionsInRange`) in place. It is the fallback, the shadow-compare reference and the rollback.
- Every step ships alone and is reversible by a flag or by reverting one file.

## 1. Phase S-0 — stop the bleeding (½ day, no schema change)

| # | Task | File | Done when |
|---|---|---|---|
| 0.1 | "Till now" uses the **current academic year window** (`loadAcademicYearConfig` + `windowForAcademicYear(cfg.currentLabel, cfg)`) as `from/to`. Label the response scope "This academic year". Semester and Period views are unchanged. | `student/me/attendance/route.ts` (+ `lib/studentAttendance/studentReportRange.ts` if the label lives there) | A student route can no longer call `loadSessionsInRange` without a `from`/`to` |
| 0.2 | **Delete `student/me/route.ts`.** First grep `src/`, `tests/e2e/` and `functions/` for `/student/me"` (src already shows no caller). Check Vercel logs for hits in the last 30 days. | `student/me/route.ts` | Route gone, no 404s in logs |
| 0.3 | Client memo: a module-level `Map<queryString, {at, data}>` with a 5-min TTL in `StudentAttendanceReport.tsx` (these pages do not use React Query, so don't add it). Skip the fetch on a hit. | `components/attendance/StudentAttendanceReport.tsx` | Switching tabs back to a seen view makes no request |
| 0.4 | `Cache-Control: private, max-age=120` on the report response. | `student/me/attendance/route.ts` | Header present |
| 0.5 | Tests: update `studentReportRange.test.ts` for the new "tillnow" bounds. | `lib/studentAttendance/studentReportRange.test.ts` | `npx vitest run src/lib/studentAttendance` green |

Rollback: revert the route file. Effect: removes the multi-year multiplier (2–3× from year 2 on).

## 2. Phase S-1 — per-student daily tally (2–2.5 days + soak)

### 2.1 Data model
**`colleges/{c}/studentAttendanceTally/{studentId}_{YYYY-MM}`** (one doc per student per month, ~3 KB)

```
{
  studentId, month: "2026-10", academicYear: "2026-27",
  sections: {                       // keyed by section so a transfer never overwrites
    "<sectionId>": {
      "2026-10-05": { "<subjectId>": [held, attended], ... },
      ...
    }
  },
  names: { "<subjectId>": { name, code } },   // merged, for the report rows
  updatedAt
}
```
- Counting rule = `tallyStudentBySubject` in `counting.ts` (student must be on the session roster, `ON_DUTY` excluded). To guarantee parity, **extract the per-session loop already inside `history.ts:getDepartmentTallies`** into one exported `tallyByStudent(sessions)` and use it from both paths.
- Day-level storage makes Month, Period and Semester views exact, not month-rounded.

**`colleges/{c}/attendanceTallyDirty/{sectionId}_{date}`**: `{ sectionId, date, dirtyAt, builtAt? }`. Written whenever a session's counted result can change.

**`colleges/{c}/settings/attendanceTally`**: `{ readyFrom: "YYYY-MM-DD" }`, set by the backfill. Ranges starting earlier fall back to the live scan.

No composite index needed: the dirty query is a single-field range on `dirtyAt`, and the per-section-day rebuild uses the existing `(status, sectionId, date)` index.

### 2.2 Tasks

| # | Task | Files | Notes |
|---|---|---|---|
| 1.1 | Extract `tallyByStudent(sessions)` from `history.ts`; keep behaviour identical; existing `history.test.ts` and `counting.test.ts` must stay green. | `lib/studentAttendance/history.ts` | Pure refactor, ship first |
| 1.2 | New `lib/studentAttendance/dayTally.ts`: `markDirty(tx\|batch, db, collegeId, sectionId, date)` and `rebuildSectionDay(db, collegeId, sectionId, date)`. Rebuild = query SUBMITTED sessions for `sectionId + date` (~7 docs) → `tallyByStudent` → for each student `batch.set(ref, data, { mergeFields: [FieldPath(["sections", sectionId, date]), "names", ...] })`. Also delete the day field for students who were on the previous build but are no longer on any roster (keep the previous student list on the dirty doc). Chunk at 400 writes with the existing `ChunkedBatch`. | new file | One section-day = ~7 reads + ~60 writes |
| 1.3 | **Dirty hooks** at every writer that can change a SUBMITTED result (these are all of them): `student-attendance/[id]/route.ts` (submit, inside the existing transaction), `office-correction/[id]/route.ts` (every save, incl. edits of submitted records), `lib/studentAttendance/onDuty.ts` `applyOnDutyToExistingSessions` and `releaseOnDutyFromSessions` (inside their per-session `tx.update`). `student-attendance/route.ts` (POST) creates only DRAFTs, so no hook. | those 4 files | Marker written in the same transaction as the session write, so it can't be lost |
| 1.4 | Cron route `api/cron/attendance-tally`: Bearer `CRON_SECRET` like `attendance-not-posted`. Per college: query dirty docs with `dirtyAt <= now-10min` (limit 100, rebuilt in parallel batches of 5); rebuild each; then delete the marker **only if `dirtyAt` is unchanged** (transaction compare-and-delete), so a late dirty isn't lost. Rate limit: skip if `builtAt` is under 15 min old. Add a second schedule in `functions/src/index.ts` (every 5 min) that pings it. | new route, `functions/src/index.ts` | Staleness for a student ≈ 10–20 min after posting |
| 1.5 | **Backfill** script `scripts/backfill-student-tally.mjs` (same style as `scripts/backfill-student-course-id.mjs`): for each section × each date with SUBMITTED sessions in the chosen academic year(s), call `rebuildSectionDay`; on success write `settings/attendanceTally.readyFrom`. Resumable by date. Dry-run flag. | new script | One-off ≈ 0.9M reads + 0.3M writes (< $1) |
| 1.6 | **Read path** in `computeStudentAttendanceHistory`: when the flag allows and `range.from >= readyFrom`, `db.getAll` the month docs in the range, sum days inside `[from,to]` over all sections, build `names`, return the same `StudentAttendanceHistory` shape. A missing month doc inside the ready window is legitimate (no sessions), so it is not an error. On exceptions only, fall back to the live scan. | `lib/studentAttendance/history.ts`, `student/me/attendance/route.ts` | Self-view = 1–12 doc reads |
| 1.7 | Flag `ATTENDANCE_TALLY` = `off` (default) / `shadow` / `on`, plus optional `ATTENDANCE_TALLY_DEPTS` (comma list) to pilot one department. `shadow` serves the live result, computes the tally result, and logs `[tally-mismatch]` with student, range and both totals (sample 10%). | env + `history.ts` | Mismatch log is the go/no-go signal |
| 1.8 | Tests (vitest, reuse the fake-Firestore helper used by `guards.concurrency.test.ts`): (a) **parity**: random sessions → `tallyByStudent` summed by day equals the live per-student tally; (b) rebuild is idempotent; (c) transfer: student on section A until day 10, B afterwards → read sums both; (d) removed-from-roster student's day field is cleared; (e) on-duty apply/release changes the tally; (f) marker compare-and-delete doesn't drop a newer dirty. | `lib/studentAttendance/dayTally.test.ts` | green |

### 2.3 Cost of the new path (audit model, 100K sessions/month)
- **Reads:** self-view ≈ 300K opens × ~3 docs ≈ 1M; rebuilds ≈ 3.5K section-days/day × 7 reads × 25 ≈ 0.6M. **~1.6M ≈ $1.**
- **Writes:** 3.5K rebuilds/day × 60 students × 25 days ≈ 5.3M ≈ **$9.5**.
- **Storage:** ~300K tally docs/year × 3 KB ≈ 1 GB ≈ $0.2/month.
- **Net:** ~$120 → ~$11. If writes matter later, read-and-compare each student's day value and skip unchanged ones (reads cost one third of writes).

### 2.4 Risks and mitigations
| Risk | Mitigation |
|---|---|
| A writer of session data is missed, so a tally goes stale | Hooks cover all 4 writers (grep list above). The nightly reconcile (task 3.2) recomputes yesterday's section-days. Shadow mode catches the rest. |
| Counting rule drifts between live and tally | One shared `tallyByStudent`; parity test 1.8(a). |
| Held-denominator `TIMETABLE` mode (not-posted periods) | Not in the tally. The student dashboard uses submitted-only counts today. Keep that mode on the live scan if a student route ever adds it. |
| Cron down → stale numbers | Existing heartbeat pattern in `notPostedSweep.ts`; staleness is bounded to "not updated", never "wrong". Add the same heartbeat doc. |
| Hot write bursts at rebuild time | 60 writes per section-day, batches of 5 sections in parallel, far below the 500/s per-database soft limit. |

## 3. Phase S-2 — remaining dashboard calls (½ day)

| # | Task | File |
|---|---|---|
| 2.1 | `student/me/today`: add an academic-year/semester filter to the `sectionId + day` slots (reuse the filter `timetable-slots/route.ts` GET already applies). | `student/me/today/route.ts` |
| 2.2 | `student/me/timetable` (`getSectionTimetableData`): replace the "all master subjects of the course" read with `getAll` of the slots' own `subjectId`s. | the data helper `getSectionTimetableData` |
| 2.3 | Merge the report's `optionsOnly` call into the first report response, so the screen makes one request, not two. | `student/me/attendance/route.ts`, `StudentAttendanceReport.tsx` |
| 2.4 | Skipped on purpose: storing `sectionId` on the student doc. It saves ~2 reads per call but needs maintenance on every promotion and section change. | n/a |

## 4. Phase S-3 — ops and retention (1 day + later)
| # | Task |
|---|---|
| 3.1 | Dashboard counters: log `source=tally\|live reads=N` per `student/me/attendance` call; weekly review of reads per call (target ≤ 15) and of department scans per day (target 0). |
| 3.2 | Nightly reconcile cron: rebuild every section-day dirtied or touched yesterday (recompute from sessions) so any missed hook self-heals within 24 h. |
| 3.3 | After one full academic year with 0 mismatches: archive or delete `studentAttendance` sessions older than N years (FLOW_AUDIT_REPORT.md F-6). Tally docs keep the history students see. |
| 3.4 | Follow-on (separate ticket): staff `section-attendance-report` and `attendance-percentage-report` can read the same tally docs for their per-student numbers, cutting their ~14K-read runs. |

## 5. Rollout order and gates

| Step | Ship | Gate to continue |
|---|---|---|
| 1 | S-0 (0.1–0.5) | Student "Till now" shows current-year numbers; no 404s from the removed route |
| 2 | 1.1 refactor | All existing tests green, no behaviour change |
| 3 | 1.2–1.4 with `ATTENDANCE_TALLY=off` | Dirty markers appear; cron rebuilds them; nothing user-visible |
| 4 | 1.5 backfill on **one department** | Tally docs exist; `readyFrom` set |
| 5 | `shadow` on that department, then college-wide | **1–2 weeks, mismatch rate 0** across on-duty, corrected and transferred students |
| 6 | `on` for the pilot department, then all | Reads per call ≤ 15; no support tickets about numbers |
| 7 | S-2 and S-3 | n/a |

**Rollback at any point:** set `ATTENDANCE_TALLY=off`. The live scan is untouched. The tally collections can be left in place (server-only, harmless) or deleted.

## 6. Effort summary
| Phase | Effort | Savings (audit model) |
|---|---|---|
| S-0 | ~½ day | removes the all-years multiplier (largest immediate cut after year 1) |
| S-1 | ~2–2.5 days + 1–2 weeks soak | ~$120 → ~$11 per month |
| S-2 | ~½ day | small reads, faster dashboard |
| S-3 | ~1 day + later | keeps storage and history bounded |
| **Total** | **~4.5 days of work** | **~$160 → ~$50/month overall** |

## 7. Open questions
1. Is 10–20 minutes of staleness acceptable on a student's own numbers? (The current code already tolerates 3 minutes plus per-instance caching.) If not, rebuild the changed section-day inline at submit time instead of on the cron, at the cost of 60 writes in the faculty's submit request.
2. Which department should be the pilot?
3. How many academic years should the backfill cover (current only, or also the previous one for Semester views)?
