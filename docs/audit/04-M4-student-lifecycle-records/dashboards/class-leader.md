# Dashboard — CLASS_LEADER (`/class-leader`)

- **Role:** CLASS_LEADER (student seat, L6)
- **Route root:** `/class-leader` (3 pages)

## Widgets/data sources
| Page | Widgets | API |
|---|---|---|
| `/class-leader` | Home | — |
| `/class-leader/timetable` | Read-only section timetable with substitution overlay | `api/college/class-leader/timetable` (currentPeriod + periodCoverage overlay) |
| `/class-leader/profile` | Profile | profile APIs |

## Permissions
- Own-section read only; no write surfaces.

## Code evidence
- Page inventory; proxy CLASS_LEADER path.
