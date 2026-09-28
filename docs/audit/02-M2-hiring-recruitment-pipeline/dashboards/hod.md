# Dashboard — HOD (M2 surfaces) (`/hod`)

- **Role:** HOD (mirror DEPARTMENT_OFFICE), department-scoped
- **M2 pages (of 86 total):** `/hod/vacancy`, `/hod/vacancy/new`, `/hod/batches`, `/hod/batches/[id]`, `/hod/batches/new`, `/hod/candidates`, `/hod/candidates/[id]`, `/hod/candidates/new`, `/hod/shortlist/[vacancyId]`, `/hod/pipeline`, `/hod/faculty-requirement` (via requirement panel API), `/hod/settings/department-office`
- **Guard:** proxy HOD paths; APIs requireCollegeMember + HOD checks + department scope (`lib/departments/scope.ts`).

## Widgets/tables and data sources
| Page | Widgets | API | Notes |
|---|---|---|---|
| `/hod/vacancy` (+new) | My department's vacancies + requirement ratios | `api/college/vacancy-requests*`, `api/college/faculty-requirement` | cadreRatioData shown |
| `/hod/shortlist/[vacancyId]` | Candidate pool, shortlist actions | `api/college/candidates*`, `candidate-applications*` | |
| `/hod/batches` (+new, [id]) | Batch stepper (9 phases), panel assignment, venue/link config | `api/college/hiring-batches*`, `hiring-terms*` | positionCategory aware |
| `/hod/pipeline` | 5-stage board (Request→Onboarding) | PipelineBoard.tsx + getCurrentStage | detailed status labels |
| `/hod/candidates*` | Candidate dossiers | `api/college/candidates/[id]` | links `/candidate-profile/[id]` |

## Filters/scopes
- Own department only (`editableDepartmentNames`); switcher for multi-dept HODs (ACTIVE_HOD_DEPT_COOKIE).

## Permissions
- Backend: guards + scope; Frontend: navConfig roles.

## Drill-downs
- Vacancy → batch → candidate → evaluation → offer.

## Export/report
- None found on these pages `[GAP]`.

## Empty/loading/error
- DataTable shared states.

## Code evidence
- Page inventory; `hod/pipeline/PipelineBoard.tsx` (getCurrentStage referencedBy); `notify.ts` vacancy-requests callsites.
