# M2 — Permissions (as-is)

## Role-by-action matrix

| Action | HOD | Principal/VP | College Office | HR_ADMIN | ADMIN_OFFICE | Administration/LDH | Accounts | College Accounts | Panel | Webmaster | Super Admin |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Raise vacancy | ✅ | ➖ | ➖ | ➖ | ➖ | ✅ (location twin) | ➖ | ➖ | ➖ | ➖ | ✅ (general-admin) |
| Approve/return vacancy | ➖ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ |
| Add/shortlist candidates | ✅ | 🔎 | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Public application | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ (public) |
| Configure batch (panel/venue) | ✅ | ➖ | ➖ | ➖ | ➖ | ✅ (location) | ➖ | ➖ | ➖ | ➖ | ➖ |
| Score demo/panel | ✅ (locked-in) | ✅ (locked-in) | 🔎 | ➖ | ➖ | ➖ | 🔎? | ➖ | ✅ | ➖ | 🔎 |
| Coordinator session | ✅ (delegated coord) | ➖ | ➖ | ➖ | ➖ | ✅ | ➖ | ➖ | ✅ | ➖ | ➖ |
| Final decision | ➖ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Create/send offer | ➖ | 🔎 | ✅ | ✅ | ➖ | ✅ | 🔎 | 🔎 | ➖ | ➖ | ➖ |
| Verify/CTC (accounts pipeline) | ➖ | 🔎 | ➖ | ➖ | ➖ | ➖ | ✅ | ✅ | ➖ | ➖ | ➖ |
| Accept offer (public) | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ (candidate) |
| Request faculty account | ➖ | ➖ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Fulfill credentials | ➖ | ➖ | 🔎 | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ | ➖ |
| Documents vault | 🔎 | 🔎 | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |

## Scoping
- College-scoped (`requireCollegeMember`); HOD additionally department-scoped via `lib/departments/scope.ts`; panel scoring limited to `batch.panelMemberUids` + locked-in leadership (notify.ts:44-53) `[route-level check UNVERIFIED]`.
- Location hiring twins: `requireLocationMember`.
- Public endpoints: tokenized by path ids — no auth; entropy unverified `[GAP]`.

## Seat limits
- Single coordinator per batch (field); panel size unlimited `[UNVERIFIED]`.

## Module/nav visibility
- Pipeline boards gated by navConfig roles; "My Interviews" injected dynamically for roles without embedded boards (ROLES_WITH_EMBEDDED_PANEL_ACCESS navConfig.ts:45-51).

## Backend vs frontend
- Backend enforcement verified for vacancy/offer/batch route guards (referencedBy guard lists); panel membership check assumed per route `[UNVERIFIED]`.

## Gaps
1. Panel-membership enforcement per scoring route not verified.
2. Public token entropy/rate limiting unverified.
3. Accounts' scoring access (🔎?) unclear — proxy grants shared paths; backend matrix unknown.
