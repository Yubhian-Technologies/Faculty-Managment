# M5 — Test Coverage & Gaps (as-is)

## Existing
- `src/lib/attendance/offlineSubmitQueue.test.ts`, `periodAttendanceStatus.test.ts`
- `src/lib/studentAttendance/percentage.test.ts`, `shortage.test.ts`
- `src/lib/timetable/hoursMatch.test.ts` (slot/load math shared)
- E2E: `academics-attendance.spec.ts` (UI), `faculty-scope-security.spec.ts`, `subjects-to-attendance-pipeline.spec.ts`

## Missing
1. Check-in gate matrix (geofence/leave/holiday/Sunday/face) — the highest-risk branchy logic.
2. Late-penalty idempotency under retry (transaction double-run).
3. today-periods substitute resolution (`resolveSubstituteSlotsForDate`).
4. Cron route: settings gating + lastRunDate stamping (mockable, untested).
5. Office-correction approval chain.
6. Monthly-export correctness (IST day boundaries).

## Risky untested
- Cross-tenancy in management attendance oversight reads.
- Face-match threshold tuning (client-only heuristics).
