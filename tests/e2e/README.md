# Budget & Indent Playwright Suite

Automates the P0/P1 cases from the [Budget & Indent QA Test Plan] for the four
procurement lifecycles: Regular Budget, Emergency Budget, Goods Indent,
Non-Goods Indent, plus cross-cutting session/tenancy checks.

[Budget & Indent QA Test Plan]: (see the artifact link shared alongside this suite)

## Layout

```
tests/e2e/
  support/
    testUsers.ts   role/env-var registry (HOD, PRINCIPAL, FINANCE, PURCHASE_DEPT, MANAGEMENT)
    session.ts      builds an fms-session cookie, or does a real Firebase login
    apiClient.ts     pre-authenticated APIRequestContext wrapper
    builders.ts      valid request-body factories for each flow
  api/
    budget-regular.spec.ts     Flow A (BUD-A-*)
    budget-emergency.spec.ts   Flow B (BUD-B-*)
    indent-goods.spec.ts       Flow C (IND-G-*)
    indent-non-goods.spec.ts   Flow D (IND-N-*)
    security.spec.ts           Cross-cutting (SEC-*)
  ui/
    login.spec.ts               real Firebase login through the actual form
    budget-regular-ui.spec.ts   HOD -> Principal -> Finance through the real dashboards
```

Test IDs (`BUD-A-01`, `IND-G-05`, ...) match the matrix in the QA test plan —
grep either one to cross-reference the other.

## Why cookie injection instead of logging in every test

`fms-session` (`src/lib/auth/verifySession.ts`) is a base64 JSON payload with
no signature — `/api/auth/session` only checks a real Firebase ID token
*once*, when minting it. Nothing re-verifies the cookie on later requests.
`support/session.ts` mints that same cookie shape directly for a given test
user, so API specs don't need six real passwords and a network round-trip to
Identity Toolkit for every one of the ~70 cases in the matrix — they need one
real login, covered separately by `ui/login.spec.ts`. This shortcut is also
tracked as a documented finding (SEC-01) in the QA plan, not an oversight —
flag it to engineering if unsigned sessions aren't intended for production.

Set `AUTH_MODE=login` (see `support/session.ts`'s `loginViaFirebaseAuth`) if
you'd rather every spec go through real Firebase Auth; you'll need
`TEST_*_PASSWORD` for every role plus `NEXT_PUBLIC_FIREBASE_API_KEY`.

## Setup

1. Seed a non-production Firebase project (or a dedicated test college inside
   a shared dev project) with one user per role: `HOD` (with `department`
   set on their profile), `PRINCIPAL`, `FINANCE` and `PURCHASE_DEPT` and
   `MANAGEMENT` (all three as `systemUsers` docs — they're GLOBAL roles).
2. `cp tests/e2e/.env.test.example tests/e2e/.env.test` and fill in the UIDs
   / college ID / emails (passwords only needed for the two `ui/login.spec.ts`
   cases and if you switch to `AUTH_MODE=login`).
3. Make sure the app's own `.env` has working `FIREBASE_ADMIN_*` credentials
   pointed at the same project the test UIDs live in — the dev server the
   suite drives needs real Firestore access.

## Running

`playwright.config.ts` loads `tests/e2e/.env.test` automatically (via
`dotenv`) — no manual sourcing needed.

```bash
npm run test:e2e                 # headless, auto-starts `npm run dev`
npm run test:e2e -- --ui         # Playwright's interactive UI mode
npm run test:e2e -- --headed     # watch the browser for the ui/ specs
npx playwright show-report       # after a run, opens the HTML report
```

If a dev server is already running on `PLAYWRIGHT_BASE_URL`, Playwright reuses
it (`reuseExistingServer`) instead of starting a second one.

## What isn't automated here

Cases marked `manual` in the QA plan need either a crafted malicious payload
(SEC-01) or two genuinely concurrent sessions racing the same document
(BUD-A-23) — both are easy to script but easy to get a false negative from in
an ordinary CI runner, so they're left as documented manual-test steps rather
than flaky automation. The full ~70-case matrix (including P2 items like
custom budget-item fields and audit-log label assertions) lives in the QA
plan; this suite automates the P0/P1 subset that gates a release.
