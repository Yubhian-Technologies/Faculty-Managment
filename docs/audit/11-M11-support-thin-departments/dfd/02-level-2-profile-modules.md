# M11 — DFD Level 2: Profile Module Editing (shared with M1/M8)

```mermaid
flowchart TD
    U["[External Entity] Thin-dept staff"]
    P41("(4.1 Resolve Assigned Modules (NavItem.module / user module list))")
    P42("(4.2 Render Module Editor)")
    P43("(4.3 Save Module Fields (profile APIs))")

    UM[("users/{uid} (profile fields)")]
    FM[("facultyMembers")]
    M8["M8 research projections"]

    U-->P41
    UM-->P41
    P41-->P42-->P43
    P43-->UM
    P43-.->|"research modules"|M8
    FM-.->P41
```

*Evidence: profile `[module]` page pattern across role roots; NavItem.module gating (navConfig.ts:12-21); M8 projection libs write users fields.*
