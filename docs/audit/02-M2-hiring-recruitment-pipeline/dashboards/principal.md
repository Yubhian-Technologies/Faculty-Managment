# Dashboard — PRINCIPAL (M2 surfaces) (`/principal`)

- **M2 pages (of 90):** vacancies (+[id]/approve, [id]/reject, department/[department], general-admin), interviews (+[id]), negotiate/[id], decisions/[id], appointment-letters

## Widgets/data sources
| Page | Widgets | API |
|---|---|---|
| `/principal/vacancies` | PrincipalPipelineBoard (5-stage stepper + detailed status) | `vacancy-requests*`, `getCurrentStage` |
| `/principal/vacancies/[id]/approve|reject` | Decision forms (principalResponse) | `vacancy-requests/[id]` PATCH |
| `/principal/vacancies/general-admin` | General-admin vacancy oversight | `admin/general-admin-vacancies*` |
| `/principal/negotiate/[id]` | Salary terms negotiation (terms snapshots) | offer-letters/hiring-terms |
| `/principal/decisions/[id]` | Final decision record | `[UNVERIFIED route detail]` |

## Filters/scopes
- College-wide; department summary view (`PrincipalDepartmentSummary.tsx`).

## Permissions
- Approve/return vacancies; final decisions; locked into every panel (notify.ts:44-53).

## Code evidence
- Page inventory; hiringPipeline referencedBy (PrincipalPipelineBoard).
