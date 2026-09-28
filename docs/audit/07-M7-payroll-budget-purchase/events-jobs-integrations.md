# M7 — Events, Jobs & Integrations (as-is)

## Notifications
- Every stage change in budget/indent/purchase-clearance notifies next actor (notify.ts built explicitly for these flows — module comment :9-16; notifyRole call sites across budget-requests, indent-requests, finance-purchase-clearance, citation-metrics unrelated).
- Emergency request → Management notified; decision → Principal.

## Jobs
- None.

## Integrations
- Uploads: budget-circular, budget-report, finance-receipt, indent-receipt, purchase-grn.
- Excel: finance reports export (exportExcel.ts).
- M5 tie-in: 25th payroll lock on manual attendance.
