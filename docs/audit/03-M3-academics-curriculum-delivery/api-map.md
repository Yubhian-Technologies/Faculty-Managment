# M3 — API Map

| Endpoint | Method | Auth | Roles | SM | DB | Notes |
|---|---|---|---|---|---|---|
| `/api/college/course-catalog` (+`[id]`) | GET, POST, PATCH | requireCollegeContext | PRINCIPAL/ACADEMICS | SM1 | courseCatalog | |
| `/api/college/courses` (+`[id]`, `/lookup`) | GET, POST, PATCH | requireCollegeContext | PRINCIPAL | SM1 | courses | |
| `/api/college/course-academic-years` | GET, POST | requireCollegeContext | PRINCIPAL | SM1/SM5 | academicYears | course↔year binding |
| `/api/college/academic-years` | GET, POST | requireCollegeContext | academic roles | SM1/SM5 | academicYears | courseScopeValidation.ts:22 |
| `/api/college/academic-sessions` | GET | requireCollegeContext | college roles | SM1/SM5 | derived | currentTimetableAcademicYear |
| `/api/college/subjects` (+`[id]`) | GET, POST, PATCH, DELETE | requireCollegeMember | ACADEMICS/HOD | SM2 | subjects | dual model validation |
| `/api/college/subjects/categories` | GET | requireCollegeMember | ACADEMICS/HOD | SM2 | — | enum + custom |
| `/api/college/subjects/import` | POST | requireCollegeMember | ACADEMICS | SM2 | subjects | excel |
| `/api/college/subject-semester-assignments` | GET, POST, DELETE | requireCollegeMember | ACADEMICS | SM3 | subjectSemesterAssignments | SubjectInstanceService |
| `/api/college/sections` (+`[id]`, `/lookup`) | GET, POST, PATCH, DELETE | requireCollegeMember | HOD/PRINCIPAL | SM4 | sections | dept scope |
| `/api/college/departments/import` | POST | requireCollegeMember | PRINCIPAL | SM4 | departments | renameCascade |
| `/api/college/teaching-assignments` (+`[id]`) | GET, POST, PATCH, DELETE | requireCollegeMember | HOD | SM5 | teachingAssignments | labBatch at POST (teaching.ts:267-275) |
| `/api/college/faculty-assignment-requests` (+`[id]`) | GET, POST, PATCH | requireCollegeMember | HOD/faculty | SM5 | facultyAssignmentRequests | PENDING→ALLOCATED|DECLINED |
| `/api/college/timetable-slots` (+`[id]`) | GET, POST, PATCH, DELETE | requireCollegeMember | incharge/HOD | SM6 | timetableSlots | overlay substitutions on GET |
| `/api/college/timetable/draft` | GET, POST, DELETE | requireCollegeMember | incharge/HOD | SM6 | timetableDrafts | generator + diagnostics |
| `/api/college/timetable/publish` | POST | requireCollegeMember | incharge/HOD | SM6 | timetableSlots | stamps semester/year |
| `/api/college/timetable-incharges` | GET, POST, DELETE? | requireCollegeMember | HOD | SM6 | timetableIncharges | doc id courseId_yearN |
| `/api/college/course-year-timings` | GET, POST | requireCollegeContext/Member | CO/Principal | SM7 | courseYearTimings | id courseId_yearN |
| `/api/college/exam-configurations` | GET, POST, PATCH? | requireCollegeMember | EXAM_CELL | SM8 | examConfigurations | id examConfigId(courseId,year,examType) |
| `/api/college/internal-exam-marks` (+`[id]`) | GET, POST, PATCH | requireCollegeMember | HOD/EXAM_CELL/Panel read | SM8 | internalExamMarks | DRAFT→SUBMITTED |
| `/api/college/mid-paper-assignments` | GET, POST | requireCollegeMember | HOD | SM8 | midPaperAssignments | status ASSIGNED |
| `/api/college/exam-circulars` (+`[id]`) | GET, POST, PATCH | requireCollegeMember | EXAM_CELL | SM8 | examCirculars | |
| `/api/college/exam-guidelines` (+`[id]`) | GET, POST, PATCH, DELETE? | requireCollegeMember | EXAM_CELL | SM8 | examGuidelines | |
| `/api/college/class-leader/timetable` | GET | requireCollegeMember | CLASS_LEADER | SM6 read | timetableSlots | read-only + overlay |
| `/api/college/class-work-records` (+`/sections`) | GET, POST | requireCollegeMember | faculty | SM5/SM8 | classWorkRecords `[UNVERIFIED name]` | deliberately not separate collection (route comment:19) |

Verbs marked `?` are `[UNVERIFIED]`.
