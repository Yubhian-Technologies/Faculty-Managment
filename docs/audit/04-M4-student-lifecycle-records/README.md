# M4 — Student Lifecycle & Records (as-is)

## Purpose
Student master data: add/import/edit roster, cohort distribution into sections (with sub-department awareness), promotions/advance-year, graduated records, lab batches, class-leader binding and class-work records.

## Status: Implemented.

## Submodules
| ID | Submodule | Status |
|---|---|---|
| M4-SM1 | Students Add / Import / Edit roster (+bulk delete) | Implemented |
| M4-SM2 | Promotions & Graduated Students | Implemented |
| M4-SM3 | Sectioning & Lab Batches (distribute, distribute-cohort) | Implemented |
| M4-SM4 | Class Leader binding + class-work records | Implemented |

## Dashboards/roles
College Office (`/college-office/students`, import, graduates), HOD (`/hod/students*`, sections), Principal (`/principal/students*`, promotions, graduates), Panel (`/panel/students`, batches), Class Leader (`/class-leader` 3 pages), Vice Principal via principal paths.

## Dependencies
- Depends on M3 (sections, subjects, departments), M1 (roles — CLASS_LEADER seat/user).
- Depended on by M5 (roster for attendance), M3 (section capacity), M9 (feedback targets indirectly).

## Key code locations
- API: `api/college/students` (+`[id]`, `bulk-delete`, `distribute`, `distribute-cohort`, `import-excel`, `promote`), `api/college/sections*` (shared M3), `api/college/class-leader/timetable`, `api/college/class-work-records*`.
- Libs: `src/lib/students/{sectionRoster,distributionLock,distributionPlan,evenSplit,departmentHistory}.ts`; `src/lib/import/fieldConstraints.ts` (test).
- UI: pages listed above; `src/components/students/*`.

## Key stores
`students`, `students/{id}/departmentHistory`, `distributionLocks`, `sections` (roster counts), `classWorkRecords` `[UNVERIFIED collection name]`.

## Major gaps
1. `bulk-delete` destructive op — audit/confirm coverage unverified.
2. Class-work-records collection name inferred from route only `[UNVERIFIED]`.
3. Graduated students retention/query path unverified beyond status field.
