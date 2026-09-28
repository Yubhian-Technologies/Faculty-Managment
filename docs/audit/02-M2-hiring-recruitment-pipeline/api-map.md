# M2 — API Map

| Endpoint | Method | Auth | Roles | SM | File | Request | Response | DB | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `/api/college/vacancy-requests` | GET, POST | requireCollegeMember | HOD raise; Principal/VP/CO read | SM1 | vacancy-requests/route.ts | VacancyRequest payload | list/created | vacancyRequests | ratio payload |
| `/api/college/vacancy-requests/[id]` | GET, PATCH | requireCollegeMember + isCollegeAdmin checks | Principal decide; HOD acknowledge | SM1 | [id]/route.ts | decision/ack | doc | vacancyRequests | principalResponse |
| `/api/college/candidates` | GET, POST | requireCollegeMember | HOD/CO/HR | SM2 | candidates/route.ts | candidate payload | list/created | candidates | |
| `/api/college/candidates/[id]` | GET, PATCH | requireCollegeMember | same | SM2 | [id]/route.ts | updates | doc | candidates | |
| `/api/college/candidate-applications` | GET, POST | requireCollegeMember | HOD shortlist | SM2 | route | application payload | list/created | candidateApplications | notify HOD |
| `/api/college/candidate-applications/[id]` | GET, PATCH | requireCollegeMember | same | SM2 | [id]/route.ts | stage/status | doc | candidateApplications | |
| `/api/college/hiring-batches` | GET, POST | requireCollegeMember | HOD/Principal | SM6 | route | batch payload | list/created | hiringBatches | |
| `/api/college/hiring-batches/[id]` | GET, PATCH | requireCollegeMember | HOD/Principal/panel reads | SM6 | [id]/route.ts | phase transitions | doc | hiringBatches | phase machine |
| `/api/college/hiring-terms` | GET, POST | requireCollegeMember | Principal | SM6 | route | template | list | hiringTerms | active template |
| `/api/college/hiring-terms/[id]` | PATCH, DELETE? | requireCollegeMember | Principal | SM6 | [id]/route.ts | updates | doc | hiringTerms | |
| `/api/college/panel-feedback` | POST/PUT | requireCollegeMember | panel members | SM3 | route | scores | doc | panelFeedback | keyed (candidate,panelist) |
| `/api/college/offer-letters` | GET, POST | requireCollegeMember | CO create; AC verify; PR read | SM4 | route | offer payload | list/created | offerLetters | terms snapshot |
| `/api/college/offer-letters/[id]` | GET, PATCH | requireCollegeMember | CO/AC/PR | SM4 | [id]/route.ts | send/decide | doc | offerLetters + candidates | tx decision offerLetterDecision.ts:22-62 |
| `/api/college/appointment-letters` | GET, POST | requireCollegeMember | CO | SM4 | route | letter payload | list/created | appointmentLetters | post-hire |
| `/api/college/faculty-account-requests` | GET, POST | requireCollegeMember | CO request | SM5 | route | request payload | list/created | facultyAccountRequests | notify |
| `/api/college/faculty-account-requests/[id]` | PATCH | requireCollegeMember | WM fulfill | SM5 | [id]/route.ts | status | doc | facultyAccountRequests | SUBMITTED→COMPLETED |
| `/api/college/email-requests` | GET, POST | requireCollegeMember | WM | SM5 | route | email request | list | emailRequests | |
| `/api/college/email-requests/[id]` | PATCH | requireCollegeMember | WM | SM5 | [id]/route.ts | status | doc | emailRequests | |
| `/api/college/email-requests/check-availability` | GET | requireCollegeMember | WM | SM5 | check route | ?email= | boolean | — | |
| `/api/location/vacancy-requests` (+[id]) | GET, POST, PATCH | requireLocationMember | ADMINISTRATION/HR | SM1 | location routes | vacancy | list/doc | location vacancy store `[UNVERIFIED root]` | location hiring |
| `/api/location/candidates` (+[id]) | GET, POST, PATCH | requireLocationMember | HR/ADMIN_OFFICE/LDH | SM2 | location routes | candidate | list/doc | location candidates | |
| `/api/location/interviews` (+[id]) | GET, POST, PATCH | requireLocationMember | same | SM3 | location routes | interview ops | list/doc | location interviews | |
| `/api/location/offers` (+[id]) | GET, POST, PATCH | requireLocationMember | CO/LDH | SM4 | location routes | offer | list/doc | location offers | |
| `/api/admin/general-admin-vacancies` (+[id]) | GET, POST, PATCH | requireSuperAdmin / requireCollegeMember mix | SUPER_ADMIN | SM1 | admin routes | vacancy | list/doc | vacancyRequests (GENERAL_ADMIN) | |
| `/api/public/candidate-form/[collegeId]/[candidateId]` | POST | public (token path) | candidate | SM2/M10 | public route | form payload | ok | candidates/applications | |
| `/api/public/offer-acceptance/[collegeId]/[offerId]` | POST | public (token path) | candidate | SM4/M10 | public route | accept/reject | ok | offerLetters | respondedBy=CANDIDATE |
| `/api/upload/resume`, `/certificate`, `/joining-letter` | POST | college guard (+public resume `[UNVERIFIED]`) | staff/candidate | SM2/SM4 | upload routes | multipart | url | Storage | |

`[UNVERIFIED]` items: exact verbs on some `[id]` routes; location vacancy store root; public resume upload guard.
