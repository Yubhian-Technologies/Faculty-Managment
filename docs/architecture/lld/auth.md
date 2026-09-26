# LLD — Auth & Authorization Module

## Module Overview

Owns every authorization decision: sign-in session minting (`/api/auth/session`), edge page gating (`src/proxy.ts`), per-route API guards (`src/lib/auth/verifySession.ts`), cookie signing (`src/lib/auth/sessionToken.ts`), live role/seat resolution (`src/lib/auth/liveRoles.ts`, `src/lib/roles/seatRoles.ts`), and the Firestore rules layer. Interface surface: the `require*` guard family consumed by ~276 of 290 route files.

## Component & Class Structure

| File | Responsibility |
|---|---|
| `src/lib/auth/sessionToken.ts` | `signSession(payload)`, `readSession(cookie)` — base64 JSON + HMAC-SHA256 (Web Crypto; works in edge + node). Secret: `SESSION_SECRET` else `FIREBASE_ADMIN_PRIVATE_KEY`. |
| `src/app/api/auth/session/route.ts` | Verifies Firebase ID token, resolves profile doc by scope, normalizes `COLLEGE_ADMIN`/`DIRECTOR`→`PRINCIPAL`, `DEPARTMENT_OFFICE`→`HOD` (keeps `realRole`), attaches seat roles, sets 24h httpOnly cookie. |
| `src/proxy.ts` | `proxy()` (replaces `middleware.ts` in Next 16) + `config.matcher`. `allowedPathsForRole(role)` = role's own paths + inherited lower-level dashboard paths (`rolesInheritedBy`). Never guards `/api/*`. |
| `src/lib/auth/verifySession.ts` | `SessionPayload {uid, email, role, realRole?, roles?, collegeId, locationId, exp}`. Guards: `requireRole(...roles)`, `requireCollegeMember(...roles)`, `requireLocationMember(...)`, `requireSuperAdmin()`, `requireCollegeContext()`, `requireManagement()`. Helpers: `isCollegeAdmin`, `isDepartmentOffice`. Throws `UNAUTHORIZED` / `NO_COLLEGE_CONTEXT` sentinels. |
| `src/lib/auth/liveRoles.ts` | Re-checks seat-held roles live (the cookie `roles` array is only a snapshot) — `resolveHeldRoles`, `resolveRealRole`. |
| `src/lib/roles/seatRoles.ts` | `pickEffectiveRole`, `orderHeldRoles` — a faculty member holding the HOD seat evaluates as HOD. |
| `src/lib/roles/activeHodDepartment.ts` | `ACTIVE_HOD_DEPT_COOKIE` — the "Working as" department switcher context. |
| `src/types/core.ts` | `UserRole`, `ROLE_LEVEL` (0–6), `ROLE_SCOPE` (`GLOBAL`/`LOCATION`/`COLLEGE`), `rolesInheritedBy`, `canRoleAccessRole`, `ROLE_DASHBOARD_PATHS`. |
| `firestore.rules` | Coarse JWT-claim checks (`hasRole`, `belongsToCollege`, `isPrincipal`, `isHOD`, ...). |

## Sequence Diagram — Authenticated API request

```mermaid
sequenceDiagram
    participant C as Client (React)
    participant FA as Firebase Auth (client)
    participant E as proxy.ts (edge)
    participant R as API route handler
    participant V as verifySession.ts
    participant L as liveRoles/seatRoles
    participant F as Firestore (admin)

    C->>FA: signInWithEmailAndPassword
    FA-->>C: ID token
    C->>R: POST /api/auth/session {idToken}
    R->>F: load profile (users | locationUsers | systemUsers)
    R->>R: normalize role (COLLEGE_ADMIN/DIRECTOR→PRINCIPAL, DEPARTMENT_OFFICE→HOD), keep realRole
    R->>R: signSession(payload) — HMAC-SHA256
    R-->>C: Set-Cookie fms-session (httpOnly, 24h)

    C->>E: GET /principal/... (cookie)
    E->>E: readSession + allowedPathsForRole (L0–L6 inheritance)
    E-->>C: 200 page | redirect /login

    C->>R: GET /api/college/students (cookie)
    R->>V: requireCollegeMember("HOD","PRINCIPAL",...)
    V->>V: verify HMAC + exp
    V->>L: resolveHeldRoles(uid) — live seat check
    V-->>R: session (effective role; HOD-seat holder reads "HOD")
    R->>F: scoped query (collegeId [+ department scope])
    R-->>C: 200 JSON | 400/401/403/404/409/500
```

## Data Models & Schemas

```ts
// SessionPayload (src/lib/auth/verifySession.ts)
interface SessionPayload {
  uid: string; email: string; role: string;
  realRole?: string;      // truth before PRINCIPAL/HOD normalization
  roles?: string[];       // snapshot of held roles (re-checked live)
  collegeId: string; locationId: string; exp: number;
}
// Cookie: fms-session = base64(JSON) + "." + base64url(HMAC-SHA256), 24h

// JWT custom claims (visible to firestore.rules): { role, collegeId, locationId }
// Rules CANNOT see seats or realRole — normalization happens before claim write.
```

System collections: `systemUsers/{uid}` (global roles), `locations/{id}/locationUsers/{uid}`, `colleges/{id}/users/{uid}`.

## API/Method Contracts

- `requireRole("HOD", ...) → Promise<SessionPayload>` — throws `UNAUTHORIZED` → routes return **401**.
- `requireCollegeMember(...roles) → Promise<SessionPayload>` — role check + `collegeId` membership; **rewrites** role for seat-holders (deliberate; ~420 `role==="HOD"` checks depend on it).
- `requireCollegeContext()` — college-scoped caller **or** global role supplying `?collegeId=` (31 call sites; adding a college-scoped role here would let it pick its own tenant).
- `requireSuperAdmin()`, `requireLocationMember()`, `requireManagement()` — analogous.

## Error Handling & Edge Cases

- Expired/invalid cookie → 401 via sentinel catch; guards must be the **first** statement in every handler.
- Cookie `roles` snapshot is stale by design — live re-resolution fixes revoked seats.
- `requireRole` role rewriting: an HOD+more-senior login evaluated as HOD returns department-scoped data, not college-wide — intentional; changing the resolution order is a breaking change.
- Firestore rules OR-combine: a second `match` block never tightens; deployed ruleset lags the repo file (deployed manually, last published before the repo file's current state).
- `requireRoleOrHigher` exists with **zero call sites** and its own tenant-context warning — do not adopt without reading it.
- No tests cover `verifySession.ts` or `scope.ts` despite deciding every authorization outcome.
