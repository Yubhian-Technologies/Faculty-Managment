import { branchKey, type TeachingRow } from "./sections";
import type { MidBankAssignment, MidBankSection } from "@/types";

// "The HOD assigns" (ExamMidSettings.midAssignment = HOD): the subject's HOD assigns who prepares its bank /
// papers for a deadline - per branch (each branch its own paper) or one paper for every branch of the subject.
// Pure rules here; the routes read / write.

/** The `branch` of a whole-subject assignment / paper. */
export const ALL_BRANCHES = "All branches";
export const isAllBranches = (branch: string) => branch === ALL_BRANCHES;

export const assignmentIdFor = (deadlineId: string, subjectId: string, branch: string) => `${deadlineId}__${subjectId}__${branchKey(branch)}`;

/** The branches a subject is taught in for a deadline (sorted). */
export function branchesOf(rows: TeachingRow[], subjectId: string): string[] {
  return [...new Set(rows.filter((r) => r.subjectId === subjectId).map((r) => r.branch))].sort();
}

/** Does a paper of `branch` (a branch, or ALL_BRANCHES with `branches`) serve this exam branch? */
export const servesBranch = (b: { branch: string; branches?: string[] }, examBranch: string) =>
  b.branch === examBranch || (isAllBranches(b.branch) && (b.branches ?? []).includes(examBranch));

/** The sections a scope covers: one branch's, or every branch's (each section tagged with its branch). */
export function sectionsForScope(rows: TeachingRow[], subjectId: string, branch: string): MidBankSection[] {
  const by = new Map<string, MidBankSection>();
  for (const r of rows) {
    if (r.subjectId !== subjectId || (!isAllBranches(branch) && r.branch !== branch)) continue;
    const s = by.get(r.sectionId) ?? { sectionId: r.sectionId, sectionName: r.sectionName, facultyIds: [], facultyNames: [], branch: r.branch };
    if (!s.facultyIds.includes(r.facultyId)) { s.facultyIds.push(r.facultyId); s.facultyNames.push(r.facultyName); }
    by.set(r.sectionId, s);
  }
  return [...by.values()].sort((a, b) => (a.branch ?? "").localeCompare(b.branch ?? "") || a.sectionName.localeCompare(b.sectionName, undefined, { numeric: true }));
}

/** Is this faculty member assigned to prepare the subject for this branch (or for all branches)? */
export function assignedScope(assignments: Pick<MidBankAssignment, "subjectId" | "branch" | "facultyIds">[], subjectId: string, facultyId: string): string[] {
  return assignments.filter((a) => a.subjectId === subjectId && a.facultyIds.includes(facultyId)).map((a) => a.branch);
}

export interface AssignmentCheck {
  /** Other assignments of the same subject + deadline. */
  existing: Pick<MidBankAssignment, "branch" | "scope" | "facultyIds" | "facultyNames">[];
  scope: "BRANCH" | "SUBJECT";
  branch: string;
  facultyIds: string[];
  /** Who may be picked (teaching it there, or of the subject's department). */
  candidateIds: Set<string>;
  /** Faculty who already started a bank / paper under this assignment - they can't be removed. */
  startedIds: Set<string>;
  /** The current assignment's setters (to know who is being removed). */
  currentIds: string[];
  namesById: Map<string, string>;
}

/** The rules of one assign / reassign. Empty facultyIds = remove the assignment. */
export function checkAssignment(c: AssignmentCheck): string[] {
  const errors: string[] = [];
  const others = c.existing.filter((e) => e.branch !== c.branch);
  if (c.facultyIds.length > 0) {
    if (c.scope === "SUBJECT" && others.some((e) => e.scope === "BRANCH" && e.facultyIds.length)) {
      errors.push("This subject already has setters per branch - remove them first to assign one paper for all branches");
    }
    if (c.scope === "BRANCH" && others.some((e) => e.scope === "SUBJECT" && e.facultyIds.length)) {
      errors.push("This subject has one paper for all branches - remove that assignment first to assign per branch");
    }
    const bad = c.facultyIds.filter((f) => !c.candidateIds.has(f));
    if (bad.length) errors.push("Pick faculty who teach this subject or belong to its department");
    if (c.facultyIds.length > 10) errors.push("At most 10 setters");
  }
  const removed = c.currentIds.filter((f) => !c.facultyIds.includes(f) && c.startedIds.has(f));
  if (removed.length) errors.push(`${removed.map((f) => c.namesById.get(f) ?? "A setter").join(", ")} already started - they can't be removed`);
  return errors;
}
