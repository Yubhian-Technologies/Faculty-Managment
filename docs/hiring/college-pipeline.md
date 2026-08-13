# A. College Pipeline

Tenancy: `colleges/{collegeId}/...`. The primary, full-featured pipeline — vacancy request → candidate sourcing → interview batch + panel scoring → decision → offer letter → candidate response → appointment letter → document verification → faculty account provisioning.

See [README.md](README.md) for the flow notation (`Role -action-> Result -> Role`) and known gaps. Per-role breakdowns of everything below live under [roles/](roles/) — this doc is the end-to-end sequence; the role docs are "what does *this* role see and do."

All routes here use `requireCollegeMember(...)` (`src/lib/auth/verifySession.ts`) and talk to Firestore directly via the Admin SDK (`getAdminDb()`). `src/lib/firestore/hiring.ts` / `src/hooks/useHiring.ts` are **not** part of this — see the README's "known gaps" section.

## Stage 1 — Vacancy Request

```
HOD -submit vacancy request [POST /api/college/vacancy-requests]-> VacancyRequest{status: PENDING} -> PRINCIPAL
```
- Also allowed for `VICE_PRINCIPAL` / `PRINCIPAL` / `SUPER_ADMIN`. `positionCategory: "GENERAL_ADMIN"` is blocked here unless the caller is `VICE_PRINCIPAL`/`SUPER_ADMIN` — that variant belongs to the [General Admin pipeline](general-admin-pipeline.md), not this one.
- Notifies all `PRINCIPAL` users (link `/principal/vacancies`); audit `VACANCY_REQUEST_CREATED`.
- Source: `src/app/api/college/vacancy-requests/route.ts:55-151`.

```
PRINCIPAL (or VICE_PRINCIPAL) -decide [PATCH /api/college/vacancy-requests/[id]]-> VacancyRequest{status: APPROVED} -> HOD
PRINCIPAL (or VICE_PRINCIPAL) -decide-> VacancyRequest{status: REJECTED} ->  (terminal)
PRINCIPAL (or VICE_PRINCIPAL) -decide-> VacancyRequest{status: MODIFIED} -> HOD
```
- Stores `principalResponse`; notifies `hodUid` (`VACANCY_APPROVED`/`VACANCY_REJECTED`); audit `VACANCY_REQUEST_APPROVED`/`_REJECTED`.
- **Terminal guard**: once `APPROVED`/`REJECTED`, a differing status on a second PATCH is rejected with 409 (protects against a stale tab re-deciding).
- Source: `src/app/api/college/vacancy-requests/[id]/route.ts:47-168`.

## Stage 2 — Candidate Sourcing

```
HOD -add candidate [POST /api/college/candidates]-> Candidate{source: WALK_IN, ...} -> HOD
HOD -attach candidate to vacancy [POST /api/college/candidate-applications]-> CandidateApplication{currentStage: DEMO, status: PENDING} -> HOD
Candidate (public, no auth) -apply via careers page-> Candidate{source: CAREERS_PAGE}, CandidateApplication{...} -> HOD
```
- Also allowed for `PRINCIPAL` / `VICE_PRINCIPAL` / `SUPER_ADMIN`. HOD is restricted to their own department's `APPROVED` vacancies.
- **A candidate may only have one active (non-`REJECTED`) application at a time** — enforced server-side (409 if already actively attached elsewhere).
- Staff entry: `src/app/api/college/candidates/route.ts:59-164` (audit `CANDIDATE_ADDED`), `src/app/api/college/candidate-applications/route.ts:61-169` (audit `CANDIDATE_APPLICATION_CREATED`).
- Public entry: `src/app/careers/[collegeId]/CareersPageClient.tsx:82-96` — client-SDK writes directly (bypasses these API routes entirely), no server-side notification or audit log. Lists only vacancies with `status === "APPROVED"`.

## Stage 3 — Bio-Data & Certificates

```
HOD -copy candidate-form link (manual, not emailed)-> (candidate receives link out-of-band)
Candidate (public, no auth) -submit bio-data + certificates [PATCH /api/public/candidate-form/[collegeId]/[candidateId]]-> Candidate{bioDataSubmitted: true, bioData, certificates[]} -> (gates Stage 9)
```
- The link (`/candidate-form/[collegeId]/[candidateId]?applicationId=...`) is generated client-side and copied to the clipboard by the HOD on the batch page (`copyFormLink()`, `src/app/(dashboard)/hod/batches/[id]/page.tsx:376-378`) — **no server code auto-sends it**.
- `GET`/`PATCH /api/public/candidate-form/[collegeId]/[candidateId]/route.ts:7-89` — security is by unguessable candidate/application ID pair, not a token.
- The form itself (`src/app/candidate-form/[collegeId]/[candidateId]/page.tsx`) collects father/mother name, DOB, gender, Aadhaar/PAN, qualifications, work experience, research profile, and uploads certificate files directly to Storage client-side.
- **`bioDataSubmitted: true` is a hard gate on offer-letter creation** (Stage 9) — this can happen any time before the offer is sent, in practice usually run in parallel with Stages 4-8.

## Stage 4 — Interview Batch Planning

```
HOD -build interview batch [POST /api/college/hiring-batches]-> HiringBatch{status: PENDING, currentPhase: PRINCIPAL_REVIEW}, CandidateApplications{isShortlisted: true, status: SHORTLISTED} -> PRINCIPAL
```
- HOD-only (plus `SUPER_ADMIN`). Runs inside a Firestore transaction that re-checks none of the selected applications are already batched — prevents two racing tabs double-booking the same shortlisted candidate.
- Notifies all `PRINCIPAL`; audit `HIRING_BATCH_CREATED`.
- Source: `src/app/api/college/hiring-batches/route.ts:78-201`.

```
PRINCIPAL (or VICE_PRINCIPAL) -approve plan [PATCH /api/college/hiring-batches/[id]]-> HiringBatch{status: APPROVED, currentPhase: HOD_FINAL_SETUP} -> HOD
PRINCIPAL (or VICE_PRINCIPAL) -reject plan-> HiringBatch{status: REJECTED}, CandidateApplications{batchId: "", still SHORTLISTED} -> HOD
PRINCIPAL (or VICE_PRINCIPAL) -request changes-> HiringBatch{status: MODIFIED} -> HOD
```
- Only allowed while `currentPhase === "PRINCIPAL_REVIEW"`. Notifies HOD (`INTERVIEW_PLAN_APPROVED`/`_REJECTED`/`_MODIFIED`); audit of the same names.
- Source: `src/app/api/college/hiring-batches/[id]/route.ts:57-418`.

## Stage 5 — Logistics Setup

```
HOD -finalize logistics (demo classroom, meeting link, coordinator, panel, interview date/time) [PATCH .../hiring-batches/[id]]-> HiringBatch{coordinatorFacultyId resolved} -> COLLEGE_OFFICE
HOD -advance phase [PATCH .../hiring-batches/[id]]-> HiringBatch{currentPhase: INTERVIEW_READY} -> COLLEGE_OFFICE
```
- Also allowed for Principal-tier. `currentPhase` explicit jumps are validated against a hardcoded one-step-forward map (`HOD_PHASE_TRANSITIONS`, `hiring-batches/[id]/route.ts:108-112`); any other jump (e.g. straight to `COMPLETED`) is rejected.
- If `coordinatorFacultyId` resolves a `userUid` from `facultyMembers`, notifies them (`COORDINATOR_ASSIGNED`, link `/coordinator/{id}`).

```
COLLEGE_OFFICE -set venue & required docs [PATCH .../hiring-batches/[id]]-> HiringBatch{interviewVenue, requiredDocuments[], setupComplete: true} -> COLLEGE_OFFICE
```
- Also allowed for HOD / Principal-tier. Field writes only, no notification.

## Stage 6 — Candidate Arrival & Demo

```
COLLEGE_OFFICE -mark arrived [PATCH /api/college/candidate-applications/[id]]-> CandidateApplication{hasArrived: true, status: ARRIVED, arrivedAt} -> panelMemberUids + COLLEGE_OFFICE
```
- Also allowed for HOD / `PANEL_MEMBER` / Principal-tier. Notifies the batch's `panelMemberUids` and all `COLLEGE_OFFICE` (`CANDIDATE_ARRIVED`, link `/panel/interviews/{batchId}`); audit `CANDIDATE_ARRIVED`.
- Source: `src/app/api/college/candidate-applications/[id]/route.ts:47-373`.

```
COORDINATOR (HOD-assigned faculty, or owning HOD/Principal-tier) -run demo, mark complete [PATCH .../hiring-batches/[id]]-> HiringBatch{demoComplete: true, currentPhase: IN_PROGRESS} -> HOD + panelMemberUids
Student (public, no auth, via QR link) -submit feedback [POST /api/public/student-feedback]-> studentFeedback subcollection entry -> (read-only, Principal-tier/HOD)
```
- Only from `INTERVIEW_READY`/`IN_PROGRESS`. Notifies HOD and panel members ("Demo Class Complete" / "Panel Feedback Unlocked").
- Student feedback: `hiringBatches/{id}/studentFeedback`, readable via `GET /api/college/student-feedback`.

## Stage 7 — Panel Scoring

```
HOD -open panel scoring [PATCH .../hiring-batches/[id]]-> HiringBatch{currentPhase: PANEL_INTERVIEW} -> PANEL_MEMBER (all panelMemberUids)
```
- One-step transition, HOD-only. Notifies all `panelMemberUids` ("Panel Interview Scoring Open").

```
PANEL_MEMBER -score candidate [POST /api/college/panel-feedback]-> panelFeedback{demoRatings | panelScores | ratings+recommendation} -> (read by Principal later, not aggregated)
```
- Caller must be an assigned panelist for the batch (or `SUPER_ADMIN`); the `candidateId` must resolve to one of the batch's own `applicationIds`; only open while `currentPhase` is `PANEL_INTERVIEW`/`PRINCIPAL_FINAL_REVIEW`/`COMPLETED`.
- One doc per (candidate, panelist), upserted transactionally across the three scoring modules (demo rubric, 5-criteria panel evaluation, legacy 3-criteria interview) — guards against duplicate docs from near-simultaneous submissions.
- **No automatic numeric aggregation** — raw ratings only, read manually by the Principal at decision time. Contrast with the [Location pipeline](location-pipeline.md), which computes a weighted score.
- Source: `src/app/api/college/panel-feedback/route.ts:18-241`; audit `FEEDBACK_SUBMITTED`.

```
HOD -close evaluation [PATCH .../hiring-batches/[id]]-> HiringBatch{currentPhase: PRINCIPAL_FINAL_REVIEW} -> PRINCIPAL
```
- One-step transition, HOD-only. Notifies all `PRINCIPAL` ("Evaluation Ready for Review", link `/principal/decisions/{id}`).

## Stage 8 — Final Decision

```
PRINCIPAL (or VICE_PRINCIPAL) -negotiate [PATCH /api/college/candidate-applications/[id]]-> CandidateApplication{expectedSalary, negotiatedSalary, dateOfJoining, termsAndConditions[]} -> PRINCIPAL
PRINCIPAL (or VICE_PRINCIPAL) -decide [PATCH /api/college/candidate-applications/[id]]-> CandidateApplication{status: APPROVED, currentStage: DECISION, committeeRecommendation} -> HOD, then COLLEGE_OFFICE
PRINCIPAL (or VICE_PRINCIPAL) -decide-> CandidateApplication{status: REJECTED, batchId: ""} -> HOD (candidate freed, reusable in a future batch)
```
- `status`/`stage`/`committeeRecommendation`/salary-negotiation fields are Principal-tier-only writes on this route; **terminal guard** — once `APPROVED`/`REJECTED`, a differing status PATCH 409s.
- On `APPROVED`, decrements the parent `VacancyRequest.requiredCount` by 1.
- Notifies `hodUid` (`HIRING_APPROVED`/`HIRING_REJECTED`); if `stage === "DECISION"` and not rejected, also notifies all `COLLEGE_OFFICE` ("Candidate Ready for Offer Letter", link `/college-office/documents`); audit `HIRING_DECISION_MADE`.
- **Server-side auto-close**: once every application in the batch has a terminal decision (`APPROVED`/`REJECTED`), the batch itself flips `currentPhase: "COMPLETED"`, `status: "COMPLETED"`. This is *not* the end of the pipeline for the hired candidate — see `isHiringClosed()` in the README.
- Source: `src/app/api/college/candidate-applications/[id]/route.ts:47-373`.

## Stage 9 — Offer Letter

```
COLLEGE_OFFICE (or PRINCIPAL / VICE_PRINCIPAL / ACCOUNTS / SUPER_ADMIN) -send offer [POST /api/college/offer-letters]-> OfferLetter{status: SENT, offeredTerms (snapshot)} -> HOD (notified, unless sender)
```
- **Gated on `Candidate.bioDataSubmitted === true`** (Stage 3) — the route returns an error otherwise.
- Writes `status: "SENT"` directly — **no `DRAFT`/`GENERATED` intermediate state is ever used**, despite the type supporting it.
- Snapshots the Principal-selected `termsAndConditions` from the `CandidateApplication` into `offeredTerms` (immutable — later deactivating a `HiringTermsTemplate` never changes an already-sent offer). Resolves and persists `ccEmails` (Principal+VP+panel+HOD+location-scoped Accounts) via `resolveOfferLetterCcEmails`.
- **Faculty account provisioning is explicitly deferred** — this step does *not* call `provisionFacultyFromOffer`. That only happens in Stage 13/14.
- PDF/email is manual: staff clicks "Download PDF" (`downloadOfferLetterPdf`, client-rendered) and/or "Compose Email" (`POST /api/email/send`, `type: "OFFER_LETTER"` — attaches a client-rendered PDF if `pdfBase64` was passed, otherwise falls back to the raw `.html` letter via `nodemailer`).
- Source: `src/app/api/college/offer-letters/route.ts:8-150`.

## Stage 10 — Candidate Response

```
Candidate (public, no auth) -accept/reject offer [POST /api/public/offer-acceptance/[collegeId]/[offerId]]-> OfferLetter{status: ACCEPTED|REJECTED, respondedAt, respondedBy: "CANDIDATE"} -> COLLEGE_OFFICE + PRINCIPAL + VICE_PRINCIPAL
COLLEGE_OFFICE (or PRINCIPAL/VICE_PRINCIPAL) -mark accepted/rejected (staff override, e.g. phone/paper confirmation) [PATCH /api/college/offer-letters/[id]]-> OfferLetter{status: ACCEPTED|REJECTED, respondedBy: <staff uid>} -> (terminal)
```
- Both paths funnel through the same shared transaction, `applyOfferDecision()` (`src/lib/firestore/offerLetterDecision.ts`), so a candidate's own click and a staff override can never race into a double-write. It only applies once, from `status: "SENT"` (returns `"already_responded"` otherwise).
- Accepting requires ticking agreement to the snapshotted `offeredTerms` and supplying a `confirmedDateOfJoining`.
- On `ACCEPTED`: `Candidate{status: APPROVED}`, and if a `facultyMembers` doc already exists for this candidate (a pre-acceptance provision retry), flips it to `status: ACTIVE`.
- Public route notifies `COLLEGE_OFFICE`+`PRINCIPAL`+`VICE_PRINCIPAL` (`OFFER_RESPONSE_RECEIVED`); audit `OFFER_ACCEPTED_BY_CANDIDATE`/`OFFER_REJECTED_BY_CANDIDATE`.
- Sources: `src/app/api/public/offer-acceptance/[collegeId]/[offerId]/route.ts:47-120`, `src/app/api/college/offer-letters/[id]/route.ts:12-117`.

## Stage 11 — Appointment Letter

```
PRINCIPAL (or VICE_PRINCIPAL) -generate appointment letter [POST /api/college/appointment-letters]-> AppointmentLetter{status: SENT} -> (no direct notification)
```
- Principal-tier-only (plus `SUPER_ADMIN`) — HOD/College Office cannot create these. Writes `status: "SENT"` directly, same convention as offer letters. Reuses the same CC-resolution helper.
- Audit `APPOINTMENT_LETTER_GENERATED`.
- Source: `src/app/api/college/appointment-letters/route.ts:8-111`.

## Stage 12 — Document Verification & Joining Letter

```
COLLEGE_OFFICE (or Principal-tier) -verify documents [PATCH /api/college/candidate-applications/[id]]-> CandidateApplication{documentVerification: {checkedDocs, allVerified}} -> (no notification unless flagged below)
COLLEGE_OFFICE (or Principal-tier) -upload joining letter scan [PATCH .../candidate-applications/[id]]-> CandidateApplication{joiningLetterUrl, joiningLetterUploadedAt} -> (audit only)
COLLEGE_OFFICE -flag ready [PATCH .../candidate-applications/[id] {notifyPrincipalDocsReady: true}]-> -> PRINCIPAL + VICE_PRINCIPAL
```
- `allVerified` is computed against the batch's `requiredDocuments[]`; audit `DOCUMENTS_VERIFIED` / `JOINING_LETTER_UPLOADED`.
- `notifyPrincipalDocsReady` sends "Documents Verified — Ready for Appointment Letter" (link `/principal/appointment-letters`) — in practice this can precede or follow Stage 11 depending on which order staff work in.
- Source: `src/app/api/college/candidate-applications/[id]/route.ts:47-373`.

## Stage 13 — Faculty Account Request (Office → Webmaster handoff)

```
COLLEGE_OFFICE (or Principal-tier) -request credentials [POST /api/college/offer-letters/[id]/request-credentials]-> OfferLetter{credentialsRequestedAt/By/ByName} -> WEBMASTER
COLLEGE_OFFICE (or Principal-tier) -submit account request [POST /api/college/faculty-account-requests]-> FacultyAccountRequest{status: SUBMITTED} -> WEBMASTER
```
- **Strictly gated**, in this order: `OfferLetter.status === "ACCEPTED"` → candidate must have a `candidateConfirmedJoiningDate` → a matching `AppointmentLetter` (same `batchId`) must already exist. One request per offer (409 on duplicate).
- Neither call provisions anything by itself — it only records the request and notifies all `WEBMASTER`.
- Sources: `src/app/api/college/offer-letters/[id]/request-credentials/route.ts:10-90`, `src/app/api/college/faculty-account-requests/route.ts:7-163`; audits `CREDENTIAL_REQUESTED` / `FACULTY_ACCOUNT_REQUEST_SUBMITTED`.

## Stage 14 — Webmaster Fulfillment (terminal)

```
WEBMASTER -start review [PATCH /api/college/faculty-account-requests/[id] {action: START_REVIEW}]-> FacultyAccountRequest{status: IN_PROGRESS} -> WEBMASTER
WEBMASTER -create credentials [PATCH .../faculty-account-requests/[id] {action: CREATE_CREDENTIALS}]-> Firebase Auth user + colleges/{id}/users/{uid}{role: PANEL_MEMBER} + facultyMembers/{id}{status: ACTIVE|INTERVIEW_DONE} + systemUsers/{uid}, FacultyAccountRequest{status: CREDENTIALS_CREATED, credentialResult.password} -> COLLEGE_OFFICE + HOD + PRINCIPAL/VICE_PRINCIPAL
COLLEGE_OFFICE (or Principal-tier) -reveal credentials [PATCH .../faculty-account-requests/[id] {action: REVEAL_CREDENTIALS}]-> (password read once, then scrubbed) -> (terminal for this candidate)
WEBMASTER -complete [PATCH .../faculty-account-requests/[id] {action: COMPLETE}]-> FacultyAccountRequest{status: COMPLETED} -> (terminal)
```
- Hardcoded one-step transitions map (`TRANSITIONS`, `src/app/api/college/faculty-account-requests/[id]/route.ts:16-20`). `CREATE_CREDENTIALS` calls `provisionFacultyFromOffer()` **before** flipping status, so a failed provision never leaves the request stuck mid-transition; falls back across `officialEmail → alternateEmail1 → alternateEmail2` if one is already taken.
- `provisionFacultyFromOffer()` (`src/lib/firestore/facultyProvisioning.ts:27-179`) is idempotent — if a `facultyMembers` doc already exists for the candidate, returns `already_exists` instead of duplicating. Generates a sequential `employeeId` (`EMP0001`-style). **New hires log in with `role: "PANEL_MEMBER"`** (UI label "Faculty") — there is no separate `FACULTY` role. New faculty status is `ACTIVE` if the offer is already `ACCEPTED`, else `INTERVIEW_DONE`.
- `CREATE_CREDENTIALS` success notifies the requesting Office user and — described in-code as "the terminal step of the whole hiring pipeline" — the vacancy's HOD plus all Principals/VPs (`CANDIDATE_HIRED`).
- `REVEAL_CREDENTIALS` is Office-role-gated (not Webmaster) and runs transactionally so the one-time password is scrubbed from `credentialResult` the instant it's read — a refresh or second viewer never sees it again.
- Manual retry path for offers predating auto-provisioning: `POST /api/college/offer-letters/[id]/provision` (`WEBMASTER`/`SUPER_ADMIN`, requires `credentialsRequestedAt` already set).
- All transitions audit (`FACULTY_ACCOUNT_REQUEST_IN_PROGRESS`/`_CREDENTIALS_CREATED`/`_COMPLETED`).

**What "closed" actually means**: `isHiringClosed()` (`src/lib/hiringPipeline.ts:146-159`) only considers a vacancy/candidate closed once every approved candidate's `FacultyAccountRequestStatus` reaches `CREDENTIALS_CREATED` or `COMPLETED` — reaching `HiringBatch.currentPhase === "COMPLETED"` back in Stage 8 is **not** sufficient. A client-derived (never persisted) `DetailedHiringStatus` — computed by `getDetailedHiringStatus()` in the same file — is what actually drives the unified progress badge shown across HOD/Principal/College-Office/Accounts pipeline boards, spanning `INTERVIEW_COMPLETED` through `HIRING_COMPLETED`.
