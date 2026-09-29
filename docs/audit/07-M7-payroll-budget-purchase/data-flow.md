# M7 — Data Flow (as-is)

## M7-SM1 Budget cycle → request → FinanceBudget

**Actors:** Principal (cycle), HOD (fill), Principal/VP (verify), Finance (decide).
**Flow:**
1. `POST /api/college/budget-cycles` → PENDING_APPROVAL (BudgetCycleStatus budget.ts:132) → Principal APPROVED → auto-creates `budgetRequests` per department with status PENDING_SUBMISSION (comment :8).
2. HOD fills items (categories RECURRING/NON_RECURRING :35-45) → submit → PENDING_PRINCIPAL_VERIFICATION.
3. Principal verify → L1_FROZEN (queued for Finance) or RETURNED_TO_PRINCIPAL? no — RETURNED_TO_HOD; or PRINCIPAL_REJECTED.
4. Finance decide → FINANCE_APPROVED (auto-creates FinanceBudget) or FINANCE_REJECTED.
**Emergency lane:** Principal/VP submits isEmergency request → PENDING_MANAGEMENT_APPROVAL → Management PATCH (sanctioned) → Finance.

```mermaid
sequenceDiagram
    actor P as Principal
    actor H as HOD
    actor F as Finance
    participant CYC as /api/college/budget-cycles
    participant BR as /api/college/budget-requests
    participant FS as budgetCycles/budgetRequests/financeBudgets
    P->>CYC: POST cycle
    P->>CYC: approve cycle
    CYC->>FS: cycle APPROVED + spawn budgetRequests (PENDING_SUBMISSION)
    H->>BR: fill + submit
    BR->>FS: PENDING_PRINCIPAL_VERIFICATION
    P->>BR: verify (L1_FROZEN)
    F->>BR: decide
    BR->>FS: FINANCE_APPROVED + create FinanceBudget
```

## M7-SM4 Indent (goods lane)

**Actors:** HOD, Purchase Dept, Finance.
**Flow:** HOD submits GOODS indent → PENDING_PURCHASE_REVIEW → Purchase adds ≥3 quotations + selects 1 → PENDING_FINANCE_REVIEW → Finance APPROVED (auto-creates FinancePayment) → Purchase buys + uploads GRN → COMPLETED. Returns: RETURNED_TO_HOD (purchase/finance), RETURNED_TO_PURCHASE (finance), REJECTED_BY_PURCHASE, REJECTED (finance). NON_GOODS: HOD → PENDING_FINANCE_REVIEW directly → Finance approves & disburses → COMPLETED.

```mermaid
sequenceDiagram
    actor H as HOD
    actor PU as Purchase Dept
    actor F as Finance
    participant API as /api/college/indent-requests
    participant FS as indentRequests/financePayments
    H->>API: POST GOODS indent
    API->>FS: PENDING_PURCHASE_REVIEW
    PU->>API: add 3 quotations + select 1
    API->>FS: PENDING_FINANCE_REVIEW
    F->>API: APPROVED
    API->>FS: status APPROVED + auto-create FinancePayment
    PU->>API: upload GRN + complete
    API->>FS: COMPLETED
```

## M7-SM3 Finance ledger
Fund allocations against FinanceBudget → payments (process at `/finance/payments/[id]/process`) → receipts (uploads) → expense requests; reports aggregate; finance-audit-logs stream.

## M7-SM5 Salary structures
Accounts defines structures (per designation bands) → `applySalaryStructurePricing` maps faculty (:44-58) → promotion-salary routes update faculty pay on promotion.

## Error paths
Terminal rejections; returns allow edit+resubmit; 25th payroll lock on manual attendance ties M5→M7 payroll cut-off.
