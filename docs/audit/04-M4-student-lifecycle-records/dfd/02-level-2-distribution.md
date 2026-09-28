# M4 — DFD Level 2: M4-SM3 Cohort Distribution

```mermaid
flowchart TD
    PR["[External Entity] Principal/VP"]
    P31("(3.1 Plan Distribution)")
    P32("(3.2 Dry-Run Preflight)")
    P33("(3.3 Acquire Lock)")
    P34("(3.4 Execute evenSplit Writes)")
    P35("(3.5 Release Lock / Report)")

    DP[("distributionLocks/{lockKey}")]
    STU[("students")]
    SEC[("sections")]

    PR-->P31
    SEC-->P31
    P31-->P32
    P32-->|"409 missing targets"|PR
    P32-->P33-->DP
    P33-->P34-->STU
    P34-->|"counts"|SEC
    P34-->P35-->PR
```

*Evidence: `lib/students/distributionLock.ts:24`, `evenSplit.ts:11`, AGENTS.md cohort ops (409 naming missing sections, dryRun preflight); tests `distributionPlan.test.ts`, `evenSplit.test.ts`.*
