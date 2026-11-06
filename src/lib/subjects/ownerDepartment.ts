import type { Subject } from "@/types";

// The Subject Department(s): the department(s) that look after a subject - its syllabus, and the HOD
// approval of every question bank / question paper prepared for it - whichever branch's sections
// the subject is taught in. Set per master subject by Academics / Principal / VP; at most
// OWNER_DEPARTMENTS_MAX. With two, both HODs are told and either one's decision is enough.
// A subject with none set is looked after by the branch (the section's department), exactly as
// before. The subject's semester assignments (timetable, teaching load) don't depend on it.

export const OWNER_DEPARTMENTS_MAX = 2;

export type OwnerDepartmentFields = Pick<Subject, "ownerDepartments" | "ownerDepartmentId" | "ownerDepartmentName">;

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

/** The departments whose HODs review a bank / paper of this subject in this branch (any one decides). */
export function reviewDepartmentsOf(branch: string, subject: OwnerDepartmentFields | null | undefined, namesById?: ReadonlyMap<string, string>): string[] {
  const owners = ownerDepartmentNames(subject, namesById);
  return owners.length ? owners : branch ? [branch] : [];
}

/** Firestore department names by id (for `ownerDepartmentNames` / `reviewDepartmentsOf`); all of them without `ids`. */
export async function departmentNamesById(db: FirebaseFirestore.Firestore, collegeId: string, ids?: readonly string[]): Promise<Map<string, string>> {
  const col = db.collection("colleges").doc(collegeId).collection("departments");
  const wanted = [...new Set((ids ?? []).filter(Boolean))];
  const docs = ids ? (wanted.length ? await db.getAll(...wanted.map((id) => col.doc(id))) : []) : (await col.get()).docs;
  const out = new Map<string, string>();
  for (const d of docs) if (d.exists) out.set(d.id, String((d.data() as { name?: string }).name ?? "").trim());
  return out;
}

/** The department names for a subject's departments (one read per department). */
export async function ownerDepartmentNamesLive(db: FirebaseFirestore.Firestore, collegeId: string, subject: OwnerDepartmentFields | null | undefined): Promise<string[]> {
  const refs = ownerDepartmentRefs(subject);
  if (!refs.length) return [];
  return ownerDepartmentNames(subject, await departmentNamesById(db, collegeId, refs.map((d) => d.id)));
}
