# LLD — Budget & Finance Module

## Module Overview

Budget cycle requests (HOD → Principal freeze → Finance approve/return), fund allocations, expenses, purchases with GRN, indents, payments/receipts, financial years, emergency budget requests (Management), salary structures, and Excel reporting. Interface surface: `/api/college/{budget-cycles, budget-requests, finance-budgets, finance-budget-requests, finance-expense-requests, finance-fund-allocations, finance-payments, finance-purchase-clearance, finance-receipts, finance-reports, finance-audit-logs, indent-requests, financial-years, salary-structures}`, `/api/finance/*`, `/api/purchase/indents`, `/api/management/emergency-budget-requests`, uploads (`finance-receipt`, `purchase-grn`, `indent-receipt`, `budget-circular`, `budget-report`).

## Component & Class Structure

| Component | Location | Responsibility |
|---|---|---|
| Domain rules | `src/lib/budget/` — `departmentScope.ts`, `managementApproval.ts`, `applySalaryStructurePricing.ts` | Scope narrowing, Management-level approvals, salary-structure pricing |
| Finance helpers | `src/lib/finance/exportExcel.ts` | Excel workbooks (exceljs) |
| Notifications | `src/lib/notify.ts` | `notify`/`notifyRole` — **born from a real bug**: FINANCE/PURCHASE_DEPT are GLOBAL roles in `systemUsers`; naive per-route copies found zero recipients |
| Types | `src/types/budget.ts`, `finance.ts`, `indent.ts`, `payroll.ts` | Domain schemas |
| UI | `src/components/finance/`, dashboards `principal/budget`, `accounts`, `finance`, `purchase`, `hod` | Role-specific workflow screens |

## Sequence Diagram — budget request lifecycle

```mermaid
sequenceDiagram
    participant H as HOD
    participant R as /api/college/budget-requests
    participant P as Principal (freeze/approve)
    participant FIN as Finance
    participant M as Management (emergency)
    participant FS as Firestore
    participant N as lib/notify

    H->>R: POST budget-requests (department-scoped)
    R->>FS: colleges/{id}/budgetRequests add (status)
    R->>N: notifyRole(PRINCIPAL)
    P->>R: PATCH [id] freeze → approve | return with reason
    R->>FS: status transition + AuditLog
    R->>N: notifyRole(FINANCE) — resolves via systemUsers (GLOBAL scope)
    FIN->>R: approve/return; fund allocation (finance-fund-allocations)
    FIN->>R: expense/purchase clearance (finance-purchase-clearance) + payments/receipts
    M->>R: POST /api/management/emergency-budget-requests (bypass normal cycle)
    R->>FS: finance-audit-logs append for every state change
```

## Data Models & Schemas (src/types/budget.ts, finance.ts, indent.ts)

```ts
// Representative fields — see type files for full schemas
BudgetCycle   { financialYearId, status, freezeAt?, ... }
BudgetRequest { collegeId, department, requestedBy, lines: BudgetLine[], status: WorkflowStatus,
                principalResponse?, financeResponse?, cycleId? }
FundAllocation{ requestId, head, amount, approvedBy, timestamps }
PurchaseClearance{ indentId, grnUrl?, financeStatus, payments: Payment[] }
IndentRequest { department, items[], status, receipts? }
EmergencyBudgetRequest{ collegeId, amount, justification, managementDecision }
```

Collections live under `colleges/{id}/...` for college-scoped flows; Finance/Purchase act through `requireCollegeContext()` (they are GLOBAL roles supplying `?collegeId=`).

## API/Method Contracts

- `POST /api/college/budget-requests` — HOD; 201; department scope enforced via `lib/budget/departmentScope.ts`.
- `PATCH /api/college/budget-requests/[id]` — Principal (freeze/approve/return) then Finance (approve/return); illegal transitions → 400/409; `isCollegeAdmin` tolerated alongside real Principal.
- `GET /api/finance/budget-requests/overview` — cross-college view (`requireRole("FINANCE")`).
- `POST /api/college/finance-purchase-clearance` — GRN upload → Storage; receipts via `upload/finance-receipt`.
- `POST /api/management/emergency-budget-requests` — MANAGEMENT only.
- Status codes: 400 invalid transition/body · 401 guard sentinel · 403 wrong role/scope · 404 cross-tenant · 500 logged.

## Error Handling & Edge Cases

- **Never copy the notify pattern locally** — use `lib/notify.ts` so GLOBAL roles resolve from `systemUsers` (the original bug shipped for months across three call sites).
- Global finance/purchase flows depend on `requireCollegeContext`'s `?collegeId=` override — adding a college-scoped role to its call sites would let that role choose a tenant.
- Salary-structure pricing (`applySalaryStructurePricing`) runs at request composition, not read time.
- Every state change appends a finance audit log — omission is a correctness bug, not a nicety.
- Excel export (`exportExcel.ts`) is server-side (exceljs); receipts/GRNs are Storage-backed with signed-style upload routes (guard-checked).
