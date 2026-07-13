# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # start dev server (Next.js)
npm run build    # production build
npm run lint     # eslint
```

There is no test framework configured — do not invent test commands.

- `node scripts/bootstrap-admin.mjs` — one-time script to promote a Firebase Auth user to SUPER_ADMIN (edit the UID/EMAIL constants and the service-account path inside it first).
- Firestore rules/indexes and Storage rules deploy via the Firebase CLI (`firebase deploy --only firestore:rules` etc.); config is in `firebase.json`.

## Stack

Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS 4, Radix/shadcn-style UI in `src/components/ui`, Firebase (Auth, Firestore, Storage) with `firebase-admin` on the server, Zustand (`src/store`) + TanStack Query for client state, nodemailer for email, puppeteer for PDF generation.

**Next.js 16 breaking changes apply** — see AGENTS.md. Notably, `src/proxy.ts` is this version's replacement for `middleware.ts` (exports `proxy()` + `config.matcher`). Read `node_modules/next/dist/docs/` before assuming an API works like older Next.js.

## Architecture

This is a multi-tenant Faculty Management System (FMS) for a group of colleges. Tenancy has two axes:

- **Locations** (campus/city) — contain **location-scoped roles**: `ADMINISTRATION`, `HR_ADMIN`, `ADMIN_OFFICE`, `LOCATION_DEPT_HEAD`. Their user profiles live at `locations/{id}/locationUsers/{uid}`.
- **Colleges** (belong to a location) — contain **college-scoped roles**: `PRINCIPAL`, `VICE_PRINCIPAL`, `HOD`, `COLLEGE_OFFICE`, `PANEL_MEMBER`, `ACCOUNTS`, `STUDENT`. Profiles live at `colleges/{id}/users/{uid}`.
- `SUPER_ADMIN` sits above both. A global `systemUsers/{uid}` collection maps uid → role/collegeId/locationId.

All 12 roles, their labels, and their dashboard home paths are defined in `src/types/core.ts` (`UserRole`, `ROLE_DASHBOARD_PATHS`). Domain types for each module live in `src/types/*.ts` (recruitment, leave, payroll, appraisal, grievance, attendance, teaching, training).

### Auth flow

1. Client signs in with Firebase Auth (`src/lib/firebase/client.ts`), then POSTs the ID token to `/api/auth/session`.
2. The route verifies the token, resolves role/collegeId/locationId (custom claims fast path, `systemUsers` Firestore fallback, then backfills custom claims), and sets an httpOnly `fms-session` cookie (24h). The cookie is a base64 JSON payload in JWT-shaped wrapping — it is **not** cryptographically signed or verified.
3. `src/proxy.ts` gates dashboard pages by role via `ROLE_PATH_MAP` and redirects unauthenticated users to `/login`. It does NOT protect `/api/*`.
4. Every API route protects itself with helpers from `src/lib/auth/verifySession.ts`: `requireRole`, `requireCollegeMember` (college-scoped), `requireLocationMember` (location-scoped), `requireSuperAdmin`. Follow this pattern in any new API route.

### Route layout

- `src/app/(dashboard)/<role-path>/…` — one route group per role (e.g. `/hod`, `/principal`, `/hr-admin`, `/super-admin`). Pages are client components that fetch from the API routes.
- `src/app/api/` is split by scope, mirroring tenancy: `admin/` (super admin), `college/` (college-scoped), `location/` (location-scoped), plus `leave/`, `auth/`, `email/`, `pdf/`, `upload/`, `public/`.
- Public (no-login) pages: `/login`, `/careers/[collegeId]` (candidate application), `/feedback/[id]` (student feedback), `/location-interview/[id]`.
- `/panel/interviews` is intentionally shared: any staff role added to an interview panel may access it (see `ROLE_PATH_MAP` in `src/proxy.ts`).

### Server-side Firebase

Use `getAdminDb()` / `getAdminAuth()` / `getAdminStorage()` (or the lazy `adminDb` / `adminStorage` proxies) from `src/lib/firebase/admin.ts` in API routes — never the client SDK. Credentials come from `FIREBASE_ADMIN_*` env vars; client SDK config from `NEXT_PUBLIC_FIREBASE_*`; email from `SMTP_*` / `EMAIL_FROM` (see `.env`).

### Domain notes

- **Recruitment pipeline** is the largest module: vacancy request → approval (HR/Admin) → hiring batch + interviews (panel scoring) → decision → offer letter (PDF, emailed) → faculty provisioning. Shared logic in `src/lib/firestore/hiring.ts` and `src/hooks/useHiring*.ts`; statuses in `WorkflowStatus` (`src/types/core.ts`).
- **Leave engine** lives in `src/lib/leave/` (`balanceEngine`, `ruleEngine`, `dayCounter`, `seedData`) — leave math belongs there, not in routes/pages.
- **FacultyMember** (`src/types/core.ts`) is the central entity; leave, attendance, payroll, and appraisal records all reference `facultyId`.
- Cross-cutting writes should create an `AuditLog` entry and `AppNotification`s, matching the existing `AuditAction` / `NotificationType` unions.

### UI conventions

Shared building blocks in `src/components/shared` (`DataTable`, `PageHeader`, `StatusBadge`, `ConfirmDialog`, `FileUpload`, …); layout shell (Sidebar/TopBar/BottomNav, role-based nav) in `src/components/layout` driven by `navConfig.ts`. Toasts via `useToast()`; auth state via `useAuth()` + `authStore`. Pages are mobile-responsive (`useMobile`, `MobileCard`).
