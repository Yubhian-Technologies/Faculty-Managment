# M8 — Data Model (as-is)

## Entities (college-scoped; ownership via uid)

| Entity | Path | Notes | Evidence |
|---|---|---|---|
| Publication | `publications/{id}` | owner uid; flat fields derived for lists; Excel import | publications.ts:9; deriveFlatFields.ts:26-34 |
| CitationMetrics | projected onto `users/{uid}` (dedicated collection `[UNVERIFIED]`) | applied by lib | applyCitationMetricsFields.ts:22-37 |
| ResearchProfile | projected onto `users/{uid}` | same pattern | applyResearchProfileFields.ts:22-37 |
| ConsultancyProject / SponsoredProject / SeedFunding / ResearchService | same-named collections | consultants resolved vs facultyMembers | finalizeConsultants.ts:20 |
| PhdSupervision / Hackathon / Innovation / DiscoveryInnovation | same-named | inventors resolved vs facultyMembers | finalizeIprInventors.ts:19-28 |
| RoleSeat | `roleSeats` | RND_COORDINATOR seat (core.ts:52-55) | coordinatorReview.ts:51 |

## Mermaid ER

```mermaid
erDiagram
    USER ||--o{ PUBLICATION : owns
    USER ||--|| RESEARCH_PROFILE : "projected fields"
    USER ||--|| CITATION_METRICS : "projected fields"
    USER ||--o{ CONSULTANCY_PROJECT : owns
    USER ||--o{ SPONSORED_PROJECT : owns
    USER ||--o{ SEED_FUNDING : owns
    USER ||--o{ RESEARCH_SERVICE : owns
    USER ||--o{ PHD_SUPERVISION : owns
    USER ||--o{ HACKATHON : owns
    USER ||--o{ INNOVATION : owns
    USER ||--o{ DISCOVERY_INNOVATION : owns
    FACULTY ||..o{ DISCOVERY_INNOVATION : "inventor resolved"
    ROLE_SEAT ||--|| USER : "RND_COORDINATOR seat"
    PUBLICATION {
        string id PK
        string uid FK
        object flatFields
    }
```

*Projection pattern: citations/profile live as fields on users docs (libs update them) rather than separate collections — read-model denormalization `[UNVERIFIED whether separate collections also exist]`.*
