# M7 — Test Coverage & Gaps (as-is)

## Existing
- None module-specific found (`grep` of test list: no budget/finance/indent tests). Only shared faculty promotionHistory.test.ts touches promotion salary fields.

## Missing (entire module untested at unit level)
1. Budget state machine transitions (legal/illegal) — pure logic ripe for tests.
2. Indent goods flow (quotation count gate, auto payment creation).
3. managementApproval notify/audit behavior + the FINANCE-in-college-users query suspicion.
4. departmentScope narrowing.
5. Salary structure pricing application.
6. Overview endpoints (GLOBAL scoping across colleges).

## Risky untested
- requireCollegeContext tenant selection on every finance route (cross-tenant risk).
- Auto-creation side effects (FinanceBudget, FinancePayment) under failure/retry.
