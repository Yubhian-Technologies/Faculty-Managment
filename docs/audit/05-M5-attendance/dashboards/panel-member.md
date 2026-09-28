# Dashboard — PANEL_MEMBER (M5 surfaces) (`/panel`)

- **Role:** PANEL_MEMBER
- **M5 pages (of 28):** /panel/mark-attendance, /panel/monthly-records (+sectionId, year/month, [date]), /panel/attendance

## Widgets/data sources
| Page | Widgets | API |
|---|---|---|
| `/panel/mark-attendance` | Today's open periods for assigned sections | `student-attendance/today-periods`, POST |
| `/panel/monthly-records/**` | Section×month×day drill with edit | `section-attendance-report` dailyPercent + PATCH `[id]` |

## Filters/scopes
- Assigned sections/batches `[UNVERIFIED scope source — likely teachingAssignments]`.

## Permissions
- College guard; backend scope for marking `[GAP — unverified]`.

## Code evidence
- Page inventory; module map lists Panel as student marker.
