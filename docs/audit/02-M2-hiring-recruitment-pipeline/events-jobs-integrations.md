# M2 — Events, Jobs & Integrations (as-is)

## Domain events (notification writes)
- Vacancy raised → notify Principal/VP + department heads (`getDepartmentHeadUids` — notify.ts:66-93; vacancy-requests callsite).
- Batch stage prompts (candidate arrived, scoring open, feedback unlocked) → panel uids **excluding leadership** (`excludeLeadershipUids` — notify.ts:44-64; hiring-batches callsite).
- Offer decision → office/CC email list; account-request updates → webmaster/office (`notify` callsites).
- Public application submitted → HOD/department heads.

## Queue jobs
- None.

## Cron jobs
- None.

## Webhooks
- None.

## Email triggers
- Offer letter send → SMTP with resolved CC (`offerLetterCc.ts:16-31`).
- Account credentials email on fulfillment `[UNVERIFIED]`.
- Candidate communications on send/decision `[UNVERIFIED exact templates]`.

## External integrations
- `/api/pdf/generate` (offer/appointment letters; HTML fallback).
- Storage uploads: resume, certificate, joining-letter (+ candidate info card text).
- Meeting platforms: `MeetingPlatform` enum on batch (ONLINE mode) — external meeting link only, no API integration `[UNVERIFIED enum values]`.
