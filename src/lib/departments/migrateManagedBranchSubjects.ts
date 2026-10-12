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

import type { SubjectSemesterAssignment, TeachingAssignment, Section } from "@/types";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";

type Db = FirebaseFirestore.Firestore;

export interface MigrateManagedBranchSubjectsResult {
  sectionsRenamed: number;
  sectionsSkippedConflict: number;
  studentsMoved: number;
  subjectAssignmentsMoved: number;
  subjectAssignmentsDeduped: number;
  teachingAssignmentsRepointed: number;
  timetableSlotsRepointed: number;
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
  const branchName = (branchSnap.data() as { name?: string }).name ?? "";

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
  const branchSectionsSnap = candidateSections.length > 0
    ? await collegeRef.collection("sections").where("department", "==", branchName).get()
    : null;
  const branchSectionKeys = new Set((branchSectionsSnap?.docs ?? []).map((d) => {
    const s = d.data() as Section;
    return `${s.name}|${s.year}`;
  }));
  const sectionsToRename = candidateSections.filter((s) => !branchSectionKeys.has(`${s.name}|${s.year}`));
  const sectionsSkipped = candidateSections.length - sectionsToRename.length;
  const renamedSectionIds = new Set(sectionsToRename.map((s) => s.id));
  const renamedSectionNames = new Set(sectionsToRename.map((s) => s.name));

  if (!dryRun && sectionsToRename.length > 0) {
    await commitInChunks(db, sectionsToRename.map((s) => ({
      ref: collegeRef.collection("sections").doc(s.id),
      action: "update" as const,
      data: { department: branchName, secondaryDepartments: [], updatedAt: new Date() },
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
    // Only students whose own section was actually renamed above - a student
    // in a section that collided (skipped) is left exactly as is, rather
    // than moved to a department its own section doc doesn't yet match.
    return !!s.section && renamedSectionNames.has(s.section);
  });
  if (!dryRun && studentsToMove.length > 0) {
    const now = new Date();
    const updates = studentsToMove.map((d) => ({
      ref: d.ref,
      action: "update" as const,
      data: { department: branchName, secondaryDepartment: null, updatedAt: now },
    }));
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

  if (!dryRun && (toCreate.length > 0 || toDiscard.length > 0)) {
    const now = new Date();
    await commitInChunks(db, toCreate.map((row) => {
      const { id: _oldId, ...originalRest } = byId.get(row.id) as SubjectSemesterAssignment;
      return {
        ref: collegeRef.collection("subjectSemesterAssignments").doc(`${row.subjectId}_${branchDepartmentId}_${row.semester}`),
        action: "set" as const,
        data: { ...originalRest, id: `${row.subjectId}_${branchDepartmentId}_${row.semester}`, departmentId: branchDepartmentId, departmentName: branchName, updatedAt: now },
      };
    }));
    await commitInChunks(db, [...toCreate, ...toDiscard].map((row) => ({
      ref: collegeRef.collection("subjectSemesterAssignments").doc(row.id),
      action: "delete" as const,
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
