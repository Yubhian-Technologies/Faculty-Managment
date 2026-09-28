# M8 — Test Coverage & Gaps (as-is)

## Existing
- None module-specific (no research/publications test files found in the 74-file test inventory).

## Missing
1. coordinatorReview seat gating (dept with/without seat).
2. Projection libs (apply*Fields) — idempotency, null handling.
3. finalize* people resolution (unknown uid handling).
4. Publication import validation.
5. Per-type CRUD ownership checks.

## Risky untested
- Proxy grant of `/rnd-coordinator` to faculty-with-seat logins (role vs seat mismatch class of bug).
