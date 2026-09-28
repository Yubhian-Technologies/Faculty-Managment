# M6 — Events, Jobs & Integrations (as-is)

## Events/notifications
- Application submitted → approver chain notified (approvalRouting + notifyRole).
- Stage advance / decision → applicant notified; audit written (decideFinalStage.ts:93).
- Adjustment invite/accept/decline → parties notified.
- OD proof uploaded → approvers (odProofNotify.ts).
- Permission (short-leave) → approvers (permissionNotify.ts).

## Jobs
- None.

## Integrations
- M5: approved leave blocks check-in; adjustments/substitutions drive timetable overlays.
- M7: leave history feeds payroll exports (leave-history-report/yearly).
- Excel import for legacy history (leave-history-report/import).
