# M4 — Test Coverage & Gaps (as-is)

## Existing
- `src/lib/students/distributionPlan.test.ts`, `evenSplit.test.ts` — split/planning logic.
- `src/lib/import/fieldConstraints.test.ts` — import validation.
- E2E: none students-specific found in inventory `[GAP]`.

## Missing
1. distribute-cohort route test (lock + 409 missing sections + tx).
2. promote route (year rollover + graduation + departmentHistory append).
3. Import error reporting (partial failure semantics).
4. bulk-delete audit behavior.

## Risky untested
- Concurrent distribute+promote on same cohort.
