# Flow — M10-F1: Public Candidate Application & Offer Acceptance

- **Flow ID:** M10-F1
- **Actors:** public visitor (candidate)
- **Trigger:** careers page visit / offer email link
- **Preconditions:** college exists; vacancy open; offer SENT and undecided
- **Main success scenario (application):**
  1. `/careers/[collegeId]` lists vacancies (data via `colleges-directory`/vacancy public reads `[UNVERIFIED guard]`).
  2. `/candidate-form/[collegeId]/[candidateId]` → `POST api/public/candidate-form/...` → candidate + candidateApplication (source CAREERS_PAGE) → resume via upload.
- **Main success scenario (acceptance):**
  1. `/offer-acceptance/[collegeId]/[offerId]` renders `offeredTerms` snapshot.
  2. `POST api/public/offer-acceptance/...` → status ACCEPTED|REJECTED, respondedBy=CANDIDATE, termsAcceptedAt, optional candidateConfirmedJoiningDate.
- **Alternate/error:** invalid/expired ids → 404; already-decided → guard message; upload failure → retry.
- **UI:** pages cited.
- **API:** 4 public routes + directory read.
- **DB:** candidates, candidateApplications, offerLetters.
- **Permission checks:** none (by design) — capability = path ids `[GAP: entropy/rate-limit]`.
- **Validation:** form fields; terms acceptance required before accept.
- **State transitions:** application PENDING; offer SENT→ACCEPTED|REJECTED.
- **Side effects:** notifications to office/HOD; uploads to Storage.
- **Code evidence:** proxy.ts:16-30; page inventory; recruitment.ts:458-490.
