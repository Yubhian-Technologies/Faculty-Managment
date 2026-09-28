# FMS — Gaps & Risks (ranked, as-is)

Severity: **S1** critical (security/data loss), **S2** high (broken/incorrect), **S3** medium (degraded), **S4** low (hygiene).

| # | Sev | Area | Finding | Impact | Suggested follow-up |
|---|-----|------|---------|--------|---------------------|
| 1 | S1 | Platform (M1) | Plaintext credentials were committed in `ACADEMICSMODULE_TESTPLAN.md` (removed 2026-09-28) — still in git history | Credential compromise; audit failure | Rotate the password; history purge (filter-repo) |
| 2 | S1 | Platform | CI runs `lint` first; lint fails on main (128 errors) → typecheck/build/test never run (SHARED_FILES.md; `.github/workflows/ci.yml` step order) | No working CI gate | Fix React Compiler rule or reorder steps; make lint non-blocking temporarily |
| 3 | S1 | Data (cross) | Deployed Firestore rules lag repo file (last publish 2026-08-03; SHARED_FILES.md) | Security model drift | Deploy rules; add rules CI compile check |
| 4 | S2 | Auth (M1) | `verifySession.ts`/`scope.ts` decide every authorization outcome with thin tests (verifySession.test.ts exists but coverage partial; scope.test.ts exists — route-level authorization untested) | Regression risk on role rewrites | Contract tests per guard + per representative route |
| 5 | S2 | Tenancy | `requireCollegeContext` allows `?collegeId=` tenant selection (31 call sites) | One mis-guarded route = cross-tenant read | Audit each call site; pin allow-list to GLOBAL roles only |
| 6 | S2 | M5 | Student attendance has no import path despite module map saying "import" (route inventory) | Manual-only entry at scale | Decide: implement import or fix map |
| 7 | S2 | M4/M3 | `.slice(0,30)` caps in `scope.ts` (30 managed branches) silently truncate scope | HOD with >30 branches loses authority silently | Raise/remove cap with pagination |
| 8 | S2 | M7 | `ACCOUNTS` role's ROLE_SCOPE=COLLEGE while acting college-wide; tenancy migration pending (core.ts comments) | Mis-scoped queries/notifications | Finish Phase-2/3 tenancy migration |
| 9 | S3 | M1 | Nav visibility can hide but not block deep links beyond proxy prefixes | Cosmetic security only | Document as UI-only control |
| 10 | S3 | Cross | Audit logging is opt-in per route; uneven coverage | Incomplete compliance trail | Central helper + checklist per mutating route |
| 11 | S3 | M6 | Leave balances have `allow write: if false` rules that did nothing for months (OR-combined rules) — rules file ahead but deployment lag (see #3) | Silent rule no-ops | Deploy + rules unit tests |
| 12 | S3 | M9/M5 | `notifyRole`/notify are fire-and-forget; no retry/dead-letter | Lost notifications | Wrap with retry queue or transactional outbox |
| 13 | S3 | M2 | Public offer-acceptance/candidate-form endpoints: token security model not audited this pass (`[UNVERIFIED]`) | Enumeration risk if tokens guessable | Verify id/token entropy + rate limits |
| 14 | S3 | M3 | `DataTable` groupBy+paginate interaction bug (SHARED_FILES.md) | Wrong group counts on paginated lists | Fix grouping to aggregate pre-pagination |
| 15 | S3 | M8 | RND coordinator review gating per college type unverified per-route `[UNVERIFIED]` | Wrong college types can see review UI | Route-level verification + tests |
| 16 | S4 | Platform | `requireRoleOrHigher` dead code with warnings (zero call sites) | Confusion | Delete or adopt with tenant context work |
| 17 | S4 | M1 | `ROLE_DASHBOARD_PATHS` includes STUDENT but no student dashboard pages exist | Dead mapping | Implement or remove |
| 18 | S4 | Cross | `BOTTOM_NAV_ITEMS` hand-maintained; drifts from NAV_ITEMS | Mobile nav gaps | Derive from NAV_ITEMS |
| 19 | S4 | M5 | Offline submit queue persistence mechanism undocumented | Recovery behavior unclear | Document + test |
| 20 | S4 | Docs | AGENTS.md vs CLAUDE.md duality (two agent-context docs; AGENTS.md wins) | Agent drift | Keep single source; symlink or reconcile |

## Module-level gap notes

- **M1**: seat conversion legacy path exists (`role-seats/convert-legacy`) — one-time; verify it's complete before deletion.
- **M2**: largest module; panel scoring concurrency (double submit) handled? `[UNVERIFIED]` — see flows/panel-scoring.
- **M3**: timetable publish authority check (`facultyId==facultyMemberId OR substituteFacultyId`) per `periodCoverage.ts`/AGENTS.md — publish route guard `[UNVERIFIED]`.
- **M4**: `students/bulk-delete` exists — destructive op, check confirm + audit coverage.
- **M5**: face registration reset paths cascade properly (management reset for Principal exists).
- **M6**: `leave/seed` route exists (SUPER_ADMIN guard per verifySession referencedBy) — production seeding guardrail.
- **M7**: `finance-reports` aggregation coverage unverified.
- **M9**: circular permissions doc — allow-list roles vs uid; verify publish route checks both.
- **M10**: `location-interview/[id]` public page's backing API path needs confirmation.
- **M11**: thin departments fully reuse M5/M6 APIs — no separate backend; nav-only differentiation.
