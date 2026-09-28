# M4 — API Map

| Endpoint | Method | Auth | Roles | SM | DB | Notes |
|---|---|---|---|---|---|---|
| `/api/college/students` | GET, POST | requireCollegeMember | CO/Principal/HOD(dept)/Panel read | SM1 | students | dept-scope filter |
| `/api/college/students/[id]` | GET, PATCH, DELETE? | requireCollegeMember | CO/Principal/HOD | SM1 | students | |
| `/api/college/students/import-excel` | POST | requireCollegeMember | CO | SM1 | students | exceljs + fieldConstraints |
| `/api/college/students/bulk-delete` | POST | requireCollegeMember | Principal | SM1 | students | destructive `[GAP — confirm audit]` |
| `/api/college/students/distribute` | POST | requireCollegeMember | Principal | SM3 | students/sections | legacy |
| `/api/college/students/distribute-cohort` | POST | requireCollegeMember | Principal/VP/HOD | SM3 | students/sections/distributionLocks | dryRun + 409 |
| `/api/college/students/promote` | POST | requireCollegeMember | Principal/VP | SM2 | students/departmentHistory | 409 missing targets |
| `/api/college/class-leader/timetable` | GET | requireCollegeMember | CLASS_LEADER | SM4 | timetableSlots | read-only |
| `/api/college/class-work-records` (+`/sections`) | GET, POST | requireCollegeMember | faculty/leader | SM4 | classWorkRecords `[UNVERIFIED name]` | route comment: not separate collection |

`[UNVERIFIED]`: exact verbs on `[id]`/bulk-delete; class-work-records backing store.
