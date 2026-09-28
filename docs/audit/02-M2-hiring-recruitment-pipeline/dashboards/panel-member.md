# Dashboard — PANEL_MEMBER (M2 surfaces) (`/panel`, `/coordinator`, `/evaluation`)

- **Role:** PANEL_MEMBER + any role added to a batch panel (Principal/VP/HOD locked in; Accounts/College Office/College Accounts reachable per proxy shared paths)
- **M2 pages:** `/panel/interviews`, `/panel/interviews/[id]`, `/coordinator/[batchId]`, `/evaluation/[batchId]/[candidateId]`, `/candidate-profile/[id]` (read-only dossier)
- **Guard:** proxy PANEL_INTERVIEWS_PATH/EVALUATION_PATH sharing (proxy.ts:35-44); APIs college guards + panel membership `[UNVERIFIED]`.

## Widgets/tables
| Page | Widgets | API | Notes |
|---|---|---|---|
| `/panel/interviews` | "My Interviews" list (Sidebar-injected dynamic item for non-embedded roles — navConfig ROLES_WITH_EMBEDDED_PANEL_ACCESS:45-51) | `api/college/hiring-batches?mine` `[UNVERIFIED param]` | |
| `/evaluation/[batchId]/[candidateId]` | Demo sheet + panel sheet forms | `api/college/panel-feedback` | optional criteria tolerated |
| `/coordinator/[batchId]` | Session runner (QR) | `api/college/hiring-batches/[id]` | phase IN_PROGRESS |
| `/candidate-profile/[id]` | Dossier: scores, docs, timeline | `api/college/candidates/[id]` | shared HOD/Principal/CO |

## Filters/scopes
- Own panel assignments only.

## Permissions
- Backend: college member + (assumed) panel uid membership; Frontend: nav + proxy shared paths.

## Drill-downs
- Interview → candidate profile → score form.

## Export
- Candidate profile print `[UNVERIFIED]`.

## Code evidence
- proxy.ts:35-44; navConfig.ts:45-51; evaluation/coordinator routes.
