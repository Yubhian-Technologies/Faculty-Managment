# M5 — UI Routes (as-is)

```text
# self (every role root has /attendance)
/<role>/attendance                              # check-in UI

# HOD
/hod/attendance · /hod/attendance-completion · /hod/attendance-history
/hod/attendance-import · /hod/attendance-reports
/hod/faculty-attendance (+[uid]) · /hod/faculty-not-posted
/hod/absent-report · /hod/shortage-report
/hod/monthly-records (+[sectionId], [year]/[month], range)

# Principal (college-wide twins)
/principal/attendance* (completion, history(+dept/course/section/student), import, report(+[uid]), reports(deep chain), absent-report, shortage-report, faculty-not-posted, faculty-attendance)

# College Office / Exam Cell / Library / T&P (admin twins)
/<role>/staff-attendance (+[uid]) · /<role>/attendance-import · /<role>/attendance · /exam-cell/attendance-report

# Panel
/panel/mark-attendance · /panel/monthly-records/** · /panel/attendance

# Management
/management/attendance · /management/faculty-attendance/[collegeId]/[uid]
/management/faculty/[collegeId]/principal/attendance · /vice-principal/attendance

# Location (branch WIP)
/location-staff-admin/attendance (+reports, shift) · /location-dept-head/attendance (+shift)
/location-staff-admin/shifts/** · /location-dept-head/shifts/**
```

Guards: proxy prefixes; reports enforce dept/college scope server-side; nav items for absent/shortage/faculty-not-posted added per AGENTS.md (navConfig).
