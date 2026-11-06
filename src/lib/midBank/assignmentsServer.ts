import { canHodEditDepartment, type HodDepartmentScope } from "@/lib/departments/scope";
import { getInChunks } from "@/lib/firestore/inQuery";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { ownerDepartmentNames, reviewDepartmentsOf } from "@/lib/subjects/ownerDepartment";
import { ALL_BRANCHES, branchesOf, isAllBranches, sectionsForScope } from "./assignments";
import { midBankRefs } from "./server";
import type { TeachingRow } from "./sections";
import { isFacultyAvailable, type FacultyMember, type MidBankAssignment, type MidQuestionBank, type Subject } from "@/types";

// Server side of "The HOD assigns": the assignments of a deadline, who may assign a subject (its reviewing HOD),
// and who may be picked (faculty teaching it in the scope + faculty of the reviewing departments).

type Db = FirebaseFirestore.Firestore;

export const assignmentsCol = (db: Db, collegeId: string) => midBankRefs(db, collegeId).college.collection("midBankAssignments");

export async function loadAssignments(db: Db, collegeId: string, deadlineId: string): Promise<MidBankAssignment[]> {
  const snap = await assignmentsCol(db, collegeId).where("deadlineId", "==", deadlineId).get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<MidBankAssignment, "id">), id: d.id }));
}

/** The departments whose HOD assigns (and reviews) a scope: the Subject Department(s), else the branch(es). */
export function reviewDepartmentsForScope(rows: TeachingRow[], subject: Pick<Subject, "ownerDepartments" | "ownerDepartmentId" | "ownerDepartmentName">, branch: string, names: ReadonlyMap<string, string>): string[] {
  const owners = ownerDepartmentNames(subject, names);
  if (owners.length) return owners;
  // No Subject Department: a whole-subject paper has no single HOD - only per branch then.
  return isAllBranches(branch) ? [] : reviewDepartmentsOf(branch, subject, names);
}

export const hodMayAssign = (scope: HodDepartmentScope | null, departments: string[]) => !scope || departments.some((d) => canHodEditDepartment(scope, d));

export interface Candidate { facultyId: string; name: string; department: string; teaches: boolean }

/** Faculty teaching the subject in the scope, then faculty of the reviewing departments (available ones only). */
export async function candidatesFor(db: Db, collegeId: string, rows: TeachingRow[], subjectId: string, branch: string, departments: string[]): Promise<Candidate[]> {
  const teachers = new Map<string, Candidate>();
  for (const s of sectionsForScope(rows, subjectId, branch)) {
    s.facultyIds.forEach((id, i) => { if (!teachers.has(id)) teachers.set(id, { facultyId: id, name: s.facultyNames[i] ?? "", department: "", teaches: true }); });
  }
  const col = midBankRefs(db, collegeId).college.collection("facultyMembers");
  const deptDocs = departments.length ? await getInChunks(departments, (chunk) => col.where("department", "in", chunk)) : [];
  const teacherDocs = teachers.size ? await db.getAll(...[...teachers.keys()].map((id) => col.doc(id))) : [];
  for (const d of teacherDocs) {
    const t = teachers.get(d.id);
    if (!t) continue;
    const f = d.data() as FacultyMember | undefined;
    if (f && !isFacultyAvailable(f.status)) { teachers.delete(d.id); continue; }
    if (f) { t.name = facultyDisplayName(f) || t.name; t.department = f.department ?? ""; }
  }
  const out = [...teachers.values()];
  for (const d of deptDocs) {
    const f = d.data() as FacultyMember;
    if (teachers.has(d.id) || !isFacultyAvailable(f.status)) continue;
    out.push({ facultyId: d.id, name: facultyDisplayName(f), department: f.department ?? "", teaches: false });
  }
  return out.sort((a, b) => Number(b.teaches) - Number(a.teaches) || a.name.localeCompare(b.name));
}

/** Faculty who already started a bank / paper under each assignment. */
export function startedByAssignment(banks: Pick<MidQuestionBank, "assignmentId" | "ownerFacultyId">[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const b of banks) if (b.assignmentId) m.set(b.assignmentId, (m.get(b.assignmentId) ?? new Set()).add(b.ownerFacultyId));
  return m;
}

export { ALL_BRANCHES, branchesOf };
