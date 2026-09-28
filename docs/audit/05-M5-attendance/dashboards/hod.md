# Dashboard — HOD (M5 surfaces) (`/hod`)

- **Role:** HOD (dept-scoped; switcher for multi-dept)
- **M5 pages (of 86):** attendance, attendance-completion, attendance-history, attendance-import, attendance-reports, faculty-attendance (+[uid]), faculty-not-posted, absent-report, shortage-report, monthly-records (+sectionId drill, year/month, range)

## Widgets/data sources
| Page | Widgets | API |
|---|---|---|
| `/hod/attendance` | Today: dept tree, per-faculty status cards | `attendance/report` (dept-tree branch), `attendance/today-status` |
| `/hod/attendance-completion` | Per-period completion table | `faculty-attendance-completion` |
| `/hod/attendance-history` | Historical logs | `attendance/report` ranged |
| `/hod/faculty-not-posted` | Faculty with unsubmitted periods | completion/not-posted data |
| `/hod/absent-report` `/shortage-report` | Absentees; below-threshold students | `section-attendance-report` modes, percentage |
| `/hod/monthly-records/**` | Section×month grid → day drill | section-attendance-report dailyPercent |

## Filters/scopes
- Own departments (scope.ts); date pickers; section/subject filters.

## Permissions
- Dept-tree enforced server-side (report route role branch).

## Export
- Monthly export (`attendance/monthly-export`).

## Empty/loading/error
- DataTable states.

## Code evidence
- Page inventory; report route role branch (AGENTS.md); navConfig absent/shortage/not-posted entries.
