# M6 — Permissions (as-is)

| Action | Staff (self) | HOD | Principal/VP | College Office | Management |
|---|---|---|---|---|---|
| Apply leave/permission/OD | ✅ | ✅ | ✅ | ✅ | ✅ |
| Approve stage 1 (dept) | ➖ | ✅ own dept | ✅ (skip-through) | ➖ | ➖ |
| Final approve | ➖ | ➖ | ✅ | ➖ | ✅ (Principal's own only) |
| Edit leave profiles | ➖ | ✅ dept | ✅ | ✅ college | ➖ |
| Assign staff adjustment | ➖ | ✅ dept (scope-checked) | ✅ | ✅ (non-teaching) | ➖ |
| Respond to adjustment invite | ✅ (own invites) | ✅ | ✅ | ✅ | ✅ |
| Leave-history reports | own | ✅ dept | ✅ college | ✅ college | ➖ |
| Import history | ➖ | ➖ | ➖ | ✅ | ➖ |
| Other leave categories | ➖ | ➖ | ✅ | ➖ | ➖ |
| Seed profiles | ➖ | ➖ | ➖ | ➖ | ➖ (SUPER_ADMIN only) |

## Scoping
- Approval routing by identity/staff-category (identity.ts, staffCategoryRouting); HOD dept-scope; Management write only via sanctioned route (verifySession.ts:84-91).

## Backend vs frontend
- Verified: leave routes guards (referencedBy); Management approval route requireManagement.

## Gaps
1. Leave balances not writable via client (rules `allow write: if false`) — but rules deployment lag means production may differ (SHARED_FILES.md).
2. Who may edit Principal's profile? (Nobody college-side; Management?) `[UNVERIFIED]`.
