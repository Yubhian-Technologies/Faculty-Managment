# M2 — Test Coverage & Gaps (as-is)

## Existing tests relevant to M2
- `src/lib/firestore/facultyProvisioning.test.ts` — provisioning logic (only M2 unit test found).
- Indirect: `tests/e2e/api/faculty-scope-security.spec.ts` (guards general).

## Missing tests
1. Phase-transition state machine (BatchPhase legal transitions; no out-of-order moves).
2. Panel feedback upsert idempotency (double submit).
3. Offer decision transaction (offerLetterDecision) — concurrent decisions.
4. CC resolution (offerLetterCc) — role mix incl. location ACCOUNTS.
5. Detailed hiring status computation (`getDetailedHiringStatus`) — pure function, easily testable.
6. Public endpoints (candidate-form, offer-acceptance) — validation + token handling.
7. Location hiring twins.

## Risky untested flows
- Provisioning existing-uid reuse path (data integrity).
- EmployeeId generation race under concurrent provisions.
