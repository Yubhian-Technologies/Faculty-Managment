# Dashboard — WEBMASTER (`/webmaster`)

- **Role:** WEBMASTER (L5, COLLEGE)
- **Route root:** `/webmaster` (11 pages)
- **Guard:** proxy path; college member guards on backing APIs.

## Pages/widgets and data sources
| Page | Widgets/Tables | API | Notes |
|---|---|---|---|
| `/webmaster` (home) | Request counters | `api/college/faculty-account-requests` (counts) `[UNVERIFIED]` | |
| `/webmaster/credential-requests` | Faculty account requests queue (approve/reject) | `GET/PATCH /api/college/faculty-account-requests/[id]`, list route | M2-SM5 boundary; notifies via `notify` (see referencedBy) |
| `/webmaster/users` | Provisioned accounts table | `api/college/users` (read) | |
| `/webmaster/requests` | Email/account request inbox | `api/college/email-requests*` (incl. `check-availability`) | email creation pipeline |
| `/webmaster/history` | Action history | audit or request logs `[UNVERIFIED]` | |
| `/webmaster/leave*` | Self-service leave (M6 reuse) | `api/leave/*` | |
| `/webmaster/profile*` | Profile (module editor) | `api/college/faculty/me` etc. | |

**Password reset:** `POST /api/college/webmaster/reset-password` — the only sanctioned password reset for college accounts (navConfig.ts showOnlyForRealRoles comment: College Admin's reset item removed when it became Webmaster-only).

## Filters/scopes
- College-scoped via `requireCollegeMember`.

## Permissions
- Backend per-route guards; frontend nav roles:["WEBMASTER"].

## Drill-downs
- Request → user → profile.

## Export/report
- None found `[GAP]`.

## Code evidence
- `src/app/(dashboard)/webmaster/**`; `src/app/api/college/faculty-account-requests/**`; `src/app/api/college/email-requests/**`; `src/app/api/college/webmaster/reset-password/route.ts`; notify call sites in `notify.ts` referencedBy.
