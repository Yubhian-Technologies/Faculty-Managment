# Flow — M2-F3: Offer Letter Generation → Candidate Acceptance

- **Flow ID:** M2-F3
- **Actors:** College Office (create/send), Accounts (verify), Principal (negotiate), Candidate (accept/reject public), HR Admin (location offers)
- **Trigger:** Principal final approval → candidate DECISION stage APPROVED (offerLetterDecision.ts:22-62 sets candidates.status=APPROVED in tx)
- **Preconditions:** application at DECISION; salary terms negotiated (terms snapshot exists)
- **Main success scenario:**
  1. Office creates offer: `POST /api/college/offer-letters` → status DRAFT (designation, department, joiningDate, ctcAnnual, offeredTerms snapshot — recruitment.ts:458-477).
  2. Generate PDF: `/api/pdf/generate` (contact block via `lib/offerLetterContactBlock.ts`) → pdfUrl, status GENERATED.
  3. Send: `PATCH [id]` → status SENT; CC resolved once (`offerLetterCc.ts:16-31`: Principal/VP/panel/HOD/Accounts; location ACCOUNTS via locationUsers); email via SMTP.
  4. Candidate opens `/offer-acceptance/[collegeId]/[offerId]` → `POST /api/public/offer-acceptance/[collegeId]/[offerId]` → status ACCEPTED, `termsAcceptedAt`, `respondedBy: "CANDIDATE"`, optional `candidateConfirmedJoiningDate`.
  5. Office uploads joining letter (`/api/upload/joining-letter` → joiningLetterUrl) → requests faculty account (M2-SM5).
- **Alternate/error:** reject → status REJECTED (respondedAt); staff manual override (respondedBy=uid); expired offer `[UNVERIFIED]`; PDF fallback raw HTML when no Chromium (AGENTS.md).
- **UI:** `/college-office/offers` (+`/offers/new`), `/hr-admin/offers/new`, `/administration/offers/[id]/reject`, `/college-accounts/candidates|/hiring`, `/principal/negotiate/[id]`.
- **API:** `api/college/offer-letters` + `[id]`; `api/public/offer-acceptance/[collegeId]/[offerId]`.
- **Backend:** offerLetterDecision.ts, offerLetterCc.ts.
- **DB:** `offerLetters` (per-college), `candidates`.
- **Permission checks:** college guard; public acceptance tokenized by offerId path (entropy `[UNVERIFIED]`).
- **Validation:** ctcAnnual ≥ 0; joiningDate future `[ASSUMPTION]`; terms snapshot non-empty.
- **State transitions:** DRAFT→GENERATED→SENT→ACCEPTED|REJECTED (recruitment.ts:477).
- **Side effects:** emails to candidate + CC; notifications office/webmaster; audit `[UNVERIFIED]`.
- **Reports:** PDF letter (print/download).
- **Concurrency:** accept-after-reject guarded by status machine `[ASSUMPTION]`; double-accept idempotent by status.
- **Code evidence:** as cited; UI files via getDetailedHiringStatus referencedBy (CollegeAccountsHiringBoard etc.).
