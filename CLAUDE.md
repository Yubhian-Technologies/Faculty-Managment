# College Hiring Pipeline — `colleges/{collegeId}/...`

Full-featured pipeline: vacancy → sourcing → interview → decision → offer → response → appointment → doc verification → faculty provisioning.
All routes use `requireCollegeMember()` (`src/lib/auth/verifySession.ts`) + Firestore Admin SDK. `src/lib/firestore/hiring.ts`/`useHiring.ts` are NOT part of this flow.

## Stages

1. **Vacancy Request** — HOD submits → PRINCIPAL/VP decides (APPROVED/REJECTED/MODIFIED). `GENERAL_ADMIN` category blocked here (belongs to general-admin pipeline). Terminal guard: re-deciding an already-decided request → 409.
   `POST/PATCH /api/college/vacancy-requests[/id]`

2. **Candidate Sourcing** — HOD adds candidate + attaches to vacancy, OR public careers-page apply (client-SDK direct write, **bypasses API — no audit/notification**). One active (non-REJECTED) application per candidate, enforced server-side.
   `/api/college/candidates`, `/api/college/candidate-applications`

3. **Bio-Data & Certs** — HOD manually copies candidate-form link (nothing auto-sends it). Public PATCH, secured by unguessable ID pair (no token). **`bioDataSubmitted: true` hard-gates Stage 9 offer creation.**
   `/api/public/candidate-form/[collegeId]/[candidateId]`

4. **Interview Batch Planning** — HOD builds batch (transaction prevents double-booking) → PRINCIPAL/VP approves/rejects/modifies. Only valid while `currentPhase === PRINCIPAL_REVIEW`.
   `/api/college/hiring-batches[/id]`

5. **Logistics** — HOD finalizes (classroom, link, coordinator, panel, time); phase transitions validated against hardcoded one-step map `HOD_PHASE_TRANSITIONS`. COLLEGE_OFFICE sets venue/required docs.

6. **Arrival & Demo** — COLLEGE_OFFICE marks arrived → notifies panel. COORDINATOR runs demo → marks complete. Public QR-based student feedback (read-only later).

7. **Panel Scoring** — HOD opens scoring (phase → `PANEL_INTERVIEW`) → PANEL_MEMBER scores (one doc per candidate+panelist, transactional upsert across 3 scoring modules). **No automatic aggregation** — raw ratings only (unlike Location pipeline, which weights scores). HOD closes eval → phase `PRINCIPAL_FINAL_REVIEW`.
   `/api/college/panel-feedback`

8. **Final Decision** — PRINCIPAL/VP negotiates terms, then decides APPROVED/REJECTED. Terminal guard (409 on re-decide). APPROVED decrements `VacancyRequest.requiredCount`. **Batch auto-closes** (`currentPhase: COMPLETED`) once all applications reach terminal status — but this is NOT the same as `isHiringClosed()` (see below).
   `/api/college/candidate-applications/[id]`

9. **Offer Letter** — COLLEGE_OFFICE (or Principal-tier/ACCOUNTS) sends offer. **Gated on `bioDataSubmitted`.** Writes `status: SENT` directly — no DRAFT state used despite type support. Snapshots `offeredTerms` (immutable). **Does NOT provision faculty accounts** (deferred to Stage 13/14). PDF/email sending is manual (staff-triggered, Gmail-compose-draft handoff — no server-side send). The email body's "contact your Interview Coordinator" block (`src/lib/offerLetterContactBlock.ts`, shared by all three offer-email composers) **falls back to the batch's HOD** if no coordinator is assigned or the coordinator has neither phone nor email on file.
   `/api/college/offer-letters`

10. **Candidate Response** — Candidate accepts/rejects (public) OR staff overrides (phone/paper). Both funnel through shared transaction `applyOfferDecision()` — prevents double-write races. Only applies from `status: SENT`. ACCEPTED → `Candidate.status: APPROVED`; if a pre-existing `facultyMembers` doc exists, flips to `ACTIVE`.

11. **Appointment Letter** — Principal-tier ONLY (not HOD/College Office). `status: SENT` directly, same CC-resolution as offers.

12. **Document Verification** — COLLEGE_OFFICE/Principal-tier verifies docs, uploads joining letter, flags `notifyPrincipalDocsReady` → notifies PRINCIPAL+VP. Order vs. Stage 11 is not enforced.

13. **Faculty Account Request** — COLLEGE_OFFICE/Principal-tier requests credentials + submits account request. **Strict gate order**: offer `ACCEPTED` → `candidateConfirmedJoiningDate` set → matching `AppointmentLetter` exists. One request per offer (409 on dup). Only records/notifies WEBMASTER — no provisioning yet.

14. **Webmaster Fulfillment (terminal)** — `START_REVIEW → CREATE_CREDENTIALS → COMPLETE` (hardcoded `TRANSITIONS` map). **`CREATE_CREDENTIALS` also accepts straight from `SUBMITTED`** (one webmaster click; `history` only records actions Webmaster actually took — no synthetic `IN_PROGRESS` entry when the Start Review step is skipped). `CREATE_CREDENTIALS` calls `provisionFacultyFromOffer()` BEFORE flipping status (failed provision never leaves it stuck). Idempotent (existing `facultyMembers` doc → `already_exists`). Falls back `officialEmail → alternateEmail1 → alternateEmail2`. **New hires get `role: PANEL_MEMBER`** (UI label "Faculty") — no separate FACULTY role. Status `ACTIVE` if offer accepted, else `INTERVIEW_DONE`. `REVEAL_CREDENTIALS` is Office-gated, scrubs password transactionally on read (one-time view). Manual retry: `POST /offer-letters/[id]/provision`. **`LINK_EXISTING_ACCOUNT`** (alternate action, same status transitions as `CREATE_CREDENTIALS`) lets Webmaster attach the request to a person's already-existing login (`linkFacultyToExistingAccount()`) instead of provisioning a new Firebase Auth user — no password/role change on the existing account.

## Key gotchas
- `isHiringClosed()` (`src/lib/hiringPipeline.ts`) requires EVERY approved candidate's `FacultyAccountRequestStatus` to reach `CREDENTIALS_CREATED`/`COMPLETED` — batch `COMPLETED` (Stage 8) alone is insufficient.
- `DetailedHiringStatus` (from `getDetailedHiringStatus()`) is client-derived, never persisted, and drives the unified progress badge across all role dashboards.
- Terminal guards (409 on re-decide) exist at: vacancy request decision, candidate-application decision.
- Public/no-auth write paths: careers-page apply, candidate-form bio-data, student feedback, offer acceptance.
- `OFFICE_STAGE_BY_STATUS`/`OFFICE_STAGE_LABELS` (`src/lib/hiringPipeline.ts`) bucket `DetailedHiringStatus` into Office's own 4-stage view (Offer Letter → Documents & Joining Letter → Appointment Letter → Credentials & Email) — shared by the department-scoped vacancy view and the consolidated all-departments board so both render identical stages.
- ACCOUNTS (not COLLEGE_ACCOUNTS) has read-only access to `/candidate-profile` and `panel-feedback` GET — granted via `src/proxy.ts`'s `ROLE_PATH_MAP`, surfaced as a "View Profile" action on `accounts/pipeline`'s candidate rows rather than a separate candidates list page.

## Role/UI map (who reaches what)
- **HOD** — `/hod/pipeline` (own vacancies, full pipeline board + actions).
- **PRINCIPAL/VICE_PRINCIPAL** — `/principal/vacancies` (all vacancies, decisions).
- **COLLEGE_OFFICE** — `/college-office/pipeline` (all departments' vacancies, read-only Office-stage stepper; "Manage Candidates & Credentials" per vacancy deep-links into the unchanged `documents/[department]/[vacancyId]` → `documents/candidate/[applicationId]` action pages, which still handle sending offers, document verification, joining letters, appointment-letter/credential requests). The older `/college-office/documents` department-picker still exists and works (internal back-links, notification `link` fields still point there) but is no longer the primary nav entry.
- **ACCOUNTS** — `/accounts/pipeline` (all vacancies, read-only, "View Profile" per candidate) + `/accounts/hiring` (send offers for Principal-approved candidates).
- **COLLEGE_ACCOUNTS** — `/college-accounts/candidates` + `/candidate-profile/[id]`.
- **WEBMASTER** — `/webmaster/credential-requests` (fulfills Stage 14; "Create Credentials" works directly off `SUBMITTED`; "Link Existing Account" opens a searchable picker over `/api/college/users`).

## Source map
| Stage | File |
|---|---|
| 1 | `src/app/api/college/vacancy-requests/route.ts`, `[id]/route.ts` |
| 2 | `src/app/api/college/candidates/route.ts`, `candidate-applications/route.ts`, `src/app/careers/[collegeId]/CareersPageClient.tsx` |
| 3 | `src/app/api/public/candidate-form/[collegeId]/[candidateId]/route.ts` |
| 4–5 | `src/app/api/college/hiring-batches/route.ts`, `[id]/route.ts` |
| 6–8, 12 | `src/app/api/college/candidate-applications/[id]/route.ts` |
| 7 | `src/app/api/college/panel-feedback/route.ts` |
| 9 | `src/app/api/college/offer-letters/route.ts` |
| 10 | `src/lib/firestore/offerLetterDecision.ts`, `.../offer-letters/[id]/route.ts`, `/api/public/offer-acceptance/[collegeId]/[offerId]/route.ts` |
| 11 | `src/app/api/college/appointment-letters/route.ts` |
| 13 | `.../offer-letters/[id]/request-credentials/route.ts`, `faculty-account-requests/route.ts` |
| 14 | `faculty-account-requests/[id]/route.ts`, `src/lib/firestore/facultyProvisioning.ts` |
| UI (Office) | `src/app/(dashboard)/college-office/pipeline/` (consolidated board, new), `documents/[department]/[vacancyId]/`, `documents/candidate/[applicationId]/`, `offers/`, `offers/new/` |
| UI (Webmaster) | `src/app/(dashboard)/webmaster/credential-requests/page.tsx` |