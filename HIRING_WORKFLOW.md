# Hiring / Recruitment Workflow — Codebase Trace

*Last verified against commit `4b27fcd` (2026-08-01).*

This traces the *actual* recruitment flow as implemented (not as the type names suggest). There are **three separate, non-interoperating pipelines** in the codebase — they share only the `UserRole` type.

| Pipeline | Tenancy | Where it lives | Complexity |
|---|---|---|---|
| **A. College pipeline** | `colleges/{id}/...` | `src/app/api/college/...`, dashboards `hod`, `principal`, `college-office`, `coordinator`, `panel` | Full 9-stage `HiringBatch` workflow — the primary flow, covered in detail below |
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
   - **`DELETE /api/college/vacancy-requests/[id]`** (guard: `HOD, PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN`; HOD can only delete their own) — lets a requester withdraw a request, but only while it's still unused: blocked with a 400 if any `HiringBatch` or `Candidate` already references it. Audit log `VACANCY_REQUEST_DELETED`.

### Stage 2 — Candidate Collection & Batch Creation

4. **HOD adds candidates** — `hod/candidates` page → `POST /api/college/candidates` (guard: `HOD, PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN`). Captures `courseId/year/preferredSubjectIds` if the candidate is for a teaching post — this resurfaces later in faculty provisioning (Stage 8).
   - Careers-page applicants are also written here, but client-side (`createCandidate()` in `src/lib/firestore/hiring.ts`), bypassing the API route and its audit log.
   - Referral capture is now split by type: `referralType: "INTERNAL"` collects `referralCollege`/`referralDesignation`; `referralType: "EXTERNAL"` collects `referralInfluenceType` (defaulting to `"NONE"`) plus a free-text `referralInfluenceOther` when that type is `"OTHER"`.
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
   - On `REJECTED`, every candidate in `batchData.candidateIds` has its `batchId` cleared (`batchId: ""`) in a batched write — they stay `isShortlisted: true` and are immediately eligible for the HOD to pick into a new batch, instead of being stuck pointing at a dead batch.
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

### Stage 6 — Panel Scoring, HR Feedback, Document Verification

13. **HOD reopens scoring** — "Open Panel Scoring" → `PATCH hiring-batches/[id]` `{currentPhase: "PANEL_INTERVIEW"}`, notifying all panel members.
14. **Panel members score candidates** — `panel/interviews/[id]` (scoring allowed only when `currentPhase ∈ {PANEL_INTERVIEW, PRINCIPAL_FINAL_REVIEW, COMPLETED}`): rates `technicalKnowledge/communicationSkills/teachingMethodology` (1–5) + `recommendation: ACCEPT|REJECT|MAYBE` → `POST /api/college/panel-feedback` (upsert, one doc per panelist+candidate). HOD, if also on the panel, uses the same endpoint via an inline form on their own batch page.
15. **HR feedback** — a working endpoint (`POST /api/college/hr-feedback`, "HOD acts as HR in this flow" per guard comment) exists, but **no page in the app calls it** — it's a dead-end capability with no reachable submission form.
16. **Document verification** — the dedicated `HiringDocVerification` type/collection is **entirely unused** (no route, no UI). What actually runs is ad-hoc via `Candidate.currentStage`/`status`: `college-office/documents` shows a checklist built from `batch.requiredDocuments` and, on "Mark Verified & Proceed", `PATCH candidates/[id]` `{stage: "DECISION", status: "IN_PROGRESS"}`. A second, redundant page (`college-office/candidates`) does the same transition without any checklist.
    - There is no salary-negotiation step anymore — CTC is set directly on the offer letter in Stage 8.

### Stage 7 — Principal Final Decision

18. **Submit to Principal** — HOD's batch page → `PATCH hiring-batches/[id]` `{currentPhase: "PRINCIPAL_FINAL_REVIEW"}`, notifying all Principals.
19. `principal/decisions/[id]` aggregates, per candidate: panel Accept/Reject/Maybe counts + averaged panel ratings, averaged student ratings, and the (rarely-populated) HR feedback record and salary figure.
    - Approve/Reject per candidate → `PATCH candidates/[id]` `{status: "APPROVED"|"REJECTED", ...(APPROVED && {stage: "DOCUMENT_VERIFICATION"})}`.
    - **Server-enforced**: the same route re-reads every sibling candidate in the batch after each decision (`src/app/api/college/candidates/[id]/route.ts:241-250`) and, once all of them are `APPROVED`/`REJECTED`, itself fires `hiringBatches/[id].update({currentPhase: "COMPLETED", status: "COMPLETED"})` — this does not depend on the browser staying open.
    - The UI says "the College Office will be notified" on approve, but no notification actually fires for this status/stage change.

### Stage 8 — Offer Letter + Faculty Provisioning (moved to HOD, single-step)

> **Updated**: this stage no longer lives under `accounts/` — `accounts/offers`, `accounts/salary`, and `POST /api/college/salary-records` were removed. Offer creation and faculty-login provisioning now happen together in one HOD action; there is no separate salary-negotiation record or DRAFT status.

19. **Send offer letter** — role **HOD** (also PRINCIPAL/VICE_PRINCIPAL/SUPER_ADMIN) at `hod/offers/new`, reachable standalone or deep-linked from the pipeline board's "Send Offer Letter" button (`?batchId=`). Picks a finalized batch (`COMPLETED` or `PRINCIPAL_FINAL_REVIEW`) and a `DECISION`-stage candidate not yet offered, sets designation/department/joining date/CTC/subjects, **plus the faculty's login email and password directly in the same form** (password field has a dice-roll "generate" button using a client-side `randomPassword()`).
    → `POST /api/college/offer-letters` creates the letter with `status: "SENT"` immediately (no DRAFT step) and, in the same request, calls `provisionFacultyFromOffer()` with the HOD-supplied `{email, password}` — so the offer and the login are created atomically from the caller's perspective.
20. **List / status progression** (`hod/offers`): shows Sent/Accepted/Rejected counts; each row can Download PDF, Email Candidate, Retry Faculty Account (idempotent, for offers that predate this flow or whose provisioning failed), or Mark Accepted/Rejected.
    - Marking `ACCEPTED` independently re-sets `candidate.status: "APPROVED"` — a second write on top of the Principal's Stage 7 decision (unchanged behavior from before).
    - PDF generation is now actually wired up client-side: `src/lib/pdf/downloadOfferLetter.ts` renders `offerLetterTemplate.ts` in-browser (no server round-trip to `/api/pdf/generate`). Email is also wired: "Email Candidate" calls `/api/email/send` with `type: "OFFER_LETTER"`.
    - `AppointmentLetter` remains completely unused — no route ever creates one.
21. **Faculty provisioning** — `src/lib/firestore/facultyProvisioning.ts`, shared by the offer-letters POST (HOD supplies credentials) and the manual idempotent `POST offer-letters/[id]/provision` retry endpoint (falls back to the candidate's own email + a **server-generated random password** — `randomBytes(9)`, not a hardcoded default anymore):
    - Creates a **Firebase Auth user**; on `auth/email-already-exists`, falls back to the existing `systemUsers` doc by email instead of failing.
    - Writes a `colleges/{id}/users/{uid}` login doc with **`role: "PANEL_MEMBER"`** (labeled "Faculty" in `ROLE_LABELS`) and a matching `systemUsers/{uid}` doc.
    - Creates the `facultyMembers/{new}` doc (`status: "ACTIVE"`, auto-incrementing `employeeId` via a `.count()` query), carrying over `pendingTeachingPreference` from the candidate's `courseId/year/preferredSubjectIds` **only if both were captured back at candidate-creation time** (Stage 2).
    - The retry endpoint's generated password is shown to the HOD **once**, in a "will not be shown again" dialog on `hod/offers` — it is not stored or emailed automatically.

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
| `POST /api/college/offer-letters` | Create + send offer, provisions faculty login in the same request | HOD, Principal, VP, Super Admin |
| `PATCH /api/college/offer-letters/[id]` | Accept/reject | HOD, Principal, VP, Super Admin |
| `POST /api/college/offer-letters/[id]/provision` | Manual/idempotent faculty provisioning retry | HOD, Principal, VP, Super Admin |
| `POST /api/public/student-feedback` | Anonymous demo feedback | none (public) |

---

## Known Gaps & Dead Code (as of this trace)

- `BatchPhase` values `CANDIDATE_COLLECTION`, `PANEL_SETUP`, `COLLEGE_OFFICE_SETUP` are declared in the type but never actually written by any route — real phase sequence is `PRINCIPAL_REVIEW → HOD_FINAL_SETUP → INTERVIEW_READY → IN_PROGRESS → PANEL_INTERVIEW → PRINCIPAL_FINAL_REVIEW → COMPLETED`.
- HR feedback (`HRFeedback`) has a working API but no reachable UI form.
- `HiringDocVerification` type/collection is fully unused; document verification is done ad-hoc via `Candidate.currentStage`/`status`, duplicated across two College Office pages.
- `AppointmentLetter` type/template exist but no route ever creates one.
- A legacy 2-segment public feedback route (`/feedback/[id]/[sub]`) is broken against the current API contract and unreachable from the app.
- Salary negotiation as a distinct recorded step is gone (`accounts/salary`, `HiringSalaryAgreement`, `POST /api/college/salary-records` all removed) — CTC is now just a field on the offer letter itself, set by whoever sends it.

---

## Budget & Indent/Purchase-Clearance Workflow

Separate module, same tenancy (`colleges/{collegeId}/...`). Newest and most-iterated part of the codebase — see `src/types/budget.ts` / `src/types/indent.ts` / `src/types/finance.ts` for the full shapes.

### Budget proposal (HOD → Principal → Finance)

`colleges/{collegeId}/budgetRequests/{id}` — one composite department proposal per submission (not one request per line item).

```
HOD submits                    → PENDING_PRINCIPAL_VERIFICATION
  Principal/VP: VERIFY         → L1_FROZEN
     Finance: APPROVE          → FINANCE_APPROVED  (creates FinanceBudget + auto-creates a linked
                                                      financePurchaseClearance, unless emergency/Non-Goods)
     Finance: REJECT           → FINANCE_REJECTED   (terminal)
     Finance: RETURN           → RETURNED_TO_HOD    (HOD edits, resubmits)
  Principal/VP: REJECT         → PRINCIPAL_REJECTED (terminal)
  Principal/VP: RETURN         → RETURNED_TO_HOD    (HOD edits, resubmits)
```

- **HOD** (`hod/budget`) builds the request from `nonRecurring`/`recurring` category groups (Lab Equipment, Furniture, Staff Salaries, Workshops, etc. — Annexure-2-style), each item carrying category-specific fields (`CATEGORY_FIELD_CONFIG`) plus optional ad-hoc custom fields per item. Totals roll up `item → category group → section → request` (`src/types/budget.ts`).
- **Principal/VP** (`principal/budget`, `principal/budget/report`) verify/reject/return, and view the Annexure-2 department rollup.
- **Finance** (`finance/budget-approvals` to approve/reject/return at `L1_FROZEN`; `finance/budget` for the resulting `FinanceBudget` ledger; `finance/budget/report` for the rollup) — the approval PATCH runs in a Firestore transaction with a fresh status re-read to prevent double-approval races.
- Every transition writes `history[]`, an `AuditLog` entry, and notifies the next role. API: `src/app/api/college/budget-requests/route.ts` (list/create) + `[id]/route.ts` (the state machine).
- **Known gap**: no data-migration script for the (twice-changed) `BudgetRequest` shape — `normalizeBudgetRequest()` defensively defaults missing arrays so old docs don't crash the UI, but pre-restructure requests render empty and need re-entry.

### Indent / Purchase Clearance (procurement that follows an approved budget)

Two parallel, same-shape flows: `colleges/{collegeId}/indentRequests/{id}` (HOD raises directly against a category) and `colleges/{collegeId}/financePurchaseClearance/{id}` (raised manually by an HOD, **or** auto-created when a budget request hits `FINANCE_APPROVED` above).

```
HOD submits, category picked → GOODS: PENDING_PURCHASE_REVIEW      NON_GOODS: PENDING_FINANCE_REVIEW (skips Purchase Dept)
  GOODS only:
    Purchase Dept: REJECT           → REJECTED_BY_PURCHASE (terminal)
    Purchase Dept: RETURN           → RETURNED_TO_HOD (HOD edits, resubmits)
    Purchase Dept: SEND_TO_FINANCE  → PENDING_FINANCE_REVIEW (needs ≥3 quotations, 1 selected)
    Finance: RETURN                 → RETURNED_TO_PURCHASE (Purchase Dept revises quotations)
  Both branches:
    Finance: REJECT  → REJECTED (terminal)
    Finance: APPROVE → GOODS: APPROVED → Purchase Dept buys → HOD uploads receipt/GRN → COMPLETED
                        NON_GOODS: COMPLETED directly
```

(`FinancePurchaseClearance` always follows the GOODS branch — it's always procurement.) Both Finance-approval PATCHes run in a transaction + fresh status re-read, same double-approval guard as the budget flow. API: `src/app/api/college/indent-requests/[id]/route.ts`, `src/app/api/college/finance-purchase-clearance/[id]/route.ts`; cross-college overview for the GLOBAL `PURCHASE_DEPT`/`FINANCE` roles at `src/app/api/purchase/indents/overview/` and `src/app/api/finance/budget-requests/overview/` (one read per college — no composite index deployed for a `collectionGroup` query yet).

**Fixed bug worth knowing about**: `notifyRole()` was copy-pasted across four route files without branching on `ROLE_SCOPE` — since `FINANCE`/`PURCHASE_DEPT` profiles live in global `systemUsers`, not a college's `users` subcollection, those roles were silently never notified of new/forwarded requests. Now centralized in `src/lib/notify.ts`; any new call site for these roles should import from there.

### Route reference (Budget/Indent)

| Route | Purpose | Who |
|---|---|---|
| `POST /api/college/budget-requests` | Submit department budget proposal | HOD |
| `PATCH /api/college/budget-requests/[id]` | Verify/reject/return (Principal), approve/reject/return (Finance) | HOD (resubmit), Principal, VP, Finance |
| `POST/PATCH /api/college/indent-requests[/id]` | Raise/advance an indent request | HOD, Purchase Dept, Finance |
| `POST/PATCH /api/college/finance-purchase-clearance[/id]` | Raise/advance a purchase clearance (or auto-created from an approved budget) | HOD, Purchase Dept, Finance |
| `GET /api/purchase/indents/overview` | Cross-college indent queue | Purchase Dept (global) |
| `GET /api/finance/budget-requests/overview` | Cross-college budget/clearance queue | Finance (global) |
