# Flow — M6-F1: Leave Application → Approval (with balance engine)

- **Flow ID:** M6-F1
- **Actors:** applicant (any staff role), HOD, Principal/VP, Management (Principal's own leave)
- **Trigger:** `/leave/apply` (role root)
- **Preconditions:** profile exists (employeeLeaveProfiles); balance sufficient; dates valid (holidays excluded via holidaysCount)
- **Main success scenario:**
  1. `POST /api/leave/applications` {LeaveTypeCode CL|SL|SCL|EL|EL|OD|SH (leave.ts:31), from, to, reason, substitute?}.
  2. balanceEngine validates entitlement/deducts preview (:37-43 stores).
  3. leaveRequests created PENDING; notify approver chain (approvalRouting: identity.ts resolves faculty vs supportingStaff :64-94; staffCategoryRouting picks chain).
  4. HOD PATCH `[id]` (stage 1) → advance; Principal/VP PATCH (final) → APPROVED/REJECTED via decideFinalStage (audit :93).
  5. Principal's own application decided at `/management/leave-approvals/[id]` (no one else within college — verifySession.ts:84-91).
- **Alternate/error:** insufficient balance 400; OD requires proof before finalize (`/leave/od-proof/[id]` + odProofNotify); overlapping leave/adjustment → availability check 400 (availability.ts:117-120).
- **UI:** `/*/leave/apply`, `/*/leave/history/[type]`, `/hod|principal/leave-approvals`, `/management/leave-approvals`.
- **API:** `leave/applications` (+`[id]`), `leave/balances`, `leave/profile`, `leave/types`, `leave/other-categories`, `management/leave-approvals*`.
- **Backend:** libs cited.
- **DB:** leaveRequests, employeeLeaveProfiles, leaveBalances, auditLogs, notifications, holidays.
- **Permissions:** route guards + routing logic; Management sanctioned write.
- **Validation:** type codes, date ranges, IST-safe day math (holidaysCount).
- **State transitions:** PENDING → (APPROVED|REJECTED) via stages; OD sub-flow proof gate.
- **Side effects:** audit, notifications; downstream: M5 check-in gate, periodCoverage substitutions, payroll history.
- **Concurrency:** simultaneous decisions — stage guard (only current-stage approver) `[ASSUMPTION]`.
- **Code evidence:** cited libs + tests (approvalRouting, balanceEngine, staffCategoryRouting, odProof).
