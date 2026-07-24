# HOD Dashboard — Department Tabs: Gaps & Fixes

Scope: the "Department" nav group under `/hod` — **Faculty, Sections, Subjects, Timetable, Teaching Assignments** (`src/components/layout/navConfig.ts`). Companion to the new "assign faculty per subject" feature on Section Edit (see bottom).

## 1. Summary

The five tabs are functionally complete individually — no dead buttons, no TODOs, error handling present on every async call. The real problems are **architectural, not bugs in any one file**:

1. Faculty was assignable to a *whole section* (Faculty Incharge) or to a *faculty member's own schedule* (Faculty Edit page), but never to a *subject within a section* — closed by this change (§6).
2. Two independent, non-overlapping data shapes share the `teachingAssignments` and `subjects` Firestore collections, populated by two different UIs that don't know about each other.
3. Hand-authored interactive elements (filter pills, icon buttons, grid cells) lack accessible names; Radix-based primitives (`Select`) are fine.

## 2. Tab-by-tab

| Tab | Route | Status | Notes |
|---|---|---|---|
| Faculty | `/hod/faculty` | OK | Full CRUD, import/export, resume PDF, credential provisioning. Graceful degrade if teaching-assignment lookups fail. |
| Sections | `/hod/sections` | Gap → fixed | Listed no subject/faculty info per section. `/hod/sections/[id]/edit` had a single whole-section "Faculty Incharge" field only — no way to see or assign per-subject faculty. **Fixed in this change.** |
| Subjects | `/hod/subjects` | Gap (unfixed) | No faculty column/indicator at all — a HOD can't tell which subjects are unstaffed without opening every section's edit page. Candidate follow-up: surface an "assigned faculty count" badge here, reading the same `teaching-assignments` data. |
| Timetable | `/hod/timetable/...` | OK | Correctly read-only; auto-derived from `TeachingAssignment` + `TimetableSlot`. Empty state (no course-year timing configured) is intentional, not broken. |
| Teaching Assignments | `/hod/teaching-assignments` | **Legacy — recommend retiring** | See §3. |

## 3. The core architectural issue: two shapes, one collection

`Subject` and `TeachingAssignment` (`src/types/teaching.ts`) each silently support two mutually exclusive field sets in the same Firestore collection:

- **Course/section-scoped** (`courseId`, `sectionId`, `year`) — used by Sections, Timetable, and the Faculty-edit page's `TeachingAssignmentsEditor`.
- **Semester-scoped** (`academicYear`, `semester`, free-text `section` string instead of `sectionId`) — used only by `/hod/teaching-assignments`.

Consequences observed:
- `/hod/teaching-assignments` sources faculty from `/api/college/users?role=PANEL_MEMBER` (login accounts), not `/api/college/faculty` (the faculty register) that every other tab uses — a faculty member without a login account silently doesn't appear there.
- Its "Add Subject" mini-form duplicates the dedicated Subjects tab but writes semester-scoped subjects with no `courseId`, invisible to the Subjects tab's course/year filter.
- Assignments created here never produce `TimetableSlot`s, so they never show up on the Timetable tab, even though both are named "teaching assignments" to the HOD.
- Net effect: a HOD who uses this tab gets data that's invisible everywhere else in the same dashboard.

**Fix (recommended, not yet applied):** retire `/hod/teaching-assignments` and its nav entry once the Sections-level faculty assignment (§6) and a Subjects-tab faculty indicator cover its use case. Do **not** extend it further — it's the wrong shape to build on.

**Minor, low-risk cleanup noticed in passing:** `hod/teaching/page.tsx` requests `?myAssignments=true`, a param the GET route never reads (it defaults to the caller's own `facultyId` regardless). Harmless today; delete the dead param next time that file is touched.

## 4. Accessibility

Spot-checked Sections, Subjects, Teaching Assignments, plus shared `DataTable`/`Select`.

- **Good baseline, inherited for free:** `Select` (Radix) ships correct roles/keyboard nav. `DataTable` rows use real `<table>` markup plus `role="button"`, `tabIndex`, and `onKeyDown` for Enter/Space — the best pattern in the codebase.
- **Gaps, all hand-rolled elements:**
  - Course/year filter pills (Sections tab): plain `<button>`, keyboard-reachable, but no `aria-pressed`/`aria-selected` — a screen reader gets no "selected" signal beyond color.
  - Section card Edit/Delete icon buttons: `title` attribute only, no `aria-label` (many AT skip `title` on non-form elements).
  - `TeachingAssignmentsEditor` period-grid cells: no accessible name beyond a ✓/✕ glyph + color.
- **Fix (recommended, not yet applied — small, mechanical, low risk):** add `aria-label` to icon-only buttons and `aria-pressed`/`aria-selected` to filter pills across `hod/sections/page.tsx`, `hod/subjects/page.tsx`, and `TeachingAssignmentsEditor.tsx`. No structural changes needed — same pattern as the existing `DataTable` row handling.

## 5. Priority

| # | Item | Effort |
|---|---|---|
| 1 | ~~Faculty assignable per subject on Section Edit~~ | **Done** (§6) |
| 2 | Faculty-coverage indicator on the Subjects tab | Small |
| 3 | `aria-label` / `aria-pressed` on filter pills and icon buttons | Small |
| 4 | Retire `/hod/teaching-assignments`, migrate any remaining semester-scoped data | Medium — needs a data decision, not just code |

## 6. Delivered: faculty-per-subject on Section Edit

`src/app/(dashboard)/hod/sections/[id]/edit/page.tsx` now has a "Subjects & Faculty" panel: on selecting course + year, it lists that year's subjects (`GET /api/college/subjects`) each with a faculty `Select` (options from the existing active-faculty list already loaded for Faculty Incharge). Saving the section also diffs staged vs. original per-subject faculty and creates/removes course/section-scoped `TeachingAssignment` records accordingly (`POST`/`DELETE /api/college/teaching-assignments`) — same collection and shape already used by Sections/Timetable/Faculty-edit, so it shows up correctly on the Timetable tab and in `TeachingAssignmentsEditor` immediately.

One backend addition: `GET /api/college/teaching-assignments` gained an optional `?sectionId=` filter (`src/app/api/college/teaching-assignments/route.ts`) to fetch a section's existing assignments directly, instead of over-fetching the whole department via `?dept=true`.

Deliberately out of scope: period/timetable-slot assignment from this screen (that stays on Faculty Edit's `TeachingAssignmentsEditor`, which already owns conflict-checking against the timetable) — Section Edit only owns the faculty↔subject link, not scheduling.
