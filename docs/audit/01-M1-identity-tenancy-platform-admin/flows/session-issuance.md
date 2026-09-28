# Flow — M1-F3: Login / Session Issuance (with role normalization)

- **Flow ID:** M1-F3
- **Actors:** any staff role
- **Trigger:** `POST /api/auth/session` after Firebase client sign-in
- **Preconditions:** valid Firebase ID token; profile exists in one of the three roots
- **Main success scenario:**
  1. Verify ID token (Firebase Admin).
  2. Resolve profile → role/collegeId/locationId (`locations/{id}/locationUsers` | `colleges/{id}/users` | `systemUsers`).
  3. Normalize: COLLEGE_ADMIN/DIRECTOR→PRINCIPAL; DEPARTMENT_OFFICE→HOD (session route + useAuth.ts mirror).
  4. Sign `fms-session` cookie (HMAC-SHA256, 24h; `src/lib/auth/sessionToken.ts`).
  5. Client redirects to `ROLE_DASHBOARD_PATHS[role]`.
- **Alternate/error:** invalid token → 401; missing profile → 403 `[ASSUMPTION]`; expired cookie → proxy redirects to `/login?redirect=…` (proxy.ts:113-124).
- **UI:** `/(auth)/login`.
- **API:** `POST /api/auth/session`.
- **Backend:** `src/app/api/auth/session/route.ts`; `src/lib/auth/sessionToken.ts`; `src/hooks/useAuth.ts` (client mirror of normalization).
- **DB:** three profile roots (read); cookie (write).
- **Permission checks:** token verification only (public route); every downstream route re-guards.
- **Validation:** token audience/issuer via Admin SDK.
- **State transitions:** signed-out → signed-in (cookie exp 24h).
- **Side effects:** none persistent (no audit on login `[GAP — login not audited]`).
- **Concurrency:** multiple devices — independent cookies.
- **Code evidence:** `src/lib/auth/verifySession.ts:17-38` (realRole semantics); `src/proxy.ts:52-96` (path map); `src/lib/auth/sessionToken.test.ts`.

```mermaid
sequenceDiagram
    actor U as User
    participant FB as Firebase Auth (client)
    participant API as POST /api/auth/session
    participant FS as profile roots
    U->>FB: email/password
    FB-->>U: ID token
    U->>API: POST {idToken}
    API->>FS: read profile (location|college|system)
    API->>API: normalize role (CA/D→PRINCIPAL; DO→HOD)
    API-->>U: Set-Cookie fms-session (24h, HMAC)
    U->>U: redirect ROLE_DASHBOARD_PATHS[role]
```
