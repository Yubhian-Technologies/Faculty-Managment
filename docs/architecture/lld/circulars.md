# LLD — Circulars & Communications Module

## Module Overview

College circulars: drafting, audience targeting, publishing with notifications, settings (message-from options), permissions (who may author), attachments, and public print/download viewers. Decoupled per SOLID in `src/types/circular.ts` + `src/lib/circular/`. Interface surface: `/api/college/{circulars, circulars/[id], circulars/[id]/publish, circular-settings, circular-permissions}`, `/api/upload/circular`, public viewer `src/app/(dashboard)/circulars/[id]` + public `circulars/[id]`.

## Component & Class Structure

| Component | Location | Responsibility |
|---|---|---|
| Domain types | `src/types/circular.ts` | `Circular`, `CircularAudience`, `CircularSettings`, `CircularPermission(sDoc)` |
| Lib layer | `src/lib/circular/` (`service.ts`, `permissions.ts`, `settings.ts`, `audienceSummary.ts`) | Audience resolution, `publishCircular` (idempotent: already-PUBLISHED returns as-is, no double notify), `requireCanSendCircular` gate |
| Upload | `api/upload/circular` | Storage at `colleges/{id}/circulars/` (verified path in route) |
| UI | `src/components/circular/` — `CircularCard` (abstraction over Card), `CircularForm`, `CircularViewer` | Form (employeeType/departments/date/subject/body/messageFrom/FileUpload, Save Draft/Publish), viewer with print/download of same HTML |
| Nav | `navConfig.ts` — `Megaphone` entry for `PRINCIPAL/HOD/PANEL_MEMBER` | Visibility |

## Sequence Diagram — draft → publish → notify

```mermaid
sequenceDiagram
    participant P as Principal/HOD (allowed author)
    participant A as /api/college/circulars
    participant PERM as circular-permissions doc
    participant FS as Firestore
    participant N as notifyAudience
    participant R as Reader (circular viewer)

    P->>A: POST {subject, body, date, audience{employeeType, departmentIds}, messageFrom, attachments}
    A->>PERM: check allowedUids / allowedRoles (PRINCIPAL & VP always allowed)
    A->>FS: circulars add (status DRAFT) | or direct PUBLISH
    P->>A: POST /circulars/[id]/publish
    A->>FS: status DRAFT→PUBLISHED
    A->>N: notifyAudience → AppNotification (type CIRCULAR_PUBLISHED, link /circulars/{id})
    N->>FS: colleges/{id}/notifications add per recipient (TEACHING | NON_TEACHING | ALL + departments)
    R->>A: GET /circulars/[id] → viewer; print/download renders same HTML
    P->>A: PUT circular-settings {messageFromOptions} (Principal-editable)
```

## Data Models & Schemas (src/types/circular.ts)

```ts
// src/types/circular.ts
type EmployeeScope = "TEACHING" | "NON_TEACHING" | "ALL";
type CircularStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
type CircularRecipientKind = "STAFF" | "STUDENTS";   // absent = STAFF (legacy docs)
CircularAudience {
  employeeType: EmployeeScope,
  departmentIds: string[],        // [] = all departments
  departmentNames?: string[],     // denormalized for display
  recipientKind?: CircularRecipientKind,
  targetYears?: number[],         // STUDENTS circulars only; []/absent = every year
}
CircularAttachment { fileName, fileUrl (Storage download URL), fileType?, fileSize? }
Circular {
  id, collegeId, subject, body, date: Timestamp, audience, messageFrom,
  attachments: CircularAttachment[],       // Storage: colleges/{id}/circulars/
  status: CircularStatus,
  createdBy, createdByName, createdByRole, publishedAt?, publishedBy?, publishedByName?,
  createdAt, updatedAt
}
CircularSettings      { messageFromOptions: string[] }  // Principal-managed
CircularPermission    { grantedToUid? | grantedToRole? | grantedToDepartment?, grantedBy, ... }
CircularPermissionsDoc{ allowedUids: string[], allowedRoles: UserRole[] }  // aggregated single doc
```

Docs live at `colleges/{id}/circulars/{id}` and `colleges/{id}/settings/{circularSettings, circularPermissions}` (verified: `src/lib/circular/settings.ts`).

## API/Method Contracts

- `GET /api/college/circulars` — list (role-filtered to authored + published-visible).
- `POST /api/college/circulars` — create DRAFT or PUBLISH inline; gated by `requireCanSendCircular` (permissions doc; Principal/VP always allowed); 403 otherwise.
- `POST /api/college/circulars/[id]/publish` — `publishCircular` flips status + best-effort fan-out notifications; **idempotent** (already-PUBLISHED returns the circular unchanged, no double notify). `ARCHIVED` exists in the type but is not set by any route today.
- `GET /api/college/circulars/[id]` — view (title = notification subject).
- `GET/PUT /api/college/circular-settings` — Principal only for PUT.
- `GET/POST /api/college/circular-permissions` — manage allow-list.
- `POST /api/upload/circular` — attachment upload, `requireCollegeMember` guard.

## Error Handling & Edge Cases

- Publishing twice must not double-notify (publish route guards on prior status).
- Audience resolution combines `employeeType` and `departmentIds`; ALL bypasses department filter. Employee-type resolution maps `facultyMembers` (TEACHING) vs supporting staff (NON_TEACHING) — the supporting-staff split rules apply (`src/lib/designations/config.ts`).
- Attachments are Storage paths served via rules; deletion of a circular should orphan-check attachments.
- Print/download uses the same HTML as the viewer — styling changes must stay in one template.
- Nav visibility (`Megaphone`) is cosmetic only; the API permission doc is the real gate.
