# M1 — DFD Level 2: M1-SM2 Users, Roles & Seats

```mermaid
flowchart TD
    SA["[External Entity] Super Admin"]
    ADM["[External Entity] Administration"]
    P_CH["[External Entity] Principal / College Office"]
    MGMT["[External Entity] Management"]
    STAFF["[External Entity] Login request (any)"]

    P21("(2.1 Create/Update User)")
    P22("(2.2 Assign Seat)")
    P23("(2.3 Issue Session<br/>normalize role)")
    P24("(2.4 Resolve Held Roles (live))")
    P25("(2.5 Reset Password (Webmaster))")

    DU[("colleges/{id}/users · locationUsers · systemUsers")]
    DS[("roleSeats")]
    DA[("auditLogs")]
    FBA[("Firebase Auth")]

    SA -->|"POST /api/admin/users"| P21
    ADM -->|"POST /api/location/users"| P21
    P_CH -->|"POST /api/college/users"| P21
    P21 -->|"upsert profile"| DU
    P21 -->|"create auth user"| FBA
    P21 -->|"audit"| DA

    MGMT -->|"POST /api/college/role-seats"| P22
    SA -->|"seat"| P22
    ADM -->|"seat"| P22
    P22 -->|"seat doc"| DS
    P22 -->|"users.seatRoles"| DU

    STAFF -->|"POST /api/auth/session (ID token)"| P23
    FBA -->|"verify token"| P23
    P23 -->|"cookie role=normalized"| STAFF
    P23 -->|"read profile"| DU

    P24 -->|"guard-time read"| DU
    P24 -->|"seat read"| DS

    WM_R["[External Entity] Webmaster"] -->|"POST reset-password"| P25
    P25 -->|"auth update"| FBA
```

*Explanation: user creation writes both Firestore profile and Firebase Auth account; session issuance normalizes mirror roles; held-role resolution happens at every guarded request (cache TTL), reading profiles and seats.*
