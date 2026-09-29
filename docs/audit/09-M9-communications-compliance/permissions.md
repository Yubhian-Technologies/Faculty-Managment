# M9 — Permissions (as-is)

| Action | Principal/VP | Allow-listed roles/uids | HOD (default) | Panel | Exam Cell | Students |
|---|---|---|---|---|---|---|
| Compose circular | ✅ implicit | ✅ if in CircularPermissionsDoc | ⚠️ (nav shows Megaphone; actual create right depends on permission doc — potential nav/rights mismatch `[GAP]`) | ⚠️ same | ➖ (uses exam-circulars) | ➖ |
| Publish | ✅ | ✅ if listed | ⚠️ | ⚠️ | ➖ | ➖ |
| Edit settings (messageFrom) | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Edit permissions doc | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Read published | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (via notifications link; viewer auth?) `[UNVERIFIED student viewer path]` |
| View feedback received | ➖ | ➖ | ➖ | ✅ | ➖ | ➖ |
| Submit feedback | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ public form |

## Enforcement
- Backend: permission doc checks at create/publish (service.ts/permissions.ts); frontend: `permissions/me` endpoint drives composer visibility.
- Nav (Megaphone for HOD/PANEL_MEMBER per AGENTS.md) may over-grant UI relative to permission doc — direct URL would 403 `[VERIFIED BY DESIGN, but UX mismatch]`.

## Gaps
1. Student access to `/circulars/[id]` viewer — is it proxy-public? Circulars is a dashboard route; students have no dashboard pages `[GAP]`.
2. Feedback abuse controls (rate limit, token entropy) `[UNVERIFIED]`.
3. Audit-log export absent.
