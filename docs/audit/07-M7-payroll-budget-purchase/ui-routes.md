# M7 — UI Routes (as-is)

```text
/hod/budget (+[id], report) · /hod/indents (+[id]) · /hod/purchase-clearance (+[id], new)
/principal/budget (+new, [id], [id]/edit, report) · /principal/indents (+[id]) · /principal/purchase-clearance (+[id])
/finance (30): /budget (+new, [id]/revise, report) · /budget-cycles · /budget-approvals (+new) · /expense-requests (+new) · /fund-allocation (+new, [id]/edit) · /payments (+new, [id]/process) · /receipts (+new) · /purchase-clearance · /indent-approvals · /reports · /audit · /browse (+[locationId], [locationId]/[collegeId]) · /leave* · /profile
/purchase (16): /indents (+[id]) · /pending · /latest · /by-category · /by-type · /clearance/[id] · /browse (+drill) · /leave* · /profile
/management/budget (+[collegeId]) · /management/indents · /management/emergency approvals on dashboard
/accounts/salary-structures (+new, [id]/edit)
```

Guards: proxy per role; finance/purchase GLOBAL with college browse; emergency management write sanctioned.
