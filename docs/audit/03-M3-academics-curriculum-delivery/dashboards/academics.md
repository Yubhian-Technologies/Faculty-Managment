# Dashboard — ACADEMICS office role (`/academics`)

- **Role:** ACADEMICS (ex-DEAN; college office role, L5)
- **Route root:** `/academics` (12 pages)
- **Guard:** proxy `/academics`; college guards on APIs.

## Pages/widgets and data sources
| Page | Widgets/Tables | API | Notes |
|---|---|---|---|
| `/academics` | Home/overview | — | |
| `/academics/subjects` (+`new`, `[id]/edit`, `import`) | Subject tables (master vs semester-scoped), import wizard | `api/college/subjects*` | dual-model validation |
| `/academics/assign-semester` | Course→year→semester picker + subject checkboxes | `api/college/subject-semester-assignments`, `course-year-timings` | SubjectInstanceService |
| `/academics/leave*`, `/profile*` | self-service (M6/M1 reuse) | — | |

## Filters/scopes
- College-wide for subject definitions; course filter chain.

## Permissions
- Subject CRUD: ACADEMICS (+HOD dept view); semester assignment: ACADEMICS primary.

## Drill-downs
- Subject → semester assignment → teaching assignments (HOD).

## Export
- None found `[GAP]`.

## Code evidence
- Page inventory; `subjects/route.ts:234` comment; validation.test.ts.
