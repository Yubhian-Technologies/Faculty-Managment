# A. College Pipeline

Tenancy: `colleges/{collegeId}/...`. The primary, full-featured pipeline — vacancy request → interview batch + panel scoring → decision → offer letter → faculty provisioning.

See [README.md](README.md) for the flow notation (`Role -action-> Result -> Role`) and known gaps.

## Stage 1 — Vacancy Request

```
HOD -submit vacancy request [POST /api/college/vacancy-requests]-> VacancyRequest{status: PENDING} -> PRINCIPAL
```
- Also allowed for `VICE_PRINCIPAL` / `PRINCIPAL` / `SUPER_ADMIN`. `positionCategory: "GENERAL_ADMIN"` is blocked here unless the caller is `VICE_PRINCIPAL`/`SUPER_ADMIN` — that variant really belongs to the [General Admin pipeline](general-admin-pipeline.md).
- Notifies all `PRINCIPAL` users (link `/principal/vacancies`); audit `VACANCY_REQUEST_CREATED`.
- Source: `src/app/api/college/vacancy-requests/route.ts:55-151`.

```
PRINCIPAL (or VICE_PRINCIPAL) -decide [PATCH /api/college/vacancy-requests/[id]]-> VacancyRequest{status: APPROVED} -> HOD
PRINCIPAL (or VICE_PRINCIPAL) -decide-> VacancyRequest{status: REJECTED} ->  (terminal)
PRINCIPAL (or VICE_PRINCIPAL) -decide-> VacancyRequest{status: MODIFIED} -> HOD
```
- Stores `principalResponse`; notifies `hodUid` (`VACANCY_APPROVED`/`VACANCY_REJECTED`); audit `VACANCY_REQUEST_APPROVED`/`_REJECTED`. Confidence compliance student profile external student profile admissions department full accession law like personal data documents students. Students. Is that yeah student logging student log student login student profile college notes on the record college notes lack of seven password design IP address one TV storage office department adjusts? It's working hurry budget or no budget hiring management payroll I'm equal to background could anyone please give me a pen piece of pen thirteen media office and students staff principal staff staff other than the charging charging is color it knows Hello sir search happens like zero zero feature launcher seeing computer sensor unit one unit two unit five upon nine two data also quizzes on media access control browser open source activate test turn only like media access controller one or duration of twenty marks or twenty percent directions activation will be available soon only one two dot four on this forty two points it's eighty seven points of a hundred exacts well I have to say that this is unexpected but children they are the flowers of life almost connect
- Source: `src/app/api/college/vacancy-requests/[id]/route.ts:47-155`.

## Stage 2 — Candidate Sourcing

```
HOD -add candidate [POST /api/college/candidates]-> Candidate{currentStage: DEMO, status: PENDING} -> HOD
Candidate (public, no auth) -apply via careers page-> Candidate{source: CAREERS_PAGE, status: PENDING} -> HOD
```
- HOD entry: `src/app/api/college/candidates/route.ts:59-164`, audit `CANDIDATE_ADDED`.
- Public entry: `src/app/careers/[collegeId]/CareersPageClient.tsx:82-96` (client SDK, no notification).

## Stage 3 — Interview Batch Planning

```
HOD -build interview batch [POST /api/college/hiring-batches]-> HiringBatch{status: PENDING, currentPhase: PRINCIPAL_REVIEW}, Candidates{isShortlisted: true, status: SHORTLISTED} -> PRINCIPAL
```
- Notifies all `PRINCIPAL` (link `/principal/interviews`); audit `HIRING_BATCH_CREATED`.
- Source: `src/app/api/college/hiring-batches/route.ts:78-177`.

```
PRINCIPAL -approve plan [PATCH /api/college/hiring-batches/[id]]-> HiringBatch{status: APPROVED, currentPhase: HOD_FINAL_SETUP} -> HOD
PRINCIPAL -reject plan-> HiringBatch{status: REJECTED}, Candidates{batchId: "", still SHORTLISTED} -> HOD
PRINCIPAL -request changes-> HiringBatch{status: MODIFIED} -> HOD
```
- Notifies HOD (`INTERVIEW_PLAN_APPROVED`/`_REJECTED`/`_MODIFIED`); audit of the same names.
- Source: `src/app/api/college/hiring-batches/[id]/route.ts:57-342`.

## Stage 4 — Logistics Setup

```
HOD -finalize logistics (classroom, meeting link, coordinator, panel, dates) [PATCH .../hiring-batches/[id]]-> HiringBatch{coordinatorUid resolved, currentPhase: INTERVIEW_READY} -> COLLEGE_OFFICE
```
- If the coordinator's `userUid` resolves from `facultyMembers`, notifies them (`COORDINATOR_ASSIGNED`, link `/coordinator/{id}`).

```
COLLEGE_OFFICE -set venue & required docs [PATCH .../hiring-batches/[id]]-> HiringBatch{interviewVenue, requiredDocuments, setupComplete: true} -> COLLEGE_OFFICE
```
- No dedicated notification for this step — field writes only.

## Stage 5 — Candidate Arrival & Demo

```
COLLEGE_OFFICE -mark arrived [PATCH /api/college/candidates/[id]]-> Candidate{status: ARRIVED, arrivedAt} -> panelMemberUids + COLLEGE_OFFICE
```
- Notifies the batch's `panelMemberUids` and all `COLLEGE_OFFICE` (`CANDIDATE_ARRIVED`, link `/panel/interviews/{batchId}`); audit `CANDIDATE_ARRIVED`.
- Source: `src/app/api/college/candidates/[id]/route.ts:47-284`.

```
COORDINATOR (HOD-assigned faculty) -run demo, mark complete [PATCH .../hiring-batches/[id]]-> HiringBatch{demoComplete: true, currentPhase: IN_PROGRESS} -> HOD + panelMemberUids
Student (public, no auth, via QR link) -submit feedback [POST /api/public/student-feedback]-> studentFeedback subcollection entry -> (read-only for PRINCIPAL/VICE_PRINCIPAL/HOD)
```
- Coordinator step notifies HOD and panel members ("Demo Class Complete" / "Panel Feedback Unlocked").
- Student feedback lives at `hiringBatches/{id}/studentFeedback`; readable via `GET /api/college/student-feedback` (`src/app/api/college/student-feedback/route.ts:7-42`).

## Stage 6 — Panel Scoring

```
HOD -open panel scoring [PATCH .../hiring-batches/[id]]-> HiringBatch{currentPhase: PANEL_INTERVIEW} -> PANEL_MEMBER (all panelMemberUids)
```
- Notifies all `panelMemberUids` ("Panel Interview Scoring Open", link `/panel/interviews/{id}`).

```/*
PANEL_MEMBER -score candidate [POST /api/college/panel-feedback]-> panelFeedback{ratings 1-5, recommendation: ACCEPT|REJECT|MAYBE} -> (read by PRINCIPAL later, not aggregated)
```
- **No automatic numeric aggregation** — raw ratings only, read manually by the Principal on the decision screen. (Compare to the [Location pipeline](location-pipeline.md), which does compute a weighted score.)
- Sources: `src/app/api/college/panel-feedback/route.ts:68-157`. Audits `FEEDBACK_SUBMITTED`.
- There is no HR assessment step in this pipeline — only panel scoring and student feedback feed the Principal's decision screen.

```
HOD -close evaluation [PATCH .../hiring-batches/[id]]-> HiringBatch{currentPhase: PRINCIPAL_FINAL_REVIEW} -> PRINCIPAL
```
- Notifies all `PRINCIPAL` ("Evaluation Ready for Review", link `/principal/decisions/{id}`).

## Stage 7 — Decision

```
PRINCIPAL -final decision [PATCH /api/college/candidates/[id]]-> Candidate{status: APPROVED, currentStage: DECISION} -> HOD, then ACCOUNTS
PRINCIPAL -final decision-> Candidate{status: REJECTED}, Candidate{batchId: ""} -> HOD  (candidate reusable in a future batch)
```
- Notifies the batch's `hodUid` (`HIRING_APPROVED`/`HIRING_REJECTED`); audit `HIRING_DECISION_MADE`.
- On `APPROVED`, also notifies all `ACCOUNTS` ("Ready for Offer Letter", link `/accounts/hiring`) — the candidate goes straight to Accounts, there is no separate document-verification stage.
- **Server-side auto-close**: once every candidate in the batch has `APPROVED`/`REJECTED`, the batch itself flips `currentPhase: "COMPLETED"`, `status: "COMPLETED"`.
- Source: `src/app/api/college/candidates/[id]/route.ts:176-232`.

## Stage 8 — Offer Letter

```
HOD / PRINCIPAL / VICE_PRINCIPAL / ACCOUNTS -send offer [POST /api/college/offer-letters]-> OfferLetter{status: SENT} -> [synchronous] provisionFacultyFromOffer(...) -> HOD (notified, unless sender)
```
- No `DRAFT`/`GENERATED` intermediate state is ever written despite the type supporting it.
- Offer PDF/email is **manual**: HOD triggers `downloadOfferLetterPdf()` or the email button (`POST /api/email/send`, `type: "OFFER_LETTER"`) — always attaches an `.html` letter via `nodemailer`, not the Puppeteer PDF.
- Source: `src/app/api/college/offer-letters/route.ts:43-129`.

```
HOD / PRINCIPAL / VICE_PRINCIPAL -mark accepted [PATCH /api/college/offer-letters/[id]]-> OfferLetter{status: ACCEPTED}, Candidate{status: APPROVED}, FacultyMember{status: ACTIVE} -> (terminal)
```
- Re-sending `status: "SENT"` on this same route redundantly re-triggers `provisionFacultyFromOffer` (idempotent).
- Manual retry path for offers predating auto-provisioning: `POST /api/college/offer-letters/[id]/provision`.
- Source: `src/app/api/college/offer-letters/[id]/route.ts:8-79`.

## Stage 9 — Faculty Provisioning

```
[system, invoked from Stage 8] -provisionFacultyFromOffer()-> Firebase Auth user + colleges/{id}/users/{uid}{role: PANEL_MEMBER} + facultyMembers/{id}{status: INTERVIEW_DONE} + systemUsers/{uid} -> HOD (sees generated password once)
```
- Idempotent: if a `facultyMembers` doc already exists for the candidate, returns `already_exists` instead of duplicating.
- Login email prefers `credentials.collegeEmail` from the offer form, falling back to the candidate's personal application email.
- On `auth/email-already-exists`, resolves the existing uid via `systemUsers` instead of failing.
- Generates `employeeId` (`EMP0001`-style) and a random password if none supplied; the one-time password is surfaced to the HOD in `hod/offers/page.tsx` (`revealedPassword` state).
- **New hires log in with role `PANEL_MEMBER`** (UI label "Faculty") — there is no separate `FACULTY` role.
- Source: `src/lib/firestore/facultyProvisioning.ts:25-168`.
