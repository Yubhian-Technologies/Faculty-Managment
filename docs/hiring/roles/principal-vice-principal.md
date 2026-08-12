# Principal / Vice-Principal — College Hiring Role

See [../college-pipeline.md](../college-pipeline.md) for the full sequence this fits into, and [../README.md](../README.md) for the flow notation.

`PRINCIPAL` and `VICE_PRINCIPAL` are documented together because the code treats them as interchangeable: every college-pipeline API guard that lists one lists the other (`requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", ...)`), and `src/proxy.ts` grants `VICE_PRINCIPAL` the entire `/principal/*` route tree — that's where all real hiring work for both roles happens. `vice-principal/page.tsx` itself is just a landing page with no hiring content. The one real divergence: VP gets its own distinct nav entry for General Admin Vacancies (`navConfig.ts`), noted below.

## Scope & pipeline position

This is the pipeline's **approval gate**, sitting at three separate points: vacancy-request approval, interview-batch approval, and the final hire/reject decision (with salary negotiation folded in). It also owns appointment-letter generation later in the flow, and is one of the roles allowed to send offer letters and manage document verification, though those are more commonly done by `COLLEGE_OFFICE`.

## Pages

`src/app/(dashboard)/principal/...` (shared by both roles via proxy path grants)
- `vacancies/page.tsx` (+ `ActionQueueView.tsx`, `PrincipalPipelineBoard.tsx`, `PrincipalDepartmentSummary.tsx`), `vacancies/[id]/approve/page.tsx`, `vacancies/[id]/reject/page.tsx`
- `vacancies/general-admin/page.tsx` — General Admin vacancy requests (own nav entry for VP)
- `interviews/page.tsx`, `interviews/[id]/page.tsx` — batch approval
- `negotiate/[id]/page.tsx` — salary/terms negotiation
- `decisions/[id]/page.tsx` — final hire/reject decision
- `appointment-letters/page.tsx`
- `settings/page.tsx` (`HiringTermsSettingsCard`) — reusable T&C template library

## Actions

| Action | API call | Guard | Effect | Notifications / audit |
|---|---|---|---|---|
| Approve/reject vacancy request | `PATCH /api/college/vacancy-requests/[id]` | `PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN` | `VacancyRequest{status: APPROVED\|REJECTED\|MODIFIED}` + `principalResponse`; terminal 409 on re-decision | Notifies HOD; audit `VACANCY_REQUEST_APPROVED`/`_REJECTED` |
| Approve/reject interview-batch proposal | `PATCH /api/college/hiring-batches/[id]` | `PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN`, only while `currentPhase === PRINCIPAL_REVIEW` | `APPROVED` auto-advances phase to `HOD_FINAL_SETUP`; `REJECTED` frees all applications' `batchId` | Notifies HOD; audit matching name |
| Manage hiring-terms templates | `POST/PATCH /api/college/hiring-terms` | `PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN` | `hiringTermsTemplates` CRUD | — |
| Negotiate salary/terms | `PATCH /api/college/candidate-applications/[id]` | Principal-tier only | `{expectedSalary, negotiatedSalary, dateOfJoining, termsAndConditions[]}` — must be set before the decision can be `APPROVED` | — |
| Final hire/reject decision | `PATCH /api/college/candidate-applications/[id]` | `HOD, PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN` (status/stage/committeeRecommendation fields are Principal-tier-only in practice), only opens in UI once `currentPhase === PRINCIPAL_FINAL_REVIEW` | `{status: APPROVED\|REJECTED, stage: DECISION, committeeRecommendation}`; terminal 409 on re-decision; `APPROVED` decrements vacancy `requiredCount` | Notifies HOD (`HIRING_APPROVED`/`_REJECTED`) and, on `DECISION`+not-rejected, `COLLEGE_OFFICE`; audit `HIRING_DECISION_MADE` |
| Send offer letter | `POST /api/college/offer-letters` | `COLLEGE_OFFICE, PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN, ACCOUNTS` | Gated on candidate bio-data submitted; `OfferLetter{status: SENT}` | Notifies HOD unless sender |
| Generate & release appointment letter | `POST /api/college/appointment-letters` | `PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN` only | `AppointmentLetter{status: SENT}`; PDF download + Gmail-compose client-side | audit `APPOINTMENT_LETTER_GENERATED` |
| Verify documents / mark offer accepted (staff override) | `PATCH /api/college/candidate-applications/[id]`, `PATCH /api/college/offer-letters/[id]` | `COLLEGE_OFFICE` or Principal-tier | `documentVerification`, or `applyOfferDecision()` transaction | audit `DOCUMENTS_VERIFIED` |
| Raise General Admin vacancy request (bypasses HOD) | `POST /api/admin/general-admin-vacancies` | `PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN` | Goes straight to `SUPER_ADMIN` for approval — see [general-admin-pipeline.md](../general-admin-pipeline.md) | — |

## Notes

- Principal and VP are **co-approvers, not sequential** — either one alone can approve/reject/decide at every gate; the code never requires both to sign off.
- The final decision route technically also lists `HOD` in its guard, but the status/stage/salary/committee fields it actually writes are gated Principal-tier-only inside the handler — HOD's presence in the guard only covers the other, non-decision fields the same route handles (arrival, shortlisting, document verification, etc. — see [college-office.md](college-office.md) and [hod.md](hod.md)).
