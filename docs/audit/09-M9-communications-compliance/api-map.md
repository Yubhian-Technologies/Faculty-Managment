# M9 — API Map

| Endpoint | Method | Auth | Roles | SM | DB | Notes |
|---|---|---|---|---|---|---|
| `/api/college/circulars` | GET, POST | requireCollegeMember + permission doc | Principal/VP/allow-list | SM1 | circulars | create DRAFT |
| `/api/college/circulars/[id]` | GET, PATCH, DELETE? | same | creator/recipient read | SM1 | circulars | |
| `/api/college/circulars/[id]/publish` | POST | same | allow-list | SM1 | circulars + notifications | fan-out |
| `/api/college/circulars/permissions/me` | GET | requireCollegeMember | any staff | SM1 | permissions doc | UI gating |
| `/api/college/circular-settings` | GET, PUT | requireCollegeMember | Principal | SM1 | settings doc | messageFrom options |
| `/api/college/circular-permissions` | GET, PUT | requireCollegeMember | Principal | SM1 | permissions doc | allowedUids/Roles |
| `/api/college/audit-logs` | GET | requireCollegeMember | Principal (college) | SM2 | auditLogs | read stream |
| `/api/college/student-feedback` | GET | requireCollegeMember | Panel recipients | SM3 | studentFeedback | |
| `/api/public/student-feedback` | POST | public (tokenized path) | student | SM3 | studentFeedback | public form |
| `/api/upload/circular` | POST | requireCollegeMember | allow-list | SM1 | Storage | colleges/{id}/circulars/ |
