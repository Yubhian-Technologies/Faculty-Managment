# Flow — M7-F1: Budget Request Lifecycle (normal + emergency)

- **Flow ID:** M7-F1
- **Actors:** HOD, Principal/VP, Finance (GLOBAL), Management (GLOBAL)
- **Trigger:** cycle approval spawns requests, or HOD creates stand-alone, or emergency submit
- **Preconditions:** active budget cycle (or emergency justification); department scope
- **Main success scenario:**
  1. Spawn: cycle APPROVED → requests auto-created PENDING_SUBMISSION per department (budget.ts:8 comment).
  2. HOD fills items (RECURRING/NON_RECURRING categories, :35-45) → submit → PENDING_PRINCIPAL_VERIFICATION.
  3. Principal verifies → L1_FROZEN; queued for Finance.
  4. Finance decides → FINANCE_APPROVED (auto-create FinanceBudget) | FINANCE_REJECTED | RETURNED_TO_HOD.
  5. Notifications at each hop (managementApproval.ts:18; notify.ts built for these flows :9-16).
- **Emergency lane:** Principal/VP submits isEmergency → PENDING_MANAGEMENT_APPROVAL → Management PATCH approve/reject/return (management/emergency-budget-requests/[id] — sanctioned write) → Finance.
- **Alternate/error:** returned states allow edit+resubmit; terminal rejections; 403 wrong stage actor.
- **UI:** `/hod/budget*`, `/principal/budget*`, `/finance/budget*` (+approvals), `/management/budget*` (+EmergencyBudgetRequests).
- **API:** `budget-cycles*`, `budget-requests*`, `finance/budget-requests/overview`, `management/emergency-budget-requests*`.
- **Backend:** managementApproval.ts (audit :66), departmentScope.ts.
- **DB:** budgetCycles, budgetRequests, emergencyBudgetRequests, financeBudgets, auditLogs, notifications.
- **Permissions:** stage-gated roles; GLOBAL finance via requireCollegeContext college param.
- **Validation:** totals (budgetRequestTotal), category field configs (fieldConfigForCategory), receipt totals (reconcileExtrasForCategory).
- **State transitions:** see budget.ts:6-22 (10 states, 4 terminal).
- **Side effects:** FinanceBudget creation; notifications; audit.
- **Concurrency:** stage guard prevents out-of-order decisions `[ASSUMPTION]`.
- **Code evidence:** cited types/lib; UI components referencedBy (8 files use budgetRequestTotal).
