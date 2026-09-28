# M6 — API Map

| Endpoint | Method | Auth | Roles | SM | DB | Notes |
|---|---|---|---|---|---|---|
| `/api/leave/applications` | GET, POST | requireCollegeMember | all staff (apply); approvers read | SM1 | leaveRequests | balance check |
| `/api/leave/applications/[id]` | GET, PATCH | requireCollegeMember | approver chain | SM1 | leaveRequests | stage routing |
| `/api/leave/applications/[id]/adjustment-response` | POST | requireCollegeMember | invited colleague | SM4 | leaveRequests | consent |
| `/api/leave/adjustment-requests` | GET, POST | requireCollegeMember | applicant | SM4 | leaveRequests | invitations |
| `/api/leave/balances` | GET | requireCollegeMember | self/HOD | SM2 | leaveBalances | computed |
| `/api/leave/profile` | GET | requireCollegeMember | self | SM2 | employeeLeaveProfiles | |
| `/api/leave/profiles` | GET, PATCH? | requireCollegeMember | HOD/CO | SM2 | employeeLeaveProfiles | manage |
| `/api/leave/types` | GET | requireRole | staff | SM2 | — | type catalog |
| `/api/leave/other-categories` | GET, POST? | requireCollegeMember | Principal | SM2 | otherLeaveCategories | custom types |
| `/api/leave/staff-adjustments` (+`[id]`) | GET, POST, PATCH | requireCollegeMember | managers | SM3 | staffAdjustments | ACTIVE/CANCELLED |
| `/api/leave/staff-adjustments/options` | GET | requireCollegeMember | managers | SM3 | users/facultyMembers | candidates |
| `/api/leave/handover-candidates` | GET | requireCollegeMember | applicant/HOD | SM3/4 | — | who can cover |
| `/api/leave/period-coverage` | GET | requireCollegeMember | faculty/HOD | SM4 | derived | coverage preview |
| `/api/leave/permissions` (+`[id]`) | GET, POST, PATCH | requireCollegeMember | staff/approvers | SM5 | permissionRequests | short leave |
| `/api/leave/seed` | POST | requireSuperAdmin | SUPER_ADMIN | SM2 | profiles/balances | seeding guardrail |
| `/api/college/leave-history-report` (+`absent-today`,`active-now`,`yearly`,`import`) | GET, POST | requireCollegeMember | CO/HOD/Principal | SM2 | leaveRequests | reportRoster merge |
| `/api/management/leave-approvals` (+`[id]`) | GET, PATCH | requireManagement | MANAGEMENT | SM1 | leaveRequests | Principal's own leave |
