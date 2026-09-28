# Dashboard — HOD (M3 surfaces) (`/hod`)

- **Role:** HOD (dept-scoped)
- **M3 pages (of 86):** subjects (+[id]/edit), sections (+new/[id]/edit), teaching, teaching-assignments, timetable `[courseId]/[year]` (+sectionId, teaching-assignments), internal-exam, mid-paper-setter, assignment-requests, setup, settings/{designations,sub-departments,department-office}

## Widgets/data sources
| Page | Widgets | API |
|---|---|---|
| `/hod/subjects*` | Dept subject list/editor | `api/college/subjects*` |
| `/hod/sections*` | Section CRUD + capacity/roster links | `api/college/sections*` |
| `/hod/teaching-assignments` | Assignment grid w/ Lab Batch per row | `api/college/teaching-assignments` (POST sets labBatch — teaching.ts:267-275) |
| `/hod/timetable/**` | Grid editor (draft), diagnostics, publish | `timetable/draft`, `timetable/publish`, `timetable-slots*` |
| `/hod/internal-exam` | Marks batch DRAFT/SUBMITTED | `internal-exam-marks*` |
| `/hod/mid-paper-setter` | Setter assignments | `mid-paper-assignments` |
| `/hod/assignment-requests` | Cross-dept request inbox | `faculty-assignment-requests*` |
| `/hod/settings/*` | Dept leadership/designations/sub-dept config | `college/users`, `departments` |

## Filters/scopes
- Dept scope (scope.ts); course/year/section deep links.

## Code evidence
- Page inventory; cited type comments.
