# M5 — Events, Jobs & Integrations (as-is)

## Jobs
- `attendanceNotPostedSweep` — 15 min, Asia/Kolkata → cron route (see flow M5-F3). Only scheduled job in the system.

## Notifications
- Not-posted sweep → faculty notifications.
- Manual attendance → notify target + audit.
- Late check-in → penalty counter (payroll-facing), optional notify `[UNVERIFIED]`.

## Integrations
- face-api.js (client-side, models under `/models`); leaflet geofence map.
- Storage: reference photos, face registrations.
- Offline client queue (offlineSubmitQueue) — replay on reconnect.

## External
- None (no biometric devices, no SMS).
