# Dashboard — PRINCIPAL (M4 surfaces) (`/principal`)

- **M4 pages (of 90):** students (+[studentId]), promotions, graduates, sections (M3 shared)

## Widgets/data sources
| Page | Widgets | API |
|---|---|---|
| `/principal/students` | College roster browse | `api/college/students` |
| `/principal/promotions` | Promotion center (dry-run preview → commit) | `students/promote`, `students/distribute-cohort` |
| `/principal/graduates` | Graduated cohort | status=GRADUATED reads |

## Permissions
- Promote/distribute: Principal/VP only (409 naming missing targets — AGENTS.md).

## Code evidence
- Page inventory; AGENTS.md cohort ops.
