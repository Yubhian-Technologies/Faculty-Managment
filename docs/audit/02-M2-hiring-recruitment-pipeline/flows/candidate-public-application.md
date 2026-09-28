# Flow — M2-F2: Public Candidate Application (careers → candidate form)

- **Flow ID:** M2-F2
- **Actors:** Public candidate
- **Trigger:** visits `/careers/[collegeId]`, picks a vacancy, opens `/candidate-form/[collegeId]/[candidateId]`
- **Preconditions:** college has public vacancies listed; candidate token valid
- **Main success scenario:**
  1. `GET /api/college/colleges-directory` + vacancy listing for careers page `[UNVERIFIED exact public listing route]`.
  2. Fill form → `POST /api/public/candidate-form/[collegeId]/[candidateId]` → creates/updates `candidates` + `candidateApplications` (source WALK_IN/CAREERS_PAGE etc.).
  3. Resume upload via `/api/upload/resume` (public-allowed variant `[UNVERIFIED guard]`).
  4. Notify HOD (notify call sites for candidate-applications — notify.ts referencedBy).
- **Alternate/error:** invalid collegeId/candidateId → 404; validation 400; duplicate application → upsert/409 `[UNVERIFIED]`.
- **UI:** `/careers/[collegeId]`, `/candidate-form/[collegeId]/[candidateId]`; proxy PUBLIC_PATHS covers `/careers`, `/candidate-form` (proxy.ts:16-30).
- **API:** public candidate-form route (M10 boundary).
- **Backend:** route inline; candidate/application docs per types/recruitment.ts:86-227.
- **DB:** `candidates`, `candidateApplications`; index [candidateId, createdAt desc], [vacancyRequestId, isShortlisted].
- **Permission checks:** unauthenticated by design; tokenized path params.
- **Validation:** name/email/phone; vacancy id must be open `[UNVERIFIED status check]`.
- **State transitions:** candidate PENDING → shortlisted by HOD later.
- **Side effects:** notification to HOD/department heads; storage resume.
- **Concurrency:** same candidate applying twice — dedupe by candidateId token `[ASSUMPTION]`.
- **Code evidence:** page routes; `src/app/api/public/candidate-form/[collegeId]/[candidateId]/route.ts`; PUBLIC_PATHS proxy.ts:16-30.
