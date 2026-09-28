# FMS — Glossary (as-is)

Terms defined to match code semantics (`src/types/*.ts`, `src/lib/**`).

## Tenancy & identity
- **Location** — a campus/city tenant; holds location-scoped roles (`locations/{id}/locationUsers`). 
- **College** — tenant under a location (`colleges/{id}/…`); the main data boundary.
- **systemUsers** — global role profiles (SUPER_ADMIN, MANAGEMENT, FINANCE, PURCHASE_DEPT).
- **Role seat** — an appointment letting an account act as another role (e.g., HOD seat); holder's effective `role` = seat (`src/types/roleSeats.ts`, `src/lib/roles/seatRoles.ts`).
- **realRole** — pre-normalization role kept on session/Firestore doc (`COLLEGE_ADMIN`, `DIRECTOR`, `DEPARTMENT_OFFICE`) (`verifySession.ts:17-22`).
- **Normalization** — COLLEGE_ADMIN/DIRECTOR→PRINCIPAL; DEPARTMENT_OFFICE→HOD at session issue.
- **ROLE_LEVEL (L0–L6)** — seniority hierarchy driving inherited path access (`core.ts:152`).
- **ROLE_SCOPE** — GLOBAL/LOCATION/COLLEGE; where profiles live and how notification lookup works (`core.ts:202`, `notify.ts:110-128`).
- **Working-as switcher** — HOD's active-department pick (`ACTIVE_HOD_DEPT_COOKIE`).
- **Office roles** — ACADEMICS (ex-DEAN), IQAC_COORDINATOR, T_AND_P, R_AND_D, PLACEMENT_DEPT, LIBRARY, EXAM_CELL, WEBMASTER; gated by college type (`src/lib/roles/officeRoles.ts`).

## Hiring (M2)
- **Vacancy request** — department's staffing need; status flow ends in Principal approval.
- **Hiring batch** — execution container for a vacancy cycle; has phases (`WorkflowStatus` `core.ts:241`).
- **Hiring terms** — configured round/terms for a batch.
- **Candidate** — applicant record; **candidate application** — per-batch application doc.
- **Panel feedback** — interviewer scoring doc; **evaluation** page = `/evaluation/[batchId]/[candidateId]`.
- **Offer letter** — generated PDF offer; status: DRAFT→APPROVED→ACCEPTED etc.; **offer acceptance** public page.
- **Appointment letter** — post-acceptance faculty appointment doc.
- **Faculty account request / email request** — webmaster email+account provisioning pipeline.
- **Faculty provisioning** — creates `facultyMembers` + `users` docs from accepted offer (`src/lib/firestore/facultyProvisioning.ts`).

## Academics (M3)
- **Course** — a program (e.g., B.Tech CSE); **course catalog** — shared catalog entries with regulations.
- **Regulation** — batch's curriculum revision (e.g., R20); subjects are master (courseId+regulation) or semester-scoped (department+semester).
- **Subject (master)** — `courseId + regulation`; **subject-semester assignment** — instance `courseId_year_semester` linking subject into a semester.
- **Section** — teaching group in a course/year; may have `secondaryDepartments` (cross-dept), `labBatch` split.
- **Sub-department** — management view grouping branches (`managedDepartments`); never a student's own department.
- **Shared first year** — derived when a top-level dept claims year 1 and acts as shared parent (`src/lib/college/academicStructure.ts`).
- **Teaching assignment** — faculty↔section/subject for an academic year/semester.
- **Assignment request** — cross-department teaching consent (`faculty-assignment-requests`).
- **Timetable slot** — `day MON–SAT × periodNumber`, `sectionId`, optional `labBatch`, `substituteFacultyId`.
- **Timetable draft / publish** — drafts live outside `timetableSlots` until publish (`timetable/draft|publish`).
- **Timetable incharge** — delegated faculty managing a course/year's timetable (`timetableIncharges`, doc id `courseId_yearN`).
- **Course-year timing** — `courseId_yearN` periods/semesters timing config.
- **Internal exam / internal marks** — exam configurations + marks entry; **mid-paper setter** assignment.

## Students (M4)
- **Sectioning / distribute-cohort** — assigning students to sections; `evenSplit`, `dryRun` preflight, 409 with missing sections.
- **Promotion / advance-year** — moving cohort to next year; graduated students → status `GRADUATED`.
- **Lab batch** — split lab subgroup on a section.
- **Class leader** — student bound to a section with timetable read access (`class-leader`).
- **Department history** — per-student subcollection of department changes (`students/{id}/departmentHistory`).

## Attendance (M5)
- **Check-in/check-out** — faculty self attendance with geofence+face gates; **manual** — admin entry with 1-tier cascade.
- **Check-in permission** — PRINCIPAL/VP→HOD/unit-head cascade doc (`attendanceCheckInPermissions`).
- **Not-posted sweep** — cron detecting periods ended without submitted sessions.
- **Period attendance status** — IN_PROGRESS/SUBMITTED etc. (`src/lib/attendance/periodAttendanceStatus.ts`).
- **Office correction** — HOD on-behalf student attendance fix (`student-attendance/office-correction`).
- **Shortage report** — below-threshold student attendance (`src/lib/studentAttendance/shortage.ts`).
- **Faculty attendance completion** — per-period submission completeness report.
- **IST time helpers** — `istDateKey`, `istMidnightUTC`, `getISTParts` (`src/lib/attendance/istTime.ts`) — all date logic must use them.

## Leave (M6)
- **Leave profile** — per-employee balance profile (`employeeLeaveProfiles`).
- **Leave balance engine** — accrual/deduction logic (`src/lib/leave/balanceEngine.ts`).
- **Permission (short leave)** — short-leave request type (`permissionRequests`, `leave/permissions`).
- **OD (on duty)** — duty request with proof (`onDutyRequests`, `/leave/od-proof/[id]`).
- **Staff adjustment** — manager-assigned substitution (`staffAdjustments`, status ACTIVE).
- **Adjustment request** — self-service substitution consent flow (`adjustment-requests`; accept/decline at `/leave/adjustments`).
- **Period coverage** — substitute-aware slot resolution for a date (`src/lib/leave/periodCoverage.ts`).

## Finance (M7)
- **Budget cycle** — annual/period container; **budget request** — HOD→Principal flow.
- **Emergency budget request** — Management-approved special request.
- **Indent** — purchase requisition; **purchase clearance** — Finance/Principal clearance step; **GRN** — goods receipt note upload.
- **Fund allocation / payment / receipt / expense request** — finance ledger docs.
- **Salary structure** — per-designation pay matrix applied to faculty (`applySalaryStructurePricing.ts`).

## R&D (M8)
- **Publication** — faculty publication; **citation metrics** — per-faculty citation snapshot.
- **Research profile** — faculty research page fields.
- **Consultancy / sponsored / seed-funded project** — project records with docs.
- **IPR / discovery-innovation / innovation / hackathon / PhD supervision** — activity records.
- **RND Coordinator seat** — department reviewer before R&D (`research/review`).

## Communications (M9)
- **Circular** — {subject, body, date, audience{employeeType, departmentIds}, messageFrom, attachments, status DRAFT|PUBLISHED}.
- **Circular settings** — messageFrom options (Principal editable).
- **Circular permissions** — allowedUids/allowedRoles doc (PRINCIPAL/VP always allowed).
- **Student feedback** — student→faculty feedback via public form.

## Platform (M1)
- **Nav visibility** — per-college toggle set hiding sidebar items (`settings` doc; defaults `navVisibilityDefaults.ts`).
- **Audit log** — append-only action record (college + global streams).
- **General-admin vacancy** — non-teaching staff vacancy at location level.
