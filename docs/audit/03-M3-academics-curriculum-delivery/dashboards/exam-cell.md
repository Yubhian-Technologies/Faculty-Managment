# Dashboard — EXAM_CELL (`/exam-cell`)

- **Role:** EXAM_CELL (L5, college)
- **Route root:** `/exam-cell` (15 pages)
- **M3 pages:** configure, guidelines, circulars (exam module circulars — separate collection from M9 circulars)

## Widgets/data sources
| Page | Widgets | API |
|---|---|---|
| `/exam-cell/configure` | Exam configuration list (id examConfigId(courseId,year,examType), ACTIVE/INACTIVE) | `api/college/exam-configurations` |
| `/exam-cell/guidelines` | Guideline docs CRUD | `api/college/exam-guidelines*` |
| `/exam-cell/circulars` | Exam circular docs | `api/college/exam-circulars*` |
| `/exam-cell/attendance*` (M5) | attendance reports twins | M5 APIs |
| `/exam-cell/internal exam views` | marks read (via panel/hod pages) | `internal-exam-marks` |

## Permissions
- Exam config/guidelines/circulars: EXAM_CELL write; marks entry shared with HOD.

## Code evidence
- Page inventory; examConfig.ts:29-31; exams.ts:11.
