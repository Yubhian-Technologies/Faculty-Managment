# M6 — UI Routes (as-is)

Per-role self-service (every staff root): `/leave`, `/leave/apply`, `/leave/history/[type]`.
Shared (cross-role): `/leave/adjustments`, `/leave/revise/[id]`, `/leave/od-proof/[id]`.
Approvals: `/hod/leave-approvals`, `/principal/leave-approvals`, `/management/leave-approvals` (+[id]).
Adjustments: `/hod/adjustments`, `/principal/adjustments`, `/college-office/adjustments`.
Profiles: `/hod/leave/profiles` (+`[uid]/edit`), `/college-office/leave/profiles` (+`[uid]/edit`).
History (college): `/college-office/leave-history` (+`[deptId]`, `[deptId]/[uid]`, `.../history/[type]`, `/import`).
Other roles' twins: `/accounts/leave*`, `/college-accounts/leave*`, `/exam-cell/leave*`, `/finance/leave*`, `/purchase/leave*`, `/academics/leave*`, `/iqac-coordinator|placement-dept|library|t-and-p|webmaster/r-and-d/leave*`.

Guards: proxy `LEAVE_ADJUSTMENTS_PATH = "/leave"` shared across roles (proxy.ts:47-48); per-role prefixes otherwise.
