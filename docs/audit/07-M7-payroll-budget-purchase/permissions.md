# M7 — Permissions (as-is)

| Action | HOD | Principal/VP | Finance | Purchase | Management | Accounts |
|---|---|---|---|---|---|---|
| Create budget cycle | ➖ | ✅ | ➖ | ➖ | 🔎 | ➖ |
| Fill/submit budget request | ✅ dept | ➖ | ➖ | ➖ | ➖ | ➖ |
| Verify (L1 freeze) | ➖ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Finance approve/reject | ➖ | ➖ | ✅ | ➖ | ➖ | ➖ |
| Emergency submit | ➖ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Emergency approve | ➖ | ➖ | ➖ | ➖ | ✅ (sanctioned) | ➖ |
| Fund allocations/payments/receipts/expenses | ➖ | 🔎 | ✅ | ➖ | 🔎 | ➖ |
| Indent raise | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Quotations (goods) | ➖ | ➖ | ➖ | ✅ | ➖ | ➖ |
| Indent approve | ➖ | ➖ | ✅ | ➖ | ➖ | ➖ |
| Purchase clearance | 🔎 | ✅ (hod/principal clearance steps) | ✅ | ➖ | 🔎 | ➖ |
| Salary structures | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ |
| Promotion salary | ➖ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Finance reports/audit | ➖ | 🔎 | ✅ | ➖ | ✅ (cross-college) | ➖ |

## Scoping
- HOD: departmentScope.ts (user doc reads :15,:36). Finance/Purchase: GLOBAL — college selected via requireCollegeContext `?collegeId=` (the 31 call-sites pattern; footgun cross-cutting #5). Management: requireManagement reads + one sanctioned write.
- 25th payroll lock ties manual attendance entries to payroll cut-off (M5).

## Gaps
1. managementApproval.ts queries `colleges/{id}/users where role==FINANCE` (:96-97) — FINANCE profiles live in systemUsers (GLOBAL); query may return empty; notify.ts exists precisely to fix this class of bug for notifications, but this direct query looks suspicious `[GAP — verify]`.
2. Accounts' salary-structures route guard — requireCollegeMember assumed; verify ACCOUNTS in role list.
