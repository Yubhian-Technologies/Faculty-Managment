# Flow — M9-F1: Circular Compose → Publish → Audience Notification

- **Flow ID:** M9-F1
- **Actors/Roles:** PRINCIPAL/VP (implicit), allow-listed roles/uids
- **Trigger:** compose at `/principal/circulars`
- **Preconditions:** permission doc grants creator; attachments uploaded
- **Main success scenario:**
  1. `POST /api/college/circulars` {subject, body, date, audience{employeeType TEACHING|NON_TEACHING|ALL, departmentIds}, messageFrom (from settings options), attachments} → DRAFT (Circular type per AGENTS.md/types/circular.ts).
  2. `POST /api/college/circulars/[id]/publish` → permission re-check → status PUBLISHED.
  3. `notifyAudience` resolves recipients: users by audience (:141-149) + students status REGULAR (:176-183) → writes `CIRCULAR_PUBLISHED` notifications with link `/circulars/{id}`.
  4. Audience reads via role dashboards; shared viewer `/circulars/[id]` (dashboard route, proxy-granted) with print/download.
- **Alternate/error:** not in allow-list → 403 (create or publish); draft-only visibility for non-published; attachment failure → retry upload.
- **UI:** CircularForm/CircularCard/CircularViewer (`src/components/circular/*`); Megaphone nav for PRINCIPAL/HOD/PANEL_MEMBER.
- **API:** circulars, `[id]`, `[id]/publish`, `permissions/me`, `circular-settings`, `circular-permissions`, `upload/circular`.
- **Backend:** lib/circular/{service,settings,permissions}.ts.
- **DB:** circulars, settings docs, notifications, Storage.
- **Permissions:** permission doc (backend enforcement at create+publish); nav visibility secondary.
- **Validation:** audience non-empty; messageFrom within settings options; date valid.
- **State transitions:** DRAFT→PUBLISHED (one-way per type; unpublish `[UNVERIFIED]`).
- **Side effects:** fan-out notifications; Storage attachments; audit `[UNVERIFIED]`.
- **Reports:** print/PDF of circular.
- **Concurrency:** double publish guarded by status.
- **Code evidence:** cited; settings editable by Principal (AGENTS.md).
