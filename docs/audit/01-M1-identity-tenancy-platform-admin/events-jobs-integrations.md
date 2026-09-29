# M1 — Events, Jobs & Integrations (as-is)

## Domain events (notification writes)
- User created/provisioned → optional `notifyRole`/`notify` `[UNVERIFIED per route]`; audit log write confirmed in provisioning (userProvisioning.ts:86).
- Seat assigned → live role resolution on next request (no event bus); possible notification `[UNVERIFIED]`.
- Password reset (webmaster) → email? `[UNVERIFIED]`.

## Queue jobs
- None.

## Cron jobs
- None owned by M1.

## Webhooks
- None.

## Email/SMS/notification triggers
- Account creation may email credentials via `api/email/send` `[UNVERIFIED call sites]`.
- Notifications stored to `colleges/{id}/notifications` (bell inbox).

## External integrations
- Firebase Auth (account lifecycle), Cloud Storage (profile photos: `admin/users/[uid]/photo`, `*/users/me/photo`).
