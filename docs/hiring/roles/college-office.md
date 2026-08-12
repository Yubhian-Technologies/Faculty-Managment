# College Office — College Hiring Role

See [../college-pipeline.md](../college-pipeline.md) for the full sequence this fits into, and [../README.md](../README.md) for the flow notation.

## Scope & pipeline position

College Office picks up the pipeline **after the Principal's hire decision** and owns everything through to handing the candidate off to Webmaster for account provisioning: sending the offer letter, tracking the candidate's response, verifying documents, uploading the signed joining letter, and requesting faculty credentials. It does not score candidates, approve vacancies, or provision accounts itself — it's the administrative through-line between "hired" and "logged in."

## Pages

`src/app/(dashboard)/college-office/...`
- `documents/page.tsx` — department-level "Hiring Pipeline" overview
- `documents/[department]/page.tsx`, `documents/[department]/[vacancyId]/page.tsx`
- `documents/candidate/[applicationId]/page.tsx` — the working page: offer status, document checklist, joining letter upload, credential request
- `candidates/page.tsx` — view-only candidate list
- `offers/new/page.tsx` — send offer letter
- `settings/faculty-credentials/page.tsx` — reveal generated passwords

## Actions

| Action | API call | Guard | Effect | Notifications / audit |
|---|---|---|---|---|
| Send offer letter | `POST /api/college/offer-letters` | `COLLEGE_OFFICE, PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN, ACCOUNTS` | Blocked unless `Candidate.bioDataSubmitted`; `OfferLetter{status: SENT}`, snapshots `offeredTerms`; PDF download + Gmail-compose client-side | Notifies HOD unless sender |
| Mark offer accepted/rejected (staff override for phone/paper confirmations) | `PATCH /api/college/offer-letters/[id]` | `COLLEGE_OFFICE, PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN` | Routes through the shared `applyOfferDecision()` transaction — same path the candidate's own public form uses, so the two can't race | `Candidate{status: APPROVED}` on accept |
| Verify documents checklist | `PATCH /api/college/candidate-applications/[id]` (`documentVerification`) | `COLLEGE_OFFICE` or Principal-tier | Computes `allVerified` against the batch's `requiredDocuments[]` | audit `DOCUMENTS_VERIFIED` |
| Upload joining letter scan | `PATCH .../candidate-applications/[id]` (`joiningLetterUrl`) | `COLLEGE_OFFICE` or Principal-tier | Sets `joiningLetterUrl`, `joiningLetterUploadedAt` | audit `JOINING_LETTER_UPLOADED` |
| Flag documents ready for appointment letter | `PATCH .../candidate-applications/[id]` (`notifyPrincipalDocsReady: true`) | `COLLEGE_OFFICE` or Principal-tier | — | Notifies `PRINCIPAL`/`VICE_PRINCIPAL` |
| Request faculty account/credentials | `POST /api/college/offer-letters/[id]/request-credentials`, `POST /api/college/faculty-account-requests` | `COLLEGE_OFFICE, PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN` | Strictly gated: offer must be `ACCEPTED`, candidate must have confirmed a joining date, a matching `AppointmentLetter` must exist. Does **not** provision anything itself | Notifies all `WEBMASTER`; audit `CREDENTIAL_REQUESTED` / `FACULTY_ACCOUNT_REQUEST_SUBMITTED` |
| Reveal generated password (one-time) | `PATCH /api/college/faculty-account-requests/[id]` (`action: REVEAL_CREDENTIALS`) | `COLLEGE_OFFICE, PRINCIPAL, VICE_PRINCIPAL, SUPER_ADMIN` | Transactional — password scrubbed from `credentialResult` the instant it's read | — |
| Download document-acknowledgement PDF | client-side only | — | — | — |

## Notes

- Every write College Office makes is also available to Principal-tier roles (the guards always list both) — in practice College Office is who actually does this day-to-day work.
- College Office can **request** credentials but cannot **create** them — `CREATE_CREDENTIALS` is Webmaster/SuperAdmin-only. See [webmaster.md](webmaster.md).
- The offer-acceptance gate (`bioDataSubmitted`) means College Office may need to chase the HOD to confirm the candidate filled the bio-data form (see Stage 3 in the full-flow doc) before an offer can be sent.
