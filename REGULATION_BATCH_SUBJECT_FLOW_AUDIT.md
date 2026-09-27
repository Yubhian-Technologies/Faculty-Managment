# Regulation → Batch → Subject Flow Audit

**Date:** 2026-09-27
**Scope:** Course Catalog (Regulation/Batch) → Course → Subject (master + instance) → Teaching Assignment → Timetable, across every dashboard that touches it (Principal/VP/Super Admin, Academics, HOD, Panel Member/College Staff, Class Leader).
**Method:** Direct code read of the current working tree (not the Firestore graph index), file:line cited for every claim. Findings are marked **CONFIRMED** (traced end-to-end through the actual code paths) or **PLAUSIBLE** (strong evidence, not fully traced).

This supersedes three items in the existing `SUBJECT_CREATION_VULNERABILITY_REPORT.md` (V1, V2, V6) — see "Stale findings" at the end. That report was generated from a knowledge-graph snapshot and predates several fixes already present in this working tree.

---

## 1. How the flow actually works today

```
Principal/VP/SuperAdmin                 colleges/{c}/courseCatalog/{id}
  Settings > Course Catalog     ──────▶  { name, code, durationYears,
  (CourseCatalogSettingsCard)             regulations: string[],
                                           regulationBatches: {                 <- "batches under a regulation"
                                             "R20": "2020-2024,2021-2025",
                                             "R23": "2023-2027,2024-2028,..." } }
        │
        │ courses/route.ts POST (Principal/SuperAdmin only)
        ▼
Department-owned Course             colleges/{c}/courses/{courseId}
  copies name/code/duration   ──────▶  { departmentId, catalogId, name, code,
  from the catalog verbatim             durationYears, isActive }
  + Department.courseScopes[catalogId] = { assignedYears, secondaryDepartments }
        │
        │ (a) academics/subjects (single add) or /import (bulk)  — Academics/Principal/VP/SuperAdmin
        ▼
Master Subject                      colleges/{c}/subjects/{subjectId}
  courseId + regulation,      ──────▶  { courseId, courseName, regulation,
  NO department, NO year                academicYear, code, name, L/T/P, type, category }
        │
        │ (b) subject-semester-assignments POST  — HOD/Academics/Principal (Teaching Assignments page)
        ▼
Subject Instance (snapshot)         colleges/{c}/subjectSemesterAssignments/{subjectId}_{departmentId}
  department + year + semester ─────▶  { subjectId, departmentId, year (derived from
  resolved from courseYearTimings       courseYearTimings), semester, snapshot of hours/credits }
        │
        │ (c) teaching-assignments POST (courseId+sectionId+subjectId)  — HOD/Panel/College Staff
        ▼
Teaching Assignment + TimetableSlot(s)   colleges/{c}/teachingAssignments/{id}
  faculty ↔ subject ↔ section  ──────▶  colleges/{c}/timetableSlots/{id}
                                          (subjectName/subjectCode DENORMALIZED at write time)
        │
        ▼
Student Attendance / Timetable views (Faculty, Class Leader, Principal, Panel)
```

A **Section** (`colleges/{c}/sections/{id}`) is a parallel, independent consumer of the same Regulation/Batch data — created by an HOD, it stores its own `batch` + optional `regulation` and is the **only** node in this whole chain that server-validates the regulation against the batch's actual admission year (see §2.1). Sections and Subjects both read `regulationBatches` but validate it with different rigor, which is the root of finding **F1**.

---

## 2. Findings

### F1 — Master Subject's regulation↔batch check is dead code (a `Number()` on a range string always yields `NaN`) — **CONFIRMED, HIGH (correctness)**

**Location:** [subjects/route.ts:160-190](src/app/api/college/subjects/route.ts#L160-L190)

```ts
const allBatchYears = Object.values(catalogData.regulationBatches).map(Number); // "2024-2028,2025-2029" -> NaN
const minYear = Math.min(...allBatchYears);   // NaN
const maxYear = Math.max(...allBatchYears);   // NaN, unused
applicableRegulations = regulationsForCourseYearByBatch(
  catalogData.regulationBatches, minYear /* NaN */, undefined, catalogData?.regulations,
);
```

`CourseCatalogItem.regulationBatches` values are comma-separated **range strings** (`"2024-2028,2025-2029"`), not numbers — that's the whole point of `parseBatchStartYears` in `academicSession.ts`. `Number("2024-2028,2025-2029")` is `NaN`. Every subsequent step keys off `NaN`:

- `admissionStartYearForCourseYear(asOfStartYear, NaN)` → `NaN`
- `regulationsForBatchStartYear(regulationBatches, NaN, ...)` → since `regulationBatches` is non-empty, the function does **not** take its fallback branch; it loops `parseBatchStartYears(batch).includes(NaN)`, which is always `false` (none of the parsed years is literally `NaN`) — so `matches` is always `[]`.

Back in the route: `applicableRegulations.length > 0` is always `false`, so it falls to the `else if` branch — the older, looser check (`catalogRegulations.includes(regulation)`, i.e. "is this regulation attached to the course at all"). The batch-aware congruence check the comment above this code describes ("resolve which regulations apply to this course... since the master subject has no year") **never actually executes** — it always silently degrades to "any regulation ever assigned to the course."

**Impact:** Not a privilege issue (both branches still require *some* legitimate relationship), but it means Academics gets no real protection against tagging a Subject with a regulation that doesn't correspond to any batch this course currently has — the code that was written to prevent exactly that is unreachable.

**Fix:** Drop the dead `minYear`/`maxYear` computation; when regulationBatches exist for a course, the "applicable regulations for a master subject" set should just be `Object.keys(catalogData.regulationBatches)` (every regulation the catalog defines batches for) unioned with the plain fallback, not a batch-year resolution that a year-less master subject can't meaningfully feed anyway.

---

### F2 — Course Catalog never validates that two regulations don't claim the same batch — **CONFIRMED, MEDIUM**

**Location:** [course-catalog/route.ts POST:61-70](src/app/api/college/course-catalog/route.ts#L61-L70), [course-catalog/[id]/route.ts PATCH:78-88](src/app/api/college/course-catalog/%5Bid%5D/route.ts#L78-L88)

Both endpoints validate each regulation's own range string against `/^\d{4}-\d{4}(,\d{4}-\d{4})*$/` — format only. Nothing stops `regulationBatches = { "R20": "2023-2027", "R23": "2023-2027" }` (same admission year claimed by two regulations) from being saved. `academicSession.ts`'s own doc-comments acknowledge this state is possible and call it "ambiguous — callers should ask Academics to fix the batches" — but every actual caller (`sections/route.ts`, `subjects/route.ts`) just takes whichever match it finds (`allowed.find(...)`, `applicableRegulations.includes(...)`) with no surfaced warning. The UI (`CourseCatalogSettingsCard.tsx`'s `RegulationBatchesEditor`) doesn't check for overlap either — it just appends whatever start-year/count the user types.

**Impact:** A typo in the Course Catalog (re-using a start year across two regulations) silently creates an ambiguous state that nothing detects until someone notices two batches showing inconsistent regulations on their Sections vs. Subjects pages.

**Fix:** On catalog POST/PATCH, after merging `regulationBatches`, expand every regulation's batch-years and reject if any start-year appears under more than one regulation code.

---

### F3 — Deleting a Subject or a Course doesn't cascade to `subjectSemesterAssignments` (or, for Course, to `subjects` at all) — **CONFIRMED, MEDIUM**

**Location:** [subjects/[id]/route.ts DELETE:152-206](src/app/api/college/subjects/%5Bid%5D/route.ts#L176-L195), [courses/[id]/route.ts DELETE:66-136](src/app/api/college/courses/%5Bid%5D/route.ts#L79-L91)

- `subjects/[id]` DELETE only checks `teachingAssignments` before allowing a hard delete (line 181-195). It does **not** check `subjectSemesterAssignments` (the per-department "instance" doc, id `${subjectId}_${departmentId}`). An HOD can instantiate a subject into their department's semester (creating that instance) without yet staffing it with a teaching assignment; at that point Academics can freely delete the master Subject, leaving the instance doc pointing at a subject id that now 404s on any re-fetch.
- `courses/[id]` DELETE only checks `sections` referencing the course (line 79-91) before deleting it and its `courseYearTimings`. It never checks `subjects` (which store `courseId`) or `subjectSemesterAssignments` (which also store `courseId`). A course with Subjects already defined but no Sections yet can be deleted, orphaning every one of its Subjects and any instances made from them.

**Impact:** Same class of problem the prior report's V1 described, but the actual remaining gap is narrower — the missing check is specifically `subjectSemesterAssignments`, not the wholesale "no DELETE exists at all" the old report claimed (that part is now fixed).

**Fix:** Add a `subjectSemesterAssignments.where("subjectId"/"courseId", "==", id)` existence check alongside the existing `teachingAssignments`/`sections` guard in both DELETE handlers, and reject (409) the same way.

---

### F4 — Master Subject Import can resolve `courseId` from a free-typed course name across the whole college — **CONFIRMED (code path), not reachable via the shipped UI today, MEDIUM**

**Location:** [MasterSubjectImportService.ts:62-75](src/lib/subjects/services/MasterSubjectImportService.ts#L62-L75)

```ts
let matchingCourse = payload.courseId ? courses.find((c) => c.id === payload.courseId) : undefined;
if (!matchingCourse && courseInput) {
  matchingCourse = courses.find((c) => c.name.toLowerCase() === courseInput.toLowerCase() || ...);
}
```

`courses/route.ts` POST deliberately lets **every department** create its own independent `Course` doc from the same Course Catalog entry, copying the catalog's `name`/`code` verbatim (courses/route.ts:361-371). So it's completely normal for CSE's "B.Tech" `Course` doc and ECE's "B.Tech" `Course` doc to have identical `name`/`code` with different `departmentId` and, usually, different `courseYearTimings`. When the import request omits `courseId` and only sends a course name, `courses.find(...)` returns whichever doc Firestore happened to hand back first — not necessarily the one the caller meant. Everything downstream (`SubjectInstanceService.resolveYearForSemester`, keyed on `${courseId}_year${y}`) then resolves semesters against that wrong department's own timing configuration.

**Mitigating factor:** the shipped Academics UI (`academics/subjects/import/page.tsx:266`) always sends an explicit `courseId` alongside the name, so this ambiguity isn't reachable through the normal product today. It is one UI change, or one direct API call by a PRINCIPAL/VP/ACADEMICS/SUPER_ADMIN user (all of whom can already call this endpoint), away from silently misfiling a batch of subjects under a different department's course.

**Fix:** Make `courseId` a hard requirement in `executeImport` (400 if absent) and drop the name/code fallback resolution entirely, or narrow it to `courses.filter(c => c.name... ).length === 1 ? that one : fail-with-"ambiguous, specify courseId"`.

---

### F5 — Import silently skips regulation tagging when a course has zero catalog regulations, with no warning — **PLAUSIBLE / by-design leniency, LOW**

**Location:** [MasterSubjectImportService.ts:110-124](src/lib/subjects/services/MasterSubjectImportService.ts#L110-L124)

```ts
if (!regulation) {
  if (catalogRegulations.length === 1) regulation = catalogRegulations[0];
  else if (catalogRegulations.length > 1) { failed.push(...); continue; }
  // catalogRegulations.length === 0: falls through, regulation stays undefined
}
```

When a course has **no** regulations configured yet, an imported subject is created with no `regulation` field at all — and, unlike every other skip path in this file, this doesn't add a `warnings` entry, so the created-count looks like a clean success. This matches the deliberate "no year restriction = offered everywhere" leniency documented elsewhere in this codebase (`academicSession.ts`'s own comment on `regulationsForCourseYearByBatch`'s fallback), so it's likely intentional rather than a defect — flagging only because it produces zero user-facing signal that regulation tagging was skipped.

**Fix (optional):** push a `warnings` entry ("Course has no regulations configured — imported without a regulation tag") when this branch is taken, matching the signal every other soft-skip in this file already gives.

---

## 3. Cross-dashboard map of who touches which node

| Node | Dashboard / Role | Route |
|---|---|---|
| Course Catalog (regulations + regulationBatches) | Principal / VP / Super Admin (create); Academics (edit regulations only) | `course-catalog`, `course-catalog/[id]` |
| Department Course (from catalog) | Principal / Super Admin | `courses`, `courses/[id]` |
| Master Subject (course + regulation) | Academics / Principal / VP / Super Admin | `subjects`, `subjects/import`, `subjects/[id]` |
| Subject Instance (department + semester) | HOD / Academics / Principal / VP / Super Admin | `subject-semester-assignments` |
| Section (course + year + batch + regulation) | HOD (create); Super Admin (override) | `sections` |
| Teaching Assignment + Timetable Slot | HOD / Panel Member / College Staff (Timetable Incharge) | `teaching-assignments` |
| Timetable / Teaching Load views | Faculty, Class Leader, Principal, HOD, Panel | `timetable-slots`, `class-leader/timetable`, `teaching-assignments` GET |

**The asymmetry that matters most:** `sections/route.ts` POST (§430-475) is the *only* one of these that correctly resolves "is this regulation valid for this exact batch's admission year" using the string-aware `regulationsForBatchStartYear`/`regulationsForCourseYearByBatch` helpers — and it does so correctly, matching the batch's own parsed start year, with case-insensitive canonicalization. `subjects/route.ts` POST attempts the equivalent check but it's dead code (F1), and `subjects/import` doesn't attempt batch congruence at all (only "is this regulation anywhere in the catalog's list", F5). Three sibling endpoints, three different levels of enforcement for the same underlying rule — which is exactly the kind of drift the "connecting nodes" question is getting at: a Subject and a Section for the *same course* can end up carrying regulations that don't actually correspond to the same batch, and nothing before the timetable/attendance layer would ever notice.

---

## 4. Stale findings from `SUBJECT_CREATION_VULNERABILITY_REPORT.md`

Verified against the current working tree — these are **already fixed**, do not re-apply their recommendations:

- **V1** ("no DELETE handler on subjects") — fixed. [subjects/[id]/route.ts:152-206](src/app/api/college/subjects/%5Bid%5D/route.ts#L152) now has a DELETE that blocks while `teachingAssignments` reference the subject. (Residual gap: F3 above.)
- **V2** ("timetable slots not cascade-deleted on assignment delete") — fixed in *both* places. [teaching-assignments/route.ts DELETE:760-764](src/app/api/college/teaching-assignments/route.ts#L760-L764) and [teaching-assignments/[id]/route.ts DELETE:105-109](src/app/api/college/teaching-assignments/%5Bid%5D/route.ts#L105-L109) both batch-delete `timetableSlots` by `assignmentId` together with the assignment.
- **V6** ("HOD bypasses master-subject authorization via the semester-scoped branch") — not a bug. `subjects/route.ts`'s comment block (line 102-106) documents this as two *intentionally* separate creation shapes sharing one collection; the master-subject branch still hard-blocks HOD at line 207-212. The semester-scoped branch is HOD's own supported path (Teaching Assignments page), not a governance bypass.

---

## 5. Priority order

1. **F1** — fix the dead NaN check (cheap, removes false confidence in an existing guard).
2. **F3** — add the missing `subjectSemesterAssignments` cascade-check to both DELETE handlers (prevents orphaned instance docs).
3. **F4** — require `courseId` in the import service (closes a latent cross-department misfile risk before any UI change reopens it).
4. **F2** — reject overlapping `regulationBatches` at the Course Catalog boundary (prevents the ambiguous state at its source).
5. **F5** — cosmetic warning, do whenever convenient.

---

## 6. Implementation action plan

Guiding rule for every item below: **no schema migration, no new abstraction, no feature flag.** Every fix is either (a) a validation that only rejects a *new* write going forward (never touches existing documents, so nothing already saved can start failing to read), or (b) a dead-code deletion that changes no runtime behavior at all. That's what keeps the existing workflow intact — there is nothing to roll back at the data layer if a fix needs to be reverted, only a code revert.

Each item is broken into the three layers the request asked to have optimised together: **Model** (Firestore shape / `src/types`), **Controller** (the API route / service), **View** (the page that has to keep behaving the same or surface the new message correctly).

### Step 1 — F1: stop pretending the master-subject batch check exists

- **Model:** no change. `CourseCatalogItem.regulationBatches` shape is untouched.
- **Controller** ([subjects/route.ts:160-190](src/app/api/college/subjects/route.ts#L160)): delete the `allBatchYears`/`minYear`/`maxYear`/`regulationsForCourseYearByBatch(...)` block entirely. A master Subject has no `year`, so a batch-*year* congruence check was never answerable at this level in the first place — that's already correctly enforced one level down, at Section creation, which has an actual batch to check against (§3's asymmetry). Replace it with the single check that's actually meaningful here: `catalogRegulations.includes(regulation)`, i.e. exactly what already runs today via the accidental fallback. **This is a no-op for runtime behavior** — it only removes misleading dead code, so nothing that currently succeeds or fails changes.
- **View:** none required. `academics/subjects/new/page.tsx`'s own comment ("show all regulations for this course, master subject has no year") already matches the simplified server behavior — it's already correct, just confirms no drift once the controller is simplified.
- **Verification:** re-run existing subject-creation flows manually (or existing tests if any cover this route) and confirm identical accept/reject outcomes before and after — the diff should be behavior-neutral.

### Step 2 — F4: require `courseId` in bulk import (closes the cross-department misfile path)

- **Model:** no change.
- **Controller** ([MasterSubjectImportService.ts:62-75](src/lib/subjects/services/MasterSubjectImportService.ts#L62)): require `payload.courseId`; if missing, fail the whole import up front with a clear message ("Select a Course before importing"), the same shape as the existing `records` length checks in `subjects/import/route.ts`. Delete the name/code `courses.find(...)` fallback rather than trying to make it "smarter" — the shipped UI never relies on it.
- **View:** none required — `academics/subjects/import/page.tsx:266` already always sends `courseId` (`courseId: selectedCourse.id`), so this tightening is invisible to the real product flow.
- **Verification:** unit test on `MasterSubjectImportService.executeImport` — omit `courseId`, expect a top-level rejection instead of a per-row failure; re-run with `courseId` present and confirm output is byte-identical to today's.

### Step 3 — F5: warn instead of silently dropping regulation on import

- **Model:** no change.
- **Controller** ([MasterSubjectImportService.ts:110-124](src/lib/subjects/services/MasterSubjectImportService.ts#L110)): in the `catalogRegulations.length === 0` fall-through branch, push one `warnings` entry ("Course has no regulations configured — imported without a regulation tag") before continuing. Purely additive; `created` count and the subject document written are unchanged.
- **View:** none required — `academics/subjects/import/page.tsx`'s result card already renders `result.warnings` generically (the "Imported, but some fields were ignored" block).
- **Verification:** import a row against a course with an empty `regulations` list, confirm the new warning appears and the subject is still created exactly as before.

### Step 4 — F3: block deletes that would orphan a subject instance

- **Model:** no change.
- **Controller:**
  - [subjects/[id]/route.ts DELETE](src/app/api/college/subjects/%5Bid%5D/route.ts#L176): add `subjectSemesterAssignments.where("subjectId","==",id).limit(1).get()` alongside the existing `teachingAssignments` check; non-empty → 409 with a message in the same voice as the existing one ("This subject still has department instances assigned. Unassign it from Teaching Assignments first, or mark it inactive.").
  - [courses/[id]/route.ts DELETE](src/app/api/college/courses/%5Bid%5D/route.ts#L79): add the equivalent two checks — `subjects.where("courseId","==",id).limit(1)` and `subjectSemesterAssignments.where("courseId","==",id).limit(1)` — alongside the existing `sections` check, same 409 pattern ("Cannot delete a course that has subjects. Remove its subjects first.").
- **View:** no change required in either case — both `academics/subjects/page.tsx` and the course-management UI already route API errors through the shared toast pattern, so a new 409 message surfaces exactly like the existing "in use" ones do. Worth a quick manual check that the delete button's confirm-dialog doesn't assume success and optimistically remove the row before the response comes back.
- **Verification:** route tests — (a) instantiate a subject into a department, attempt to delete the master subject, expect 409, unassign, delete again, expect 200; (b) create a course with a subject but no sections, attempt delete, expect 409.
- **Why this is safe to tighten (unlike F2 below, this is a pure net-add):** it only turns a previously-silent data-corruption path into an explicit, recoverable error. No existing document is touched; a delete that would have succeeded and quietly orphaned data now fails loudly and tells the user what to clean up first.

### Step 5 — F2: reject overlapping regulation batches at the Course Catalog boundary

- **Model:** no change to `CourseCatalogItem`.
- **Controller** ([course-catalog/route.ts POST:61-70](src/app/api/college/course-catalog/route.ts#L61), [course-catalog/[id]/route.ts PATCH:78-88](src/app/api/college/course-catalog/%5Bid%5D/route.ts#L78)): after the existing per-regulation format regex passes, run one more pass over the **complete** submitted `regulationBatches` map (both routes already receive/write it as a full replacement object, never a partial merge — confirmed by how `CourseCatalogSettingsCard` manages `draft.regulationBatches` client-side) — expand each regulation's `parseBatchStartYears`, and if any start-year appears under more than one regulation code, reject with 400 naming the conflicting regulations and year.
- **View** (`CourseCatalogSettingsCard.tsx`'s `RegulationBatchesEditor.addRegulation`, optional UX improvement, not required for correctness): run the same overlap check client-side before calling `setDraft(...)`, so the conflict surfaces as an inline toast at the moment of adding a batch rather than only on save. Skip this if it isn't wanted — the server check alone is sufficient and this is the one place in the whole plan that's a genuine "nice to have," not a fix.
- **Why this is the last step, not the first:** it's the only change in this plan that can reject a *save* an Academics/Principal user is actively trying to make (unlike F3, which only blocks destructive deletes). It needs to ship after the others so there's a stable baseline to test the new rejection against, and it's worth a quick manual pass through existing colleges' catalog data (read-only, via the existing GET) to confirm no college already has an overlapping config that this would suddenly start blocking on their *next* edit — if one exists, that college's Academics team gets a one-time "fix your batches" prompt the next time they touch that entry, which is the intended outcome, not a regression, but worth knowing about in advance rather than being surprised by a support ticket.

### Sequencing summary

| Step | Finding | Risk of breaking existing workflow | Type of change |
|---|---|---|---|
| 1 | F1 | None — behavior-neutral dead code removal | Simplification |
| 2 | F4 | None — shipped UI already complies | Guard rail (closes unused path) |
| 3 | F5 | None — additive warning only | Additive |
| 4 | F3 | Low — only blocks an action that was silently corrupting data | New guard |
| 5 | F2 | Low, but the only step that can reject a legitimate in-progress save | New validation |

### Cross-layer check to run once, after all five steps

- **Model:** `src/types/teaching.ts` / `src/types/core.ts` — confirm no type needs a new optional field (none of the fixes above add stored data, so this should be a no-op check, not a change).
- **Controller:** `npx tsc --noEmit` and `npx vitest run` (per this repo's own command list in `CLAUDE.md`) — not `npm run lint`, which is documented as already broken on `main` for unrelated reasons.
- **View:** manually exercise, once, end-to-end in the Academics and HOD dashboards: create a catalog entry with two regulations → add a course → add a master subject → instantiate it into a department's semester → assign a teaching assignment → confirm the Sections page's own regulation picker still shows the same options it did before (Step 5 must not have narrowed *that* endpoint — it doesn't touch `sections/route.ts` at all, but worth eyeballing once since it's the one page in this whole chain that was already correct).
