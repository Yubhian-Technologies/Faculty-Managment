# M9 — Communications & Compliance (as-is)

## Purpose
Circulars (role-gated creation, draft/publish, audience targeting, attachments), college audit logs (compliance trail, shared with M1-SM4), and student→faculty feedback via public form + panel recipients.

## Status: Implemented.

## Submodules
| ID | Submodule | Status |
|---|---|---|
| M9-SM1 | Circulars (+settings, permissions) | Implemented (SOLID decoupled per AGENTS.md) |
| M9-SM2 | Audit Logs (college) | Implemented (shared with M1-SM4) |
| M9-SM3 | Student → Faculty Feedback | Implemented |

## Dashboards/roles
Principal/VP (`/principal/circulars`, settings), HOD (`/hod/circulars`), Panel (`/panel/circulars`, `/panel/feedback`), Exam Cell (`/exam-cell/circulars`), shared viewer `/circulars/[id]`; faculty receive feedback via panel pages.

## Dependencies
- Depends on M1 (roles, nav), M2 (recipients? no — staff audiences), M3 (department audience lists).
- Depended on by exam circulars (M3-SM8 uses its own exam-circulars collection — parallel system `[NOTE]`).

## Key code locations
- Types: `src/types/circular.ts` — Circular {subject, body, date, audience{employeeType TEACHING|NON_TEACHING|ALL, departmentIds}, messageFrom, attachments, status DRAFT|PUBLISHED}, CircularSettings (messageFromOptions: default Management/Principal/Academics/HOD, editable by Principal), CircularPermissionsDoc {allowedUids, allowedRoles}.
- Libs: `src/lib/circular/service.ts` (collection ref :11; audience resolution users :141-149; students REGULAR :176-183), `settings.ts` (:10), `permissions.ts` (:12); `src/components/circular/*` (CircularCard/Form/Viewer).
- API: `api/college/circulars` (+`[id]`, `[id]/publish`, `permissions/me`), `circular-settings`, `circular-permissions`, `api/college/audit-logs`, `api/college/student-feedback`, `api/public/student-feedback`.
- UI: pages above; `upload/circular` → Storage `colleges/{id}/circulars/` (AGENTS.md).

## Key stores
`colleges/{id}/circulars`, `settings` (circular settings + permissions docs), `auditLogs`, `studentFeedback`.

## Jobs
None.

## Major gaps
1. Circular audience targeting vs department arrays — publish fan-out is compute-on-read (service.ts:141-183) `[ASSUMPTION — no recipient fan-out writes]`.
2. Two circular systems (college circulars + exam-circulars in M3) — intentional? `[OPEN]`.
3. Feedback anonymity/abuse controls on public route `[UNVERIFIED]`.
