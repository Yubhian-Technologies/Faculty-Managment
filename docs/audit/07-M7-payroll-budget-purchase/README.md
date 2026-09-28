# M7 — Payroll, Budget & Purchase (as-is)

## Purpose
Budget cycles → HOD budget requests (L1 freeze) → Finance budgets/payments/receipts/expenses → financial reports & audit; emergency budgets via Management; indents (goods vs non-goods) with Purchase Dept quotation flow and clearance; salary structures applied to faculty (promotions).

## Status: Implemented (deep state machines, well-typed).

## Submodules
| ID | Submodule | Status |
|---|---|---|
| M7-SM1 | Budget Cycles & Requests | Implemented (10-state machine budget.ts:6-22) |
| M7-SM2 | Emergency Budgets (Principal/VP→Management→Finance) | Implemented |
| M7-SM3 | Finance Ledger (budgets, fund allocations, payments, receipts, expense requests, reports, audit) | Implemented |
| M7-SM4 | Indents & Purchase Clearance (goods/non-goods 8-state) | Implemented (indent.ts:36-48) |
| M7-SM5 | Salary Structures & Promotion Salary | Implemented |
| M7-SM6 | Financial Reports & Audit/Compliance | Implemented |

## Dashboards/roles
HOD (`/hod/budget*`, `/hod/indents*`, `/hod/purchase-clearance*`), Principal (`/principal/budget*`, indents, purchase-clearance), Finance (30 pages), Purchase (16 pages), Management (budget/indents read + emergency approve), Accounts (salary-structures), College Accounts (hiring cost views).

## Dependencies
- Depends on M1 (tenants — Finance/Purchase are GLOBAL roles with requireCollegeContext), M5/M6 (payroll inputs), M2 (CTC on provisioning).
- Depended on by M2 (offer CTC → salary), M5 (payroll lock date).

## Key code locations
- Types: `src/types/budget.ts` (320 lines: BudgetRequestStatus:6, BudgetCycleStatus:132, categories NON_RECURRING/RECURRING:35-45; normalizeBudgetRequest/budgetRequestTotal used by 8 UI+API files), `src/types/finance.ts`, `src/types/indent.ts` (130 lines: IndentStatus:36, IndentRequestType GOODS/NON_GOODS, IndentItem:60+), `src/types/payroll.ts`.
- Libs: `src/lib/budget/{managementApproval,departmentScope,applySalaryStructurePricing}.ts`; `src/lib/finance/exportExcel.ts`.
- API: `api/college/budget-cycles*`, `budget-requests*`, `api/college/finance-*` (budgets, fund-allocations, payments, receipts, expense-requests, purchase-clearance, reports, audit-logs), `api/college/indent-requests*`, `api/college/financial-years`, `api/college/salary-structures`, `api/college/faculty/[id]/promotion-salary`, `api/college/users/[uid]/promotion-salary`, `api/finance/budget-requests/overview`, `api/purchase/indents/overview`, `api/management/emergency-budget-requests*`, uploads `budget-circular|budget-report|finance-receipt|indent-receipt|purchase-grn`.
- UI: dirs above; `src/components/finance/*`, `src/components/shared/budget/*`, `src/components/shared/indent/*`, `src/components/management/EmergencyBudgetRequests.tsx`.

## Key stores
`budgetCycles`, `budgetRequests`, `emergencyBudgetRequests`, `financeBudgets`, `financeFundAllocations`, `financePayments`, `financeReceipts`, `financeExpenseRequests`, `financePurchaseClearance`, `indentRequests`, `salaryStructures`, `financialYears`, `financeAuditLogs`? (route finance-audit-logs `[UNVERIFIED collection]`), notifications, auditLogs.

## Jobs
None scheduled.

## Major gaps
1. Finance audit-log stream vs college auditLogs relationship `[UNVERIFIED]`.
2. Salary structures → payroll processing pipeline absent (structures exist; monthly payroll runs offline?) `[GAP]`.
3. Payment status machine for finance payments `[UNVERIFIED read]`.
