# M7 — DFD Level 2: M7-SM1/SM2 Budget Request Lifecycle

```mermaid
flowchart TD
    HOD["[External Entity] HOD"]
    PR["[External Entity] Principal/VP"]
    FIN["[External Entity] Finance"]
    MGMT["[External Entity] Management"]

    P21("(2.1 Spawn from Cycle / Emergency Submit)")
    P22("(2.2 HOD Fill Items (categories))")
    P23("(2.3 Principal Verify (L1 freeze))")
    P24("(2.4 Finance Decide)")
    P25("(2.5 Emergency Management Approval)")
    P26("(2.6 Notify + Audit)")

    DBR[("budgetRequests (10 states)")]
    DFB[("financeBudgets")]
    DN[("notifications · auditLogs")]

    PR-->P21-->DBR
    HOD-->P22-->DBR
    PR-->P23
    FIN-->P24
    P24-->|"FINANCE_APPROVED"|DFB
    PR-->P25; MGMT-->P25-->DBR
    P22-->P26; P23-->P26; P24-->P26; P25-->P26
    P26-->DN
```

*Evidence: budget.ts:6-22 (states incl. emergency lane + isEmergency), managementApproval.ts:18-97 (notify :18, ref :39, audit :66, FINANCE lookup :96-97), management emergency PATCH sanctioned (verifySession.ts:84-91).*
