import type { Subject } from "@/types";
import { cachedCollectionDocs } from "@/lib/firestore/sharedReads";

// The Subject Department(s): the department(s) that look after a subject - its syllabus, and the HOD
// approval of every question bank / question paper prepared for it - whichever branch's sections
// the subject is taught in. Set per master subject by Academics / Principal / VP; at most
// OWNER_DEPARTMENTS_MAX. With two, both HODs are told and either one's decision is enough.
// A subject with none set is looked after by the branch (the section's department), exactly as
// before. The subject's semester assignments (timetable, teaching load) don't depend on it.

export const OWNER_DEPARTMENTS_MAX = 2;

export type OwnerDepartmentFields = Pick<Subject, "ownerDepartments" | "ownerDepartmentId" | "ownerDepartmentName" | "ownBranchPapers">;

/** The saved Subject Departments: the list, else the single department saved before lists existed. */
export function ownerDepartmentRefs(subject: OwnerDepartmentFields | null | undefined): { id: string; name: string }[] {
  if (!subject) return [];
  if (subject.ownerDepartments?.length) return subject.ownerDepartments.filter((d) => d?.id);
  return subject.ownerDepartmentId ? [{ id: subject.ownerDepartmentId, name: subject.ownerDepartmentName ?? "" }] : [];
}

/**
 * The Subject Departments' names as they are now: looked up by id in `namesById` (a renamed
 * department keeps working), else the name saved with it. [] when none is set.
 */
export function ownerDepartmentNames(subject: OwnerDepartmentFields | null | undefined, namesById?: ReadonlyMap<string, string>): string[] {
  const names = ownerDepartmentRefs(subject).map((d) => namesById?.get(d.id) || d.name.trim()).filter(Boolean);
  return [...new Set(names)];
}

/**
 * The branches that prepare and approve their own Mid papers for this subject although it has a Subject Department
 * (`ownBranchPapers`), by their current names. [] while no Subject Department is set (the branch decides anyway), and
 * a branch that is itself a Subject Department is left out (it already decides).
 */
export function ownBranchPaperNames(subject: OwnerDepartmentFields | null | undefined, namesById?: ReadonlyMap<string, string>): string[] {
  const owners = ownerDepartmentNames(subject, namesById);
  if (!owners.length) return [];
  const names = (subject?.ownBranchPapers ?? []).filter((d) => d?.id).map((d) => namesById?.get(d.id) || d.name.trim()).filter(Boolean);
  return [...new Set(names)].filter((n) => !owners.includes(n));
}

/**
 * The departments whose HODs review a bank / paper of this subject in this branch (any one decides): the Subject
 * Department(s), except in a branch that handles its own papers (`ownBranchPapers`) - there, the branch. No Subject
 * Department: the branch.
 */
export function reviewDepartmentsOf(branch: string, subject: OwnerDepartmentFields | null | undefined, namesById?: ReadonlyMap<string, string>): string[] {
  const owners = ownerDepartmentNames(subject, namesById);
  if (!owners.length) return branch ? [branch] : [];
  return branch && ownBranchPaperNames(subject, namesById).includes(branch) ? [branch] : owners;
}

/** Firestore department names by id (for `ownerDepartmentNames` / `reviewDepartmentsOf`); all of them without `ids`. */
export async function departmentNamesById(db: FirebaseFirestore.Firestore, collegeId: string, ids?: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids) {
    // All of them: the shared per-instance copy of the departments (refreshed every 20 s).
    for (const d of await cachedCollectionDocs(db, collegeId, "departments")) out.set(d.id, String((d.data() as { name?: string }).name ?? "").trim());
    return out;
  }
  const col = db.collection("colleges").doc(collegeId).collection("departments");
  const wanted = [...new Set(ids.filter(Boolean))];
  const docs = wanted.length ? await db.getAll(...wanted.map((id) => col.doc(id))) : [];
  for (const d of docs) if (d.exists) out.set(d.id, String((d.data() as { name?: string }).name ?? "").trim());
  return out;
}

/** The department names for a subject's departments (one read per department). */
export async function ownerDepartmentNamesLive(db: FirebaseFirestore.Firestore, collegeId: string, subject: OwnerDepartmentFields | null | undefined): Promise<string[]> {
  const refs = ownerDepartmentRefs(subject);
  if (!refs.length) return [];
  return ownerDepartmentNames(subject, await departmentNamesById(db, collegeId, refs.map((d) => d.id)));
}

/** The Subject Departments' and own-paper branches' current names, from one read of just those departments. */
export async function subjectReviewNamesLive(db: FirebaseFirestore.Firestore, collegeId: string, subject: OwnerDepartmentFields | null | undefined): Promise<Map<string, string>> {
  const ids = [...ownerDepartmentRefs(subject).map((d) => d.id), ...(subject?.ownBranchPapers ?? []).map((d) => d?.id ?? "")].filter(Boolean);
  return ids.length ? departmentNamesById(db, collegeId, ids) : new Map();
}
