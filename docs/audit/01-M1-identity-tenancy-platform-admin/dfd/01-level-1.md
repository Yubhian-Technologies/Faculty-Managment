# M1 — DFD Level 1

```mermaid
flowchart TD
    SA["[External Entity] Super Admin"]
    ADM["[External Entity] Administration"]
    WM["[External Entity] Webmaster"]
    STAFF["[External Entity] Any staff login"]

    P1("(1.0 Manage Tenants<br/>locations & colleges)")
    P2("(2.0 Manage Users, Roles & Seats)")
    P3("(3.0 Manage Nav Visibility)")
    P4("(4.0 Record/View Audit Logs)")
    P5("(5.0 Maintain College Settings<br/>academic year, catalog)")

    D1[("locations · colleges")]
    D2[("locationUsers · systemUsers · users · roleSeats")]
    D3[("settings/nav-visibility")]
    D4[("auditLogs (college + global)")]
    D5[("settings/general · academicYears · courseCatalog")]

    SA -->|"tenant CRUD"| P1
    ADM -->|"college CRUD, principals"| P1
    P1 <-->|"docs"| D1

    SA -->|"global users"| P2
    ADM -->|"location users"| P2
    STAFF -->|"session request"| P2
    P2 <-->|"profiles, seats"| D2
    P2 -->|"audit entry"| D4

    SA -->|"view/toggle"| P3
    P3 <-->|"visibility doc"| D3

    P4 <-->|"write/read"| D4
    SA -->|"query"| P4

    P5 <-->|"general/years/catalog"| D5
    SA -->|"catalog custody"| P5

    WM -->|"reset-password"| P2
```

*Explanation: five processes map 1:1 to submodules M1-SM1..SM5. P2 feeds D4 directly (provisioning writes audit). Session issuance (login) is part of P2's responsibilities (auth/session route).*
