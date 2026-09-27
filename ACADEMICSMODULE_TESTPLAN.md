# Faculty Management System - Complete Academics Module Test Plan

**Test Plan ID:** ACAD-TEST-2026-001  
**Date:** 2026-09-26  
**Tester Role:** Senior QA Engineer (30+ years experience)  
**Target Credentials:** clgadmin: ravi.k@au.edu.in / 12345678  
**Test Environment:** Local development (localhost:3000)  
**Scope:** Complete Academics Module from subject creation → semester assignment → teaching assignments → timetable → attendance → reports

---

## TABLE OF CONTENTS

1. [Test Strategy Overview](#1-test-strategy-overview)
2. [Test Environment Setup](#2-test-environment-setup)
3. [Test Data Preparation](#3-test-data-preparation)
4. [Test Module 1: Department Setup](#4-test-module-1-department-setup)
5. [Test Module 2: Course Catalog Setup](#5-test-module-2-course-catalog-setup)
6. [Test Module 3: Subject Creation](#6-test-module-3-subject-creation)
7. [Test Module 4: Subject Import](#7-test-module-4-subject-import)
8. [Test Module 5: Section & Student Setup](#8-test-module-5-section--student-setup)
9. [Test Module 6: Faculty Setup](#9-test-module-6-faculty-setup)
10. [Test Module 7: Subject-Semester Assignment](#10-test-module-7-subjectsemester-assignment)
11. [Test Module 8: Timetable Incharge Assignment](#11-test-module-8-timetable-incharge-assignment)
12. [Test Module 9: Teaching Assignments](#12-test-module-9-teaching-assignments)
13. [Test Module 10: Timetable Creation](#13-test-module-10-timetable-creation)
14. [Test Module 11: Timetable Publish & Display](#14-test-module-11-timetable-publish--display)
15. [Test Module 12: Faculty Attendance](#15-test-module-12-faculty-attendance)
16. [Test Module 13: Student Attendance](#16-test-module-13-student-attendance)
17. [Test Module 14: Reports & Analytics](#17-test-module-14-reports--analytics)
18. [Test Module 15: Cross-Department Operations](#18-test-module-15-cross-department-operations)
19. [Test Module 16: Edge Cases & Worst-Case Scenarios](#19-test-module-16-edge-cases--worst-case-scenarios)
20. [Test Module 17: Authorization & Security](#20-test-module-17-authorization--security)
21. [Test Module 18: End-to-End Full Flow](#21-test-module-18-end-to-end-full-flow)
22. [Bug Report Template](#22-bug-report-template)

---

## 1. TEST STRATEGY OVERVIEW

### Testing Approach
- **Black-box testing**: Test all APIs and UI flows without knowledge of implementation
- **White-box testing**: Verify data integrity across collections
- **Boundary value analysis**: Test edge cases at boundaries
- **Equivalence partitioning**: Group similar inputs for efficiency
- **State transition testing**: Verify workflow state changes
- **Negative testing**: Intentional invalid inputs to verify error handling
- **Cross-functional testing**: Verify data consistency across multiple modules

### Test Levels
1. **Unit Level**: Individual API endpoint validation
2. **Integration Level**: Multi-endpoint workflows
3. **System Level**: Complete module workflows
4. **Regression Level**: Verify existing functionality after changes

### Test Priority Matrix
| Priority | Description | Test Count |
|----------|-------------|------------|
| P0 - Critical | Core functionality, data integrity, security | 45 |
| P1 - High | Important workflows, edge cases | 35 |
| P2 - Medium | Secondary features, reporting | 25 |
| P3 - Low | UI/UX, minor features | 15 |

---

## 2. TEST ENVIRONMENT SETUP

### Prerequisites
```bash
# 1. Start development server
npm run dev

# 2. Verify Firebase connection
# Check .env.test exists with correct credentials
cat tests/e2e/.env.test

# 3. Verify Firestore has test data
# Create a test college, departments, courses in Firestore
```

### Environment Variables Required
```
FIREBASE_ADMIN_PROJECT_ID=...
FIREBASE_ADMIN_CLIENT_EMAIL=...
FIREBASE_ADMIN_PRIVATE_KEY=...
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
SESSION_SECRET=test-session-secret-key-for-testing-only
```

### Test Data Setup (Firestore)
```javascript
// Create test college
college: "TEST-CLG-001"
name: "Test Engineering College"

// Create departments
departments:
  - id: "DEPT-CSE", name: "Computer Science Engineering", parentDepartmentId: null
  - id: "DEPT-EEE", name: "Electronics and Electrical Engineering", parentDepartmentId: null
  - id: "DEPT-MECH", name: "Mechanical Engineering", parentDepartmentId: null
  - id: "DEPT-BASIC", name: "Basic Science", parentDepartmentId: null
    - children: ["DEPT-BS-MATH", "DEPT-BS-ENGLISH"]
  - id: "DEPT-BS-MATH", name: "BS Mathematics", parentDepartmentId: "DEPT-BASIC"

// Create courses
courses:
  - id: "COURSE-CSE-BTECH", name: "B.Tech CSE", catalogId: "CAT-BTECH", durationYears: 4, departmentId: "DEPT-CSE"
  - id: "COURSE-EEE-BTECH", name: "B.Tech EEE", catalogId: "CAT-BTECH", durationYears: 4, departmentId: "DEPT-EEE"
  - id: "COURSE-MECH-BTECH", name: "B.Tech MECH", catalogId: "CAT-BTECH", durationYears: 4, departmentId: "DEPT-MECH"
  - id: "COURSE-BASIC-BTECH", name: "B.Tech Common", catalogId: "CAT-BTECH", durationYears: 4, departmentId: "DEPT-BASIC"

// Create course catalog
courseCatalog:
  id: "CAT-BTECH"
  name: "Bachelor of Technology"
  code: "BTECH"
  durationYears: 4
  regulations: ["R20", "R23"]
  regulationBatches: {"R20": "2020-2024,2021-2025", "R23": "2023-2027,2024-2028"}

// Create course year timings
courseYearTimings:
  - id: "COURSE-CSE-BTECH_year1"
    courseId: "COURSE-CSE-BTECH"
    year: 1
    semesters: [{semester: 1}, {semester: 2}]
  - id: "COURSE-CSE-BTECH_year2"
    courseId: "COURSE-CSE-BTECH"
    year: 2
    semesters: [{semester: 3}, {semester: 4}]
  // ... all years for all courses
```

---

## 3. TEST DATA PREPARATION

### Test Credentials
| Role | Email | Password | Access Level |
|------|-------|----------|--------------|
| College Admin | ravi.k@au.edu.in | 12345678 | PRINCIPAL |
| HOD | hod-cse@au.edu.in | 12345678 | HOD (CSE) |
| Faculty | faculty1@au.edu.in | 12345678 | PANEL_MEMBER |
| Faculty2 | faculty2@au.edu.in | 12345678 | PANEL_MEMBER (EEE) |
| Department Office | deptoffice@au.edu.in | 12345678 | DEPARTMENT_OFFICE |

### Test Subjects Data
```csv
S.No.,Category,Name,Code,Type,L,T,P,Hours/Week,Credits,Regulation,AcademicYear
1,Professional Core,Data Structures and Algorithms,CS201,THEORY,3,1,0,4,4,R20,2026-27
2,Professional Core,Object Oriented Programming,CS202,THEORY,3,1,0,4,4,R20,2026-27
3,Professional Core,Digital Logic Design,CS203,THEORY,3,0,1,4,4,R20,2026-27
4,Professional Core,Database Management Systems,CS204,THEORY,3,1,0,4,4,R20,2026-27
5,Professional Core,Computer Networks,CS205,THEORY,3,1,0,4,4,R20,2026-27
6,Professional Core,Operating Systems,CS206,THEORY,3,1,0,4,4,R20,2026-27
7,Professional Core,Compiler Design,CS207,THEORY,3,0,1,4,4,R20,2026-27
8,Professional Core,Software Engineering,CS208,THEORY,3,1,0,4,4,R20,2026-27
9,Open Elective,Artificial Intelligence,CS209,THEORY,3,0,1,4,4,R20,2026-27
10,Open Elective,Machine Learning,CS210,THEORY,3,0,1,4,4,R20,2026-27
11,Professional Core,Data Structures Lab,CS221,PRACTICAL,0,0,3,3,3,R20,2026-27
12,Professional Core,DBMS Lab,CS222,PRACTICAL,0,0,3,3,3,R20,2026-27
13,Professional Core,CN Lab,CS223,PRACTICAL,0,0,3,3,3,R20,2026-27
```

### Test Faculty Data
```csv
employeeId,name,designation,department,email,category,dateOfJoining
F001,Rajesh Kumar,Professor,CSE,rajesh@au.edu.in,TEACHING,2015-06-15
F002,Priya Sharma,Associate Professor,CSE,priya@au.edu.in,TEACHING,2018-03-22
F003,Ravi Patel,Assistant Professor,CSE,ravi@au.edu.in,TEACHING,2021-07-10
F004,Sita Devi,Professor,EEE,sita@au.edu.in,TEACHING,2012-01-05
F005,Amit Singh,Associate Professor,EEE,amit@au.edu.in,TEACHING,2016-09-18
F006,Neha Gupta,Assistant Professor,BASIC,neha@au.edu.in,TEACHING,2020-04-12
F007,Ramesh Yadav,Professor,BASIC,ram@au.edu.in,TEACHING,2010-11-20
F008,Komal Agarwal,HOD,CSE,komal@au.edu.in,TEACHING,2008-02-14
```

### Test Student Data
```csv
studentId,name,branch,year,section,email
S001,Aarav Patel,CSE,1,A,arav@au.edu.in
S002,Priya Sharma,CSE,1,A,priya@au.edu.in
S003,Rohit Singh,CSE,1,A,rohit@au.edu.in
S004,Ananya Gupta,CSE,1,A,ananya@au.edu.in
S005,Arjun Mehta,CSE,1,A,arjun@au.edu.in
S006,Diya Nair,CSE,1,B,diya@au.edu.in
S007,Varun Joshi,CSE,1,B,varun@au.edu.in
S008,Khushi Shah,CSE,1,B,khushi@au.edu.in
...
```

---

## 4. TEST MODULE 1: DEPARTMENT SETUP

### TC-DEPT-001: Create Department (P0)
**Steps:**
1. Login as clgadmin (PRINCIPAL)
2. Navigate to Settings → Departments
3. Click "Add Department"
4. Enter: Name = "Test Department", Code = "TEST-DEPT"
5. Submit

**Expected Result:** Department created successfully, appears in department list

**Verification:**
- API: `GET /api/college/departments` returns new department
- Firestore: `colleges/{collegeId}/departments` contains new doc
- UI: Department visible in dropdowns

### TC-DEPT-002: Create Sub-Department (P1)
**Steps:**
1. Create "Basic Science" as parent department
2. Create "BS Mathematics" as child of Basic Science
3. Create "BS English" as child of Basic Science

**Expected Result:** Parent-child relationship established correctly

### TC-DEPT-003: Department Import via Excel (P1)
**Steps:**
1. Prepare Excel with 500 departments
2. Navigate to Departments → Import
3. Upload file
4. Verify all departments created

**Expected Result:** All 500 departments imported, max limit enforced

### TC-DEPT-004: Create Department Without Required Fields (P0)
**Steps:**
1. Attempt to create department with empty name
2. Attempt to create department with duplicate code

**Expected Result:** Proper validation errors displayed

### TC-DEPT-005: Cross-Department Visibility (P1)
**Steps:**
1. Login as HOD of CSE
2. Verify can see Basic Science and its sub-departments
3. Verify CANNOT see EEE departments

**Expected Result:** HOD scope correctly filters departments

---

## 5. TEST MODULE 2: COURSE CATALOG SETUP

### TC-CATALOG-001: Create Course Catalog Entry (P0)
**Steps:**
1. Navigate to Settings → Course Catalog
2. Add: B.Tech CSE with regulations R20, R23
3. Set regulationBatches: R20 → "2020-2024", R23 → "2023-2027"

**Expected Result:** Catalog entry created with regulations

### TC-CATALOG-002: Create Course for Department (P0)
**Steps:**
1. Navigate to Academics → Courses
2. Add: B.Tech CSE (4 years, linked to DEPT-CSE)
3. Link to CAT-BTECH catalog

**Expected Result:** Course created, appears in department's course list

### TC-CATALOG-003: Create Course-Year Timings (P0)
**Steps:**
1. For COURSE-CSE-BTECH, create Year 1-4 timings
2. Each year: 2 semesters with period definitions
3. Set workingDays: [MON, TUE, WED, THU, FRI, SAT]
4. Set maxPeriodsPerDay: 8, maxConsecutive: 4

**Expected Result:** CourseYearTiming docs created with correct structure

### TC-CATALOG-004: Invalid Regulation Assignment (P1)
**Steps:**
1. Attempt to create course with regulation not in catalog
2. Verify error

**Expected Result:** Validation error: "Regulation not assigned to this course"

---

## 6. TEST MODULE 3: SUBJECT CREATION

### TC-SUBJ-001: Create Master Subject (P0)
**Steps:**
1. Login as clgadmin (PRINCIPAL)
2. Navigate to Academics → Subjects
3. Select course: B.Tech CSE
4. Select regulation: R20
5. Fill subject form: Data Structures, CS201, THEORY, L=3, T=1, P=0
6. Click "Add Subject"

**Expected Result:** Subject created with `{courseId, regulation, academicYear}`

**Verification:**
- API: `GET /api/college/subjects?courseId=COURSE-CSE-BTECH&regulation=R20`
- Firestore: `subjects/{id}` has courseId, regulation, academicYear (NO year, NO department)
- No department field in the document

### TC-SUBJ-002: Create Subject Without Regulation (P1)
**Steps:**
1. Create subject without selecting regulation (when catalog has no regulations)

**Expected Result:** Subject created with empty regulation field

### TC-SUBJ-003: Duplicate Subject Prevention (P0)
**Steps:**
1. Create subject CS201 with regulation R20
2. Attempt to create another CS201 with regulation R20

**Expected Result:** Error: "Subject with this code already exists for this course/regulation"

### TC-SUBJ-004: HOD Cannot Create Master Subject (P0)
**Steps:**
1. Login as hod-cse@au.edu.in (HOD)
2. Navigate to Academics → Subjects
3. Attempt to add subject via POST /api/college/subjects

**Expected Result:** 403 Forbidden: "Master subjects require ACADEMICS/PRINCIPAL role"

### TC-SUBJ-005: Create Subject with Invalid Category (P1)
**Steps:**
1. Attempt to create subject with unrecognized category

**Expected Result:** Validation error

### TC-SUBJ-006: Create Subject Missing L/T/P (P0)
**Steps:**
1. Attempt to create subject without lecture/tutorial/practical hours

**Expected Result:** Validation error: "L, T and P are required"

### TC-SUBJ-007: Subject Regulation Validation (P0)
**Steps:**
1. Attempt to create subject with regulation "XYZ" for a course that only has R20, R23
2. Verify error: "Regulation XYZ isn't assigned to this course"

**Expected Result:** Proper validation

### TC-SUBJ-008: Subject Export to XLSX (P2)
**Steps:**
1. Create 5 subjects
2. Click "Export XLSX"
3. Verify file has all 5 subjects with correct columns

### TC-SUBJ-009: Subject Export to DOCX (P2)
**Steps:**
1. Create 3 subjects
2. Click "Export DOCX"
3. Verify document has proper table format

### TC-SUBJ-010: Subject Serial Number Auto-Increment (P1)
**Steps:**
1. Create 3 subjects with serialNumbers 1, 2, 3
2. Add new subject without specifying serialNumber

**Expected Result:** New subject gets serialNumber 4

---

## 7. TEST MODULE 4: SUBJECT IMPORT

### TC-IMP-001: Bulk Import Master Subjects (P0)
**Steps:**
1. Prepare CSV with 50 subjects for B.Tech CSE, R20
2. Navigate to Academics → Import Subjects
3. Upload CSV
4. Verify all 50 subjects created

**Expected Result:** All subjects imported with `{courseId, regulation, academicYear}`

### TC-IMP-002: Import with Auto-Resolved Regulation (P1)
**Steps:**
1. Course has only 1 regulation (R20)
2. Upload CSV without Regulation column
3. Verify subjects get regulation R20 automatically

### TC-IMP-003: Import with Invalid Regulation (P0)
**Steps:**
1. Upload CSV with regulation "INVALID"
2. Verify all rows fail with: "Regulation INVALID isn't assigned to this course"

### TC-IMP-004: Import Exceeds 500 Records (P1)
**Steps:**
1. Prepare CSV with 501 rows
2. Attempt upload
3. Verify error: "Maximum 500 records per import"

### TC-IMP-005: Import Duplicate Codes (P0)
**Steps:**
1. Prepare CSV where row 5 and row 10 have same code "CS201"
2. Upload
3. Verify row 10 fails: "A subject with this code already exists"

### TC-IMP-006: Import Missing Required Fields (P0)
**Steps:**
1. Prepare CSV with missing S.No. or missing L/T/P
2. Upload
3. Verify proper validation errors

### TC-IMP-007: Import Category Validation (P1)
**Steps:**
1. Prepare CSV with unrecognized category "INVALID"
2. Upload
3. Verify: "Unrecognized Category"

### TC-IMP-008: Import Fix-and-Retry (P1)
**Steps:**
1. Prepare CSV with 1 valid and 1 invalid row
2. Import
3. Fix the invalid row
4. Retry
5. Verify both subjects created

### TC-IMP-009: HOD Cannot Use Import (P0)
**Steps:**
1. Login as HOD
2. Navigate to Import
3. Verify: Access denied or not visible

---

## 8. TEST MODULE 5: SECTION & STUDENT SETUP

### TC-SEC-001: Create Sections for Course (P0)
**Steps:**
1. Navigate to Academics → Sections
2. For B.Tech CSE Year 1, create Section A (30 students) and Section B (30 students)
3. Create Section A for Year 2, Section A for Year 3, etc.

**Expected Result:** All sections created with proper year, courseId, departmentId

### TC-SEC-002: Student Import (P0)
**Steps:**
1. Prepare Excel with 100 students for B.Tech CSE Year 1
2. Navigate to Students → Import
3. Upload file
4. Verify all students distributed to sections

**Expected Result:** Students imported, distributed across sections by surname

### TC-SEC-003: Even Student Distribution (P1)
**Steps:**
1. Import 60 students
2. Verify Section A has 30, Section B has 30
3. Verify no section exceeds capacity

### TC-SEC-004: Create Section Without Course Setup (P1)
**Steps:**
1. Attempt to create section for a course that doesn't exist
2. Verify error

### TC-SEC-005: Student Promote (P1)
**Steps:**
1. Promote all Year 1 students to Year 2
2. Verify their sections change
3. Verify their batch (academicYear) updates

### TC-SEC-006: Edge Case - Single Student Section (P2)
**Steps:**
1. Create a section with only 1 student
2. Verify all operations work correctly

### TC-SEC-007: Edge Case - Maximum Section Size (P2)
**Steps:**
1. Create section with 120 students (above normal 60)
2. Verify system handles it correctly

---

## 9. TEST MODULE 6: FACULTY SETUP

### TC-FAC-001: Import Faculty (P0)
**Steps:**
1. Prepare Excel with 50 faculty members
2. Navigate to Faculty → Import
3. Upload file
4. Verify all faculty created

**Expected Result:** All faculty imported with correct departments

### TC-FAC-002: Assign Faculty to Department (P0)
**Steps:**
1. Create faculty F001 in CSE
2. Verify F001 appears in CSE faculty list
3. Verify F001 does NOT appear in EEE faculty list (for HOD view)

### TC-FAC-003: Cross-Department Faculty Sharing (P1)
**Steps:**
1. Create faculty F006 in BASIC
2. Assign F006 as Timetable Incharge for CSE Year 1 Common Subjects
3. Verify F006 can teach in CSE sections

### TC-FAC-004: Faculty Link to HOD (P1)
**Steps:**
1. Assign F008 as HOD of CSE
2. Verify F008 sees HOD dashboard
3. Verify F008 can manage CSE department

### TC-FAC-005: Faculty Assignment Request (Cross-Dept) (P1)
**Steps:**
1. HOD of CSE has no available faculty for a subject
2. Create facultyAssignmentRequest to EEE
3. EEE HOD approves
4. Verify faculty appears in CSE teaching assignments

### TC-FAC-006: Edge Case - Faculty With No Department (P2)
**Steps:**
1. Create faculty without department assignment
2. Verify they cannot be assigned to teaching

### TC-FAC-007: Link HOD to Department (P0)
**Steps:**
1. Navigate to Department → Link HOD
2. Assign F008 as HOD of CSE
3. Verify all HOD permissions activated

---

## 10. TEST MODULE 7: SUBJECT-SEMESTER ASSIGNMENT

### TC-SSA-001: Assign Subject to Semester (P0)
**Steps:**
1. Login as HOD of CSE
2. Navigate to Academics → Assign to Semester
3. Select Department: CSE
4. Select Course: B.Tech CSE
5. Select Year: 1
6. Select Regulation: R20
7. Select Semester: 1
8. For each unassigned subject, click "Add"
9. Verify all subjects appear in Semester 1 panel

**Expected Result:** SubjectSemesterAssignment docs created with `{subjectId, courseId, academicYear, regulation, departmentId, semester}`

### TC-SSA-002: Assign to Multiple Departments (P0)
**Steps:**
1. Assign CS201 to CSE Semester 1
2. Assign CS201 to EEE Semester 1 (same subject, different department)
3. Verify both assignments exist

**Expected Result:** Two SubjectSemesterAssignment docs (same subjectId, different departmentId)

### TC-SSA-003: Assign Subject with Invalid Semester (P1)
**Steps:**
1. Course has 4 years × 2 semesters = 8 semesters
2. Attempt to assign to semester 10
3. Verify error

### TC-SSA-004: Auto-Resolve from Subject (P0)
**Steps:**
1. Call `POST /api/college/subject-semester-assignments` with only `{subjectId, departmentId, semester}`
2. Verify `courseId`, `academicYear`, `regulation`, `year` are auto-resolved from Subject document

**Expected Result:** All fields correctly populated from Subject

### TC-SSA-005: Duplicate Assignment Prevention (P0)
**Steps:**
1. Assign CS201 to CSE Semester 1
2. Attempt to assign CS201 to CSE Semester 1 again
3. Verify the existing assignment is updated (upsert) not duplicated

### TC-SSA-006: Remove Subject from Semester (P0)
**Steps:**
1. Assign CS201 to CSE Semester 1
2. Click "Remove" on CS201 in Semester 1
3. Verify SubjectSemesterAssignment deleted

**Expected Result:** Assignment removed via `DELETE /api/college/subject-semester-assignments?subjectId=...&departmentId=...`

### TC-SSA-007: HOD Scope - Cannot Assign Other Department Subject (P0)
**Steps:**
1. Login as HOD of CSE
2. Attempt to assign EEE's subject to CSE
3. Verify: Error or empty subject list

### TC-SSA-008: Parent HOD Assigns Sub-Dept Subject (P1)
**Steps:**
1. Login as HOD of Basic Science
2. Verify can see BS-Chemistry, BS-Mathematics sub-dept subjects
3. Assign subjects to sub-departments

### TC-SSA-009: Bulk Assign Multiple Subjects (P1)
**Steps:**
1. Select all 10 subjects for Year 1 Semester 1
2. Click "Assign All"
3. Verify all created in single operation

### TC-SSA-010: Edge Case - Course Without CourseYearTiming (P1)
**Steps:**
1. Course has no CourseYearTiming configured
2. Attempt to assign subject to semester
3. Verify proper error: "That semester isn't configured for any year of this course"

---

## 11. TEST MODULE 8: TIMETABLE INCHARGE ASSIGNMENT

### TC-TIC-001: Assign Timetable Incharge (P0)
**Steps:**
1. Login as HOD of CSE
2. Navigate to Timetable → Incharges
3. Assign F001 (Ravi) as Timetable Incharge for B.Tech CSE Year 1
4. Verify F001 can now create teaching assignments

**Expected Result:** TimetableIncharge doc created linking F001 to course-year

### TC-TIC-002: Assign Cross-Department Incharge (P1)
**Steps:**
1. Assign F006 (from BASIC) as Timetable Incharge for CSE Year 1 Common Subjects
2. Verify F006 can create assignments for CSE sections

### TC-TIC-003: Batch Assign for Sub-Departments (P1)
**Steps:**
1. Assign F007 as Timetable Incharge for B.Tech Common Year 1
2. Verify covers all sub-departments (BS-MATH, BS-ENGLISH)

### TC-TIC-004: Revoke Timetable Incharge (P1)
**Steps:**
1. Revoke F001's incharge role
2. Verify F001 can no longer create teaching assignments

### TC-TIC-005: Incharge Cannot Create for Other Course-Year (P0)
**Steps:**
1. F001 is incharge for Year 1 only
2. F001 attempts to create assignment for Year 2
3. Verify: Access denied

---

## 12. TEST MODULE 9: TEACHING ASSIGNMENTS

### TC-TA-001: Create Section-Scoped Teaching Assignment (P0)
**Steps:**
1. Login as HOD of CSE (or Timetable Incharge)
2. Navigate to Teaching Assignments
3. Select course: B.Tech CSE, section: Year 1 Section A
4. Select subject: CS201 (Data Structures)
5. Select faculty: F001 (Ravi)
6. Select year: 1, semester: 1
7. Submit

**Expected Result:** TeachingAssignment doc created with `{courseId, sectionId, subjectId, facultyId, year, semester, timetableSemester}`

### TC-TA-002: Create Semester-Scoped Teaching Assignment (P0)
**Steps:**
1. Navigate to Teaching Assignments (semester mode)
2. Select academicYear: 2026-27, semester: 1
3. Select subject from SubjectSemesterAssignment
4. Select faculty
5. Submit

**Expected Result:** TeachingAssignment with `{academicYear, semester, subjectId, facultyId}` (no sectionId)

### TC-TA-003: Faculty Double-Booking Prevention (P0)
**Steps:**
1. Assign F001 to teach CS201 in Section A, Period 1, Monday
2. Attempt to assign F001 to teach CS202 in Section B, Period 1, Monday
3. Verify: Error: "Faculty already has a class at this time"

### TC-TA-004: Section Double-Booking Prevention (P0)
**Steps:**
1. Assign F001 to Period 1, Monday, Section A
2. Attempt to assign another subject to Period 1, Monday, Section A
3. Verify: Error: "Section already has a class at this time"

### TC-TA-005: Lab Split Validation (P0)
**Steps:**
1. Attempt to assign 3 faculty to CS221 (PRACTICAL) in same section
2. Verify: Error: "Lab subject already has 2 faculty assigned in this section"
3. Assign exactly 2 faculty - verify success

### TC-TA-006: Lab Split Cross-Department (P1)
**Steps:**
1. Split CS221 lab between F001 (CSE) and F006 (BASIC)
2. Verify both faculty can teach the split lab

### TC-TA-007: HOD Cannot Create Master Subject (P0)
**Steps:**
1. Login as HOD
2. Attempt to create teaching assignment without subject-semester-assignment
3. Verify proper error

### TC-TA-008: Assign Deleted Subject (P1)
**Steps:**
1. Delete a subject from master collection
2. Attempt to assign it via teaching assignment
3. Verify: Error: "Subject not found"

### TC-TA-009: Teaching Assignment with isPast (P1)
**Steps:**
1. Create assignment with isPast: true for previous year
2. Verify it doesn't appear in current timetable but shows in reports

### TC-TA-010: Denormalized Subject Metadata Staleness (P1)
**Steps:**
1. Create teaching assignment (stores subjectName/subjectCode)
2. Rename the subject in master collection
3. Verify teaching assignment still shows OLD name (stale)
4. Verify GET endpoint joins fresh data at read time

### TC-TA-011: Cross-Department Faculty Lending (P1)
**Steps:**
1. HOD of CSE needs F005 (from EEE) to teach a subject
2. Create facultyAssignmentRequest to EEE
3. EEE HOD approves (status: ALLOCATED)
4. Verify F005 can now be assigned to CSE teaching
5. Verify lending HOD can place/move periods for their allocated assignment

---

## 13. TEST MODULE 10: TIMETABLE CREATION

### TC-TT-001: Auto-Generate Timetable Draft (P0)
**Steps:**
1. Navigate to Timetable → Draft
2. Select section: Year 1 Section A, semester: 1
3. Click "Generate Draft"
4. Verify draft created with all subjects placed

**Expected Result:** Timetable draft with all teaching assignments placed respecting constraints

### TC-TT-002: Manual Timetable Editing (P0)
**Steps:**
1. Load draft
2. Move CS201 from Period 1 to Period 3
3. Verify no conflicts
4. Save draft

**Expected Result:** Draft updated with new placement

### TC-TT-003: Hard Constraint Violation (P0)
**Steps:**
1. Attempt to place a subject on Sunday (working day = false)
2. Attempt to place 9 periods in a day (max = 8)
3. Attempt to place 5 consecutive periods (max = 4)
4. Verify all errors

### TC-TT-004: Faculty Busy Validation in Draft (P0)
**Steps:**
1. Attempt to place a faculty member who already has a class at that time
2. Verify: Error in draft validation

### TC-TT-005: Lab Contiguous Block Requirement (P0)
**Steps:**
1. Attempt to split a lab across non-contiguous periods
2. Verify: Error: "Lab must be in contiguous block"
3. Place lab in contiguous periods - verify success

### TC-TT-006: Pin Manual Slot (P1)
**Steps:**
1. Manually pin CS201 in Period 1, Monday
2. Generate draft around pinned slot
3. Verify pinned slot is preserved

### TC-TT-007: Edge Case - Complete Week Generation (P1)
**Steps:**
1. Generate timetable for full week (MON-SAT)
2. Verify all days covered
3. Verify no gaps or overlaps

### TC-TT-008: Edge Case - Single Period Course (P2)
**Steps:**
1. Course with only 1 period per week
2. Generate draft
3. Verify single period placed correctly

### TC-TT-009: Edge Case - Subject Daily Repeat Limit (P1)
**Steps:**
1. Subject has max 2 periods per day
2. Attempt to place 3 periods of same subject
3. Verify error

### TC-TT-010: Draft with Pinned Slots from Previous Semester (P1)
**Steps:**
1. Previous semester has MANUAL pinned slots
2. Create new semester draft
3. Verify pinned slots are NOT carried over (different semester)

---

## 14. TEST MODULE 11: TIMETABLE PUBLISH & DISPLAY

### TC-PUB-001: Publish Timetable (P0)
**Steps:**
1. Complete draft for Year 1 Section A, Semester 1
2. Click "Publish"
3. Verify all draft slots become TimetableSlot docs
4. Verify draft is marked as PUBLISHED

**Expected Result:** All slots published, faculty can see their timetable

### TC-PUB-002: Publish Overlaps with Live Data (P0)
**Steps:**
1. Publish draft
2. While published, another section assigns the same faculty at same time
3. Re-publish first section
4. Verify: Conflict detection, stale assignments dropped

### TC-PUB-003: Publish with Deleted Teaching Assignment (P1)
**Steps:**
1. Create teaching assignment → generate draft → publish
2. Delete the teaching assignment
3. Re-publish
4. Verify: Slots for deleted assignment are dropped

### TC-PUB-004: Timetable Display on Faculty Dashboard (P0)
**Steps:**
1. Publish timetable
2. Login as faculty F001
3. Verify timetable shows all assigned periods
4. Verify correct subject names, classrooms, days, periods

### TC-PUB-005: Timetable Display on Student Dashboard (P0)
**Steps:**
1. Publish timetable
2. Login as student
3. Verify timetable shows their section's subjects
4. Verify correct faculty names

### TC-PUB-006: Timetable Display on HOD Dashboard (P0)
**Steps:**
1. Publish timetable for all sections
2. Login as HOD of CSE
3. Verify can see all CSE sections' timetables
4. Verify can see EEE sections only if shared first year

### TC-PUB-007: Class-Leader Timetable (P1)
**Steps:**
1. Login as CLASS_LEADER
2. Verify sees only own bound section's timetable
3. Verify cannot see other sections

### TC-PUB-008: Timetable History (P2)
**Steps:**
1. Create and publish Semester 1 timetable
2. Create and publish Semester 2 timetable
3. Verify Semester 1 history is preserved
4. Verify "current" timetable shows Semester 2 only

### TC-PUB-009: Prior Semester Shows in History Only (P1)
**Steps:**
1. Verify slots with old semester tags are excluded from current read
2. Verify they appear in Timetable History panel

### TC-PUB-010: Batch Publish Chunking (P1)
**Steps:**
1. Publish timetable with 500+ slots
2. Verify batch operations chunked to stay under 500-op Firestore limit
3. Verify all slots published correctly

---

## 15. TEST MODULE 12: FACULTY ATTENDANCE

### TC-FAC-ATT-001: Self Check-In (P0)
**Steps:**
1. Login as faculty F001
2. Navigate to Attendance → Check-In
3. Complete face verification
4. Verify geofence check passes
5. Click "Check In"
6. Verify: Attendance record created with timestamp

**Expected Result:** Check-in recorded in `attendance` collection

### TC-FAC-ATT-002: Self Check-Out (P0)
**Steps:**
1. After check-in, click "Check Out"
2. Verify check-out recorded

### TC-FAC-ATT-003: Double Check-In Prevention (P0)
**Steps:**
1. Check-in successfully
2. Attempt to check-in again
3. Verify: Error: "Already checked in" (HTTP 409)

### TC-FAC-ATT-004: Sunday Check-In Blocked (P0)
**Steps:**
1. Attempt check-in on Sunday
2. Verify: "Today is Sunday" or holiday message

### TC-FAC-ATT-005: Holiday Check-In Blocked (P0)
**Steps:**
1. Attempt check-in on declared holiday
2. Verify: Blocked

### TC-FAC-ATT-006: Leave Check-In Blocked (P0)
**Steps:**
1. Mark F001 as on approved leave
2. Attempt check-in
3. Verify: Blocked

### TC-FAC-ATT-007: Geofence Validation Failure (P0)
**Steps:**
1. Attempt check-in from outside campus
2. Verify: "You are outside the campus boundary"

### TC-FAC-ATT-008: Late Check-In Penalty (P0)
**Steps:**
1. Check-in after 09:05 cutoff
2. Verify: Late penalty recorded
3. Verify penalty is idempotent (refreshing page doesn't create duplicate)

### TC-FAC-ATT-009: Face Verification Failure (P0)
**Steps:**
1. Attempt check-in with face match distance > 0.92
2. Verify: "Face verification failed"

### TC-FAC-ATT-010: Manual Attendance Marking (P1)
**Steps:**
1. Login as HOD
2. Navigate to Attendance → Manual
3. Mark attendance for F001 (one tier below)
4. Verify: Attendance created with source: "MANUAL"
5. Verify AuditLog and notification created

### TC-FAC-ATT-011: Principal Marks HOD (P1)
**Steps:**
1. Login as Principal
2. Mark attendance for HOD
3. Verify: Allowed (one tier up)

### TC-FAC-ATT-012: Cross-Tier Marking Denied (P1)
**Steps:**
1. Login as HOD
2. Attempt to mark attendance for Principal
3. Verify: Denied (only one tier down)

### TC-FAC-ATT-013: Monthly Attendance Report (P1)
**Steps:**
1. Navigate to Attendance → Report
2. Select date, view roster
3. Verify all faculty shown with status

### TC-FAC-ATT-014: Attendance Import from Excel (P1)
**Steps:**
1. Prepare Excel with month of attendance data
2. Navigate to Attendance → Import
3. Upload file
4. Verify all records created

### TC-FAC-ATT-015: Monthly Export CSV (P2)
**Steps:**
1. Navigate to Attendance → Monthly Export
2. Export for current month
3. Verify CSV has all required fields

### TC-FAC-ATT-016: Faculty Attendance Completion (P1)
**Steps:**
1. Navigate to Faculty Attendance Completion
2. Verify shows per-period completion status
3. Verify COLLEGE_ADMIN excluded from this report

### TC-FAC-ATT-017: Late Check-In Permission Grant (P1)
**Steps:**
1. HOD grants late check-in permission to faculty
2. Verify faculty can check in late
3. Verify permission expires after specified time

---

## 16. TEST MODULE 13: STUDENT ATTENDANCE

### TC-STU-ATT-001: Mark Student Attendance (P0)
**Steps:**
1. Login as PANEL_MEMBER (faculty)
2. Navigate to Student Attendance
3. View today's periods
4. Select active period
5. Mark students present/absent
6. Submit

**Expected Result:** StudentAttendanceSession created with status: DRAFT

### TC-STU-ATT-002: Submit Attendance Session (P0)
**Steps:**
1. After marking, click "Submit"
2. Verify status changes to SUBMITTED
3. Verify entries saved per student

### TC-STU-ATT-003: Attendance Period Window Validation (P0)
**Steps:**
1. Attempt to mark attendance outside active period
2. Verify: Error: "Not within active period window"

### TC-STU-ATT-004: Roster Merge for DRAFT Session (P1)
**Steps:**
1. Create DRAFT session
2. New students join the section
3. Mark attendance again
4. Verify new students added to roster, existing marks preserved

### TC-STU-ATT-005: Today's Periods View (P0)
**Steps:**
1. Navigate to Student Attendance → Today's Periods
2. Verify shows all periods for today with isOpen flag
3. Verify periods that already have sessions are shown differently

### TC-STU-ATT-006: Office Correction (P1)
**Steps:**
1. Login as HOD
2. Navigate to Office Correction
3. Modify a faculty's attendance on behalf of that faculty
4. Verify: Corrected with proper audit trail

### TC-STU-ATT-007: Edge Case - Zero Students in Session (P2)
**Steps:**
1. Section with no students
2. Attempt to mark attendance
3. Verify: 0-student allowed with notes

### TC-STU-ATT-008: Edge Case - Version Conflict (P1)
**Steps:**
1. Faculty A opens attendance session
2. Faculty B also opens same session
3. Faculty A submits
4. Faculty B tries to submit with stale version
5. Verify: 409 Conflict, `expectedUpdatedAt` check works

### TC-STU-ATT-009: Substitute Teacher Attendance (P1)
**Steps:**
1. Faculty on leave, substitute teaches
2. Substitute marks attendance
3. Verify substituteForFacultyId recorded
4. Verify original faculty's attendance shows substitute info

### TC-STU-ATT-010: Section Attendance Report (P0)
**Steps:**
1. Navigate to Section Attendance Report
2. Select section, drill into years → months → dates
3. Verify aggregated attendance across ALL subjects/faculty

### TC-STU-ATT-011: Attendance Percentage Report (P1)
**Steps:**
1. Navigate to Attendance Percentage Report
2. Filter by department, course, year, section, semester
3. Verify cross-section percentages
4. Verify only EXAM_CELL, PRINCIPAL, VP, SUPER_ADMIN can access

### TC-STU-ATT-012: Class Work Records (P1)
**Steps:**
1. Navigate to Class Work Records
2. Drill into year → month → section → date
3. Verify class work from SUBMITTED sessions

---

## 17. TEST MODULE 14: REPORTS & ANALYTICS

### TC-RPT-001: Faculty Attendance Report (P0)
**Steps:**
1. Navigate to Attendance → Report
2. Select date
3. Verify full roster with NOT_MARKED/NOT_REGISTERED/ABSENT/HOLIDAY/PRESENT
4. Verify HOD sees own dept+sub-depts only
5. Verify Principal sees college-wide

### TC-RPT-002: Section Attendance Drill-Down (P0)
**Steps:**
1. Navigate to Section Attendance Report
2. Select section → Year → Month → Date
3. Verify drill-down works correctly
4. Verify aggregated across all subjects/faculty

### TC-RPT-003: Faculty Attendance Completion Range (P1)
**Steps:**
1. Use from/to date range
2. Verify shows completion status for the range
3. Verify allTime mode works

### TC-RPT-004: Attendance Percentage with Filters (P1)
**Steps:**
1. Filter by minPct=80, maxPct=100
2. Verify only sections with 80-100% attendance shown
3. Verify listSections parameter works

### TC-RPT-005: Class Work Records Summary (P1)
**Steps:**
1. Generate class work records summary
2. Verify shows teaching hours, student attendance ratio

### TC-RPT-006: Today's Status (P1)
**Steps:**
1. Navigate to Today's Status
2. Verify shows whether today is holiday/Sunday/leave
3. Verify pre-check-in banner displays correctly

### TC-RPT-007: Campus Location Config (P2)
**Steps:**
1. Navigate to Campus Location
2. Verify geofence config displayed
3. Verify read-only for check-in UI

### TC-RPT-008: Edge Case - No Attendance Data (P2)
**Steps:**
1. Generate report for date with no attendance
2. Verify empty state displayed correctly

### TC-RPT-009: Edge Case - All Faculty Absent (P2)
**Steps:**
1. All faculty marked ABSENT for a date
2. Verify report shows all ABSENT correctly
3. Verify NOT_REGISTERED vs ABSENT distinction

### TC-RPT-010: Export to CSV (P2)
**Steps:**
1. Export attendance report to CSV
2. Verify all fields present
3. Verify date format correct

---

## 18. TEST MODULE 15: CROSS-DEPARTMENT OPERATIONS

### TC-XDEPT-001: Shared First-Year Structure (P0)
**Steps:**
1. Setup Basic Science as shared first-year department
2. Create sub-departments: BS-MATH, BS-ENGLISH
3. Assign B.Tech CSE Year 1 subjects to Basic Science
4. Verify BS-MATH and BS-ENGLISH students see same subjects
5. Verify students keep their real branch in `student.department`

### TC-XDEPT-002: Managed Branch HOD Visibility (P1)
**Steps:**
1. Parent HOD (Basic Science) manages BS-MATH
2. Verify can see BS-MATH subjects and assignments
3. Verify CANNOT see non-shared years of BS-MATH
4. Verify canHodEditDepartmentYear gates this

### TC-XDEPT-003: Cross-Department Subject Assignment (P0)
**Steps:**
1. Subject CS201 is created for CSE
2. SubjectSemesterAssignment creates it for EEE too
3. Verify EEE students can see CS201 in their timetable
4. Verify faculty from EEE can teach CS201

### TC-XDEPT-004: Branch Split Lab (P1)
**Steps:**
1. CS221 lab has split batches: Batch 1 (CSE), Batch 2 (EEE)
2. Verify labBatch field properly set
3. Verify `today-periods` shows split-lab awareness
4. Verify different faculty for different batches

### TC-XDEPT-005: Faculty Lending Workflow (P1)
**Steps:**
1. CSE HOD creates facultyAssignmentRequest to EEE
2. EEE HOD approves (ALLOCATED)
3. CSE HOD can now assign EEE faculty
4. Verify lending HOD can place/move periods
5. Verify previous holder loses access immediately

### TC-XDEPT-006: Shared Branch Student Promotion (P1)
**Steps:**
1. Promote BS-MATH students from Year 1 to Year 2
2. Verify students remain in BS-MATH sub-department
3. Verify their `student.department` stays as real branch
4. Verify sub-department is management view only

---

## 19. TEST MODULE 16: EDGE CASES & WORST-CASE SCENARIOS

### TC-EDGE-001: Subject Deletion with Active Dependencies (P0)
**Steps:**
1. Create subject CS201
2. Assign to Semester 1 via SubjectSemesterAssignment
3. Create teaching assignment
4. Create timetable slots
5. Create student attendance
6. Attempt to delete CS201
7. Verify: 409 error with instructions to deactivate first
8. Verify cascading delete order: SubjectSemesterAssignment → TeachingAssignment → TimetableSlot → StudentAttendance → Subject

### TC-EDGE-002: Delete Teaching Assignment with Timetable Slots (P0)
**Steps:**
1. Create teaching assignment → generate draft → publish
2. Delete teaching assignment
3. Verify: All associated TimetableSlots deleted (cascade)
4. Verify no orphaned slots remain

### TC-EDGE-003: Simultaneous Teaching Assignment Creation (P1)
**Steps:**
1. Two HODs attempt to assign same faculty to same period simultaneously
2. Verify: Race condition handled, one succeeds, one gets conflict

### TC-EDGE-004: Timetable Publish During Live Changes (P1)
**Steps:**
1. Start publishing timetable
2. While publishing, another section changes faculty assignment
3. Verify: Publish validates against live data, drops stale assignments
4. Verify no data corruption

### TC-EDGE-005: 500-Record Import Stress (P1)
**Steps:**
1. Import 500 subjects in single batch
2. Verify all created within reasonable time
3. Verify no Firestore limit exceeded

### TC-EDGE-006: Maximum Sections per Course (P2)
**Steps:**
1. Create 20 sections for a course
2. Generate timetable for all sections
3. Verify all timetables conflict-free

### TC-EDGE-007: All Days Working (P2)
**Steps:**
1. Set workingDays: [MON, TUE, WED, THU, FRI, SAT]
2. Generate timetable
3. Verify all 6 days used

### TC-EDGE-008: No Semesters Configured (P1)
**Steps:**
1. Course has no semesters configured
2. Attempt to assign subject to semester
3. Verify: "This course-year has no semesters configured"
4. Verify Timetable Incharge cannot create assignments

### TC-EDGE-009: Subject with Zero Lecture Hours (P2)
**Steps:**
1. Create subject with L=0, T=0, P=0
2. Verify: Creation succeeds (e.g., Project/Studio course)
3. Verify timetable handles 0-hour subjects

### TC-EDGE-010: Regulation Change After Subject Creation (P1)
**Steps:**
1. Create subject with regulation R20
2. Change course catalog regulationBatches
3. Verify subject still accessible (regulation is stored, not dynamically resolved)

### TC-EDGE-011: Academic Year Boundary (P1)
**Steps:**
1. Create subject for academicYear 2026-27
2. Current date changes to 2027-04-01
3. Verify subject still accessible (academicYear is stored)
4. Verify new sessions use 2027-28

### TC-EDGE-012: Section Reuse Across Years (P1)
**Steps:**
1. Section A of Year 1 (batch 2026)
2. Section A of Year 1 (batch 2027)
3. Verify academicYear field prevents overwriting prior cohort's timetable
4. Verify TimetableHistory shows both years separately

### TC-EDGE-013: Faculty Resigned During Semester (P1)
**Steps:**
1. Faculty F001 has active teaching assignment
2. F001 is marked as resigned
3. Verify F001 cannot check in
4. Verify HOD can reassign the subject
5. Verify `isPast` flag can be set for historical record

### TC-EDGE-014: Department Merged During Semester (P2)
**Steps:**
1. Two departments merge mid-semester
2. Verify all subjects, assignments, timetables properly reorganized
3. Verify student sections remain intact

### TC-EDGE-015: Course Duration Changed Mid-Semester (P2)
**Steps:**
1. B.Tech CSE 4 years → 3 years
2. Verify Year 4 students affected correctly
3. Verify CourseYearTiming updated

---

## 20. TEST MODULE 17: AUTHORIZATION & SECURITY

### TC-AUTH-001: HOD Cannot Create Master Subject (P0)
**Steps:**
1. Login as HOD
2. Attempt POST /api/college/subjects with courseId
3. Verify: 403 Forbidden

### TC-AUTH-002: Principal Can Create Master Subject (P0)
**Steps:**
1. Login as Principal (clgadmin)
2. Create master subject
3. Verify: Success

### TC-AUTH-003: HOD Scope - Cannot See Other Department (P0)
**Steps:**
1. Login as HOD of CSE
2. Attempt to access EEE's subjects
3. Verify: Filtered to CSE only

### TC-AUTH-004: COLLEGE_ADMIN Role Normalization (P0)
**Steps:**
1. Login with COLLEGE_ADMIN role
2. Verify `role` reads "PRINCIPAL" everywhere
3. Verify `realRole` reads "COLLEGE_ADMIN"
4. Verify `isCollegeAdmin()` returns true
5. Verify `faculty-attendance-completion` excludes COLLEGE_ADMIN

### TC-AUTH-005: DEPARTMENT_OFFICE Normalization (P0)
**Steps:**
1. Login with DEPARTMENT_OFFICE role
2. Verify `role` reads "HOD"
3. Verify `realRole` reads "DEPARTMENT_OFFICE"
4. Verify cannot appoint another office head
5. Verify cannot remove a Sub-HOD

### TC-AUTH-006: Timetable Incharge Access Boundary (P0)
**Steps:**
1. Login as PANEL_MEMBER (Timetable Incharge)
2. Verify can create/read/update/delete assignments for delegated course-year only
3. Attempt to access other course-year
4. Verify: Access denied

### TC-AUTH-007: CLASS_LEADER Strict Section Lock (P1)
**Steps:**
1. Login as CLASS_LEADER
2. Verify sees only own bound section
3. Attempt to access other section's timetable
4. Verify: Access denied

### TC-AUTH-008: Faculty Cannot See Other Section (P1)
**Steps:**
1. Faculty assigned to Section A
2. Attempt to view Section B timetable
3. Verify: Cannot see Section B

### TC-AUTH-009: API Guard Bypass Attempt (P0)
**Steps:**
1. Modify session cookie to change role from PANEL_MEMBER to PRINCIPAL
2. Attempt to access admin-only endpoints
3. Verify: HMAC verification fails (tampered cookie)
4. Verify redirected to login

### TC-AUTH-010: Expired Session Cookie (P0)
**Steps:**
1. Wait for session cookie to expire (24h)
2. Attempt to access protected route
3. Verify: Redirected to login

### TC-AUTH-011: Disabled User Cookie (P1)
**Steps:**
1. Disable faculty account in Firebase Auth
2. Attempt to use existing cookie
3. Verify: Redirected to login (live disabled check)

### TC-AUTH-012: Missing SESSION_SECRET in Production (P0)
**Steps:**
1. Set NODE_ENV=production without SESSION_SECRET
2. Attempt to sign session
3. Verify: Error thrown, session not created

### TC-AUTH-013: Faculty Assignment Request Authorization (P1)
**Steps:**
1. HOD creates facultyAssignmentRequest to EEE
2. EEE HOD is not the requesting HOD
3. Verify: Only EEE HOD can approve/reject
4. Verify unauthorized users cannot access the request

---

## 21. TEST MODULE 18: END-TO-END FULL FLOW

### TC-E2E-001: Complete Academic Workflow (P0)
**This is THE critical end-to-end test. Execute every step in order.**

#### Step 1: Setup (Principal/College Admin)
1. Login as clgadmin (PRINCIPAL)
2. Navigate to Settings → Departments
3. Create: CSE, EEE, MECH, Basic Science (with sub-depts BS-MATH, BS-ENGLISH)
4. Navigate to Settings → Course Catalog
5. Create: B.Tech with regulations R20, R23
6. Navigate to Academics → Courses
7. Create: B.Tech CSE (4 years), B.Tech EEE (4 years), B.Tech MECH (4 years)
8. For each course, create CourseYearTimings (Year 1-4, 2 semesters each)
9. Navigate to Settings → Working Days
10. Set workingDays: [MON-SAT], maxPeriodsPerDay: 8, maxConsecutive: 4

#### Step 2: Subject Creation (Principal/Academics)
11. Navigate to Academics → Subjects
12. Select course: B.Tech CSE, regulation: R20
13. Create 20 subjects (10 THEORY, 5 TUTORIAL, 5 PRACTICAL)
14. Verify all created with `{courseId, regulation, academicYear}`

#### Step 3: Subject Import (Alternative Path)
15. Prepare CSV with 10 more subjects for R23 regulation
16. Navigate to Academics → Import
17. Upload CSV
18. Verify all 10 imported for R23

#### Step 4: Section & Student Setup (College Office/HOD)
19. Navigate to Academics → Sections
20. Create: Year 1 Section A (30 students), Section B (30 students) for each year
21. Navigate to Students → Import
22. Import 120 students for Year 1
23. Verify students distributed across sections

#### Step 5: Faculty Setup (HOD/Principal)
24. Navigate to Faculty → Import
25. Import 20 faculty members
26. Link F008 as HOD of CSE
27. Assign F001-F003 as CSE faculty
28. Assign F006 from Basic Science as shared faculty

#### Step 6: Subject-Semester Assignment (HOD)
29. Login as HOD of CSE
30. Navigate to Academics → Assign to Semester
31. Select Department: CSE, Course: B.Tech CSE, Year: 1, Regulation: R20, Semester: 1
32. Assign all 5 THEORY subjects to Semester 1
33. Assign all 5 PRACTICAL subjects to Semester 2
34. Verify SubjectSemesterAssignment docs created

#### Step 7: Timetable Incharge Assignment (HOD)
35. Navigate to Timetable → Incharges
36. Assign F001 as Timetable Incharge for B.Tech CSE Year 1
37. Assign F006 (from BASIC) for shared subjects

#### Step 8: Teaching Assignments (Timetable Incharge)
38. Navigate to Teaching Assignments
39. Create section-scoped assignments for Year 1 Section A, Semester 1
40. Assign CS201 to F001, Period 1, Monday
41. Assign CS202 to F002, Period 2, Monday
42. Assign CS221 (PRACTICAL) to F001 + F006, split lab, Period 3-5, Tuesday
43. Verify all assignments created, no conflicts

#### Step 9: Timetable Creation (Timetable Incharge)
44. Navigate to Timetable → Draft
45. Select Section A, Semester 1
46. Generate auto-draft
47. Manually adjust placements to fix any conflicts
48. Verify all subjects placed, no constraint violations

#### Step 10: Timetable Publish (HOD/Principal)
49. Click "Publish"
50. Verify all slots become TimetableSlot docs
51. Verify draft marked as PUBLISHED

#### Step 11: Faculty Dashboard Verification (Faculty)
52. Login as F001
53. Verify timetable shows CS201 (Period 1, Mon), CS221 (Period 3-5, Tue)
54. Verify correct subject names, classrooms, students

#### Step 12: Student Dashboard Verification (Student)
55. Login as student in Section A
56. Verify timetable shows all subjects for their section
57. Verify correct faculty names, periods

#### Step 13: Faculty Attendance (PANEL_MEMBER)
58. Login as F001
59. Navigate to Attendance → Check-In
60. Complete face verification, geofence check
61. Click "Check In" at 09:00
62. Navigate to Student Attendance → Today's Periods
63. Mark attendance for CS201 students
64. Submit attendance session
65. Click "Check Out" at 17:00

#### Step 14: HOD Attendance Overview (HOD)
66. Login as HOD of CSE
67. Navigate to Attendance → Report
68. Select today's date
69. Verify all faculty shown with status
70. Verify F001 shows PRESENT with check-in/out times

#### Step 15: Student Attendance Report (HOD/Principal)
71. Navigate to Section Attendance Report
72. Select Section A
73. Drill into Year → Month → Date
74. Verify attendance across all subjects/faculty

#### Step 16: Faculty Attendance Completion (HOD/Principal)
73. Navigate to Faculty Attendance Completion
74. Verify F001 shows completed for all periods
75. Verify any missing periods highlighted

#### Step 17: Attendance Percentage Report (EXAM_CELL)
76. Login as EXAM_CELL
77. Navigate to Attendance Percentage Report
78. Filter by CSE, Year 1, Section A
79. Verify percentages calculated correctly

#### Step 18: Class Work Records (HOD/PANEL_MEMBER)
80. Navigate to Class Work Records
81. Verify class work entries from submitted sessions
82. Verify teaching hours summary

#### Step 19: Timetable History Verification (All)
83. Navigate to Timetable History
84. Verify prior semesters shown separately
85. Verify current semester is the "live" timetable

#### Step 20: Cross-Department Verification (Shared First Year)
86. Verify BS-MATH students see same subjects as CSE Year 1
87. Verify BS-ENGLISH students see same subjects
88. Verify students keep their real branch
89. Verify parent HOD can see managed branch assignments

#### Step 21: Edge Case Testing
90. Attempt to delete CS201 with active assignments → Verify 409
91. Attempt to publish with deleted teaching assignment → Verify stale dropped
92. Attempt double check-in → Verify 409
93. Attempt faculty double-booking → Verify error
94. Attempt lab with 3 faculty → Verify error
95. Verify COLLEGE_ADMIN excluded from faculty-attendance-completion

#### Step 22: Sign Out & Re-Login
96. Sign out
97. Sign in as different user
98. Verify session cookie refreshed
99. Verify all access correct for new role

**Expected Result:** All steps complete without errors. Data integrity maintained across all collections. All dashboards display correct information.

### TC-E2E-002: Complete Import Workflow (P0)
**Alternative path: Bulk import everything at once**

1. Login as clgadmin
2. Import all departments via Excel (500 rows)
3. Import all courses via Excel
4. Import all subjects via CSV (100 rows)
5. Import all faculty via Excel (50 rows)
6. Import all students via Excel (200 rows)
7. Create CourseYearTimings
8. Assign subjects to semesters via Assign to Semester page
9. Create teaching assignments
10. Generate and publish timetable
11. Mark attendance
12. Generate reports
13. Verify all data consistent

### TC-E2E-003: Complete Rollback/Recovery (P1)
1. Create all data as above
2. Delete a department
3. Verify all dependent data is cleaned up
4. Recreate department
5. Re-import all data
6. Verify no duplicates
7. Verify all workflows still functional

### TC-E2E-004: Performance Under Load (P2)
1. Create 1000 subjects
2. Create 5000 students
3. Create 500 faculty
4. Generate timetable for all sections
5. Measure response times
6. Verify all under acceptable thresholds (< 3 seconds)

---

## 22. BUG REPORT TEMPLATE

### Bug Report Format
```
Bug ID: ACAD-[YYYY]-[XXX]
Module: [Subjects/Timetable/Attendance/Reports/etc.]
Severity: [CRITICAL/HIGH/MEDIUM/LOW]
Priority: [P0/P1/P2/P3]
Title: [Brief description]
Steps to Reproduce:
1. [Step 1]
2. [Step 2]
3. [Step 3]
Expected Result: [What should happen]
Actual Result: [What actually happens]
Screenshots: [Attach screenshots]
Environment: [Browser, OS, Device]
Test Data Used: [Credentials, courseId, etc.]
Root Cause Analysis: [If known]
Recommendation: [Fix suggestion]
Status: [Open/Fixed/Verified]
```

### Example Bug Reports from This Testing:

#### Bug 1: Timetable Slots Not Cascade-Deleted
```
Bug ID: ACAD-2026-001
Module: Teaching Assignment → Timetable Slots
Severity: CRITICAL
Priority: P0
Title: Timetable slots not deleted when teaching assignment deleted
Steps to Reproduce:
1. Create teaching assignment
2. Generate and publish timetable (creates TimetableSlots)
3. Delete teaching assignment
4. Verify TimetableSlots still exist
Expected Result: All associated TimetableSlots deleted
Actual Result: TimetableSlots remain, corrupting timetable
Status: Open
```

#### Bug 2: Subject Deletion No Cascade
```
Bug ID: ACAD-2026-002
Module: Subject Deletion
Severity: CRITICAL
Priority: P0
Title: No cascade delete when subject deleted
Steps to Reproduce:
1. Create master subject
2. Create SubjectSemesterAssignment for it
3. Create teaching assignment referencing it
4. Create timetable slots
5. Create student attendance
6. Delete subject
7. Verify orphaned records in all dependent collections
Expected Result: All dependent records cascade-deleted
Actual Result: Subject deleted, all dependent records orphaned
Status: Open
```

#### Bug 3: Denormalized Subject Metadata Stale
```
Bug ID: ACAD-2026-003
Module: Teaching Assignment → Subject Metadata
Severity: HIGH
Priority: P1
Title: TeachingAssignment stores stale subjectName/subjectCode
Steps to Reproduce:
1. Create subject "Data Structures" with code "CS201"
2. Create teaching assignment (stores subjectName="Data Structures", subjectCode="CS201")
3. Rename subject to "DSA"
4. Verify teaching assignment still shows "Data Structures" / "CS201"
Expected Result: Teaching assignment shows updated name
Actual Result: Teaching assignment shows old name (denormalized and never updated)
Status: Open
```

#### Bug 4: No Duplicate Check in POST
```
Bug ID: ACAD-2026-004
Module: Subject Creation
Severity: HIGH
Priority: P1
Title: Duplicate subjects allowed in POST endpoint
Steps to Reproduce:
1. POST /api/college/subjects with {courseId, regulation, code: "CS201"}
2. POST /api/college/subjects again with same data
3. Verify two subjects created with same code
Expected Result: Second POST rejected with duplicate error
Actual Result: Two subjects created (only import endpoint checks duplicates)
Status: Open
```

#### Bug 5: HOD Can Bypass Master Subject Restriction
```
Bug ID: ACAD-2026-005
Module: Subject Creation Authorization
Severity: HIGH
Priority: P1
Title: HOD can create master subjects by omitting courseId
Steps to Reproduce:
1. Login as HOD
2. POST /api/college/subjects WITHOUT courseId field
3. Include semester + department + name + code
4. Verify subject created via semester-scoped branch
Expected Result: 403 Forbidden (HOD cannot create master subjects)
Actual Result: Subject created because `if (body.courseId)` branch is skipped
Status: Open
```

#### Bug 6: Faculty Double-Booking by Subject Code
```
Bug ID: ACAD-2026-006
Module: Teaching Assignment
Severity: HIGH
Priority: P1
Title: Lab split validation checks subjectId, not code
Steps to Reproduce:
1. Create Subject LAB_001 (PRACTICAL) + Faculty A + Section A
2. Create Subject LAB_001_v2 (PRACTICAL) + Faculty B + Section A (different doc)
3. Create Subject LAB_001_v3 (PRACTICAL) + Faculty C + Section A
4. All three pass validation (different subjectIds)
Expected Result: Only 2 faculty allowed per lab subject code in a section
Actual Result: 3 faculty assigned to same lab code in same section
Status: Open
```

#### Bug 7: Department Not Found in Import
```
Bug ID: ACAD-2026-007
Module: Subject Import
Severity: HIGH
Priority: P0
Title: Import asks for department which causes "Department not found"
Steps to Reproduce:
1. Navigate to Academics → Import Subjects
2. Prepare CSV with subject data (no department column)
3. Upload CSV
4. Verify error: "Department 'Computer Science Engineering' not found"
Expected Result: Import should work without department (master subject model)
Actual Result: Import still requires department (old semester-scoped model)
Status: Fixed - Import endpoint rewritten to use courseId + regulation
```

#### Bug 8: No CSRF Protection
```
Bug ID: ACAD-2026-008
Module: Authentication
Severity: HIGH
Priority: P2
Title: No CSRF/origin verification on session endpoint
Steps to Reproduce:
1. Create malicious website
2. Make fetch to POST /api/auth/session with stolen Firebase token
3. Server creates session cookie
Expected Result: Origin verification prevents cross-site request
Actual Result: Any valid token creates a session regardless of origin
Status: Open
```

---

## TEST COMPLETION CRITERIA

### P0 Tests (Must Pass)
- All 45 P0 tests pass
- No CRITICAL bugs remain open
- All data integrity tests pass
- All authorization tests pass

### P1 Tests (Should Pass)
- All 35 P1 tests pass
- No HIGH bugs remain open except documented exceptions
- All edge cases handled gracefully

### P2 Tests (Recommended)
- All 25 P2 tests pass
- UI/UX consistent across all pages
- Performance within acceptable thresholds

### P3 Tests (Nice to Have)
- All 15 P3 tests pass
- Documentation complete
- All export formats work correctly

### Sign-Off Criteria
1. All P0 tests pass (45/45)
2. Zero CRITICAL bugs open
3. All data flows verified end-to-end
4. Cross-department operations tested
5. Edge cases handled
6. Authorization verified at all levels
7. Performance acceptable
8. All bug reports filed and tracked
9. Regression test suite established
10. Final sign-off from QA Lead and Product Owner

---

## APPENDIX

### A. API Endpoint Quick Reference

| Endpoint | Method | Roles | Description |
|----------|--------|-------|-------------|
| `/api/college/subjects` | GET | HOD, PRINCIPAL, VP, SA, CO, PM, CS, EX, AC | List subjects |
| `/api/college/subjects` | POST | HOD, PRINCIPAL, VP, SA, AC | Create master/semester subject |
| `/api/college/subjects/[id]` | PATCH | HOD, PRINCIPAL, VP, SA, AC | Update subject |
| `/api/college/subjects/[id]` | DELETE | HOD, PRINCIPAL, VP, SA, AC | Delete subject (cascade) |
| `/api/college/subjects/import` | POST | PRINCIPAL, VP, SA, AC | Bulk import master subjects |
| `/api/college/subject-semester-assignments` | GET | HOD, PRINCIPAL, VP, SA, AC, PM, CS | List assignments |
| `/api/college/subject-semester-assignments` | POST | PRINCIPAL, VP, SA, AC, HOD | Assign subject to semester |
| `/api/college/subject-semester-assignments` | DELETE | PRINCIPAL, VP, SA, AC, HOD | Unassign subject |
| `/api/college/teaching-assignments` | GET | HOD, PRINCIPAL, SA, PM, CS, VP | List assignments |
| `/api/college/teaching-assignments` | POST | HOD, PRINCIPAL, VP, SA, PM, CS | Create assignment |
| `/api/college/teaching-assignments` | DELETE | HOD, PRINCIPAL, VP, SA, PM, CS | Delete + cascade slots |
| `/api/college/timetable-slots` | GET | HOD, PRINCIPAL, SA, PM, CS, VP | Get slots for section |
| `/api/college/timetable-slots` | POST | HOD, PRINCIPAL, VP, SA, PM, CS | Pin manual slot |
| `/api/college/timetable/draft` | GET/POST/PATCH/DELETE | HOD, PRINCIPAL, VP, CO, SA, PM, CS | Timetable draft |
| `/api/college/timetable/publish` | POST | HOD, PRINCIPAL, VP, SA, PM, CS | Publish draft |
| `/api/college/timetable-incharges` | GET/POST/DELETE | HOD, PRINCIPAL, VP, SA | Timetable incharges |
| `/api/college/class-leader/timetable` | GET | CLASS_LEADER | Class leader timetable |
| `/api/college/attendance` | GET | HOD, PRINCIPAL, VP, SA, PM, unit heads | Monthly attendance |
| `/api/college/attendance/check-in` | POST | PM, HOD, PRINCIPAL, VP, CS, unit heads | Self check-in |
| `/api/college/attendance/check-out` | POST | PM, HOD, PRINCIPAL, VP, CS, unit heads | Self check-out |
| `/api/college/attendance/manual` | POST | HOD, PRINCIPAL, VP, unit heads | Manual attendance |
| `/api/college/attendance/report` | GET | HOD, PRINCIPAL, VP, SA, unit heads | Daily roster |
| `/api/college/attendance/face-registration` | GET/POST | PM, HOD, PRINCIPAL, VP, CS, unit heads | Face registration |
| `/api/college/attendance/import` | POST | HOD, unit heads, PRINCIPAL, VP | Bulk attendance import |
| `/api/college/student-attendance` | POST | PM | Mark student attendance |
| `/api/college/student-attendance/today-periods` | GET | PM | Today's periods |
| `/api/college/student-attendance/[id]` | PATCH | PM | Update attendance |
| `/api/college/student-attendance/office-correction` | GET/POST | HOD | Office correction |
| `/api/college/section-attendance-report` | GET | HOD, PRINCIPAL, VP | Section report |
| `/api/college/faculty-attendance-completion` | GET | HOD, PRINCIPAL, VP | Faculty completion |
| `/api/college/attendance-percentage-report` | GET | EX, PRINCIPAL, VP, SA | Percentage report |
| `/api/college/class-work-records` | GET | HOD, PM, CS | Class work records |
| `/api/college/students` | GET | HOD, PRINCIPAL, VP, SA, CO, PM, CS | List students |
| `/api/college/students/import-excel` | POST | HOD, CO | Bulk student import |
| `/api/college/students/distribute` | POST | HOD | Distribute students |
| `/api/college/students/promote` | POST | PRINCIPAL, VP, SA, CO | Promote students |
| `/api/college/faculty` | GET | HOD, PRINCIPAL, VP, SA, CO, PM, CS | List faculty |
| `/api/college/faculty/import` | POST | HOD, PRINCIPAL, SA | Bulk faculty import |
| `/api/college/faculty/link-hod` | POST | - | Link HOD |
| `/api/college/departments` | GET | - | List departments |
| `/api/college/departments/import` | POST | PRINCIPAL, VP, SA | Bulk department import |
| `/api/college/courses` | GET | HOD, PRINCIPAL, VP, SA, CO, PM, CS | List courses |
| `/api/college/course-year-timings` | GET/POST | - | Course year timings |
| `/api/college/course-catalog` | GET/POST | - | Course catalog |
| `/api/college/academic-sessions` | GET | - | Academic sessions |
| `/api/college/attendance-not-posted-settings` | GET/POST | - | Attendance settings |
| `/api/college/audit-logs` | GET | - | Audit logs |

### B. Role Access Matrix (Academics Module)

| Action | SUPER_ADMIN | PRINCIPAL | VP | HOD | PM | CO | SA | EX | AC | MGMT |
|--------|-------------|-----------|-----|-----|-----|-----|-----|-----|-----|------|
| Create Master Subject | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Import Subjects | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Assign Semester | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Create Teaching Assignment | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Publish Timetable | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Mark Faculty Attendance | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Mark Student Attendance | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| View Reports | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Delete Subject | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Manage Faculty | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Manage Students | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Manage Departments | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage Course Catalog | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View Class-Leader TT | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

### C. Test Data Summary

| Data Type | Count | Purpose |
|-----------|-------|---------|
| Departments | 5-10 | Department setup, cross-dept testing |
| Courses | 3-5 | Course catalog, timing setup |
| Subjects (R20) | 20-50 | Master subject creation, import |
| Subjects (R23) | 20-50 | Multi-regulation testing |
| Sections | 20-40 | Section-scoped assignments |
| Students | 500-1000 | Student attendance, roster testing |
| Faculty | 50-100 | Teaching assignments, attendance |
| Teaching Assignments | 100-200 | Timetable generation |
| Timetable Slots | 500-1000 | Timetable display, publish |
| Attendance Records | 1000+ | Reports, analytics |

---

**Test Plan Prepared By:** Senior QA Engineer (30+ years experience)  
**Date:** 2026-09-26  
**Version:** 1.0  
**Status:** Ready for Execution
