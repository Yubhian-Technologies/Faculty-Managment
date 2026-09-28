# Dashboard — PRINCIPAL (M3 surfaces) (`/principal`)

- **Role:** PRINCIPAL (mirrors VP/College Admin/Director)
- **M3 pages (of 90):** courses, departments (+new/import/[id]/edit, courses new/edit, timing/[year]/edit), sections (+[id]), timetable, internal-marks

## Widgets/data sources
| Page | Widgets | API |
|---|---|---|
| `/principal/courses` | Course list + catalog linkage | `api/college/courses*`, `course-catalog*` |
| `/principal/departments/**` | Dept tree, sub-department config, course timing editors | `api/college/departments*` (+import), `course-year-timings` |
| `/principal/sections*` | College-wide sections | `api/college/sections*` |
| `/principal/timetable` | Read-only college timetable view | `timetable-slots` (current reads) |
| `/principal/internal-marks` | Marks overview | `internal-exam-marks` |

## Permissions
- Catalog/courses/departments: Principal write (Academics for subjects); timing edits here + College Office.

## Code evidence
- Page inventory; core.ts:780 (CourseYearTiming).
