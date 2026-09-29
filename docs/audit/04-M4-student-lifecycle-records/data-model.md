# M4 — Data Model (as-is)

## Entities

| Entity | Path | Key fields | Evidence |
|---|---|---|---|
| Student | `students/{id}` | name, department (real branch), secondaryDepartment?, section, year, labBatch?, status REGULAR/GRADUATED, batch (session cohort), contacts | sectionRoster.ts:50-53 (primary+secondary merge), AGENTS.md academic structure |
| DepartmentHistory | `students/{id}/departmentHistory/{id}` | from/to department, at, by | departmentHistory.ts:24-26 |
| DistributionLock | `distributionLocks/{lockKey}` | holder, expiresAt? | distributionLock.ts:24 |
| Section (shared M3) | `sections/{id}` | roster counts implied | sectionRoster |
| ClassWorkRecord | `classWorkRecords?` | route-derived `[UNVERIFIED]` | class-work-records/route.ts |

## Mermaid ER

```mermaid
erDiagram
    SECTION ||--o{ STUDENT : "assigned via distribute"
    COURSE ||--o{ SECTION : "courseId+year"
    STUDENT ||--o{ DEPARTMENT_HISTORY : logs
    STUDENT {
        string id PK
        string department
        string secondaryDepartment
        string sectionId FK
        number year
        string status
        string batch
    }
    DEPARTMENT_HISTORY {
        string id PK
        string fromDepartment
        string toDepartment
        string at
    }
```

## Indexes (M4)
- students: [section, year], [department, section, year], [department, year], [secondaryDepartment, section, year], [secondaryDepartment, year] (firestore.indexes.json).

## Notes
- No soft-delete collection; status field governs. Bulk delete is hard delete `[GAP]`.
