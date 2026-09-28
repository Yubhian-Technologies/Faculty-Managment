# M8 — Permissions (as-is)

| Action | Faculty (self) | RND_COORDINATOR (seat) | R_AND_D | Principal |
|---|---|---|---|---|
| Create/edit own records | ✅ | ✅ | ✅ | ➖ |
| Import publications | ➖ | ➖ | ✅ | ➖ |
| Pre-review dept submissions | ➖ | ✅ (seat via roleSeats) | ➖ | ➖ |
| View all college records | 🔎 own | 🔎 dept | ✅ | 🔎 |
| Citation metrics / research profile write | own? | ➖ | ✅ | ➖ |
| Coordinator seat grant | ➖ | ➖ (Principal/HOD appoints — M1) | ➖ | ✅ |

## Scoping
- College guard everywhere; seat is department-scoped (core.ts:52-55 comment); projections write only via libs (no direct client write to projections `[ASSUMPTION]`).

## Enforcement
- Backend: college guards + seat check in research-review; Frontend: `/rnd-coordinator` visible only to seat holders (proxy RND_COORDINATOR path; navConfig).

## Gaps
1. Self-edit of citation metrics by faculty (own `[uid]` PATCH) — allowed? `[UNVERIFIED]`
2. College-type gating of the seat (map implies engineering colleges only?) `[UNVERIFIED]`.
