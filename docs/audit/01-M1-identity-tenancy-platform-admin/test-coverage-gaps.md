# M1 — Test Coverage & Gaps (as-is)

## Existing tests relevant to M1
| Test | Covers | File |
|---|---|---|
| Session token sign/verify | HMAC cookie | `src/lib/auth/sessionToken.test.ts` |
| verifySession guards | guard behaviors (partial) | `src/lib/auth/verifySession.test.ts` |
| Seat roles | seat ordering/pick | `src/lib/roles/seatRoles.test.ts` |

## Missing tests
1. `liveRoles.ts` cache-TTL revocation behavior (security-relevant).
2. `officeRoles.ts` college-type gating matrix (Engineering/Degree/Polytechnic/School).
3. Provisioning flows (userProvisioning) — root selection per ROLE_SCOPE.
4. Admin routes: none (no route-level tests for `api/admin/**`).
5. Nav visibility defaults consistency (`navVisibilityDefaults.ts` vs navConfig module ids).

## Risky untested flows
- requireRole rewrite semantics for seat holders under concurrent seat changes.
- role-seats convert-legacy one-time migration (re-run safety unknown).
