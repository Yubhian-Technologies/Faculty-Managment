# M9 — DFD Level 2: M9-SM1 Circular Compose & Publish

```mermaid
flowchart TD
    P["[External Entity] Principal/VP / allowed role"]
    R["[External Entity] Audience (staff + students)"]

    P11("(1.1 Check Permissions (allowedRoles/allowedUids))")
    P12("(1.2 Compose Draft (audience, attachments))")
    P13("(1.3 Publish (status flip))")
    P14("(1.4 Resolve Audience (users + students REGULAR))")
    P15("(1.5 Notify (CIRCULAR_PUBLISHED))")

    DP[("circular-permissions doc")]
    DC[("circulars")]
    DST[("settings doc")]
    DU[("users · students")]
    DN[("notifications")]
    STO[("Storage circulars/")]

    P-->P11
    DP-->P11
    P11-->P12-->DC
    P12-->|"attachments"|STO
    DST-->P12
    P-->P13-->DC
    P13-->P14
    DU-->P14
    P14-->P15-->DN
    R-->|"read /circulars/[id]"|DC
```

*Evidence: service.ts:11 (ref), :141-149 (users), :176-183 (students REGULAR); settings.ts:10; permissions.ts:12; notifyAudience + CIRCULAR_PUBLISHED link per AGENTS.md circulars.*
