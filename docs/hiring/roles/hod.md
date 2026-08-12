# HOD — College Hiring Role

See [../college-pipeline.md](../college-pipeline.md) for the full sequence this fits into, and [../README.md](../README.md) for the flow notation.

## Scope & pipeline position

HOD is where the college pipeline **starts and drives the middle stages**: it originates the vacancy request, sources and shortlists candidates, builds the interview batch/panel proposal, and runs logistics through to demo day and panel scoring. HOD hands off to `PRINCIPAL`/`VICE_PRINCIPAL` twice (vacancy approval, batch approval) and once more at the final hire/reject decision; it hands off to `COLLEGE_OFFICE` for offer letters onward. An HOD who is also listed as a panelist scores through the same panel-feedback route as any other `PANEL_MEMBER`.

## Pages

`src/app/(dashboard)/hod/...`
- `vacancy/page.tsx`, `vacancy/new/page.tsx` — list / raise vacancy requests
- `pipeline/page.tsx` (+ `PipelineBoard.tsx`) — 5-stage board: Request → Candidates → Interview → Decision → Onboarding
- `candidates/page.tsx`, `candidates/new/page.tsx`, `candidates/[id]/page.tsx` — candidate pool
- `shortlist/[vacancyId]/page.tsx` — tick candidates to shortlist
- `batches/page.tsx`, `batches/new/page.tsx`, `batches/[id]/page.tsx` — interview batch creation/management (this is also where the candidate-form link is copied — see Stage 3 of the full flow)

## Actions

| Action | API call | Allowed roles (guard) | Effect | Notifications / audit |
|---|---|---|---|---|
| Raise vacancy request | `POST /api/college/vacancy-requests` | `HOD, PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN` | `VacancyRequest{status: PENDING}` | Notifies all `PRINCIPAL`; audit `VACANCY_REQUEST_CREATED` |
| Delete own vacancy request | `DELETE /api/college/vacancy-requests/[id]` | `HOD, PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN` (HOD limited to own) | Blocked if a batch/application already references it | audit `VACANCY_REQUEST_DELETED` |
| Add candidate to pool | `POST /api/college/candidates` | `HOD, PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN` | `Candidate{source: WALK_IN}` | audit `CANDIDATE_ADDED` |
| Attach candidate to vacancy | `POST /api/college/candidate-applications` | same, HOD restricted to own department's `APPROVED` vacancies | `CandidateApplication{currentStage: DEMO, status: PENDING}`; 409 if candidate already actively attached elsewhere | audit `CANDIDATE_APPLICATION_CREATED` |
| Shortlist candidates | `PATCH /api/college/candidate-applications/[id]` (`isShortlisted`) | HOD or Principal-tier | — | — |
| Copy candidate bio-data form link | (client-side only, no API) | — | Candidate receives `/candidate-form/[collegeId]/[candidateId]` link out-of-band — **not auto-emailed** | — |
| Create interview batch / panel proposal | `POST /api/college/hiring-batches` | `HOD, SUPER_ADMIN` only | `HiringBatch{status: PENDING, currentPhase: PRINCIPAL_REVIEW}`, applications set `{isShortlisted: true, status: SHORTLISTED}`; transactional double-book guard | Notifies all `PRINCIPAL`; audit `HIRING_BATCH_CREATED` |
| Finalize logistics (venue not included — that's Office; classroom, meeting link, coordinator, panel, date/time) | `PATCH /api/college/hiring-batches/[id]` | owning HOD or Principal-tier | Sets fields, resolves `coordinatorFacultyId` | Notifies coordinator if they have a login (`COORDINATOR_ASSIGNED`) |
| Advance phase `HOD_FINAL_SETUP → INTERVIEW_READY` | `PATCH .../hiring-batches/[id]` (`currentPhase`) | HOD-only, one-step transition, server-enforced | — | — |
| Send interview call letters | client-side Gmail compose only (`sendCallLetter()`) | — | No server record | CC's Principal/VP/College Office/panel |
| Mark candidate arrived | `PATCH /api/college/candidate-applications/[id]` (`hasArrived`) | HOD, `PANEL_MEMBER`, or Principal-tier | `{status: ARRIVED, arrivedAt}` | Notifies panel + `COLLEGE_OFFICE`; audit `CANDIDATE_ARRIVED` |
| Advance phase `IN_PROGRESS → PANEL_INTERVIEW` (open scoring) | `PATCH .../hiring-batches/[id]` | HOD-only, one-step | — | Notifies all panelists |
| Submit own panel score (if also a panelist) | `POST /api/college/panel-feedback` | `PANEL_MEMBER, PRINCIPAL, VICE_PRINCIPAL, HOD, SUPER_ADMIN` | Upserted `panelFeedback` doc | audit `FEEDBACK_SUBMITTED` |
| Advance phase `PANEL_INTERVIEW → PRINCIPAL_FINAL_REVIEW` (close evaluation) | `PATCH .../hiring-batches/[id]` | HOD-only, one-step | — | Notifies all `PRINCIPAL` |
| Edit panel roster / interview date before scoring locks | `PATCH .../hiring-batches/[id]` | owning HOD or Principal-tier | — | — |

## Notes

- HOD is **never** the approver of their own vacancy request or batch proposal — both always require a Principal-tier decision.
- The three `currentPhase` advances above (`HOD_FINAL_SETUP→INTERVIEW_READY`, `IN_PROGRESS→PANEL_INTERVIEW`, `PANEL_INTERVIEW→PRINCIPAL_FINAL_REVIEW`) are validated server-side against a hardcoded one-step map — HOD cannot skip a phase.
- After the final decision (Stage 8 of the full flow), HOD only receives notifications (`HIRING_APPROVED`/`_REJECTED`) — offer letters, appointment letters, document verification, and provisioning are all owned by `COLLEGE_OFFICE`/`PRINCIPAL`/`WEBMASTER` from there on.
