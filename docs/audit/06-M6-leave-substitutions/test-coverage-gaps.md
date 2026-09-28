# M6 — Test Coverage & Gaps (as-is)

## Existing (strong lib coverage)
- `adjustmentRequests.test.ts`, `approvalRouting.test.ts`, `availability.test.ts`, `balanceEngine.test.ts`, `odProof.test.ts`, `staffCategoryRouting.test.ts` — 6 dedicated lib suites.

## Missing
1. Route-level: applications POST/PATCH stage enforcement (only lib-level tested).
2. decideFinalStage audit write assertion.
3. reportRoster merge (faculty + supporting staff + HOD doc :36-103).
4. periodCoverage chunked slot queries (>30 sections path :429).
5. leave-history import validation.

## Risky untested
- Balance engine vs rules mismatch (write rules no-op history).
- Management deciding VP's leave (routing ambiguity?) `[OPEN]`.
