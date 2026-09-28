# M3 — Permissions (as-is)

## Role-by-action matrix

| Action | Principal/VP | HOD | ACADEMICS | College Office | College Staff/Panel | Exam Cell | Class Leader |
|---|---|---|---|---|---|---|---|
| Catalog/courses CRUD | ✅ | 🔎 | ✅ (subjects side) | ➖ | ➖ | ➖ | ➖ |
| Departments CRUD/import | ✅ | 🔎 (own) | ➖ | ➖ | ➖ | ➖ | ➖ |
| Subjects CRUD/import | 🔎 | ✅ (dept) | ✅ | ➖ | ➖ | ➖ | ➖ |
| Semester assignment | ➖ | 🔎 | ✅ | ➖ | ➖ | ➖ | ➖ |
| Sections CRUD | ✅ | ✅ (own dept) | ➖ | ➖ | ➖ | ➖ | ➖ |
| Teaching assignments | ➖ | ✅ | ➖ | ➖ | 🔎 own | ➖ | ➖ |
| Assignment requests | ➖ | ✅ | ➖ | ➖ | ✅ (respond) | ➖ | ➖ |
| Timetable draft/publish | 🔎 | ✅ (dept) | ➖ | ➖ | ✅ if incharge | ➖ | ➖ |
| Course-year timings | ✅ | ➖ | ➖ | ✅ | ➖ | ➖ | ➖ |
| Timetable read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (own section) |
| Exam configurations | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ | ➖ |
| Internal marks entry | 🔎 | ✅ | ➖ | ➖ | ✅ (panel views) | ✅ | ➖ |
| Mid-paper assign | ➖ | ✅ | ➖ | ➖ | 🔎 (mid-bank) | ➖ | ➖ |
| Exam circulars/guidelines | 🔎 | 🔎 | ➖ | ➖ | ➖ | ✅ | ➖ |

## Scoping
- HOD: department scope via `lib/departments/scope.ts` (own + children + managed); sections cross-dept via secondaryDepartments logic.
- Timetable writes: timetableIncharges doc authority (facultyId) OR HOD `[UNVERIFIED route-level exact check]`.
- Exam Cell: college-wide exam config; marks entry shared with HOD.

## Seat/delegation limits
- One incharge per (courseId, yearN) — doc id enforces single delegation (`departments/timetableIncharge.ts:22-23`).

## Module/nav visibility
- "timetable-incharge" module gating: faculty must be assigned module to see incharge nav (navConfig `module` field).

## Backend vs frontend
- Verified guards on academic-sessions/years (requireCollegeContext), subjects/sections (requireCollegeMember); incharge authority check assumed in publish route `[UNVERIFIED]`.

## Gaps
1. Publish authority exact check unverified (incharge vs HOD vs Principal).
2. Panel marks-entry scopes (mid-bank read-only?) unverified.
3. Mid-paper has no completion state — setters never "done".
