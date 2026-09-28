# M5 — API Map

| Endpoint | Method | Auth | Roles | SM | DB | Notes |
|---|---|---|---|---|---|---|
| `/api/college/attendance/check-in` | POST | requireCollegeMember | staff self | SM1 | attendanceRecords, lateAttendanceCounters | gates + idempotent penalty (route:79) |
| `/api/college/attendance/check-out` | POST | requireCollegeMember | staff self | SM1 | attendanceRecords | |
| `/api/college/attendance/today-status` | GET | requireCollegeMember | staff self | SM1 | attendanceRecords | |
| `/api/college/attendance/face-registration` (+`/reset`) | POST | requireCollegeMember | self; reset cascades | SM1 | users/Storage | |
| `/api/college/attendance/reference-photo` | POST | requireCollegeMember | self | SM1 | Storage | |
| `/api/college/attendance/campus-location` | GET/PUT | requireCollegeMember | Principal (write) | SM1 | settings | geofence def |
| `/api/college/attendance/check-in-permission` | GET/POST | requireCollegeMember | cascade | SM1 | attendanceCheckInPermissions | PRINCIPAL/VP→HOD/unit-head |
| `/api/college/attendance/report` | GET | requireCollegeMember | HOD (dept tree) / Principal (college) | SM2 | attendanceRecords | route:147 Sunday fix |
| `/api/college/attendance/manual` | POST | requireCollegeMember | admins | SM2 | attendanceRecords + audit | 1-tier cascade + 25th lock |
| `/api/college/attendance/import` | POST | requireCollegeMember | admins | SM2 | attendanceRecords | excel |
| `/api/college/attendance/monthly-export` | GET | requireCollegeMember | admins | SM2 | attendanceRecords | file |
| `/api/college/attendance` | GET | requireCollegeMember | read views | SM2 | attendanceRecords | |
| `/api/college/attendance-not-posted-settings` | GET, PUT | requireCollegeMember | Principal | SM5 | settings | |
| `/api/college/faculty-attendance-completion` | GET | requireCollegeMember | HOD/Principal | SM5 | studentAttendance/attendanceRecords | ranges |
| `/api/college/student-attendance/today-periods` | GET | requireCollegeMember | faculty/panel | SM3 | timetableSlots + studentAttendance | currentPeriod engine |
| `/api/college/student-attendance` | GET, POST | requireCollegeMember | faculty/substitute/panel | SM3 | studentAttendance | tx; id assign_date_period |
| `/api/college/student-attendance/[id]` | GET, PATCH | requireCollegeMember | same | SM3 | studentAttendance | expectedUpdatedAt→409 |
| `/api/college/student-attendance/office-correction` (+`[id]`) | GET, POST, PATCH | requireCollegeMember | HOD | SM3 | studentAttendance | on-behalf |
| `/api/college/student-attendance-history` | GET | requireCollegeMember | HOD/Principal/ExamCell | SM4 | studentAttendance | |
| `/api/college/section-attendance-report` | GET | requireCollegeMember | HOD/Principal/ExamCell/Panel | SM4 | studentAttendance | 5 modes |
| `/api/college/attendance-percentage-report` | GET | requireCollegeMember | HOD/Principal | SM4 | studentAttendance | |
| `/api/cron/attendance-not-posted` | POST | Bearer CRON_SECRET | system | SM5 | settings + notifications | once/day/college |
| `/api/location/staff-attendance` (+`/report`) | GET, POST | requireRole (location) | LDH/LSA/Administration | SM6 | location attendance | branch WIP |
| `/api/location/shifts` (+`[id]`, `/rotate`) | GET, POST, PATCH | requireRole (location) | LSA/LDH | SM6 | location shifts | rotation |
| `/api/management/colleges/[collegeId]/faculty-attendance/[uid]` | GET | requireManagement | MANAGEMENT | SM2 | attendanceRecords | oversight |
| `/api/management/colleges/[collegeId]/department-attendance` | GET | requireManagement | MANAGEMENT | SM2 | attendanceRecords | |
| `/api/management/colleges/[collegeId]/principal-attendance` (+`/reset`) | GET, POST | requireManagement | MANAGEMENT | SM2 | attendanceRecords | sanctioned write |
| `/api/management/colleges/[collegeId]/vice-principal-attendance` | GET | requireManagement | MANAGEMENT | SM2 | attendanceRecords | |
| `/api/management/colleges/[collegeId]/monthly-export` | GET | requireManagement | MANAGEMENT | SM2 | attendanceRecords | |
