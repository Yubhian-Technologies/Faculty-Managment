# M3 — UI Routes (as-is)

```text
/academics                        (ACADEMICS office role)
  ├ /academics/subjects (+new, [id]/edit, import)
  ├ /academics/assign-semester
  └ (profile/leave — self)

/hod
  ├ /hod/subjects (+[id]/edit)
  ├ /hod/sections (+new, [id], [id]/edit)
  ├ /hod/teaching · /hod/teaching-assignments
  ├ /hod/timetable/[courseId]/[year] (+[sectionId], /teaching-assignments)
  ├ /hod/internal-exam
  ├ /hod/mid-paper-setter
  ├ /hod/assignment-requests
  └ /hod/setup · /hod/settings/{designations,sub-departments,department-office}

/principal
  ├ /principal/courses
  ├ /principal/departments (+new, import, [id], [id]/edit, courses/new, courses/[courseId]/edit, timing/[year]/edit)
  ├ /principal/sections (+[id])
  ├ /principal/timetable
  └ /principal/internal-marks

/college-office/timings (+[departmentId]/[courseId]/[year]/edit)

/college-staff/timetable-incharge/[courseId]/[year] (+[sectionId], /teaching-assignments)
/panel/timetable-incharge/** · /panel/internal-exam · /panel/mid-bank · /panel/assignment-requests
/college-staff/assignment-requests

/exam-cell/configure · /exam-cell/guidelines · /exam-cell/circulars
/class-leader/timetable
```

## Guards
- Proxy prefixes per role; deep links carry courseId/year/sectionId — validated server-side per college.

## Nav visibility
- `module: "timetable-incharge"` items shown only to faculty with that assigned module (navConfig NavItem.module); academics nav per office role.
