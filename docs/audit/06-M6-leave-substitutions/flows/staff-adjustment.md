# Flow — M6-F2: Staff Adjustments (manager-assigned) & Self-Service Consent

- **Flow ID:** M6-F2
- **Actors:** manager (HOD/Principal/College Office), substitute colleague, applicant
- **Trigger:** known absence needs a substitute; manager assigns OR applicant requests consent
- **Preconditions:** substitute available (availability.ts:117-120 excludes live leave/ACTIVE adjustments); manager scope over target (staffAdjustmentScope.ts:60)
- **Main success scenario (manager-assigned):**
  1. `GET /api/leave/staff-adjustments/options?...` → eligible substitutes.
  2. `POST /api/leave/staff-adjustments` {user, substitute, dates} → status ACTIVE (leave.ts:296).
  3. periodCoverage treats as substitution source (:402-405); notify substitute.
  4. `PATCH [id]` CANCELLED to revoke.
- **Main success scenario (self-service):**
  1. Applicant creates request inviting colleague (adjustment-requests) → colleague notified.
  2. Colleague accepts via `POST /api/leave/applications/[id]/adjustment-response` (or declines → applicant revises at `/leave/revise/[id]`, re-inviting).
- **Alternate/error:** out-of-scope manager → 403; busy substitute → 409/400; expired request.
- **UI:** `/hod/adjustments`, `/principal/adjustments`, `/college-office/adjustments`, shared `/leave/adjustments`, `/leave/revise/[id]`.
- **API:** `leave/staff-adjustments*` (+options), `leave/adjustment-requests`, `leave/applications/[id]/adjustment-response`, `leave/handover-candidates`, `leave/period-coverage` (debug/preview `[UNVERIFIED purpose]`).
- **Backend:** staffAdjustmentScope, availability, adjustmentRequests (+test), periodCoverage.
- **DB:** staffAdjustments, leaveRequests (adjustment fields).
- **Permissions:** manager scope check; colleague self consent only.
- **Validation:** date overlap; substitute ≠ applicant.
- **State transitions:** ACTIVE→CANCELLED (manager); invited→accepted|declined (self).
- **Side effects:** notifications; substitutions visible in M3/M5 reads.
- **Concurrency:** two managers adjusting same user — last-write `[GAP]`.
- **Code evidence:** cited; tests adjustmentRequests/availability.
