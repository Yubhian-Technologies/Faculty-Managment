# Subject/Assignment Data Flow Optimization Plan

**Goal:** Fix denormalization drift and managed-branch visibility without breaking sub-departments, managed branches, or legacy data.

**Timeline:** 4 phases, ~2 weeks.

---

## Phase 1: Cascade Subject PATCH to Assignments (Days 1–2)

**Problem:** Subject name/code/hours edits don't reach `subjectSemesterAssignments`. Pickers show stale data.

**Changes:**
- `subjects/[id]/route.ts` PATCH: after updating the master, also update matching assignments in 400-doc chunks (like the existing `teachingAssignments` cascade).
- Fields to cascade: `subjectName`, `subjectCode`, `shortCode`, `lectureHours`, `tutorialHours`, `practicalHours`, `hoursPerWeek`.
- Query: `where("subjectId", "==", id)` (covers all departments and semesters).
- Wrap in same transaction when write count is low; batch separately when high.

**Edge cases handled:**
- Sub-department assignments (same query hits them).
- Managed-branch assignments if fan-out is chosen later.
- Legacy assignments with no `year` field: still updated.

**Tests:**
- Add unit test: edit a subject, verify assignment copies are updated.
- Add e2e: edit subject name in Subjects page, verify Teaching Assignments picker shows new name.

**Rollback:** PATCH fails if cascade fails (transaction). Deployable immediately.

**Risk:** Write latency increases for subjects with many assignments. Mitigate with batch chunking (already done).

---

## Phase 2: Unify Subject Creation Rules (Days 3–4)

**Problem:** Manual add uses code-keyed lock; import uses identity hash (code + name + category + L-T-P). Inconsistent after code-uniqueness removal.

**Option A (recommended):** Make manual add use import's identity rule.
- Remove `subjectKeys` lock.
- POST validation: query siblings by `courseId`, check identity in memory (same as import).
- Pro: one rule, consistent, supports my code-duplication change.
- Con: allow duplicate codes requires UI clarity.

**Option B:** Keep code uniqueness, revert my code-duplication change.
- Restore `sameSubjectIdentity` check.
- Pro: simpler, no UI changes.
- Con: users can't import the same code for different subjects.

**Recommendation:** Option A. Update the Subjects page add-dialog to warn "A subject with code X exists as 'Different Subject'. Confirm you want another."

**Changes:**
- Delete `subjectKeys.ts` and its references.
- Update `subjects/route.ts` POST: replace `claimSubjectKey` with in-memory identity check.
- Update `MasterSubjectImportService` to use same identity check (align two paths).
- Remove unit tests for `claimSubjectKey`, add test for identity collision detection.

**Edge cases handled:**
- Sub-departments on parent's course (same identity check as import).
- Legacy courses with no `catalogId` (fallback to courseId for grouping, same as import).

**Rollback:** Deploy both POST and import changes together. If rolled back, old lock check is inert (no new keys are claimed).

**Risk:** Admins can now create duplicate codes. Mitigate with clear UI warning.

---

## Phase 3: Managed-Branch Visibility (Days 5–10)

**Choose one path:**

### Path A: Reader Resolution (Recommended)

**Problem:** Managed branches don't see shared-year subjects because assignments are stored under the manager only.

**Solution:** Fix the two read paths to resolve managed branches.

1. **`subject-semester-assignments` GET** (core route):
   - When filtering by `departmentId`, also include assignments for any department that manages this one (reverse lookup).
   - When filtering by `courseId` alone, return all departments' assignments (already does).
   - Query: `where("departmentId", "in", [selected + those managing it])`.

2. **Teaching Assignments pickers:**
   - Both `TeachingAssignmentsEditor.tsx` calls fetch `subject-semester-assignments?courseId=…&year=…`.
   - De-duplicate by `subjectId` in the UI when the manager and a branch both assign the same subject.

**Changes:**
- Update `subject-semester-assignments/route.ts` GET to resolve managed-branch reversal.
- Update both React components to de-duplicate results.
- Add `findReverseManagers(dept, allDepts)` helper in `managedBranches.ts`.
- No schema changes, no data migration.

**Tests:**
- Unit test: a branch queries assignments, should see manager's shared-year subjects.
- E2E: import subjects under manager, verify branch's Teaching Assignments picker includes them.

**Edge cases:**
- Sub-departments under a managed parent (e.g., "BS-Chemistry" under "BS" which is managed by "BS-English"): handled by recursive manager lookup.
- "No own sections" parents: no change needed (children already stand in for them).
- HOD scope checks: still work (managed branches are part of scope).

**Rollback:** Revert GET query and picker de-dupe. Safe.

---

### Path B: Fan-Out at Import (if chosen)

**Problem:** Branches see nothing because assignments exist only under the manager.

**Solution:** Write copies to each managed branch at import time.

1. **`CourseStructureImportService.commit`:**
   - After writing manager's assignments, loop each department in `managedDepartments`.
   - For each branch, write assignments under branch's own `departmentId` and course doc (if different from manager's).
   - Skip years the manager doesn't teach (already filtered).
   - Write count re-check: manager + (branches × semesters) must be ≤ 500.

2. **`CourseStructureImportService.verify`:**
   - Check manager's assignments and each branch's copy.

3. **Backfill existing subjects:**
   - One-off script: for each subject under a managing department, copy to all branches for the shared years.
   - Dry-run first, report what would be written.
   - Run in background jobs (chunked), not in a single transaction.

**Changes:**
- Update `commit()` to fan-out after manager writes.
- Update `verify()` to check branches.
- Update `buildPlan()` write-count check.
- Add UI notice: "Subjects will be copied to X branches."
- Add backfill script in `scripts/backfill-managed-assignments.mjs`.

**Tests:**
- Unit test: import under manager, verify branches get assignments.
- E2E: import subjects, check both manager's and branch's assignment docs.
- Backfill test: script reports correctly without actual writes.

**Edge cases:**
- Branch's own course doc vs. manager's: use branch's if different.
- Unassign from manager: must also unassign from all branches (requires update to `subject-semester-assignments` DELETE route).
- Branches with no students yet: assignments still written (consistent with manager).

**Rollback:** Branches keep stale copies. Needs cleanup script.

---

## Phase 4: Legacy Data Cleanup (Days 11–14)

**Problem:** Old assignment keys (`{subjectId}_{departmentId}` without `semester`) and semester-scoped subjects still in production.

**Optional:** Clean up after phases 1–3 are stable (1 month).

**Changes:**
- Add migration script to rekey old assignments to new format `{subjectId}_{departmentId}_{semester}`.
- Convert semester-scoped subjects (with `department` field) to master+assignment shape.
- Remove `else if (!body.semester)` branch in `subjects/route.ts` POST.
- Remove legacy key migration code from `SubjectInstanceService`.

**Risk:** Large batch operations. Run as background job with transaction chunks.

**Tests:** Migration dry-run, then live run in staging.

---

## Dependency Order

1. **Phase 1** (PATCH cascade) → standalone, deploy immediately.
2. **Phase 2** (unify creation) → deploy with Phase 1 or alone.
3. **Phase 3a** (reader resolution) → standalone, no data migration. OR
   **Phase 3b** (fan-out) → requires backfill script, coordinate carefully.
4. **Phase 4** (legacy cleanup) → after 1 month of phase 1–3 stability.

---

## Files to Change

### Phase 1
- `src/app/api/college/subjects/[id]/route.ts` (+15 lines cascade)
- Add test in `src/lib/subjects/services/CourseStructureImportService.test.ts`

### Phase 2
- Delete: `src/lib/subjects/subjectKeys.ts`
- Update: `src/app/api/college/subjects/route.ts` (POST validation)
- Update: `src/lib/subjects/services/MasterSubjectImportService.ts` (duplicate check)
- Update: `src/lib/departments/managedBranches.ts` (add identity check, optional helper)
- Update: `src/app/(dashboard)/academics/subjects/page.tsx` (add warning dialog)
- Tests: rewrite `subjectKeys.test.ts`

### Phase 3a (Reader Resolution)
- Update: `src/app/api/college/subject-semester-assignments/route.ts` (reverse manager lookup)
- Update: `src/components/faculty/TeachingAssignmentsEditor.tsx` (de-dupe results)
- Update: `src/components/timetable/TeachingAssignmentsEditor.tsx` (de-dupe results)
- Add: `src/lib/departments/managedBranches.ts` (findReverseManagers helper)

### Phase 3b (Fan-Out)
- Update: `src/lib/subjects/services/CourseStructureImportService.ts` (commit, verify, write count)
- Add: `scripts/backfill-managed-assignments.mjs`
- Update: `src/app/api/college/subject-semester-assignments/route.ts` (DELETE to unassign branches too)
- Update: UI to show branch count in import summary

### Phase 4
- Add: `scripts/migrate-legacy-assignments.mjs`
- Update: `src/lib/subjects/services/SubjectInstanceService.ts` (remove legacy rekey)
- Update: `src/app/api/college/subjects/route.ts` (remove `else if (!body.semester)`)

---

## Testing Checklist

- [ ] Phase 1: Subject edit cascades to assignments.
- [ ] Phase 1: Teaching Assignments picker shows updated name.
- [ ] Phase 2: Manual add rejects identity collisions (not code alone).
- [ ] Phase 2: Import and manual add use same rules.
- [ ] Phase 3a: Branch queries resolve manager's shared-year subjects.
- [ ] Phase 3a: Picker de-dupes manager and branch assignments.
- [ ] Phase 3b: Import fans out to branches. Verify counts match.
- [ ] Phase 3b: Unassign from manager also unassigns from branches.
- [ ] Phase 4: Migration script rewrites old keys without data loss.

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| PATCH cascade slow on large subjects | Batch in 400-doc chunks (same as existing). Monitor latency. |
| Duplicate codes confuse users | Add clear warning in Subjects page add dialog. |
| Manager edits don't unassign branches (Path B) | Update DELETE route to cascade. Test thoroughly. |
| Backfill misses edge cases | Dry-run first, spot-check results, roll back if issues found. |
| Legacy data breaks migrations | Run migrations in background, chunk by college. Test in staging first. |
| Sub-department queries break | All changes use existing scope checks (managedBranches, canHodEditDepartmentYear). No new scope rules. |

---

## Recommendation

**Do Path A (reader resolution) + Phase 1 + Phase 2.** 

- Smallest risk, fastest to ship.
- Fixes the pickers immediately (Phase 1).
- Makes rules consistent (Phase 2).
- Solves visibility without new data (Phase 3a).
- Skip Phase 4 until legacy data is proven stable (weeks/months).
- If fan-out is needed later, can be added as Phase 3b in a separate cycle.

**Estimated effort:** 5–7 days, 3 deploys (Phase 1, Phase 2, Phase 3a).

**Green light to proceed?**
