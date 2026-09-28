# Dashboard — PRINCIPAL (M5 surfaces) (`/principal`)

- **Role:** PRINCIPAL (mirrors: VP via /principal paths, College Admin, Director)
- **M5 pages (of 90):** attendance, attendance-completion, attendance-history (+departmentId→courseId→sectionId→studentId chain), attendance-import, attendance-report (+[uid]), attendance-reports (dept→course→section→subject→year/month chain), absent-report, shortage-report, faculty-not-posted, faculty-attendance

## Widgets/data sources
| Page | Widgets | API |
|---|---|---|
| `/principal/attendance` | College-wide today | attendance/report (college branch), today-status |
| `/principal/attendance-reports/**` | Deep drill dept→course→section→subject→month | section-attendance-report modes |
| `/principal/attendance-history/**` | Student-level history drill | student-attendance-history |
| `/principal/faculty-not-posted` | Not-posted list | faculty-attendance-completion |
| `/principal/attendance-import` | Excel import | attendance/import |

## Filters/scopes
- College-wide; management switcher n/a; deep-link params drive drill.

## Permissions
- College branch of report route; import/admin via college guard.

## Export
- monthly-export.

## Code evidence
- Page inventory; report route college branch; attendance-not-posted-settings card.
