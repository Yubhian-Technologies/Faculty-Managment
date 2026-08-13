# Webmaster — College Hiring Role

See [../college-pipeline.md](../college-pipeline.md) for the full sequence this fits into, and [../README.md](../README.md) for the flow notation.

`WEBMASTER` is a college-scoped "internal office role" (like `DEAN`/`IQAC_COORDINATOR`/`T_AND_P`/etc. — see `src/lib/roles/officeRoles.ts`), not a location or global role. In the hiring pipeline it plays one, late, high-consequence part: turning an accepted offer into an actual login.

## Scope & pipeline position

Webmaster is the pipeline's **terminal actor**. It only becomes involved once College Office has requested a faculty account (Stage 13 of the full flow) — everything upstream (vacancy, candidates, interviews, decision, offer, appointment letter, document verification) is invisible to it. Its job is to review the request, create the Firebase Auth login + faculty record, and close the request out. Per `isHiringClosed()` (`src/lib/hiringPipeline.ts:146-159`), the hire is not considered fully closed until Webmaster's work reaches `CREDENTIALS_CREATED` or `COMPLETED` — not when the batch itself hit `COMPLETED` back at the decision stage.

## Pages

`src/app/(dashboard)/webmaster/...`
- `page.tsx` — dashboard home
- `credential-requests/page.tsx` — the working queue: review, create credentials, complete
- `users/page.tsx` — general user management (not hiring-specific)

## Actions

| Action | API call | Guard | Effect | Notifications / audit |
|---|---|---|---|---|
| Start review | `PATCH /api/college/faculty-account-requests/[id]` (`action: START_REVIEW`) | `WEBMASTER, SUPER_ADMIN` | `FacultyAccountRequest{status: SUBMITTED → IN_PROGRESS}` | audit `FACULTY_ACCOUNT_REQUEST_IN_PROGRESS` |
| Create credentials | `PATCH .../faculty-account-requests/[id]` (`action: CREATE_CREDENTIALS`, optional supplied password ≥6 chars) | `WEBMASTER, SUPER_ADMIN` | Calls `provisionFacultyFromOffer()` **before** flipping status (a failed provision never leaves the request stuck mid-transition); email fallback across `officialEmail → alternateEmail1 → alternateEmail2`; on success `FacultyAccountRequest{status: CREDENTIALS_CREATED, credentialResult.password}` | Notifies the requesting Office user, plus the vacancy's HOD and all Principals/VPs (`CANDIDATE_HIRED`) — described in-code as the pipeline's true terminal notification; audit `FACULTY_ACCOUNT_REQUEST_CREDENTIALS_CREATED` |
| Complete | `PATCH .../faculty-account-requests/[id]` (`action: COMPLETE`) | `WEBMASTER, SUPER_ADMIN` | `FacultyAccountRequest{status: CREDENTIALS_CREATED → COMPLETED}` | audit `FACULTY_ACCOUNT_REQUEST_COMPLETED` |
| Manual provision retry (offers predating auto-provisioning) | `POST /api/college/offer-letters/[id]/provision` | `WEBMASTER, SUPER_ADMIN` | Requires `credentialsRequestedAt` already set; calls `provisionFacultyFromOffer()` directly | Sets `credentialsFulfilledAt/By`; audit `CREDENTIAL_REQUEST_FULFILLED` |

## What `provisionFacultyFromOffer()` actually does

(`src/lib/firestore/facultyProvisioning.ts:27-179`, invoked from `CREATE_CREDENTIALS` above)

1. Idempotency check — if a `facultyMembers` doc already exists for the candidate, returns `already_exists` rather than duplicating.
2. Resolves the login email: Webmaster's/Office's supplied `collegeEmail`, falling back to the candidate's personal application email.
3. Creates a Firebase Auth user (REST); if the email is already taken (`auth/email-already-exists`), returns `email_taken` rather than hijacking an unrelated account.
4. Generates a sequential `employeeId` (`EMP0001`-style).
5. In one batch write: `colleges/{id}/users/{uid}{role: "PANEL_MEMBER"}` (merge), `colleges/{id}/facultyMembers/{id}{status: ACTIVE if offer already accepted, else INTERVIEW_DONE}`, `systemUsers/{uid}` (merge).
6. Returns the generated password once — this is what `credentialResult.password` in the request doc holds until `COLLEGE_OFFICE` reveals it.

## Notes

- **New hires log in with `role: "PANEL_MEMBER"`** (UI label "Faculty") — there is no separate `FACULTY` role in `UserRole`. This is why a newly hired teacher can later sit on interview panels for future hiring cycles.
- Webmaster never sees the password after creating it — `REVEAL_CREDENTIALS` is a College Office action (see [college-office.md](college-office.md)), and it's a one-time, transactionally-scrubbed read.
- Provisioning is idempotent at every layer — retrying `CREATE_CREDENTIALS` or the manual `/provision` endpoint after a partial failure is safe.
