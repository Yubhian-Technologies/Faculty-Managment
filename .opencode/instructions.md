# OpenCode Instructions — FMS (Faculty Management System)

> Generated from a ground-truth audit (2026-09-26) of actual source and configs. Where `AGENTS.md` and code disagree, this file follows the code (e.g., the `fms-session` cookie **is** HMAC-signed — `src/lib/auth/sessionToken.ts` — despite older docs saying otherwise).

## Project Overview

Multi-tenant Faculty Management System for a group of colleges. Two tenancy axes — **Locations** contain location-scoped roles (`ADMINISTRATION`, `HR_ADMIN`, `ADMIN_OFFICE`, `LOCATION_DEPT_HEAD`); **Colleges** contain college-scoped roles (`PRINCIPAL`, `VICE_PRINCIPAL`, `HOD`, `COLLEGE_OFFICE`, `PANEL_MEMBER`, internal-office roles, `STUDENT`); `SUPER_ADMIN`/`MANAGEMENT`/`FINANCE`/`PURCHASE_DEPT` are global.

**Stack:** Next.js 16.2.9 (App Router, Turbopack, `src/proxy.ts` instead of `middleware.ts`) · React 19.2 · TypeScript 5.9 strict · Tailwind CSS 4 + Radix/shadcn · Firebase (Auth / Firestore / Storage via `firebase-admin` 14, server-side only) · Zustand + TanStack Query · react-hook-form + zod · exceljs, jspdf/html2canvas, puppeteer (server PDF), face-api.js, leaflet, nodemailer. Scheduled jobs: Firebase Cloud Functions v2 (`functions/`, Node 20) pinging `/api/cron/attendance-not-posted` every 15 min.

## Commands

```bash
npm run dev        # dev server (Turbopack)
npm run build      # production build (~180s)
npm run lint       # eslint — currently FAILS on main (128 errors, mostly one React Compiler rule);
                   # CI runs lint first, so its typecheck/build/test steps never execute
npx tsc --noEmit   # typecheck (strict mode)

npm test                                          # vitest — unit tests only (src/**/*.test.ts, node env)
npx vitest run src/lib/college/semester.test.ts   # one unit test file
npx vitest run -t "partial test name"             # one test by name

npm run test:e2e                                   # Playwright, workers=1 (sequential — tests mutate shared Firestore state)
npx playwright test tests/e2e/api/subjects.spec.ts # one e2e spec
PLAYWRIGHT_SKIP_WEBSERVER=1 npm run test:e2e       # against an already-running dev server
# Requires a seeded non-prod environment via tests/e2e/.env.test — not runnable on an empty DB.

firebase deploy --only firestore:rules|firestore:indexes|storage   # manual deploys; CI never deploys these
cd functions && npm run build && npx firebase deploy --only functions

node scripts/bootstrap-admin.mjs                  # one-time SUPER_ADMIN promotion (edit UID/email first)
node scripts/create-admin.mjs
```

Key env vars: `FIREBASE_ADMIN_PROJECT_ID` / `FIREBASE_ADMIN_CLIENT_EMAIL` / `FIREBASE_ADMIN_PRIVATE_KEY`, `NEXT_PUBLIC_FIREBASE_*`, `SMTP_*` + `EMAIL_FROM`, `SESSION_SECRET` (optional; falls back to the admin private key), `CRON_SECRET` + `APP_URL`.

## Architecture & Directory Map

| Path | Role |
|---|---|
| `src/proxy.ts` | Edge gate for **dashboard pages only** (per-role path map + role inheritance). Never touches `/api/*`. |
| `src/app/(dashboard)/<role>/` | One route tree per role (`principal`, `hod`, `college-office`, `panel`, `accounts`, `finance`, `academics`, `exam-cell`, ...). |
| `src/app/api/` | ~290 self-guarded `route.ts` files: `admin/` (Super Admin), `college/` (~90 domains: faculty, departments, sections, students, subjects, courses, academic-sessions, exams, `attendance/*`, `student-attendance/*`, teaching/timetable, circulars, budget/finance, hiring, research, users), `location/`, `management/`, `finance/`, `purchase/`, `auth/`, `cron/`, `pdf/`, `email/`, `upload/` (21 endpoints). |
| `src/app/(auth)/login`, `careers/[collegeId]`, `candidate-form`, `offer-acceptance`, `feedback`, `faculty-public` | Public pages. |
| `src/lib/auth/verifySession.ts` | **THE** API authorization layer: `requireRole`, `requireCollegeMember`, `requireLocationMember`, `requireSuperAdmin`, `requireCollegeContext`. |
| `src/lib/auth/sessionToken.ts` | HMAC-SHA256 signing of the `fms-session` cookie (Web Crypto, edge+node compatible). |
| `src/lib/departments/scope.ts` | Department-level authorization boundary (HOD scope, managed branches, sub-departments). |
| `src/lib/college/academicStructure.ts` | Single source of truth for the derived academic structure (common first year vs department-direct). |
| `src/lib/attendance/istTime.ts` | All calendar-day/wall-clock logic for attendance (fixed IST, `Asia/Kolkata`). |
| `src/lib/firebase/admin.ts` | `getAdminDb()` / `getAdminAuth()` / `getAdminStorage()` — the only sanctioned server Firebase access. |
| `src/types/` | Domain types; `core.ts` holds `UserRole`, `ROLE_LEVEL` (0–6), `ROLE_SCOPE`, dashboard paths. |
| `src/components/` | `shared/` (DataTable, PageHeader, StatusBadge, FileUpload), `ui/` (shadcn), `layout/` (Sidebar/navConfig), plus per-domain folders. |
| `src/store/` | Zustand: `authStore`, `uiStore`, `workContextStore`. |
| `functions/src/index.ts` | v2 scheduled function → pings `/api/cron/attendance-not-posted` with `CRON_SECRET`. |
| `firestore.rules`, `firestore.indexes.json`, `storage.rules` | Deployed manually; repo may be ahead of the live ruleset. |

### Auth flow (must understand before touching routes)

1. Client Firebase Auth → `POST /api/auth/session` verifies the ID token, resolves tenant + role, sets the signed httpOnly `fms-session` cookie (24h).
2. `proxy.ts` gates pages via role → path map (level inheritance L0–L6). It does **not** protect APIs.
3. Every API route self-guards via `verifySession.ts`; guards throw `UNAUTHORIZED` / `NO_COLLEGE_CONTEXT` sentinels that routes map to 401.
4. `COLLEGE_ADMIN`/`DIRECTOR` → `PRINCIPAL` and `DEPARTMENT_OFFICE` → `HOD` are normalized at session time; the truth is kept in `session.realRole`.

## Coding Conventions & Guardrails

### Style

- Alias `@/*` → `src/*` (mirrored in `vitest.config.mts`); import types from the `@/types` barrel.
- Routes: `export async function GET/POST/PATCH/DELETE(request: Request)`, dynamic params are **promises** in Next 16 (`{ params }: { params: Promise<{ id: string }> }`), `export const dynamic = "force-dynamic"` when freshness matters.
- Status codes: 400 validation · 401 guard sentinel · 403 role/scope denials · 404 missing or cross-tenant id · **409 for conflicts/optimistic concurrency (`expectedUpdatedAt`)** · 500 with `console.error("[route-name]", err)` and a generic message. Never leak internals to the client.
- Multi-document writes: `db.runTransaction` (or `ChunkedBatch` for >500 ops). Firestore batch cap is 500.
- All attendance dates through `lib/attendance/istTime.ts` — never local `Date` getters.
- Notifications through `lib/notify.ts` (`notify` / `notifyRole` — it handles GLOBAL roles whose profiles live in `systemUsers`, which naive per-route copies got wrong).
- New cross-cutting event kinds extend the `AuditLog` / `AppNotification` unions in `src/types/core.ts`.
- Validation with zod in newer routes; forms with react-hook-form + `@hookform/resolvers`.

### Strict boundaries — do NOT modify without permission

1. `src/lib/auth/verifySession.ts` (~276 importers): `requireRole` intentionally rewrites roles; the resolution order underpins ~420 `role === "HOD"` checks.
2. `src/lib/departments/scope.ts`: the three scope functions (`editable ⊃ facultyManageable ⊃ own`) look redundant and are not — the comments record real bugs.
3. `firestore.rules`: OR-combined — a second `match` block for the same path never tightens access. JWT claims carry only `{role, collegeId, locationId}`; seat-holders are invisible to rules.
4. `src/components/shared/DataTable.tsx` (~68 importers) and `src/components/layout/navConfig.ts` (item placement silently changes module/visibility mapping; keep `BOTTOM_NAV_ITEMS` in sync).
5. `src/lib/college/academicStructure.ts` — never re-derive academic shape inline elsewhere.
6. The Technical/Non-Technical **supporting-staff split** is a repeatedly re-decided product decision — don't reopen casually.
7. Don't introduce `middleware.ts`; don't adopt the unused `requireRoleOrHigher`.
8. Nav visibility is not security — every capability needs its own API guard.
