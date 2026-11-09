import { branchKey, type TeachingRow } from "./sections";
import type { MidBankAssignment, MidBankSection } from "@/types";

// "The HOD assigns" (ExamMidSettings.midAssignment = HOD): the subject's HOD assigns who prepares its bank /
// papers for a deadline - per branch (each branch its own paper), one paper for a GROUP of branches (e.g. CSE + EEE),
// or one paper for every branch of the subject. Pure rules here; the routes read / write.

/** The `branch` of a whole-subject assignment / paper. */
export const ALL_BRANCHES = "All branches";
export const isAllBranches = (branch: string) => branch === ALL_BRANCHES;

/** A group of branches (scope GROUP) is stored under one label: the branch names, sorted, joined by GROUP_JOIN. */
export const GROUP_JOIN = " + ";
export const groupBranchLabel = (branches: string[]) => [...new Set(branches)].sort().join(GROUP_JOIN);
export const isGroupBranch = (branch: string) => branch.includes(GROUP_JOIN);
/** A paper / assignment for more than one branch (a group, or all branches) - it carries `branches`. */
export const isMultiBranch = (branch: string) => isAllBranches(branch) || isGroupBranch(branch);
/** The branches a scope label stands for: one branch, a group's branches, or null = every branch. */
export const scopeBranches = (branch: string): string[] | null => (isAllBranches(branch) ? null : branch.split(GROUP_JOIN));

export const assignmentIdFor = (deadlineId: string, subjectId: string, branch: string) => `${deadlineId}__${subjectId}__${branchKey(branch)}`;

/** The branches a subject is taught in for a deadline (sorted). */
export function branchesOf(rows: TeachingRow[], subjectId: string): string[] {
  return [...new Set(rows.filter((r) => r.subjectId === subjectId).map((r) => r.branch))].sort();
}

/** Does a paper of `branch` (a branch, a group, or ALL_BRANCHES with `branches`) serve this exam branch? */
export const servesBranch = (b: { branch: string; branches?: string[] }, examBranch: string) =>
  b.branch === examBranch || (isMultiBranch(b.branch) && (b.branches ?? scopeBranches(b.branch) ?? []).includes(examBranch));

/** The sections a scope covers: one branch's, a group's or every branch's (each section tagged with its branch). */
export function sectionsForScope(rows: TeachingRow[], subjectId: string, branch: string): MidBankSection[] {
  const by = new Map<string, MidBankSection>();
  const only = scopeBranches(branch);
  for (const r of rows) {
    if (r.subjectId !== subjectId || (only && !only.includes(r.branch))) continue;
    const s = by.get(r.sectionId) ?? { sectionId: r.sectionId, sectionName: r.sectionName, facultyIds: [], facultyNames: [], branch: r.branch };
    if (!s.facultyIds.includes(r.facultyId)) { s.facultyIds.push(r.facultyId); s.facultyNames.push(r.facultyName); }
    by.set(r.sectionId, s);
  }
  return [...by.values()].sort((a, b) => (a.branch ?? "").localeCompare(b.branch ?? "") || a.sectionName.localeCompare(b.sectionName, undefined, { numeric: true }));
}

/**
 * How a paper names its branches on the printed header (short codes): one branch -> its code with its sections;
 * several (a group / all branches) -> each branch's code with its own sections, e.g. "CSE (A, B) · EEE (A)".
 */
export function paperBranchLabel(b: { branch: string; branches?: string[]; sections: Pick<MidBankSection, "sectionName" | "branch">[] }, codeOf: (name: string) => string): { branch: string; sections: string[] } {
  if (!isMultiBranch(b.branch)) return { branch: codeOf(b.branch) || b.branch, sections: b.sections.map((s) => s.sectionName) };
  const names = b.branches?.length ? b.branches : scopeBranches(b.branch) ?? [...new Set(b.sections.map((s) => s.branch ?? ""))].filter(Boolean);
  const label = [...names].sort().map((n) => {
    const secs = b.sections.filter((s) => s.branch === n).map((s) => s.sectionName);
    return `${codeOf(n) || n}${secs.length ? ` (${secs.join(", ")})` : ""}`;
  }).join(" · ");
  return { branch: label, sections: [] };
}

/** Is this faculty member assigned to prepare the subject for this branch (or for all branches)? */
export function assignedScope(assignments: Pick<MidBankAssignment, "subjectId" | "branch" | "facultyIds">[], subjectId: string, facultyId: string): string[] {
  return assignments.filter((a) => a.subjectId === subjectId && a.facultyIds.includes(facultyId)).map((a) => a.branch);
}

export interface AssignmentCheck {
  /** Other assignments of the same subject + deadline. */
  existing: Pick<MidBankAssignment, "branch" | "scope" | "facultyIds" | "facultyNames">[];
  scope: "BRANCH" | "GROUP" | "SUBJECT";
  branch: string;
  facultyIds: string[];
  /** Who may be picked (teaching it there, or of the subject's department). */
  candidateIds: Set<string>;
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
    if (c.scope !== "SUBJECT" && others.some((e) => e.scope === "SUBJECT" && e.facultyIds.length)) {
      errors.push("This subject has one paper for all branches - remove that assignment first to assign per branch");
    }
    // A branch is in one paper only: its own, or one group's.
    if (c.scope !== "SUBJECT") {
      const mine = scopeBranches(c.branch) ?? [];
      if (c.scope === "GROUP" && mine.length < 2) errors.push("Pick at least two branches for one paper");
      for (const e of others) {
        if (!e.facultyIds.length || e.scope === "SUBJECT") continue;
        const theirs = scopeBranches(e.branch) ?? [];
        const shared = mine.filter((b) => theirs.includes(b));
        if (shared.length) errors.push(`${shared.join(", ")} ${shared.length === 1 ? "already has" : "already have"} a paper (${isGroupBranch(e.branch) ? theirs.join(" + ") : "its own setters"}) - remove that first`);
      }
    }
    const bad = c.facultyIds.filter((f) => !c.candidateIds.has(f));
    if (bad.length) errors.push("Pick faculty who teach this subject or belong to its department");
    if (c.facultyIds.length > 10) errors.push("At most 10 setters");
  }
  // A setter who already started may be removed or given other papers: their work is withdrawn / kept, never deleted
  // (planSetterChanges).
  return errors;
}

/** A setter's paper set / bank under one assignment, as the HOD's change will find it. */
export interface SetterBank {
  bankId: string;
  facultyId: string;
  name: string;
  withdrawn: boolean;
  /** The papers it writes now ([] = a question bank, no papers). */
  sets: number[];
  approval?: string | null;
  /** Papers the Exam Cell already chose (or printed) for an exam - never taken away. */
  chosenSets: number[];
  /** Questions written so far, per paper (for the HOD's confirmation). */
  written: Record<number, number>;
}

export interface SetterChange {
  kind: "WITHDRAW" | "RESTORE" | "PAPERS";
  bankId: string;
  facultyId: string;
  name: string;
  from: number[];
  to: number[];
  /** Submitted / approved work whose papers change goes back to the setter to submit again. */
  resetsApproval: boolean;
  /** Questions written in papers it loses (kept, hidden until given back). */
  hiddenQuestions: number;
}

/**
 * What a reassignment does to work already started, and what it may not do. Removed setter -> WITHDRAW (kept,
 * read-only, out of the Exam Cell's choice); setter added back -> RESTORE; other papers -> PAPERS. Refused: taking away
 * a paper (or a whole set) the Exam Cell already chose for an exam. `total` = papers per subject (0 = question bank).
 */
export function planSetterChanges(banks: SetterBank[], next: { facultyIds: string[]; setShare?: Record<string, number[]>; total: number }): { changes: SetterChange[]; errors: string[] } {
  const all = Array.from({ length: next.total }, (_, i) => i + 1);
  const changes: SetterChange[] = [];
  const errors: string[] = [];
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  const decided = (b: SetterBank) => b.approval === "SUBMITTED" || b.approval === "APPROVED";
  for (const b of banks) {
    const keep = next.facultyIds.includes(b.facultyId);
    const to = next.total ? [...(next.setShare?.[b.facultyId] ?? all)].sort((x, y) => x - y) : [];
    const lost = b.sets.filter((n) => !keep || !to.includes(n));
    const chosenLost = lost.filter((n) => b.chosenSets.includes(n));
    if (!keep) {
      if (b.withdrawn) continue;
      if (b.chosenSets.length) { errors.push(`${b.name}'s Paper ${b.chosenSets.join(", ")} is already chosen for the exam - ask the Exam Cell`); continue; }
      changes.push({ kind: "WITHDRAW", bankId: b.bankId, facultyId: b.facultyId, name: b.name, from: b.sets, to: [], resetsApproval: false, hiddenQuestions: 0 });
      continue;
    }
    if (chosenLost.length) { errors.push(`${b.name}'s Paper ${chosenLost.join(", ")} is already chosen for the exam - ask the Exam Cell`); continue; }
    const papersChange = next.total > 0 && !same(b.sets, to);
    if (!b.withdrawn && !papersChange) continue;
    changes.push({
      kind: b.withdrawn ? "RESTORE" : "PAPERS", bankId: b.bankId, facultyId: b.facultyId, name: b.name, from: b.sets, to,
      resetsApproval: papersChange && decided(b),
      hiddenQuestions: lost.reduce((n, p) => n + (b.written[p] ?? 0), 0),
    });
  }
  return { changes, errors };
}
