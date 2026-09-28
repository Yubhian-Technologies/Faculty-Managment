# Dashboard — COLLEGE_OFFICE (M4 surfaces) (`/college-office`)

- **M4 pages (of 49):** students (+import), graduates

## Widgets/data sources
| Page | Widgets | API |
|---|---|---|
| `/college-office/students` | Roster table (dept/section/year filters) | `api/college/students` |
| `/college-office/students/import` | Excel import wizard | `students/import-excel` (fieldConstraints) |
| `/college-office/graduates` | Graduated list | `students?status=GRADUATED` |

## Permissions
- College-wide student CRUD + import (Principal also).

## Code evidence
- Page inventory; lib/import/fieldConstraints.test.ts.
