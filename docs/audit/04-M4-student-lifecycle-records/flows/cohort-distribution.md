# Flow — M4-F1: Distribute Cohort into Sections

- **Flow ID:** M4-F1
- **Actors:** PRINCIPAL/VP (college-wide), HOD (dept scope)
- **Trigger:** distribute action on a cohort (course+year) from sections UI
- **Preconditions:** target sections exist for course/year; lock free
- **Main success scenario:**
  1. `POST /api/college/students/distribute-cohort {dryRun:true}` → plan preview (evenSplit bucket counts, distributionPlan.ts).
  2. `POST {dryRun:false}` → acquire `distributionLocks/{lockKey}` (distributionLock.ts:24).
  3. Transaction: assign each student's `section` (primary dept; secondaryDepartment respected per sectionRoster.ts:50-53 merge), update section rosters/counts.
  4. Release lock; return summary.
- **Alternate/error:** missing target section → 409 naming every missing target (AGENTS.md); lock held → 409 busy; partial failure → tx rollback.
- **UI:** `/principal/sections`, `/hod/sections/[id]`.
- **API:** `students/distribute-cohort` (legacy `students/distribute`).
- **Backend:** lib/students/{distributionPlan,evenSplit,distributionLock,sectionRoster}.ts.
- **DB:** students, sections, distributionLocks.
- **Permissions:** requireCollegeMember + role/scope.
- **Validation:** cohort/year/section ids; capacity `[UNVERIFIED whether capacity enforced]`.
- **State transitions:** student.section changes; history unchanged (dept history only on dept change).
- **Side effects:** none async.
- **Concurrency:** lock + tx; second run blocked until release.
- **Code evidence:** cited libs; tests evenSplit/distributionPlan.
