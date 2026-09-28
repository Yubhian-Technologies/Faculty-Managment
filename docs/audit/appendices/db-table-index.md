# Appendix — Firestore Collection Index

Derived from `.collection(` search across `src/` (180 matches sampled) + `firestore.indexes.json`. Owner module in brackets. `[UNVERIFIED]` = inferred from route/lib names without a direct collection-read.

## Global roots
| Path | Owner |
|---|---|
| `systemUsers/{uid}` | M1 |
| `locations/{id}` + `locations/{id}/locationUsers/{uid}` | M1 |

## `colleges/{id}/…` (college-scoped)

| Collection / doc | Owner | Evidence |
|---|---|---|
| `users/{uid}` | M1 | userProvisioning.ts:65 |
| `roleSeats/{id}` | M1/M8 | coordinatorReview.ts:51 |
| `auditLogs/{id}` | M1/M9 | userProvisioning.ts:86; decideFinalStage.ts:93 |
| `notifications/{id}` | cross | notify.ts:27 |
| `settings/{general}` | M1 | collegeSettings.ts:26 |
| `settings/{SETTINGS_DOC}` (circular settings) | M9 | circular/settings.ts:10 |
| `settings/{PERMS_DOC}` (circular permissions) | M9 | circular/permissions.ts:12 |
| `settings/timetableRules` | M3 | teaching.ts:349-351; loadContext.ts:64 |
| `settings/{attendance not-posted}` | M5 | notPostedSettings.ts:24 |
| `departments/{id}` | M3 | scope.ts:213+ |
| `courses/{id}` · `courseCatalog/{id}` | M3 | courseSelections.ts:29 |
| `academicYears/{id}` | M1/M3 | courseScopeValidation.ts:22-24 |
| `subjects/{id}` | M3 | internalExamMarks.ts:30 |
| `subjectSemesterAssignments/{id}` | M3 | SubjectInstanceService.ts:185,271-273 |
| `sections/{id}` | M3/M4 | loadContext.ts:51 |
| `teachingAssignments/{id}` | M3 | internalExamMarks.ts:71 |
| `facultyAssignmentRequests/{id}` | M3 | route |
| `timetableSlots/{id}` | M3 | currentPeriod.ts:95 |
| `timetableDrafts/{sectionId}` | M3 | teaching.ts:378-380 |
| `timetableIncharges/{courseId_yearN}` | M3 | timetableIncharge.ts:22-23 |
| `courseYearTimings/{courseId_yearN}` | M3 | currentPeriod.ts:63 |
| `examConfigurations/{id}` | M3 | internalExamMarks.ts:82 |
| `internalExamMarks/{id}` | M3 | exams.ts |
| `midPaperAssignments/{id}` | M3 | midPaper.ts |
| `examCirculars/{id}` · `examGuidelines/{id}` | M3 | types |
| `students/{id}` | M4 | sectionRoster.ts:50-53 |
| `students/{id}/departmentHistory/{id}` | M4 | departmentHistory.ts:24-26 |
| `distributionLocks/{lockKey}` | M4 | distributionLock.ts:24 |
| `classWorkRecords?/{id}` | M4 | route comment `[UNVERIFIED name]` |
| `attendanceRecords/{id}` | M5 | report/manual routes; indexes |
| `lateAttendanceCounters/{id}` | M5 | lateAttendancePenalty.ts:8 |
| `attendanceCheckInPermissions/{id}` | M5 | checkInPermission.ts:8 |
| `workingDays/{id}` · `holidays/{id}` · `summerHolidays/{id}` | M5 | workingDays.ts:18; holidaysCount.ts:26-94 |
| `studentAttendance/{id}` (COLLECTION_GROUP across dept paths) | M5 | indexes; types/studentAttendance.ts |
| `leaveRequests/{id}` | M6 | balanceEngine.ts:40 |
| `leaveBalances/{id}` | M6 | balanceEngine.ts:37 |
| `employeeLeaveProfiles/{uid}` | M6 | balanceEngine.ts:43 |
| `staffAdjustments/{id}` | M6 | availability.ts:120 |
| `otherLeaveCategories/{id}` | M6 | otherCategories.ts:9 |
| `permissionRequests/{id}` · `onDutyRequests/{id}` | M6 | indexes |
| `budgetCycles/{id}` · `budgetRequests/{id}` | M7 | managementApproval.ts:39; indexes |
| `financeBudgets · financeFundAllocations · financePayments · financeReceipts · financeExpenseRequests · financePurchaseClearance` | M7 | routes |
| `indentRequests/{id}` | M7 | indent.ts |
| `salaryStructures/{id}` · `salaryRecords/{id}` | M7 | applySalaryStructurePricing.ts:44; indexes |
| `financialYears/{id}` | M7 | routes |
| `publications/{id}` | M8 | firestore/publications.ts:9 |
| `consultancyProjects · sponsoredProjects · seedFunding · researchServices · phdSupervision · hackathons · innovations · discoveryInnovation` | M8 | routes/libs |
| `circulars/{id}` | M9 | circular/service.ts:11 |
| `studentFeedback/{id}` | M9 | indexes |
| `vacancyRequests/{id}` · `candidates/{id}` · `candidateApplications/{id}` | M2 | indexes; hiring.ts |
| `hiringBatches/{id}` (+`/panelFeedback/{id}` subcollection) | M2 | recruitment.ts:359 comment; indexes |
| `hiringTerms/{id}` | M2 | recruitment.ts:446 |
| `offerLetters/{id}` · `appointmentLetters/{id}` | M2 | recruitment.ts:458,492; offerLetterDecision.ts:23 |
| `facultyAccountRequests/{id}` · `emailRequests/{id}` | M2 | recruitment.ts:538; routes |
| `facultyMembers/{id}` | M2/M1 | facultyProvisioning.ts |
| `supportingStaff/{id}` | M2/M6 | reportRoster.ts:102; identity.ts:94 |
| `emailRequests`, `facultyAssignmentRequests` | M2/M3 | routes |

## Storage layout (summary)
`colleges/{id}/circulars/…` (M9); per-feature doc/proof/photo objects via 21+ `api/upload/*` routes (M2/M7/M8 + profiles) `[full tree UNVERIFIED]`.
