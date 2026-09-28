# M1 — API Map

| Endpoint | Method | Auth | Roles | SM | Controller file | Request | Response | DB | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `/api/admin/locations` | GET, POST | requireSuperAdmin | SUPER_ADMIN | SM1 | `api/admin/locations/route.ts` | location payload | list/created | `locations` | |
| `/api/admin/locations/[id]` | GET?, PATCH | requireSuperAdmin | SUPER_ADMIN | SM1 | `api/admin/locations/[id]/route.ts` | updates | doc | `locations` | `[UNVERIFIED GET]` |
| `/api/admin/colleges` | GET, POST | requireSuperAdmin | SUPER_ADMIN | SM1 | `api/admin/colleges/route.ts` | college payload | list/created | `colleges` | |
| `/api/admin/users` | GET, POST | requireSuperAdmin | SUPER_ADMIN | SM2 | `api/admin/users/route.ts` | user payload | list/created | `systemUsers` | global users |
| `/api/admin/users/[uid]` | PATCH, DELETE | requireSuperAdmin | SUPER_ADMIN | SM2 | `api/admin/users/[uid]/route.ts` | updates | ok | `systemUsers` | |
| `/api/admin/users/[uid]/photo` | POST | requireSuperAdmin | SUPER_ADMIN | SM2 | photo route | multipart | url | Storage | |
| `/api/admin/users/me` | GET, PATCH | requireRole | self | SM2 | `api/admin/users/me/route.ts` | profile edits | doc | `systemUsers` | self-profile |
| `/api/admin/users/me/photo` | POST | requireRole | self | SM2 | photo route | multipart | url | Storage | |
| `/api/admin/dashboard-stats` | GET | requireSuperAdmin | SUPER_ADMIN | SM1 | stats route | — | counts | multi | home cards |
| `/api/admin/audit-logs` | GET | requireSuperAdmin | SUPER_ADMIN | SM4 | audit route | filters | logs | `auditLogs`(global) | |
| `/api/admin/settings/nav-visibility` | GET, PUT | requireSuperAdmin | SUPER_ADMIN | SM3 | nav-visibility route | visibility map | doc | settings | global defaults |
| `/api/admin/general-admin-vacancies*` | GET, POST, PATCH | requireSuperAdmin/requireCollegeMember mix | SUPER_ADMIN | (M2) | general-admin-vacancies routes | vacancy payloads | list | `vacancyRequests`(location) | M2 boundary |
| `/api/administration/college-people` | GET, POST | requireLocationMember | ADMINISTRATION | SM2 | college-people route | person payload | list/created | `colleges/{id}/users`? | `[UNVERIFIED target root]` |
| `/api/administration/college-people/[uid]` | GET, PATCH | requireLocationMember | ADMINISTRATION | SM2 | `[uid]/route.ts` | updates | doc | same | |
| `/api/administration/colleges/[collegeId]/departments` | GET, POST | requireLocationMember | ADMINISTRATION | SM1 | departments route | dept payload | list | `colleges/{id}/departments` | |
| `/api/administration/colleges/[collegeId]/departments/[deptId]/faculty` | GET | requireLocationMember | ADMINISTRATION | SM1 | faculty route | — | list | `facultyMembers` | |
| `/api/administration/principals` | GET, POST | requireLocationMember | ADMINISTRATION | SM2 | principals route | principal payload | list | `colleges/{id}/users` + seats | Principal appointment |
| `/api/college/users` | GET, POST | requireCollegeMember | PRINCIPAL/VP/COLLEGE_OFFICE(+HOD dept) | SM2 | `api/college/users/route.ts` | user payload | list/created | `colleges/{id}/users` | office-role college-type gate |
| `/api/college/users/[uid]` | GET, PATCH, DELETE? | requireCollegeMember + isDepartmentOffice exceptions | per matrix | SM2 | `[uid]/route.ts` | updates | doc | `colleges/{id}/users` | |
| `/api/college/users/[uid]/promotion-salary` | PATCH | requireCollegeMember | PRINCIPAL/VP | (M7) | promotion-salary route | salary/promotion | doc | `users`, `facultyMembers` | M7 boundary |
| `/api/college/users/me` | GET, PATCH | requireCollegeMember | self | SM2 | me route | profile | doc | `colleges/{id}/users` | |
| `/api/college/users/me/photo` | POST | requireCollegeMember | self | SM2 | photo route | multipart | url | Storage | |
| `/api/college/role-seats` | GET, POST | requireRole(PRINCIPAL, MANAGEMENT, SUPER_ADMIN, ADMINISTRATION…) | per verifySession comment | SM2 | role-seats route | seat payload | list/created | `roleSeats` | seat appointment |
| `/api/college/role-seats/[id]` | PATCH, DELETE? | requireRole | same | SM2 | `[id]/route.ts` | seat updates | doc | `roleSeats` | |
| `/api/college/role-seats/convert-legacy` | POST | requireRole | PRINCIPAL | SM2 | convert-legacy route | — | summary | `roleSeats` | one-time migration |
| `/api/college/settings/general` | GET, PUT | requireRole | PRINCIPAL/VP | SM5 | settings/general route | settings | doc | `settings/general` | collegeSettings.ts:26 |
| `/api/college/settings/nav-visibility` | GET, PUT | requireRole | PRINCIPAL/VP | SM3 | nav-visibility route | visibility map | doc | settings | |
| `/api/college/academic-years` | GET, POST | requireCollegeContext | academic roles | SM5 | academic-years route | year payload | list | `academicYears` | |
| `/api/college/academic-sessions` | GET | requireCollegeContext | college roles | SM5 | academic-sessions route | — | label/current | derived | academicSession.ts |
| `/api/college/course-academic-years` | GET, POST | requireCollegeContext | PRINCIPAL/ACADEMICS | SM5 | route | mappings | list | `academicYears` | course↔year binding |
| `/api/college/course-catalog` | GET, POST | requireCollegeContext | PRINCIPAL/ACADEMICS | SM5/M3 | course-catalog route | catalog payload | list | `courseCatalog` | shared M3 |
| `/api/college/course-catalog/[id]` | GET, PATCH, DELETE? | requireCollegeContext | same | SM5/M3 | `[id]/route.ts` | updates | doc | `courseCatalog` | |
| `/api/college/webmaster/reset-password` | POST | requireCollegeMember (WEBMASTER) | WEBMASTER | SM2 | reset-password route | uid+password | ok | Firebase Auth | sole reset path |
| `/api/management/**` (M1-relevant: colleges, locations, users, role-assignments reads) | GET | requireManagement | MANAGEMENT | SM1/SM2 | management routes | — | lists | multi | read-only oversight |

Method lists marked `?` are per-file `[UNVERIFIED]` where not read this pass.
