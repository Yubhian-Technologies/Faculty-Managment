# FMS — Integrations & Jobs (as-is)

## 1. Scheduled jobs (cron)

| Job | Schedule | Target | Auth | Behavior | Evidence |
|---|---|---|---|---|---|
| `attendanceNotPostedSweep` | every 15 min, `Asia/Kolkata` | `POST {APP_URL}/api/cron/attendance-not-posted` | `Authorization: Bearer CRON_SECRET` (Firebase Secret) | Thin pinger; per-college: settings-gated (`college/attendance-not-posted-settings`), cutoff-aware, once per college per day via `lastRunDate`; notifies faculty with ended-but-unsubmitted periods | `functions/src/index.ts:20-44`; `src/app/api/cron/attendance-not-posted/route.ts`; `src/lib/attendance/notPostedSettings.ts:24` |

No other scheduled jobs exist. No queue workers.

## 2. Email (SMTP)

- Route: `POST /api/email/send` — nodemailer; env `SMTP_*`, `EMAIL_FROM`.
- Used by hiring/offer flows and account-requests (faculty account request → webmaster email creation flow references email requests with availability check: `api/college/email-requests`, `email-requests/check-availability`, `email-requests/[id]`) `[UNVERIFIED per-callsite — sampled]`.
- No SMS/push provider found.

## 3. PDF generation

- Server: `POST /api/pdf/generate` — HTML templates (`src/lib/pdf/`) + dynamic puppeteer; absent on Vercel → fallback returns raw HTML download. `POST /api/pdf/image-proxy` for embedding remote images.
- Used by: offer letters, appointment letters, circular print/download (client reuse of same HTML), budget reports `[UNVERIFIED per-callsite]`.
- Client: jspdf + html2canvas for exports (package.json).

## 4. Excel import/export

- Shared parser: `POST /api/college/parse-excel` (exceljs).
- Imports (route inventory 2026-09-28): faculty (`college/faculty/import`), supporting staff (`college/supporting-staff/import`), students (`college/students/import-excel`), subjects (`college/subjects/import`), departments (`college/departments/import`), holidays (`college/holidays/import`), leave history (`college/leave-history-report/import`), publications (`college/publications/import`), location staff bulk (`location/staff/bulk-import`).
- Exports: attendance monthly export (`college/attendance/monthly-export`; management twin), student attendance CSV (`src/lib/studentAttendance/exportCsv.ts`), finance reports (`college/finance-reports`; `src/lib/finance/exportExcel.ts`).

## 5. File storage (Cloud Storage) — upload surfaces

21+ `api/upload/*` routes (full list in repo inventory): budget-circular, budget-report, certificate, circular, consultancy-doc, faculty-document, finance-receipt, hackathon-doc, indent-receipt, ipr-doc, joining-letter, leave-proof, phd-doc, profile-photo, purchase-grn, research-service-doc, resume, seed-funding-doc, sponsored-project-doc, staff-photo, supporting-staff-document. Paths under `colleges/{id}/…` by feature (circulars confirmed via `AGENTS.md`; others follow same pattern `[ASSUMPTION from route naming + AGENTS.md]`).

## 6. Face recognition & geofencing (attendance)

- face-api.js models served from `public/models` (proxy PUBLIC_PATHS `/models` — `src/proxy.ts:28-30`).
- EAR/yaw liveness thresholds in `src/lib/attendance/faceMatch.ts` (AGENTS.md: EAR 0.92/yaw 0.12).
- Geofence: haversine/polygon `src/lib/attendance/geofence.ts`; campus locations `api/college/attendance/campus-location`.

## 7. Inbound webhooks / external APIs

None found. No Stripe/payment-gateway, no LMS sync, no biometric device integration; face/geo are client-side only.

## 8. Internal "integrations" (module couplings)

- Cloud Function → app cron route (§1).
- Public forms → M2 pipeline (candidate-form writes `candidateApplications` via `api/public/candidate-form/[collegeId]/[candidateId]`).
- Offer acceptance (public) → `offerLetters` status transitions via `api/public/offer-acceptance/[collegeId]/[offerId]`.
- `faculty-public` reads faculty profile for public pages via `api/public/faculty-public`.

## 9. Environment/config surface

`FIREBASE_ADMIN_*` (server), `NEXT_PUBLIC_FIREBASE_*` (client), `SMTP_*`/`EMAIL_FROM`, `SESSION_SECRET` (optional; falls back to admin private key), `CRON_SECRET` + `APP_URL` (functions), `PLAYWRIGHT_*` (tests). CI pins placeholders for `NEXT_PUBLIC_FIREBASE_*` (`.github/workflows/ci.yml:12-18`).

## 10. Gaps

- No outbound webhook/event bus; all downstream effects are in-process (notifications rows) `[LIMITATION]`.
- No dead-letter/retry for email sends (fire-and-forget in routes) `[GAP]`.
- Cron sweep depends on Vercel cron? No — only Firebase Scheduler function; if Blaze plan absent, sweep never runs (functions/README.md) `[OPERATIONAL RISK]`.
