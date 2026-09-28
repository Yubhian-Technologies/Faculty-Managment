# Appendix — API Index (301 route files → modules)

Full route list (from 2026-09-28 inventory) grouped by module. Verbs per route live in each module's `api-map.md`.

## M1 (admin, administration, location users, management oversight, college users/roles/seats/settings/years/catalog/webmaster)
`admin/audit-logs · admin/colleges · admin/dashboard-stats · admin/locations(+[id]) · admin/settings/nav-visibility · admin/users(+[uid],[uid]/photo,me,me/photo) · administration/college-people(+[uid]) · administration/colleges/[collegeId]/departments(+[deptId]/faculty) · administration/principals · college/users(+[uid],[uid]/promotion-salary→M7,me,me/photo) · college/role-seats(+[id],convert-legacy) · college/settings/{general,nav-visibility} · college/academic-years · college/academic-sessions · college/course-academic-years · college/course-catalog(+[id]) · college/webmaster/reset-password · management/** (18 routes, oversight) · location/users(+[uid],me,me/photo) · auth/session`

## M2 (hiring)
`admin/general-admin-vacancies(+[id]) · college/vacancy-requests(+[id]) · college/candidates(+[id]) · college/candidate-applications(+[id]) · college/hiring-batches(+[id]) · college/hiring-terms(+[id]) · college/panel-feedback · college/offer-letters(+[id]) · college/appointment-letters · college/faculty-account-requests(+[id]) · college/email-requests(+[id],check-availability) · location/vacancy-requests(+[id]) · location/candidates(+[id]) · location/interviews(+[id]) · location/offers(+[id]) · public/candidate-form/[collegeId]/[candidateId] · public/offer-acceptance/[collegeId]/[offerId] · college/colleges-directory · upload/{resume,certificate,joining-letter}`

## M3 (academics)
`college/courses(+[id],lookup) · college/subjects(+[id],categories,import) · college/subject-semester-assignments · college/sections(+[id],lookup) · college/departments(+import) · college/designations(+[id]) · college/teaching-assignments(+[id]) · college/faculty-assignment-requests(+[id]) · college/timetable-slots(+[id]) · college/timetable/{draft,publish} · college/timetable-incharges · college/course-year-timings · college/exam-configurations · college/internal-exam-marks(+[id]) · college/mid-paper-assignments · college/exam-circulars(+[id]) · college/exam-guidelines(+[id]) · college/class-leader/timetable · college/class-work-records(+sections)`

## M4 (students)
`college/students(+[id],bulk-delete,distribute,distribute-cohort,import-excel,promote)`

## M5 (attendance)
`college/attendance(+campus-location,check-in,check-in-permission,check-out,face-registration(+reset),import,manual,monthly-export,reference-photo,report,today-status) · college/attendance-not-posted-settings · college/attendance-percentage-report · college/faculty-attendance-completion · college/student-attendance(+history,[id],office-correction(+[id]),today-periods) · college/section-attendance-report · cron/attendance-not-posted · location/staff-attendance(+report) · location/shifts(+[id],rotate) · management/colleges/[collegeId]/{department-attendance,faculty-attendance/[uid],monthly-export,principal-attendance(+reset),vice-principal-attendance} · college/holidays(+[id],import) · college/summer-holidays(+[id]) · college/working-days(+[id])`

## M6 (leave)
`leave/{adjustment-requests,applications(+[id],adjustment-response),balances,handover-candidates,other-categories,period-coverage,permissions(+[id]),profile,profiles,seed,staff-adjustments(+[id],options),types} · college/leave-history-report(+absent-today,active-now,import,yearly) · management/leave-approvals(+[id]) · upload/leave-proof · college/parse-excel (shared)`

## M7 (budget/finance/purchase/payroll)
`college/budget-cycles(+[id]) · college/budget-requests(+[id]) · college/finance-budget-requests(+[id]) · college/finance-budgets(+[id]) · college/finance-expense-requests(+[id]) · college/finance-fund-allocations(+[id]) · college/finance-payments(+[id]) · college/finance-purchase-clearance(+[id]) · college/finance-receipts(+[id]) · college/finance-reports · college/finance-audit-logs · college/financial-years · college/indent-requests(+[id]) · college/salary-structures · college/faculty/[id]/promotion-salary · finance/budget-requests/overview · purchase/indents/overview · management/emergency-budget-requests(+[id]) · upload/{budget-circular,budget-report,finance-receipt,indent-receipt,purchase-grn}`

## M8 (research)
`college/publications(+[id],import) · college/citation-metrics(+[uid]) · college/research-profile(+[uid]) · college/consultancy-projects(+[id]) · college/sponsored-projects(+[id]) · college/seed-funding(+[id]) · college/research-services(+[id]) · college/phd-supervision(+[id]) · college/hackathons(+[id]) · college/innovations(+[id]) · college/discovery-innovation(+[id]) · college/research-review · upload/{consultancy-doc,hackathon-doc,innovation-doc,ipr-doc,phd-doc,research-service-doc,seed-funding-doc,sponsored-project-doc}`

## M9 (communications)
`college/circulars(+[id],[id]/publish,permissions/me) · college/circular-settings · college/circular-permissions · college/audit-logs · college/student-feedback · public/student-feedback · upload/circular`

## M10 (public)
`public/candidate-form/… · public/offer-acceptance/… · public/faculty-public` (cross-listed) · `pdf/generate · pdf/image-proxy · email/send`

## Shared/cross-cutting
`college/faculty(+[id],[id]/login,import,link-hod,lookup,me,modules,lookup) · college/faculty-lookup · college/supporting-staff(+[id],[id]/login,import) · college/faculty-requirement · college/notifications · college/info · upload/{faculty-document,profile-photo,staff-photo,supporting-staff-document}`

Unclassified stragglers (assigned in module docs): `college/appointment-letters` (M2), `college/email-requests` (M2), `college/college-people` variants (M1), `college/faculty-account-requests` (M2).
