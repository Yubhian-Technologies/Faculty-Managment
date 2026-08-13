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

9. **Offer Letter** — COLLEGE_OFFICE (or Principal-tier/ACCOUNTS) sends offer. **Gated on `bioDataSubmitted`.** Writes `status: SENT` directly — no DRAFT state used despite type support. Snapshots `offeredTerms` (immutable). **Does NOT provision faculty accounts** (deferred to Stage 13/14). PDF/email sending is manual (staff-triggered).
   `/api/college/offer-letters`

10. **Candidate Response** — Candidate accepts/rejects (public) OR staff overrides (phone/paper). Both funnel through shared transaction `applyOfferDecision()` — prevents double-write races. Only applies from `status: SENT`. ACCEPTED → `Candidate.status: APPROVED`; if a pre-existing `facultyMembers` doc exists, flips to `ACTIVE`.

11. **Appointment Letter** — Principal-tier ONLY (not HOD/College Office). `status: SENT` directly, same CC-resolution as offers.

12. **Document Verification** — COLLEGE_OFFICE/Principal-tier verifies docs, uploads joining letter, flags `notifyPrincipalDocsReady` → notifies PRINCIPAL+VP. Order vs. Stage 11 is not enforced.

13. **Faculty Account Request** — COLLEGE_OFFICE/Principal-tier requests credentials + submits account request. **Strict gate order**: offer `ACCEPTED` → `candidateConfirmedJoiningDate` set → matching `AppointmentLetter` exists. One request per offer (409 on dup). Only records/notifies WEBMASTER — no provisioning yet.

14. **Webmaster Fulfillment (terminal)** — `START_REVIEW → CREATE_CREDENTIALS → COMPLETE` (hardcoded `TRANSITIONS` map). `CREATE_CREDENTIALS` calls `provisionFacultyFromOffer()` BEFORE flipping status (failed provision never leaves it stuck). Idempotent (existing `facultyMembers` doc → `already_exists`). Falls back `officialEmail → alternateEmail1 → alternateEmail2`. **New hires get `role: PANEL_MEMBER`** (UI label "Faculty") — no separate FACULTY role. Status `ACTIVE` if offer accepted, else `INTERVIEW_DONE`. `REVEAL_CREDENTIALS` is Office-gated, scrubs password transactionally on read (one-time view). Manual retry: `POST /offer-letters/[id]/provision`.

## Key gotchas
- `isHiringClosed()` (`src/lib/hiringPipeline.ts`) requires EVERY approved candidate's `FacultyAccountRequestStatus` to reach `CREDENTIALS_CREATED`/`COMPLETED` — batch `COMPLETED` (Stage 8) alone is insufficient.
- `DetailedHiringStatus` (from `getDetailedHiringStatus()`) is client-derived, never persisted, and drives the unified progress badge across all role dashboards.
- Terminal guards (409 on re-decide) exist at: vacancy request decision, candidate-application decision.
- Public/no-auth write paths: careers-page apply, candidate-form bio-data, student feedback, offer acceptance.

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