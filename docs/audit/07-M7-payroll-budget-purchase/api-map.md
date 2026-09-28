# M7 — API Map

| Endpoint | Method | Auth | Roles | SM | DB | Notes |
|---|---|---|---|---|---|---|
| `/api/college/budget-cycles` (+`[id]`) | GET, POST, PATCH | requireCollegeContext | Principal/Finance/HOD read | SM1 | budgetCycles | spawns requests |
| `/api/college/budget-requests` (+`[id]`) | GET, POST, PATCH | requireCollegeContext + isCollegeAdmin | HOD/Principal/Finance | SM1 | budgetRequests | 10-state machine |
| `/api/finance/budget-requests/overview` | GET | requireRole(FINANCE) | FINANCE | SM1 | budgetRequests | GLOBAL overview |
| `/api/management/emergency-budget-requests` (+`[id]`) | GET, PATCH | requireManagement | MANAGEMENT | SM2 | emergencyBudgetRequests | sanctioned write |
| `/api/college/finance-budgets` (+`[id]`) | GET, POST, PATCH | requireCollegeContext | FINANCE | SM3 | financeBudgets | |
| `/api/college/finance-fund-allocations` (+`[id]`) | GET, POST, PATCH | requireCollegeContext | FINANCE | SM3 | financeFundAllocations | |
| `/api/college/finance-payments` (+`[id]`) | GET, POST, PATCH | requireCollegeContext | FINANCE | SM3 | financePayments | auto-created by indent approval |
| `/api/college/finance-receipts` (+`[id]`) | GET, POST | requireCollegeContext | FINANCE | SM3 | financeReceipts | upload receipt |
| `/api/college/finance-expense-requests` (+`[id]`) | GET, POST, PATCH | requireCollegeContext | FINANCE | SM3 | financeExpenseRequests | |
| `/api/college/finance-purchase-clearance` (+`[id]`) | GET, POST, PATCH | requireCollegeContext | FINANCE | SM4 | financePurchaseClearance | |
| `/api/college/indent-requests` (+`[id]`) | GET, POST, PATCH | requireCollegeContext/Member | HOD/Purchase/Finance | SM4 | indentRequests | 8-state |
| `/api/purchase/indents/overview` | GET | requireRole(PURCHASE_DEPT) | PURCHASE_DEPT | SM4 | indentRequests | GLOBAL overview |
| `/api/college/finance-reports` | GET | requireCollegeContext | FINANCE | SM6 | finance* | excel export |
| `/api/college/finance-audit-logs` | GET | requireCollegeContext | FINANCE | SM6 | financeAuditLogs? `[UNVERIFIED]` | |
| `/api/college/financial-years` | GET, POST | requireCollegeContext | FINANCE | SM3 | financialYears | |
| `/api/college/salary-structures` | GET, POST, PATCH | requireCollegeMember | ACCOUNTS | SM5 | salaryStructures | |
| `/api/college/faculty/[id]/promotion-salary` | PATCH | requireCollegeMember | Principal | SM5 | facultyMembers | |
| `/api/college/users/[uid]/promotion-salary` | PATCH | requireCollegeMember | Principal | SM5 | users | non-teaching |
| `/api/management/colleges/[collegeId]` (budget read) | GET | requireManagement | MANAGEMENT | SM1 | finance* | oversight |
