# Hiring / Recruitment Workflow — Codebase Trace

This traces the *actual* recruitment flow as implemented (not as the type names suggest). There are **three separate, non-interoperating pipelines** in the codebase — they share only the `UserRole` type.

| Pipeline | Tenancy | Where it lives | Complexity |
|---|---|---|---|
| **A. College pipeline** | `colleges/{id}/...` | `src/app/api/college/...`, dashboards `hod`, `principal`, `college-office`, `coordinator`, `panel`, `accounts` | Full 9-stage `HiringBatch` workflow — the primary flow, covered in detail below |
| **B. Location pipeline** | `locations/{id}/...` | `src/app/api/location/...`, dashboards `location-dept-head`, `hr-admin`, `administration` | Simpler 3-role linear approval chain, no batches/panel-scoring machinery |
| **C. General Admin pipeline** | global | `src/app/api/admin/general-admin-vacancies/...` | Single-step Vice Principal → Super Admin approval, no candidates/interviews |

---

## A. College Pipeline (primary flow)

### Stage 1 — Vacancy Request

1. **HOD raises a request** — `src/app/(dashboard)/hod/vacancy/new/page.tsx`, auto-filled from cadre-ratio data (`GET /api/college/faculty-requirement`).
   → `POST /api/college/vacancy-requests` (guard: `HOD, PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN`).
   - `positionCategory: "GENERAL_ADMIN"` is rejected unless the caller is `VICE_PRINCIPAL`/`SUPER_ADMIN` — HOD can only request `TEACHING`/`SUPPORTING_STAFF` here. General Admin hiring goes through Pipeline C instead.
   - Writes `status: "PENDING"`, audit log `VACANCY_REQUEST_CREATED`, notifies all Principals → `/principal/vacancies`.
2. **List** — `GET /api/college/vacancy-requests`: HOD/VP see only their own requests; Principal/COLLEGE_OFFICE/Super Admin see all.
3. **Principal (or VP) approves/rejects** — `principal/vacancies/[id]/approve` and `.../reject` pages → `PATCH /api/college/vacancy-requests/[id]` (guard: `PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN`).
   - Writes `principalResponse{action, reason, respondedAt, principalUid}`, notifies the HOD, audit log `VACANCY_REQUEST_APPROVED`/`_REJECTED`.
   - An approved vacancy also becomes visible on the public careers page (`/careers/[collegeId]`), which queries `vacancyRequests where status==APPROVED` **directly via the client Firestore SDK**, bypassing the API.

### Stage 2 — Candidate Collection & Batch Creation

4. **HOD adds candidates** — `hod/candidates` page → `POST /api/college/candidates` (guard: `HOD, PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN`). Captures `courseId/year/preferredSubjectIds` if the candidate is for a teaching post — this resurfaces later in faculty provisioning (Stage 8).
   - Careers-page applicants are also written here, but client-side (`createCandidate()` in `src/lib/firestore/hiring.ts`), bypassing the API route and its audit log.
5. **HOD shortlists / removes candidates** — `PATCH` / `DELETE /api/college/candidates/[id]`.
6. **HOD creates a Hiring Batch** — `hod/batches/new` page: pick an `APPROVED` vacancy, interview date/time, shortlisted candidates (must not already belong to a batch), and panel members (Principal + VP are locked-in defaults, plus the HOD).
   → `POST /api/college/hiring-batches` (guard: `HOD, SUPER_ADMIN` only — **VP/Principal cannot create batches**).
   - Batch is created directly with `status: "PENDING"` and `currentPhase: "PRINCIPAL_REVIEW"` — submitted for approval immediately.
   - Marks all selected candidates `batchId`, `isShortlisted: true`, `status: "SHORTLISTED"`.
   - Notifies all Principals, audit log `HIRING_BATCH_CREATED`.
   - `hod/pipeline` gives the HOD a 4-stage rollup view (Request → Candidates → Interview → Decision), computed client-side from the vacancy/candidates/batch — not a separate backend state.

### Stage 3 — Principal Reviews the Interview Plan

7. `principal/interviews` lists pending batches; `principal/interviews/[id]` shows candidates/resumes/panel and lets the Principal **Approve** or **Reject** (with optional notes).
   → `PATCH /api/college/hiring-batches/[id]` `{status, principalNotes}` (guard on this endpoint is broad: `PRINCIPAL, VICE_PRINCIPAL, HOD, SUPER_ADMIN, COLLEGE_OFFICE, PANEL_MEMBER` — it's reused by every later phase-actor too).
   - On `APPROVED`, `currentPhase` is set straight to **`HOD_FINAL_SETUP`**.
   - Notifies the HOD, audit log `INTERVIEW_PLAN_APPROVED`/`_REJECTED`.

### Stage 4 — Setup (College Office + HOD)

8. **College Office** (`college-office/setup`) — a phase-independent side task gated on `status === "APPROVED"` (not on `currentPhase`): sets `interviewVenue` + `requiredDocuments[]`, "Mark Setup Complete" sets `setupComplete: true`. Does not itself advance `currentPhase`.
9. **HOD final setup** (`hod/batches/[id]`, shown when `currentPhase === "HOD_FINAL_SETUP"`) — sets/overwrites `interviewVenue`, `requiredDocuments`, plus `demoClassroom`, `meetingLink`, and picks a **Demo Coordinator** from active faculty.
   - Save → `PATCH hiring-batches/[id]` `{..., setupComplete: true, currentPhase: "INTERVIEW_READY"}`.
   - Server resolves the coordinator's faculty doc → `coordinatorFacultyId/coordinatorName/coordinatorUid`; notifies the coordinator only if they have a login account.
   - HOD can also edit the panel committee/date at any point before `IN_PROGRESS`, and send a Gmail call-letter (mailto compose link, CC'ing Principal + VP).

### Stage 5 — Interview / Demo Day

10. **Coordinator QR session** (`coordinator/[batchId]`) — coordinator (a faculty member, role `PANEL_MEMBER`) presents each candidate, generates a QR per candidate encoding `/feedback/{collegeId}/{batchId}/{candidateId}`, and clicks **Mark Demo Complete** → `PATCH hiring-batches/[id]` `{demoComplete: true, currentPhase: "IN_PROGRESS"}`, notifying HOD + all panel members that scoring is unlocked.
11. **Candidate arrival** — HOD's batch page has a "Mark Arrived" action → `PATCH candidates/[id]` `{hasArrived: true}` → sets `status: "ARRIVED"`, notifies panel members + College Office.
12. **Anonymous student feedback** — `/feedback/[collegeId]/[batchId]/[candidateId]` (public, no auth), 5-criteria star rating → `POST /api/public/student-feedback`.
    - A legacy 2-segment route `/feedback/[id]/[sub]` still exists but posts without `collegeId`, which the API requires — it is orphaned/broken and nothing links to it anymore.

### Stage 6 — Panel Scoring, HR Feedback, Salary Negotiation, Document Verification

13. **HOD reopens scoring** — "Open Panel Scoring" → `PATCH hiring-batches/[id]` `{currentPhase: "PANEL_INTERVIEW"}`, notifying all panel members.
14. **Panel members score candidates** — `panel/interviews/[id]` (scoring allowed only when `currentPhase ∈ {PANEL_INTERVIEW, PRINCIPAL_FINAL_REVIEW, COMPLETED}`): rates `technicalKnowledge/communicationSkills/teachingMethodology` (1–5) + `recommendation: ACCEPT|REJECT|MAYBE` → `POST /api/college/panel-feedback` (upsert, one doc per panelist+candidate). HOD, if also on the panel, uses the same endpoint via an inline form on their own batch page.
15. **HR feedback** — a working endpoint (`POST /api/college/hr-feedback`, "HOD acts as HR in this flow" per guard comment) exists, but **no page in the app calls it** — it's a dead-end capability with no reachable submission form.
16. **Salary negotiation** — role **ACCOUNTS** (`accounts/salary/new`) picks a completed/final-review batch and a `DECISION`-stage candidate, enters a salary breakdown → `POST /api/college/salary-records`, writing a `HiringSalaryAgreement` and re-confirming `candidate.currentStage: "DECISION"`.
17. **Document verification** — the dedicated `HiringDocVerification` type/collection is **entirely unused** (no route, no UI). What actually runs is ad-hoc via `Candidate.currentStage`/`status`: `college-office/documents` shows a checklist built from `batch.requiredDocuments` and, on "Mark Verified & Proceed", `PATCH candidates/[id]` `{stage: "DECISION", status: "IN_PROGRESS"}`. A second, redundant page (`college-office/candidates`) does the same transition without any checklist.

### Stage 7 — Principal Final Decision

18. **Submit to Principal** — HOD's batch page → `PATCH hiring-batches/[id]` `{currentPhase: "PRINCIPAL_FINAL_REVIEW"}`, notifying all Principals.
19. `principal/decisions/[id]` aggregates, per candidate: panel Accept/Reject/Maybe counts + averaged panel ratings, averaged student ratings, and the (rarely-populated) HR feedback record and salary figure.
    - Approve/Reject per candidate → `PATCH candidates/[id]` `{status: "APPROVED"|"REJECTED", ...(APPROVED && {stage: "DOCUMENT_VERIFICATION"})}`.
    - Once every candidate in the batch has a decision, the client also fires `PATCH hiring-batches/[id]` `{currentPhase: "COMPLETED", status: "COMPLETED"}` — this completion check is **client-side only**; closing the tab mid-way can leave a batch stuck without ever reaching `COMPLETED`.
    - The UI says "the College Office will be notified" on approve, but no notification actually fires for this status/stage change.

### Stage 8 — Offer Letter, Appointment Letter, Faculty Provisioning

20. **Offer letter** — role **ACCOUNTS** (`accounts/offers/new`) picks a `DECISION`-stage candidate with a signed salary agreement, sets designation/department/joining date → `POST /api/college/offer-letters` (also allowed for `PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN`). Created as `status: "DRAFT"`.
21. **Status progression** (`accounts/offers`): DRAFT → "Mark as Sent" → SENT → Accept/Reject or "Create Faculty Account".
    - **PDF generation and email are built but never invoked** for this flow: `src/lib/pdf/offerLetterTemplate.ts` + the generic `/api/pdf/generate` route support `OFFER_LETTER`/`APPOINTMENT_LETTER`, and `/api/email/send` has an offer-letter template — but nothing in the offer pages calls either. `OfferLetter.pdfUrl` is never populated; it's a pure status record.
    - **`AppointmentLetter` is completely unused** — no route ever creates one, despite the type and a template function existing.
22. **Faculty provisioning** (the one fully-automated step) — triggered by marking an offer `SENT` (or via the separate idempotent `POST offer-letters/[id]/provision` endpoint, kept for offers marked SENT before auto-provisioning existed):
    - Creates a **Firebase Auth user** with a **hardcoded default password (`12345678`)**; falls back to an existing `systemUsers` doc by email if the auth account already exists.
    - Writes a `colleges/{id}/users/{uid}` login doc with **`role: "PANEL_MEMBER"`** (labeled "Faculty" in `ROLE_LABELS` — this is the system's generic teaching-staff role, not literally interview-panel duty).
    - Creates the `facultyMembers/{new}` doc (`status: "ACTIVE"`, auto-incrementing `employeeId`), carrying over `pendingTeachingPreference` from the candidate's `courseId/year/preferredSubjectIds` **only if both were captured back at candidate-creation time** (Stage 2).
    - When the offer is later marked `ACCEPTED`, `candidate.status` is independently set to `"APPROVED"` again — a second write on top of the Principal's Stage 7 decision.

---

## B. Location Pipeline (simpler, separate tenancy)

Applies to `locations/{id}/...` — no `HiringBatch`, no panel scoring, no salary/doc-verification machinery.

1. **Location Dept Head** submits a vacancy request — `POST /api/location/vacancy-requests` (Dept Head only).
2. **HR Admin** forwards to Administration or rejects — `PATCH /api/location/vacancy-requests/[id]`.
3. **Administration** approves/rejects — same endpoint, different action.
4. **HR Admin** adds/manages candidates — `POST/PATCH /api/location/candidates[/id]`.
5. **HR Admin** creates an interview plan, notifies Administration — `POST /api/location/interviews`.
6. **Administration** approves/rejects the plan; **HR Admin** sends call letters / marks complete; panel roles submit feedback (NBA/NAAC-style 70/30 weighted score) — all via `PATCH /api/location/interviews/[id]` with an `action` discriminator.
7. **HR Admin** creates an offer — `POST /api/location/offers`; **Administration** approves/rejects — `PATCH /api/location/offers/[id]`, setting candidate status to `OFFER_SENT`/`SELECTED`.
   - No faculty provisioning exists anywhere in this pipeline — it ends at offer decision.

---

## C. General Admin Vacancy Pipeline

For institution-wide, non-departmental hiring (e.g. admin staff), submitted directly by the Vice Principal and approved at the top level — no candidates, interviews, or batches involved.

1. **Vice Principal** submits — `principal/vacancies/general-admin` page → `POST /api/admin/general-admin-vacancies` (guard: `PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN`).
2. **Super Admin** approves/rejects — `PATCH /api/admin/general-admin-vacancies/[id]` (guard: `requireSuperAdmin`).

---

## Route Reference (College pipeline)

| Route | Purpose | Who |
|---|---|---|
| `POST /api/college/vacancy-requests` | Create vacancy request | HOD, Principal, VP, Super Admin |
| `PATCH /api/college/vacancy-requests/[id]` | Approve/reject vacancy | Principal, VP, Super Admin |
| `POST /api/college/candidates` | Add candidate | HOD, Principal, VP, Super Admin |
| `PATCH/DELETE /api/college/candidates/[id]` | Shortlist, arrival, stage/status, resume edits | HOD, Principal, VP, Super Admin, Panel, College Office, Accounts |
| `POST /api/college/hiring-batches` | Create batch (submits straight to Principal review) | HOD, Super Admin |
| `PATCH /api/college/hiring-batches/[id]` | Mega-endpoint: Principal approve/reject, Office venue+docs, HOD setup+coordinator, demo-complete, all phase transitions | Principal, VP, HOD, Super Admin, College Office, Panel Member |
| `POST /api/college/panel-feedback` | Upsert panel scoring | Principal, VP, HOD, Super Admin, Panel Member |
| `POST /api/college/hr-feedback` | "HR" assessment (no UI calls it) | HOD, Principal, VP, Super Admin |
| `POST /api/college/salary-records` | Hiring salary agreement | Accounts, HOD, Principal, VP, Super Admin |
| `POST /api/college/offer-letters` | Create draft offer | Accounts, Principal, VP, Super Admin |
| `PATCH /api/college/offer-letters/[id]` | Status changes; SENT auto-provisions faculty | Accounts, Principal, VP, Super Admin |
| `POST /api/college/offer-letters/[id]/provision` | Manual/idempotent faculty provisioning | Accounts, Principal, VP, Super Admin |
| `POST /api/public/student-feedback` | Anonymous demo feedback | none (public) |

---

## Known Gaps & Dead Code (as of this trace)

- `BatchPhase` values `CANDIDATE_COLLECTION`, `PANEL_SETUP`, `COLLEGE_OFFICE_SETUP` are declared in the type but never actually written by any route — real phase sequence is `PRINCIPAL_REVIEW → HOD_FINAL_SETUP → INTERVIEW_READY → IN_PROGRESS → PANEL_INTERVIEW → PRINCIPAL_FINAL_REVIEW → COMPLETED`.
- HR feedback (`HRFeedback`) has a working API but no reachable UI form.
- `HiringDocVerification` type/collection is fully unused; document verification is done ad-hoc via `Candidate.currentStage`/`status`, duplicated across two College Office pages.
- Offer/appointment letter PDF generation and email sending are implemented but never called; `AppointmentLetter` is never created.
- Batch completion (`currentPhase: "COMPLETED"`) is a client-side check, not server-enforced — can get stuck if the browser closes mid-decision.
- Faculty provisioning sets a hardcoded default password (`12345678`) for new Firebase Auth accounts.
- A legacy 2-segment public feedback route (`/feedback/[id]/[sub]`) is broken against the current API contract and unreachable from the app.
