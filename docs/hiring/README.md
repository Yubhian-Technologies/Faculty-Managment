# Hiring Pipeline Flows

Ground-truth trace of the recruitment/hiring pipelines, generated from the actual API routes (not from type names or intent). Every transition cites its source file so it can be re-verified against the code as it changes.

**Flow notation used throughout:**

```
Role -action-> Result -> Role
```

Read as: *Role* performs *action*, producing *Result* (a status/state change), which then puts the next step in front of *Role*. A `->` with no role after it means the flow is terminal (nothing downstream reacts to it in code).

## The three pipelines

This system has **three separate, non-interoperating hiring pipelines**. They share only the `UserRole` type from `src/types/core.ts` — no shared runtime code path.

| Pipeline | Doc | Tenancy | Has candidates/interviews? | Provisions faculty accounts? | Has an audit trail? |
|---|---|---|---|---|---|
| A. College | [college-pipeline.md](college-pipeline.md) | `colleges/{id}/...` | Yes — full batch + panel scoring | Yes | Yes (`auditLogs`) |
| B. Location | [location-pipeline.md](location-pipeline.md) | `locations/{id}/...` | Yes — simpler, no batches | **No — dead-ends at offer approval** | **No** |
| C. General Admin | [general-admin-pipeline.md](general-admin-pipeline.md) | global | No — headcount approval only | No — not applicable | No |

## Known gaps and footguns (verified in code, not speculation)

- **`src/lib/firestore/hiring.ts` and `src/hooks/useHiring.ts` are vestigial.** Every College-pipeline API route talks to Firestore directly via `getAdminDb()`; `useHiring.ts` has zero importers anywhere in `src/`. Don't treat these as the "shared engine" — they aren't wired to anything live.
- **Location pipeline never provisions a faculty account.** No route under `src/app/api/location/` calls `provisionFacultyFromOffer`. It terminates at `locationOffers.status: "APPROVED"` with no Firebase Auth user, no `locations/{id}/locationUsers/{uid}` profile, no faculty record.
- **Location and General Admin pipelines have no audit log.** Only the College pipeline writes to an `auditLogs` collection. Location writes an ad-hoc `locationNotifications` shape whose `type` values (`"VACANCY_REQUEST"`, `"VACANCY_FORWARDED"`, `"INTERVIEW_PLAN_PENDING"`, ...) are **not** members of the `NotificationType` union in `core.ts`. Same for College pipeline's `OFFER_LETTER_CREATED` and General Admin's `GENERAL_ADMIN_VACANCY` notification types — all three are string literals used at call sites without a corresponding union member.
- **`positionCategory: "GENERAL_ADMIN"` is ambiguous.** The same string is reused across two structurally different collections: a vacancy can go through `colleges/{id}/vacancyRequests` (pipeline A's full HOD/Principal flow) *or* the dedicated `generalAdminVacancies` collection (pipeline C), depending on which route/UI page created it.
- **Offer letters skip `DRAFT`/`GENERATED`.** `OfferLetter.status` supports those states but the create route always writes `status: "SENT"` directly.
- **Panel scoring is not aggregated in the College pipeline.** `panelFeedback` docs store raw 1–5 ratings per panelist; there's no weighted-score formula. Contrast with the Location pipeline's interview feedback, which *does* compute `panelScore`/`studentScore`/`overallScore` (70/30 weighted).
- **PDF vs HTML for offer emails.** `POST /api/email/send` with `type: "OFFER_LETTER"` always attaches an `.html` letter — the Puppeteer PDF path exists (`/api/pdf/generate`) but isn't wired into the email attachment, only into the manual "download PDF" button.

## New hires log in as `PANEL_MEMBER`

There is no separate `FACULTY` role. `provisionFacultyFromOffer` (`src/lib/firestore/facultyProvisioning.ts`) writes the new `colleges/{id}/users/{uid}` profile with `role: "PANEL_MEMBER"` (UI label "Faculty") — that's how a newly hired teacher ends up able to log in and, later, sit on interview panels for future hires.
