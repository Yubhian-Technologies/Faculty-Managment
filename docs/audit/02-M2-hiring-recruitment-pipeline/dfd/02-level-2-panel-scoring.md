# M2 — DFD Level 2: M2-SM3 Interviews & Panel Scoring

```mermaid
flowchart TD
    HOD["[External Entity] HOD"]
    CO_F["[External Entity] Coordinator faculty"]
    PM["[External Entity] Panel member"]
    PR["[External Entity] Principal/VP (locked-in panel)"]

    P31("(3.1 Configure Batch<br/>venue/platform/coordinator/panel)")
    P32("(3.2 Run Demo Day (QR session))")
    P33("(3.3 Record Demo Ratings)")
    P34("(3.4 Record Panel Scores)")
    P35("(3.5 Advance Phase)")
    P36("(3.6 Compute Averages/Status)")

    DB[("hiringBatches")]
    DPF[("hiringBatches/{id}/panelFeedback")]
    DC[("candidateApplications / candidates")]
    N[("notifications")]

    HOD -->|"setup payload"| P31
    P31 -->|"batch doc update"| DB
    CO_F -->|"start session"| P32
    P32 -->|"phase=IN_PROGRESS"| DB
    PM -->|"demoRatings (6 criteria + overall 1-10)"| P33
    P33 -->|"upsert (candidate,panelist) doc"| DPF
    PM -->|"panelScores (7 criteria 1-10)"| P34
    P34 -->|"same doc, panel module"| DPF
    HOD -->|"review demo scores"| P35
    P35 -->|"phase transitions"| DB
    PR -->|"final review actions"| P35
    P36 -->|"averages (tolerate missing criteria)"| DC
    P31 -->|"candidate arrived prompt"| N
```

*Evidence: PanelFeedback shape `src/types/recruitment.ts:359-399+` (demo module, panel module, optional criteria note :380-386); phases :284-294; leadership exclusion `src/lib/notify.ts:44-64`; coordinator/evaluation pages `/coordinator/[batchId]`, `/evaluation/[batchId]/[candidateId]`.*
