import type { HodDepartmentScope } from "@/lib/departments/scope";
import { reviewingDepartment } from "./reviewer";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { ownerDepartmentNames, reviewDepartmentsOf } from "@/lib/subjects/ownerDepartment";
import { ALL_BRANCHES, branchesOf, isAllBranches, sectionsForScope } from "./assignments";
import { midBankRefs } from "./server";
import { cachedValue } from "@/lib/firestore/sharedReads";
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

/** Only the reviewing department's HOD assigns (a Subject Department: its own HOD, never a managed-branch coordinator). */
export const hodMayAssign = (scope: HodDepartmentScope | null, departments: string[], bySubjectDepartment: boolean) =>
  !scope || !!reviewingDepartment(scope, departments, bySubjectDepartment);

export interface Candidate { facultyId: string; name: string; department: string; teaches: boolean }

/** Every faculty member of the college, read ONCE per request (by id and by department) - the candidate lists are
 *  built from it in memory, so a deadline with many subjects x branches is not two queries per pair. */
export interface FacultyIndex { byId: Map<string, FacultyMember>; byDept: Map<string, { id: string; f: FacultyMember }[]> }

/** The faculty index kept 60 s per server instance - for showing the Assign card; an assignment save reads it fresh. */
export function loadFacultyIndexCached(db: Db, collegeId: string): Promise<FacultyIndex> {
  return cachedValue(`facultyIndex/${collegeId}`, 60_000, () => loadFacultyIndex(db, collegeId));
}

export async function loadFacultyIndex(db: Db, collegeId: string): Promise<FacultyIndex> {
  // Only what the pick lists use (name, title, department, status) - the full records are large.
  const snap = await midBankRefs(db, collegeId).college.collection("facultyMembers").select("legalName", "honorific", "department", "status").get();
  const byId = new Map<string, FacultyMember>();
  const byDept = new Map<string, { id: string; f: FacultyMember }[]>();
  for (const d of snap.docs) {
    const f = d.data() as FacultyMember;
    byId.set(d.id, f);
    const k = f.department ?? "";
    byDept.set(k, [...(byDept.get(k) ?? []), { id: d.id, f }]);
  }
  return { byId, byDept };
}

/** Faculty teaching the subject in the scope, then faculty of the reviewing departments (available ones only). */
export function candidatesFor(index: FacultyIndex, rows: TeachingRow[], subjectId: string, branch: string, departments: string[]): Candidate[] {
  const teachers = new Map<string, Candidate>();
  for (const s of sectionsForScope(rows, subjectId, branch)) {
    s.facultyIds.forEach((id, i) => { if (!teachers.has(id)) teachers.set(id, { facultyId: id, name: s.facultyNames[i] ?? "", department: "", teaches: true }); });
  }
  for (const [id, t] of [...teachers]) {
    const f = index.byId.get(id);
    if (f && !isFacultyAvailable(f.status)) { teachers.delete(id); continue; }
    if (f) { t.name = facultyDisplayName(f) || t.name; t.department = f.department ?? ""; }
  }
  const out = [...teachers.values()];
  for (const dept of new Set(departments)) for (const { id, f } of index.byDept.get(dept) ?? []) {
    if (teachers.has(id) || !isFacultyAvailable(f.status)) continue;
    out.push({ facultyId: id, name: facultyDisplayName(f), department: f.department ?? "", teaches: false });
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
