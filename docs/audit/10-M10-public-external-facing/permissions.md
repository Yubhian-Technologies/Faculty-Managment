# M10 — Permissions (as-is)

| Surface | Auth | Enforcement |
|---|---|---|
| `/careers/[collegeId]` | public | college must exist; vacancies filtered `[UNVERIFIED open-status filter]` |
| `/candidate-form/[collegeId]/[candidateId]` | public | path ids act as capability |
| `/offer-acceptance/[collegeId]/[offerId]` | public | offer must be SENT/undecided (status machine) |
| `/faculty-public/[param]` | public | read-only projection |
| `/location-interview/[id]` | public | `[UNVERIFIED]` |
| `/feedback/[id]/[sub]` | public | tokenized path |
| `/` landing | public | client redirect when session present |

## Enforcement points
- Proxy explicitly public-lists all these prefixes (proxy.ts:16-30); APIs skip proxy (`/api/` — proxy.ts:104).
- Backend validation of ids per route `[UNVERIFIED depth — key security review item]`.

## Gaps
1. No rate limiting/captcha found on public POSTs.
2. Path-id entropy unverified (Firestore auto-ids are high-entropy — likely acceptable `[ASSUMPTION]`).
3. Public upload guard variants unclear.
