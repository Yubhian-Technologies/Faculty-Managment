# Flow — M8-F1: RND Coordinator Pre-Review

- **Flow ID:** M8-F1
- **Actors:** faculty submitter, RND_COORDINATOR seat holder (department), R_AND_D
- **Trigger:** faculty submits a research record (publication/project/activity)
- **Preconditions:** submitter owns record; department's seat state determines routing
- **Main success scenario:**
  1. Submit → record persisted (college-scoped collection) + notify R&D/coordinator.
  2. `GET /api/college/research-review` — coordinator lists pending submissions for their department; seat verified via `roleSeats` lookup (coordinatorReview.ts:51).
  3. Approve → record visible to R&D (`/r-and-d` boards); Return → back to faculty with remarks.
  4. People-field resolution (inventors/consultants) runs against `facultyMembers where userUid` before final save (finalizeIprInventors.ts:19-28, finalizeConsultants.ts:20).
- **Alternate/error:** no seat in department → submissions go directly to R&D `[ASSUMPTION]`; non-seat reviewer → 403; ownership mismatch → 403.
- **UI:** `/rnd-coordinator` (inbox), `/r-and-d/record/[module]/[id]` (detail), faculty submit via profile module pages.
- **API:** `research-review`, per-type CRUD routes.
- **Backend:** coordinatorReview.ts, applyResearchProfileFields/applyCitationMetricsFields (projections), finalize*.
- **DB:** roleSeats, per-type collections, facultyMembers, users (projections), notifications.
- **Permissions:** seat check (live via roleSeats); college guard on CRUD.
- **Validation:** uid references exist; metrics ranges `[UNVERIFIED]`.
- **State transitions:** submitted → reviewed(approved|returned) when seat exists.
- **Side effects:** notifications; users-doc projections updated on metrics/profile saves (:36-37).
- **Concurrency:** single-seat per department assumed `[ASSUMPTION]`.
- **Code evidence:** cited.
