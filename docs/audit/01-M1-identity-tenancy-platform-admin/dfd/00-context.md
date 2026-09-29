# M1 — DFD Level 0 (context)

System as one process; external entities and major data flows touching M1 responsibilities.

```mermaid
flowchart LR
    SA["[External Entity] Super Admin"]
    ADM["[External Entity] Administration (location)"]
    WM["[External Entity] Webmaster"]
    MGMT["[External Entity] Management"]
    STAFF["[External Entity] College staff (any role)"]

    M1(("(Process) M1: Identity, Tenancy & Platform Admin"))

    FSU[("Data Store: locations / colleges / locationUsers / systemUsers / users / roleSeats")]
    FSS[("Data Store: settings (nav visibility, general)")]
    FSA[("Data Store: auditLogs")]
    FSP[("Data Store: profile photos (Storage)")]

    SA -->|"tenant create/update"| M1
    ADM -->|"college + people mgmt"| M1
    WM -->|"password resets, account requests"| M1
    MGMT -->|"oversight reads, seat appointment"| M1
    STAFF -->|"login (session issue)"| M1

    M1 -->|"tenant docs"| FSU
    M1 -->|"visibility + general settings"| FSS
    M1 -->|"action records"| FSA
    M1 -->|"photo objects"| FSP
```

*Explanation: M1 is the entry point for every login (session issuance lives in the shared auth flow) and the owner of tenant/user stores. All flows are synchronous request/response.*
