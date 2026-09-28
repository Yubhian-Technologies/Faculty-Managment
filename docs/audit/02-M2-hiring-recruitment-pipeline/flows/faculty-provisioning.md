# Flow — M2-F5: Faculty Provisioning (post-hire account creation)

- **Flow ID:** M2-F5
- **Actors:** Webmaster (credentials), system (provisioning)
- **Trigger:** account request reaches CREDENTIALS_CREATED, or provisioning invoked post-acceptance
- **Preconditions:** accepted offer; candidate record; no existing facultyMember for uid (or reuse path)
- **Main success scenario:**
  1. Count existing facultyMembers (`facultyProvisioning.ts:24`) → derive employeeId.
  2. Read offer letter (:46) + candidate (:70).
  3. Transaction: create `facultyMembers/{id}` + `colleges/{id}/users/{uid}` (:119-123).
  4. Mirror global role map in `systemUsers/{uid}` (:182).
  5. Account request → COMPLETED; detailed hiring status → HIRING_COMPLETED (hiringPipeline.ts:66-69).
- **Alternate/error:** existing uid → reuse/relink path (:208-266: letter read, facultyMembers where, candidates read, users read) — avoids duplicate accounts; Auth failures bubble 500.
- **UI:** `/webmaster/credential-requests`, `/college-office/offers` (request button), `/accounts/pipeline` (status).
- **API:** `api/college/faculty-account-requests` + `[id]`; provisioning internal.
- **Backend:** `src/lib/firestore/facultyProvisioning.ts`; test `facultyProvisioning.test.ts`.
- **DB:** `facultyMembers`, `colleges/{id}/users`, `systemUsers`, `facultyAccountRequests`.
- **Permissions:** webmaster/office guards; provisioning server-side.
- **Validation:** email availability (email-requests/check-availability); role defaults to faculty-level.
- **State transitions:** FacultyAccountRequest SUBMITTED→IN_PROGRESS→CREDENTIALS_CREATED→COMPLETED (recruitment.ts:520).
- **Side effects:** credentials email `[UNVERIFIED]`; audit (provisioning auditLogs in userProvisioning twin path); notifications.
- **Concurrency:** transaction prevents duplicate facultyMember per candidate; employeeId counter race mitigated by count+tx `[ASSUMPTION]`.
- **Code evidence:** as cited; `facultyProvisioning.test.ts` exists.
