# M2 — Hiring & Recruitment Pipeline (as-is)

## Purpose
End-to-end staffing: department vacancy requests → principal approval → hiring batch execution (demo + panel interview) → offer letters (candidate self-acceptance) → appointment letters → faculty/supporting-staff account provisioning. Location-level hiring for non-teaching staff runs a parallel simpler flow (`api/location/*`).

## Status: Implemented — the largest module (most routes + pages).

## Submodules
| ID | Submodule | Status |
|---|---|---|
| M2-SM1 | Vacancy Requests (college + location + general-admin) | Implemented |
| M2-SM2 | Candidates & Applications | Implemented |
| M2-SM3 | Interviews & Panel Scoring (demo + panel, online/offline) | Implemented |
| M2-SM4 | Offer Letters & Acceptance (+CC, terms snapshots) | Implemented |
| M2-SM5 | Credential Requests (office→webmaster account handoff) | Implemented |
| M2-SM6 | Hiring Batches & Terms (execution shell) | Implemented |

## Dashboards / roles served
HOD (`/hod/*` 86 pages incl. batches/candidates/shortlist/pipeline), Principal (`/principal/vacancies*`, board), VP shares principal paths, College Office (49 pages: candidates/offers/documents/pipeline), HR Admin (13), Admin Office (5), Administration (20, location hiring), Location Dept Head (19), Accounts (11: pipeline/hiring), College Accounts (9), Panel Member (28: interviews/evaluation/coordinator), Super Admin (`/super-admin/vacancies`), Webmaster (credential requests).

## Dependencies
- Depends on M1 (users, roles/panels, webmaster accounts), M3 (subjects for requirement ratios), M7 (accounts CTC/salary downstream), M10 (public forms ingress), M9 (notifications).
- Depended on by M1 (faculty provisioning creates users), M3/M4/M5 (provisioned faculty enter academic modules), M7 (salary structures applied to hires).

## Key code locations
- Types: `src/types/recruitment.ts` (564 lines: VacancyRequest:14, Candidate:~86, CandidateApplication:229, BatchPhase:284, HiringBatch:305, PanelFeedback:359, OfferLetter:458, AppointmentLetter:492, FacultyAccountRequest:538), `src/types/core.ts:268` (WorkflowStatus).
- Pipeline logic: `src/lib/hiringPipeline.ts` (5-stage stepper `getCurrentStage`:11-19; detailed status machine `getDetailedHiringStatus`:66-97).
- Libs: `src/lib/firestore/hiring.ts`, `offerLetterDecision.ts`, `offerLetterCc.ts`, `facultyProvisioning.ts`, `src/lib/offerLetterContactBlock.ts`.
- API: `api/college/vacancy-requests*`, `candidates*`, `candidate-applications*`, `hiring-batches*`, `hiring-terms*`, `panel-feedback`, `offer-letters*`, `appointment-letters`, `faculty-account-requests*`, `email-requests*`, `api/location/*` (hiring subset), `api/admin/general-admin-vacancies*`, `api/public/candidate-form`, `offer-acceptance`.
- UI: dashboard roots listed in module-map.md; boards: `PipelineBoard.tsx`, `PrincipalPipelineBoard.tsx`, `OfficePipelineBoard.tsx`, `AccountsPipelineBoard.tsx`, `CollegeAccountsHiringBoard.tsx` (all consume `getCurrentStage`).

## Key APIs / stores / jobs
- APIs above; stores: `vacancyRequests`, `candidates`, `candidateApplications`, `hiringBatches`, `hiringTerms`, `hiringBatches/{id}/panelFeedback` (subcollection), `offerLetters`, `appointmentLetters`, `facultyAccountRequests`, `emailRequests`, `facultyMembers` (output).
- Jobs: none scheduled; all flows synchronous + notifications.

## Major gaps
1. Panel feedback double-submit concurrency `[UNVERIFIED]` — doc id per (candidate,panelist) suggests idempotent overwrite.
2. Public offer-acceptance token entropy/rate-limit `[UNVERIFIED]`.
3. Demo stage skipped for SUPPORTING_STAFF/ONLINE batches (positionCategory) — document parity check for location hiring.
4. `studentFeedback` collection listed in indexes but demo-feedback gating for ONLINE mode unclear `[UNVERIFIED]`.
