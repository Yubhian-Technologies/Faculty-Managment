# M6 — DFD Level 2: M6-SM1 Application & Approval Routing

```mermaid
flowchart TD
    EMP["[External Entity] Applicant"]
    HOD["[External Entity] HOD"]
    PR["[External Entity] Principal/VP"]
    MGMT["[External Entity] Management"]

    P11("(1.1 Validate & Balance-check)")
    P12("(1.2 Determine Routing<br/>identity + staff category)")
    P13("(1.3 Stage Decisions)")
    P14("(1.4 Finalize + Audit + Notify)")
    P15("(1.5 Generate PeriodSubstitutions)")

    DL[("leaveRequests")]
    DB[("employeeLeaveProfiles/leaveBalances")]
    DA[("auditLogs")]
    DN[("notifications")]
    PC[("periodCoverage output (M5/M3 reads)")]

    EMP-->P11
    DB-->P11
    P11-->P12
    P12-->|"faculty → HOD→Principal"|P13
    P12-->|"supporting staff → category chain"|P13
    P12-->|"Principal's own → Management"|P13
    HOD-->P13; PR-->P13; MGMT-->P13
    P13-->P14-->DL
    P14-->DA; P14-->DN
    P14-->|"APPROVED"|P15-->PC
```

*Evidence: approvalRouting.ts, staffCategoryRouting.test.ts, identity.ts:47-114, decideFinalStage.ts:93, management/leave-approvals sanctioned write (verifySession.ts:84-91).*
