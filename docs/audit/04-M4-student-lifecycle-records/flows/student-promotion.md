# Flow — M4-F2: Promote Cohort (advance-year) & Graduation

- **Flow ID:** M4-F2
- **Actors:** PRINCIPAL/VP
- **Trigger:** `/principal/promotions`
- **Preconditions:** academic year rollover; target sections for year+1 exist or will be created
- **Main success scenario:**
  1. `POST /api/college/students/promote` → for cohort: students.year+1; missing target sections → 409 naming each (AGENTS.md).
  2. Department changes (rare, e.g., re-branch) → append `students/{id}/departmentHistory` (departmentHistory.ts:24-26).
  3. Final-year cohort → status GRADUATED (excluded from live queries; visible in `/graduates`).
- **Alternate/error:** same 409 pattern; lock contention with distribution.
- **UI:** `/principal/promotions`, `/principal/graduates`, `/college-office/graduates`.
- **API:** `students/promote`.
- **DB:** students, departmentHistory, sections.
- **State transitions:** year n→n+1; REGULAR→GRADUATED.
- **Side effects:** none async; audit `[UNVERIFIED]`.
- **Concurrency:** shares distributionLocks pattern `[ASSUMPTION]`.
- **Code evidence:** AGENTS.md cohort ops; departmentHistory.ts.
