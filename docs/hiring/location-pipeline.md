# B. Location Pipeline

Tenancy: `locations/{locationId}/...`. A simpler, linear approval chain — no hiring batches, no panel-scoring machinery, no auto-close. **Dead-ends at offer approval — never provisions a faculty account** (see [README.md](README.md)).

See [README.md](README.md) for the flow notation (`Role -action-> Result -> Role`).

## Stage 1 — Vacancy Request

```
LOCATION_DEPT_HEAD -submit vacancy request [POST /api/location/vacancy-requests]-> VacancyRequest{status: PENDING_HR} -> HR_ADMIN
```
- Notifies all `HR_ADMIN` in the location (`type: "VACANCY_REQUEST"`, link `/hr-admin/vacancies`).
- Source: `src/app/api/location/vacancy-requests/route.ts:54-143`.

```
HR_ADMIN -forward [PATCH /api/location/vacancy-requests/[id], action: FORWARD]-> VacancyRequest{status: PENDING_ADMIN, forwardedByUid/Name} -> ADMINISTRATION
HR_ADMIN -reject [action: REJECT]-> VacancyRequest{status: REJECTED, hrResponse} -> LOCATION_DEPT_HEAD (terminal)
```
- Forward notifies all `ADMINISTRATION` (link `/administration/vacancies`) + the dept head (`VACANCY_FORWARDED`).
- Source: `src/app/api/location/vacancy-requests/[id]/route.ts:47-150`.

```
ADMINISTRATION -approve [PATCH .../vacancy-requests/[id]]-> VacancyRequest{status: APPROVED, administrationResponse} -> HR_ADMIN
ADMINISTRATION -reject-> VacancyRequest{status: REJECTED, administrationResponse} -> HR_ADMIN (terminal)
```
- Notifies the forwarding `HR_ADMIN` and the dept head (`VACANCY_APPROVED`/`VACANCY_REJECTED`).
- Source: `src/app/api/location/vacancy-requests/[id]/route.ts:152-220`.

## Stage 2 — Candidates

```
HR_ADMIN or LOCATION_DEPT_HEAD -add candidate [POST /api/location/candidates]-> Candidate{status: PENDING} -> HR_ADMIN
```
- Source: `src/app/api/location/candidates/route.ts:32-84`.

```
HR_ADMIN -shortlist [PATCH /api/location/candidates/[id], action: SHORTLIST]-> Candidate{status: SHORTLISTED} -> HR_ADMIN
HR_ADMIN -reject [action: REJECT_CANDIDATE]-> Candidate{status: REJECTED} -> (terminal)
Candidate (public, no auth, via /location-interview/[id]) -submit bio data [PATCH same route]-> Candidate{bioDataSubmitted: true} -> HR_ADMIN
HR_ADMIN or ADMINISTRATION -update status (SELECTED, OFFER_PENDING, ...) [PATCH same route]-> Candidate{status: <value>} -> next stage
```
- Note: candidate `status` is a free-form string set ad hoc by the caller, not a closed enum in code.
- Source: `src/app/api/location/candidates/[id]/route.ts:35-89`.

## Stage 3 — Interview

```
HR_ADMIN -create interview plan [POST /api/location/interviews]-> Interview{status: PENDING_ADMIN} -> ADMINISTRATION
```
- Notifies all `ADMINISTRATION` (`INTERVIEW_PLAN_PENDING`, link `/administration/interviews/{id}`).
- Source: `src/app/api/location/interviews/route.ts:50-141`.

```
ADMINISTRATION -approve [PATCH /api/location/interviews/[id], action: APPROVE]-> Interview{status: APPROVED} -> HR_ADMIN
ADMINISTRATION -reject [action: REJECT]-> Interview{status: REJECTED} -> HR_ADMIN (terminal)
```
- Notifies all `HR_ADMIN` (`INTERVIEW_PLAN_APPROVED`/`_REJECTED`).
- Source: `src/app/api/location/interviews/[id]/route.ts:97-143`.

```
HR_ADMIN -send call letters [PATCH .../interviews/[id], action: SEND_CALL_LETTERS]-> Candidates{callLetterSent: true} -> panel members
```
- Notifies each panel member (`INTERVIEW_PLAN_APPROVED`, link `/location-dept-head/interviews/{id}`). Source lines 145-184.

```
Panel member (ADMINISTRATION / HR_ADMIN / LOCATION_DEPT_HEAD) -submit feedback [action: SUBMIT_FEEDBACK]-> feedback{panelScore, studentScore, overallScore, recommendation: SELECTED|REJECTED|WAITLISTED} -> HR_ADMIN
```
- **This is the one place in either pipeline where a numeric composite score is computed in code**: `panelScore = (Σ 5 panel criteria / 25) * 70`, `studentScore = (Σ 5 student criteria / 25) * 30`, `overallScore = panelScore + studentScore`. Upserted per candidate per panelist into `locationInterviews/{id}/feedback`. Source lines 186-259.

```
HR_ADMIN -mark complete [action: MARK_COMPLETE]-> Interview{status: COMPLETED} -> HR_ADMIN
```
- Source lines 262-268.

## Stage 4 — Offer (terminal — no provisioning)

```
HR_ADMIN -create offer [POST /api/location/offers]-> Offer{status: PENDING_ADMIN}, Candidate{status: OFFER_PENDING} -> ADMINISTRATION
```
- Notifies all `ADMINISTRATION` (`OFFER_LETTER_GENERATED`, link `/administration/offers/{id}`).
- Source: `src/app/api/location/offers/route.ts:39-130`.

```
ADMINISTRATION -approve [PATCH /api/location/offers/[id]]-> Offer{status: APPROVED}, Candidate{status: OFFER_SENT} -> HR_ADMIN (terminal — nothing downstream)
ADMINISTRATION -reject-> Offer{status: REJECTED}, Candidate{status: SELECTED} -> HR_ADMIN (terminal)
```
- Notifies all `HR_ADMIN` (`OFFER_LETTER_GENERATED`).
- Source: `src/app/api/location/offers/[id]/route.ts:35-128`.
- **Confirmed gap**: no route under `src/app/api/location/` calls `provisionFacultyFromOffer` (verified by repo-wide grep — only College-pipeline files reference it). No Firebase Auth account, no `locations/{id}/locationUsers/{uid}` profile, no faculty record is ever created here. If a location-sourced hire needs a system account, someone must create it through the College pipeline or manually.

## Notifications & audit

Uses an ad-hoc `locations/{id}/locationNotifications` shape whose `type` values (`"VACANCY_REQUEST"`, `"VACANCY_FORWARDED"`, `"INTERVIEW_PLAN_PENDING"`, ...) are **not** members of the `NotificationType` union in `src/types/core.ts`. **No `auditLogs`/`locationAuditLogs` writes exist anywhere under `src/app/api/location/`** — this pipeline has no audit trail at all, unlike the [College pipeline](college-pipeline.md).
