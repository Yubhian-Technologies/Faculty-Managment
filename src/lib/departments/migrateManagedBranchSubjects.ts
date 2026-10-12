// Moves a shared-year manager's (e.g. "Basic Science - Chemistry") Year-1
// sections, students, subjects, teaching assignments and timetable rows over
// to the real core department it feeds (e.g. "CSE") directly, once that core
// department's own Years Taught has been opened up to include the shared
// year.
//
// Checked against real production data (VISHNU INSTITUTE OF TECHNOLOGY,
// "VISHNU WOMEN'S UNIVERSITY"/SVECW) rather than assumed: today, a shared
// first-year Section/StudentRecord is filed with `department` = the
// manager's OWN name and the real branch only as `secondaryDepartments`
// (Section, plural, "a section commits to a single branch" - see
// src/types/core.ts) / `secondaryDepartment` (StudentRecord, singular). This
// is exactly the shape the existing `students/promote` route already
// transitions out of (department -> the real branch, secondaryDepartment
// cleared) when a cohort advances a year - this module does the same rename,
// in place, without advancing the year, for whichever Section is explicitly
// being moved.
//
// teachingAssignments/timetableSlots are repointed by sectionId (not by
// guessing a department-name match), since that's the one unambiguous link
// between them and the Section actually being renamed.
//
// Idempotent and safe to retry: a subjectSemesterAssignment already present
// at the branch's own deterministic id is never overwritten (kept, the
// manager's copy discarded instead); a Section that would collide with one
// already filed under the branch (same name+year) is skipped, reported, and
// left untouched rather than merged or overwritten.

import { FieldValue } from "firebase-admin/firestore";
import type { SubjectSemesterAssignment, TeachingAssignment, Section } from "@/types";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";

type Db = FirebaseFirestore.Firestore;

export interface SectionMoveDetail {
  sectionId: string;
  sectionName: string;
  year: number;
  studentCount: number;
  fromDepartmentName: string;
  toDepartmentName: string;
}

export interface SkippedSectionDetail {
  sectionName: string;
  year: number;
  reason: string;
}

export interface MigrateManagedBranchSubjectsResult {
  sectionsRenamed: number;
  sectionsSkippedConflict: number;
  studentsMoved: number;
  subjectAssignmentsMoved: number;
  subjectAssignmentsDeduped: number;
  teachingAssignmentsRepointed: number;
  timetableSlotsRepointed: number;
  /** Existing rows under the branch whose courseId still pointed at the manager's (or any other department's) Course doc - repaired in place, idempotent. */
  courseIdsRepaired: number;
  /**
   * Rows whose courseId could NOT be repointed because the branch has no
   * Course doc yet for that catalog entry - e.g. its own Years Taught/Course
   * wasn't set up before this ran. These rows stay invisible everywhere that
   * filters by courseId (Course-Year Timings subject counts, etc.) until this
   * migration is run again after the branch's own Course doc exists. A
   * non-zero count here means: create/open that department's own Course for
   * this programme, then re-run this same migration to finish the job.
   */
  courseIdsUnresolved: number;
  /** Existing rows under the branch that still carried a secondaryDepartmentNames narrowing from before they moved here - cleared, since once a row is directly owned by this department the narrowing is both meaningless and actively wrong (it can make the row reappear in a SIBLING branch's own Subjects list). */
  secondaryDepartmentNamesCleared: number;
  /** Per-section breakdown - which section, how many students, moving to which department. */
  sections: SectionMoveDetail[];
  /** Sections NOT moved because a section with the same name/year already exists under the core department. */
  skippedSections: SkippedSectionDetail[];
}

interface AssignmentRow {
  id: string;
  subjectId: string;
  semester: number;
  year?: number;
}

/**
 * Pure decision step for subjectSemesterAssignments: which of the manager's
 * own rows get cloned under the branch's departmentId (`toCreate`), which
 * are discarded because the branch already has its own copy at that
 * deterministic id (`toDiscard` - both still get their manager-side
 * original deleted), and which are left untouched because they're for a
 * year outside the requested scope (`toSkip`).
 */
export function planSubjectAssignmentMoves(
  rows: AssignmentRow[],
  branchDepartmentId: string,
  existingBranchInstanceIds: ReadonlySet<string>,
  years: ReadonlySet<number> | null
): { toCreate: AssignmentRow[]; toDiscard: AssignmentRow[]; toSkip: AssignmentRow[] } {
  const toCreate: AssignmentRow[] = [];
  const toDiscard: AssignmentRow[] = [];
  const toSkip: AssignmentRow[] = [];
  for (const row of rows) {
    if (years && row.year != null && !years.has(row.year)) {
      toSkip.push(row);
      continue;
    }
    const targetId = `${row.subjectId}_${branchDepartmentId}_${row.semester}`;
    if (existingBranchInstanceIds.has(targetId)) toDiscard.push(row);
    else toCreate.push(row);
  }
  return { toCreate, toDiscard, toSkip };
}

async function commitInChunks(db: Db, ops: { ref: FirebaseFirestore.DocumentReference; action: "set" | "delete" | "update"; data?: Record<string, unknown> }[]): Promise<void> {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + 400)) {
      if (op.action === "delete") batch.delete(op.ref);
      else if (op.action === "set") batch.set(op.ref, op.data as Record<string, unknown>);
      else batch.update(op.ref, op.data as Record<string, unknown>);
    }
    await batch.commit();
  }
}

async function run(
  db: Db,
  collegeId: string,
  subDepartmentId: string,
  branchDepartmentId: string,
  years: number[] | undefined,
  dryRun: boolean
): Promise<MigrateManagedBranchSubjectsResult> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const [subDeptSnap, branchSnap] = await Promise.all([
    collegeRef.collection("departments").doc(subDepartmentId).get(),
    collegeRef.collection("departments").doc(branchDepartmentId).get(),
  ]);
  if (!subDeptSnap.exists) throw new Error("Sub-department not found");
  if (!branchSnap.exists) throw new Error("Core department not found");
  const subDeptData = subDeptSnap.data() as {
    name?: string;
    managedDepartments?: string[];
    secondaryDepartments?: string[];
    courseScopes?: Record<string, { secondaryDepartments?: string[] }>;
  };
  const subDeptName = subDeptData.name ?? "";
  const branchData = branchSnap.data() as { name?: string; code?: string };
  const branchName = branchData.name ?? "";
  const branchCode = branchData.code ?? "";

  // ── Course-doc resolution, shared by sections renaming, the subject move
  // and the courseId repair pass below. A moved subjectSemesterAssignment
  // must point at the BRANCH's own Course doc (the one its own HOD/Years
  // Taught actually resolve against) - carrying over the manager's Course
  // doc id left the row invisible everywhere that also filters by courseId
  // (e.g. the Course-Year Timings "N Subjects" counts), even though
  // departmentId was already correct. ──
  const branchCoursesSnap = await collegeRef.collection("courses").where("departmentId", "==", branchDepartmentId).get();
  const catalogIdToOwnCourseId = new Map<string, string>();
  for (const d of branchCoursesSnap.docs) {
    const catalogId = (d.data() as { catalogId?: string }).catalogId;
    if (catalogId) catalogIdToOwnCourseId.set(catalogId, d.id);
  }
  const courseCatalogCache = new Map<string, string | undefined>();
  async function catalogIdForCourse(cId: string): Promise<string | undefined> {
    if (!cId) return undefined;
    if (courseCatalogCache.has(cId)) return courseCatalogCache.get(cId);
    const snap = await collegeRef.collection("courses").doc(cId).get();
    const catalogId = (snap.data() as { catalogId?: string } | undefined)?.catalogId;
    courseCatalogCache.set(cId, catalogId);
    return catalogId;
  }
  /**
   * The branch's own Course doc id for the same programme as `sourceCourseId`.
   * `unresolved: true` means the branch has no Course doc yet for that catalog
   * entry (e.g. its own Years Taught/Course wasn't set up before this ran) -
   * `courseId` then falls back to the source id unchanged (never worse than
   * before this fix), but the row is left pointing at the WRONG department's
   * Course doc and will stay invisible to every courseId-scoped view (Course-
   * Year Timings subject counts, etc.) until this function is called again
   * after the branch's own Course doc exists - see courseIdsUnresolved below.
   */
  async function resolveBranchCourseId(sourceCourseId: string | undefined): Promise<{ courseId: string | undefined; unresolved: boolean }> {
    if (!sourceCourseId) return { courseId: sourceCourseId, unresolved: false };
    const catalogId = await catalogIdForCourse(sourceCourseId);
    if (!catalogId) return { courseId: sourceCourseId, unresolved: false };
    const ownId = catalogIdToOwnCourseId.get(catalogId);
    return { courseId: ownId ?? sourceCourseId, unresolved: ownId === undefined };
  }

  // Either linkage mechanism counts - VISHNU INSTITUTE OF TECHNOLOGY's
  // sub-departments use `managedDepartments`, "VISHNU WOMEN'S UNIVERSITY"
  // (SVECW)'s use `secondaryDepartments`/`courseScopes[*].secondaryDepartments`
  // instead. Either is an acceptable, real, already-configured relationship.
  const declaredElsewhere =
    (subDeptData.managedDepartments ?? []).includes(branchName) ||
    (subDeptData.secondaryDepartments ?? []).includes(branchName) ||
    Object.values(subDeptData.courseScopes ?? {}).some((s) => (s.secondaryDepartments ?? []).includes(branchName));
  if (!declaredElsewhere) {
    throw new Error(`"${branchName}" isn't declared as a managed/secondary department of "${subDeptName}"`);
  }
  const yearsSet = years && years.length > 0 ? new Set(years) : null;

  // ── A. Sections filed under the manager, cross-listed to this branch ──────
  const sectionsSnap = await collegeRef.collection("sections")
    .where("department", "==", subDeptName)
    .where("secondaryDepartments", "array-contains", branchName)
    .get();
  const candidateSections = sectionsSnap.docs
    .map((d) => {
      const data = d.data() as Section;
      return { id: d.id, name: data.name, year: data.year };
    })
    .filter((s) => yearsSet == null || yearsSet.has(s.year));

  // Collision check: a section already filed under the branch with the same
  // name+year is never merged or overwritten - skip it and report instead.
  // Always fetched (not just when there are candidates) - Step B below also
  // needs the branch's current section names, to catch a student whose own
  // section is ALREADY filed under the branch for any reason (a prior
  // partial run, or any other means) even when this invocation renames
  // nothing new itself.
  const branchSectionsSnap = await collegeRef.collection("sections").where("department", "==", branchName).get();
  const branchSectionKeys = new Set(branchSectionsSnap.docs.map((d) => {
    const s = d.data() as Section;
    return `${s.name}|${s.year}`;
  }));
  const branchSectionNames = new Set(branchSectionsSnap.docs.map((d) => (d.data() as Section).name));
  const sectionsToRename = candidateSections.filter((s) => !branchSectionKeys.has(`${s.name}|${s.year}`));
  const skippedSections: SkippedSectionDetail[] = candidateSections
    .filter((s) => branchSectionKeys.has(`${s.name}|${s.year}`))
    .map((s) => ({ sectionName: s.name, year: s.year, reason: `A section named "${s.name}" already exists under "${branchName}" for this year` }));
  const sectionsSkipped = skippedSections.length;
  const renamedSectionIds = new Set(sectionsToRename.map((s) => s.id));
  const renamedSectionNames = new Set(sectionsToRename.map((s) => s.name));

  // Drop a leading "<manager code>-" style prefix once the branch's own code
  // appears as its own hyphen-separated segment (e.g. "BSC-CSE-A", branch
  // code "CSE" -> "CSE-A") - matches this manager's own naming convention
  // without guessing at one nobody configured. No match (or no branch code
  // at all) leaves the name untouched - never a worse outcome than before
  // this existed. A proposed name that would itself collide with an
  // existing branch section falls back to the original name too - the
  // section still moves, it just keeps its old name rather than erroring.
  function proposedSectionName(oldName: string, year: number): string {
    if (!branchCode) return oldName;
    const segments = oldName.split("-");
    const idx = segments.findIndex((s) => s.toUpperCase() === branchCode.toUpperCase());
    if (idx === -1) return oldName;
    const candidate = segments.slice(idx).join("-");
    if (candidate === oldName) return oldName;
    if (branchSectionKeys.has(`${candidate}|${year}`)) return oldName;
    return candidate;
  }
  const finalNameBySectionId = new Map<string, string>();
  const finalNameByOldName = new Map<string, string>();
  for (const s of sectionsToRename) {
    const finalName = proposedSectionName(s.name, s.year);
    finalNameBySectionId.set(s.id, finalName);
    finalNameByOldName.set(s.name, finalName);
  }

  if (!dryRun && sectionsToRename.length > 0) {
    await commitInChunks(db, sectionsToRename.map((s) => ({
      ref: collegeRef.collection("sections").doc(s.id),
      action: "update" as const,
      data: { department: branchName, secondaryDepartments: [], name: finalNameBySectionId.get(s.id), updatedAt: new Date() },
    })));
  }

  // ── B. Students currently filed under the manager for one of those sections ──
  const studentsSnap = await collegeRef.collection("students")
    .where("department", "==", subDeptName)
    .where("secondaryDepartment", "==", branchName)
    .get();
  const studentsToMove = studentsSnap.docs.filter((d) => {
    const s = d.data() as { section?: string; year?: number };
    if (yearsSet != null && s.year != null && !yearsSet.has(s.year)) return false;
    // A student moves when their own section was either renamed above in
    // THIS run, or already sits directly under the branch for any other
    // reason (a prior partial run, a manual fix, any other means) - matched
    // by branchSectionNames, queried fresh at the top of this function, so
    // it reflects the branch's current state regardless of how it got there.
    // A student in a section that collided (skipped) is left exactly as is,
    // rather than moved to a department its own section doc doesn't match.
    return !!s.section && (renamedSectionNames.has(s.section) || branchSectionNames.has(s.section));
  });

  // Per-section breakdown for the review UI - which section, how many of
  // its students, moving to which department. Built from the same
  // sectionsToRename/studentsToMove sets the actual writes above use, so the
  // preview can never show a different plan than what Confirm executes.
  const studentCountBySection = new Map<string, number>();
  for (const d of studentsToMove) {
    const s = d.data() as { section?: string };
    if (!s.section) continue;
    studentCountBySection.set(s.section, (studentCountBySection.get(s.section) ?? 0) + 1);
  }
  const sections: SectionMoveDetail[] = sectionsToRename.map((s) => ({
    sectionId: s.id,
    sectionName: finalNameBySectionId.get(s.id) ?? s.name,
    year: s.year,
    studentCount: studentCountBySection.get(s.name) ?? 0,
    fromDepartmentName: subDeptName,
    toDepartmentName: branchName,
  }));

  if (!dryRun && studentsToMove.length > 0) {
    const now = new Date();
    const updates = studentsToMove.map((d) => {
      const s = d.data() as { section?: string };
      const finalSection = (s.section && finalNameByOldName.get(s.section)) ?? s.section;
      return {
        ref: d.ref,
        action: "update" as const,
        data: { department: branchName, secondaryDepartment: null, section: finalSection, updatedAt: now },
      };
    });
    await commitInChunks(db, updates);
    const historyWrites = studentsToMove.map((d) => {
      const s = d.data() as { section?: string; year?: number };
      return departmentHistoryEntry(db, collegeId, d.id, branchName, s.section ?? "", s.year ?? 0, now);
    });
    for (let i = 0; i < historyWrites.length; i += 400) {
      const batch = db.batch();
      for (const h of historyWrites.slice(i, i + 400)) batch.set(h.ref, h.data);
      await batch.commit();
    }
  }

  // ── C. subjectSemesterAssignments filed under the manager ────────────────
  const assignSnap = await collegeRef.collection("subjectSemesterAssignments").where("departmentId", "==", subDepartmentId).get();
  const byId = new Map(assignSnap.docs.map((d) => [d.id, d.data() as SubjectSemesterAssignment]));
  const rows: AssignmentRow[] = assignSnap.docs
    .map((d) => {
      const data = d.data() as SubjectSemesterAssignment;
      return { id: d.id, subjectId: data.subjectId, semester: data.semester, year: data.year };
    })
    .filter((r) => !!r.subjectId && r.semester != null);

  const targetIds = rows.map((r) => `${r.subjectId}_${branchDepartmentId}_${r.semester}`);
  const existingTargets = targetIds.length > 0
    ? await db.getAll(...targetIds.map((id) => collegeRef.collection("subjectSemesterAssignments").doc(id)))
    : [];
  const existingBranchInstanceIds = new Set(existingTargets.filter((d) => d.exists).map((d) => d.id));

  const { toCreate, toDiscard } = planSubjectAssignmentMoves(rows, branchDepartmentId, existingBranchInstanceIds, yearsSet);

  let courseIdsUnresolved = 0;
  if (!dryRun && (toCreate.length > 0 || toDiscard.length > 0)) {
    const now = new Date();
    const createOps = await Promise.all(toCreate.map(async (row) => {
      // secondaryDepartmentNames is dropped, never carried over: it narrows a
      // MANAGER's broad row down to specific core departments (see this
      // field's own doc-comment, types/teaching.ts) - meaningless, and
      // actively wrong, once the row is filed directly under the branch's own
      // departmentId. Carrying it over verbatim is exactly what let a row
      // narrowed to "CSE, CSBS" reappear in BOTH branches' own Subjects lists
      // after each got its own direct copy - a real bug this is fixing.
      const { id: _oldId, secondaryDepartmentNames: _dropped, ...originalRest } = byId.get(row.id) as SubjectSemesterAssignment;
      const resolved = await resolveBranchCourseId(originalRest.courseId);
      if (resolved.unresolved) courseIdsUnresolved++;
      return {
        ref: collegeRef.collection("subjectSemesterAssignments").doc(`${row.subjectId}_${branchDepartmentId}_${row.semester}`),
        action: "set" as const,
        data: { ...originalRest, id: `${row.subjectId}_${branchDepartmentId}_${row.semester}`, departmentId: branchDepartmentId, departmentName: branchName, courseId: resolved.courseId, updatedAt: now },
      };
    }));
    await commitInChunks(db, createOps);
    await commitInChunks(db, [...toCreate, ...toDiscard].map((row) => ({
      ref: collegeRef.collection("subjectSemesterAssignments").doc(row.id),
      action: "delete" as const,
    })));
  }

  // ── C2. Repair courseId AND drop a stale secondaryDepartmentNames on rows
  // already filed under the branch - from an earlier run of this same
  // migration before this fix existed, or any other stale cause. Idempotent:
  // an already-correct row is a no-op. The narrowing field is cleared
  // unconditionally here (not just on a courseId mismatch) - a row already
  // correctly filed under the branch's own departmentId can still carry a
  // leftover narrowing from before it moved, which is exactly what made it
  // reappear in a SIBLING branch's own Subjects list. ──
  const branchAssignSnap = await collegeRef.collection("subjectSemesterAssignments").where("departmentId", "==", branchDepartmentId).get();
  const branchRowFixes: { ref: FirebaseFirestore.DocumentReference; newCourseId?: string; clearSecondary: boolean }[] = [];
  for (const d of branchAssignSnap.docs) {
    const data = d.data() as SubjectSemesterAssignment;
    let newCourseId: string | undefined;
    if (data.courseId) {
      const resolved = await resolveBranchCourseId(data.courseId);
      if (resolved.unresolved) courseIdsUnresolved++;
      else if (resolved.courseId && resolved.courseId !== data.courseId) newCourseId = resolved.courseId;
    }
    const clearSecondary = Array.isArray(data.secondaryDepartmentNames) && data.secondaryDepartmentNames.length > 0;
    if (newCourseId || clearSecondary) branchRowFixes.push({ ref: d.ref, newCourseId, clearSecondary });
  }
  const courseIdsRepaired = branchRowFixes.filter((f) => !!f.newCourseId).length;
  const secondaryDepartmentNamesCleared = branchRowFixes.filter((f) => f.clearSecondary).length;
  if (!dryRun && branchRowFixes.length > 0) {
    await commitInChunks(db, branchRowFixes.map((f) => ({
      ref: f.ref,
      action: "update" as const,
      data: {
        ...(f.newCourseId ? { courseId: f.newCourseId } : {}),
        ...(f.clearSecondary ? { secondaryDepartmentNames: FieldValue.delete() } : {}),
        updatedAt: new Date(),
      },
    })));
  }

  // ── D. teachingAssignments for the sections being renamed ────────────────
  // Matched by sectionId - the one unambiguous link to the Section actually
  // being moved, rather than guessing from a department-name string.
  let taToRepoint: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  if (renamedSectionIds.size > 0) {
    const taSnap = await collegeRef.collection("teachingAssignments").where("departmentId", "==", subDepartmentId).get();
    taToRepoint = taSnap.docs.filter((d) => {
      const ta = d.data() as TeachingAssignment;
      return !!ta.sectionId && renamedSectionIds.has(ta.sectionId);
    });
  }
  if (!dryRun && taToRepoint.length > 0) {
    await commitInChunks(db, taToRepoint.map((d) => ({
      ref: d.ref,
      action: "update" as const,
      data: { departmentId: branchDepartmentId, department: branchName, updatedAt: new Date() },
    })));
  }

  // ── E. timetableSlots for the sections being renamed ──────────────────────
  let slotsToRepoint: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  if (renamedSectionIds.size > 0) {
    const slotsSnap = await collegeRef.collection("timetableSlots").where("department", "==", subDeptName).get();
    slotsToRepoint = slotsSnap.docs.filter((d) => {
      const sectionId = (d.data() as { sectionId?: string }).sectionId;
      return !!sectionId && renamedSectionIds.has(sectionId);
    });
  }
  if (!dryRun && slotsToRepoint.length > 0) {
    await commitInChunks(db, slotsToRepoint.map((d) => ({
      ref: d.ref,
      action: "update" as const,
      data: { department: branchName },
    })));
  }

  return {
    sectionsRenamed: sectionsToRename.length,
    sectionsSkippedConflict: sectionsSkipped,
    studentsMoved: studentsToMove.length,
    subjectAssignmentsMoved: toCreate.length,
    subjectAssignmentsDeduped: toDiscard.length,
    teachingAssignmentsRepointed: taToRepoint.length,
    timetableSlotsRepointed: slotsToRepoint.length,
    courseIdsRepaired,
    courseIdsUnresolved,
    secondaryDepartmentNamesCleared,
    sections,
    skippedSections,
  };
}

export function previewMigrateManagedBranchSubjects(
  db: Db,
  collegeId: string,
  subDepartmentId: string,
  branchDepartmentId: string,
  years?: number[]
): Promise<MigrateManagedBranchSubjectsResult> {
  return run(db, collegeId, subDepartmentId, branchDepartmentId, years, true);
}

export function migrateManagedBranchSubjects(
  db: Db,
  collegeId: string,
  subDepartmentId: string,
  branchDepartmentId: string,
  years?: number[]
): Promise<MigrateManagedBranchSubjectsResult> {
  return run(db, collegeId, subDepartmentId, branchDepartmentId, years, false);
}
