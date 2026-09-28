# Appendix — Evidence Index

Key file:line citations used across this audit (verified by read/search on 2026-09-28, branch `guna-subjects-timetable-updates`).

## Identity / auth / tenancy
- `src/types/core.ts:5-61` — UserRole (29 values incl. RND_COORDINATOR seat comment :52-55)
- `src/types/core.ts:111` ROLE_DASHBOARD_PATHS; `:152` ROLE_LEVEL; `:202` ROLE_SCOPE; `:268` WorkflowStatus; `:780` CourseYearTiming; `:825` TimetableIncharge; `:2651` Section
- `src/lib/auth/verifySession.ts:17-22` realRole; `:28-38` isCollegeAdmin/isDepartmentOffice; `:66` verifySession; `:73` requireSuperAdmin; `:84-91` requireManagement sanctioned writes + role-seats note; `:113-121` HOD dept cookie
- `src/lib/auth/liveRoles.ts:42,70-71` — three-root live role resolution
- `src/proxy.ts:16-30` PUBLIC_PATHS; `:35-48` shared paths; `:52-96` ROLE_PATH_MAP; `:99-104` allowedPathsForRole + `/api/` skip
- `src/lib/firestore/userProvisioning.ts:38,45,65,86` — three roots + audit write
- `src/lib/auth/sessionToken.test.ts` — HMAC cookie test

## Hiring (M2)
- `src/types/recruitment.ts:14-52` VacancyRequest (ratios :30-37, principalResponse :39-44); `:61-76` stages; `:98` InterviewMode; `:229` CandidateApplication; `:281-294` BatchPhase (born at PRINCIPAL_REVIEW :281-283); `:305-357` HiringBatch (positionCategory copy :313-317); `:359-430` PanelFeedback (optional criteria :380-386); `:440-456` HiringTerms snapshot comment; `:458-490` OfferLetter (offeredTerms, respondedBy); `:492-518` AppointmentLetter; `:520` :538-564 FacultyAccountRequest
- `src/lib/hiringPipeline.ts:11-19` getCurrentStage; `:66-97` getDetailedHiringStatus
- `src/lib/firestore/offerLetterDecision.ts:22-62` decision tx; `offerLetterCc.ts:16-31` CC resolution; `facultyProvisioning.ts:24,46,70,119-123,182,208-266`
- `src/lib/notify.ts:24-37` notify; `:44-64` excludeLeadershipUids; `:66-93` getDepartmentHeadUids; `:110-128` notifyRole GLOBAL

## Academics (M3)
- `src/types/teaching.ts:34` Subject; `:103` SubjectSemesterAssignment; `:141` TeachingAssignment; `:208` FacultyAssignmentRequest; `:256-340` TimetableSlot (labBatch :267-275; history :289-309; overlay :310-330); `:344-383` TimetableRules + DEFAULT; `:384`+ TimetableDraft (`timetableDrafts/{sectionId}` :378-380)
- `src/lib/timetable/loadContext.ts:49-85`; `currentPeriod.ts:63,94-111,106,165-183,251-273`
- `src/lib/subjects/services/SubjectInstanceService.ts:52-81,84,112-113,160,185,271-273`
- `src/lib/departments/timetableIncharge.ts:22-23,43-44` (doc id courseId_yearN)
- `src/lib/leave/periodCoverage.ts:135-136,167,207-216,402-405,429` (chunk 30)

## Students (M4)
- `src/lib/students/evenSplit.ts:11`; `distributionLock.ts:24`; `departmentHistory.ts:24-26`; `sectionRoster.ts:50-53`
- `src/app/api/college/class-work-records/route.ts:19` (not-a-separate-collection comment)

## Attendance (M5)
- `src/lib/attendance/checkInPermission.ts:8`; `lateAttendancePenalty.ts:8`; `workingDays.ts:18`; `notPostedSettings.ts:24`; `registration.ts:13-21`
- `functions/src/index.ts:9-13,20-44` (pinger rationale + schedule/secrets)
- `src/types/studentAttendance.ts` (id assign_date_period)

## Leave (M6)
- `src/types/leave.ts:31` LeaveTypeCode; `:296` StaffAdjustmentStatus; `src/types/permission.ts:19`
- `src/lib/leave/balanceEngine.ts:37-43`; `identity.ts:47-114`; `staffAdjustmentScope.ts:60`; `availability.ts:117-120`; `decideFinalStage.ts:93`; `reportRoster.ts:36-103`; `holidaysCount.ts:26-94`

## Budget/Finance (M7)
- `src/types/budget.ts:6-22` (10 states incl. emergency), `:35-45` categories, `:132` cycle status
- `src/types/indent.ts:2-5,36-48,60+`
- `src/lib/budget/managementApproval.ts:18,39,66,96-97` (FINANCE-in-college-users query — flagged gap); `departmentScope.ts:15,36`; `applySalaryStructurePricing.ts:44,58`

## Research (M8)
- `src/lib/research/coordinatorReview.ts:51,75-79`; `applyCitationMetricsFields.ts:22-37`; `applyResearchProfileFields.ts:22-37`; `finalizeIprInventors.ts:19-28`; `finalizeConsultants.ts:20`
- `src/lib/publications/firestore/publications.ts:9`; `resolveOwnerDesignation.ts:23`; `deriveFlatFields.ts:26-34`

## Communications (M9)
- `src/lib/circular/service.ts:11,141-149,176-183`; `settings.ts:10`; `permissions.ts:12`

## Platform
- `src/components/layout/navConfig.ts:12-21` (module), `:23-38` (hideFor/showOnlyForRealRoles), `:45-51` ROLES_WITH_EMBEDDED_PANEL_ACCESS
- `.github/workflows/ci.yml:12-18` (placeholders), step order lint-first
- `firestore.indexes.json` (927 lines; studentAttendance 4 COLLECTION_GROUP composites; sections 7; leaveRequests 4)
- SHARED_FILES.md (verifySession 276 importers claim; scope triple; rules lag; lint failure)

## Count baselines (2026-09-28)
- 301 API `route.ts` files; 570 `page.tsx`; 74 test files (64 `*.test.ts` + 10 `*.spec.ts`); 1 Cloud Function.
- Dashboard page counts per role: principal 90, hod 86, college-office 49, finance 30, panel 28, management 27, r-and-d 22, administration 20, location-dept-head 19, super-admin 18, location-staff-admin 17, purchase 16, exam-cell 15, hr-admin 13, college-staff 13, academics 12, webmaster 11, t-and-p 11, library 11, accounts 11, college-accounts 9, placement-dept 7, iqac-coordinator 7, admin-office 5, leave 3, class-leader 3, rnd-coordinator 2, vice-principal 1, evaluation 1, coordinator 1, circulars 1, candidate-profile 1.
