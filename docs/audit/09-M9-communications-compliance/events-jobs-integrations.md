# M9 — Events, Jobs & Integrations (as-is)

## Events/notifications
- CIRCULAR_PUBLISHED → fan-out to audience (users by employeeType/departments + REGULAR students) with deep link.
- Feedback submission → recipient notification `[UNVERIFIED]`.

## Jobs
- None.

## Integrations
- Storage `colleges/{id}/circulars/` attachments.
- Print/download via shared HTML (client jspdf/html2canvas reuse).
