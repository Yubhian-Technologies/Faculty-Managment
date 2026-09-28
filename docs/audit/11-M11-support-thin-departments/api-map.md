# M11 — API Map (shared endpoints consumed)

| Endpoint | Method | Auth | Consumer roles | Notes |
|---|---|---|---|---|
| `/api/college/attendance/check-in|check-out|today-status` | POST/GET | requireCollegeMember | all four | M5-SM1 |
| `/api/college/attendance/report` | GET | requireCollegeMember | Library/T&P (dept admins) | M5-SM2 |
| `/api/college/attendance/import` | POST | requireCollegeMember | Library/T&P | attendance-import pages |
| `/api/leave/*` (applications, balances, types, history) | GET/POST/PATCH | requireCollegeMember | all four | M6 |
| `/api/college/faculty/me` (+ photo) | GET/PATCH | requireCollegeMember | all four | profile |
| profile module save APIs | PATCH | requireCollegeMember | module-assigned | M1/M8 |

No M11-owned endpoints exist — by design.
