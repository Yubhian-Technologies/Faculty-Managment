# M10 — Public / External-Facing (as-is)

## Purpose
Unauthenticated ingress surfaces: candidate application (into M2), careers listing per college, offer acceptance (into M2 decisions), faculty public profiles, location interview self check-in, public student feedback (M9).

## Status: Implemented.

## Submodules
| ID | Submodule | Status |
|---|---|---|
| M10-SM1 | Candidate application form | Implemented |
| M10-SM2 | Careers page (per college) | Implemented |
| M10-SM3 | Offer acceptance | Implemented |
| M10-SM4 | Faculty public profile | Implemented |
| M10-SM5 | Location interview page | Implemented |

## Dashboards/roles
None — public routes (proxy PUBLIC_PATHS: `/careers`, `/candidate-form`, `/offer-acceptance`, `/faculty-public`, `/location-interview`, `/feedback`, `/models` — proxy.ts:16-30).

## Dependencies
- Feeds M2 (candidates, offer decisions); reads M1/M2 data (college directory, faculty profiles); feedback feeds M9.

## Key code locations
- Pages: `src/app/(dashboard)`-external siblings: `/candidate-profile/[id]` (auth), public: `/careers/[collegeId]`, `/candidate-form/[collegeId]/[candidateId]`, `/offer-acceptance/[collegeId]/[offerId]`, `/faculty-public/[param]`, `/faculty-public/demo`, `/location-interview/[id]`, `/feedback/[id]/[sub]`.
- APIs: `api/public/candidate-form/[collegeId]/[candidateId]`, `api/public/offer-acceptance/[collegeId]/[offerId]`, `api/public/faculty-public`, `api/college/colleges-directory` (public careers data `[UNVERIFIED guard]`).
- Landing: `src/app/page.tsx` (public `/` with client redirect for signed-in users — proxy.ts:9-12 comment), `src/components/landing/*`.

## Key stores
`candidates`, `candidateApplications`, `offerLetters`, `facultyMembers`/`users` (public profile read), `studentFeedback`.

## Major gaps
1. Token model: path ids (collegeId/candidateId/offerId) — entropy and enumeration risk `[GAP — security review]`.
2. Rate limiting/abuse controls on public POSTs `[GAP]`.
3. Careers listing API guard status (public vs college guard) `[UNVERIFIED]`.
