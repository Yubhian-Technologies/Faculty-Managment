import type { Firestore } from "firebase-admin/firestore";
import { canHodEditDepartment, editableDepartmentNames, getHodDepartmentScope } from "@/lib/departments/scope";
import { findCurrentSectionDoc } from "@/lib/students/findCurrentSectionDoc";
import type { StudentRecord } from "@/types";
import type { ActingUser } from "./types";

// Everything the permission module needs to know about OTHER modules' data
// (students, sections, departments, who heads what). Kept in one file so the
// use-cases depend on these functions, not on how those records are stored.

export type SectionOwner = { department: string; inchargeUid?: string };

export async function loadStudentByUid(db: Firestore, collegeId: string, uid: string) {
  const snap = await db.collection("colleges").doc(collegeId).collection("students").where("uid", "==", uid).limit(1).get();
  return snap.empty ? null : { ...(snap.docs[0].data() as StudentRecord), id: snap.docs[0].id };
}

export async function loadStudentsByIds(db: Firestore, collegeId: string, ids: string[]) {
  const col = db.collection("colleges").doc(collegeId).collection("students");
  const snaps = await db.getAll(...ids.map((id) => col.doc(id)));
  return snaps.filter((s) => s.exists).map((s) => ({ ...(s.data() as StudentRecord), id: s.id }));
}

/** The section this student represents as a Class Representative, or null when they are not one (or their section can't be resolved). */
export async function representedSectionOf(db: Firestore, collegeId: string, student: StudentRecord & { id: string }) {
  const sec = await findCurrentSectionDoc(db, collegeId, student);
  const data = sec?.data() as { department: string; name: string; year: number; classRepresentatives?: { studentId: string }[] } | undefined;
  return data?.classRepresentatives?.some((r) => r.studentId === student.id) ? data : null;
}

/** The department that actually owns the student's section (the approver's department), and its class incharge. */
export async function ownershipOf(db: Firestore, collegeId: string, s: StudentRecord, cache: Map<string, SectionOwner>): Promise<SectionOwner> {
  const key = `${s.department}|${s.secondaryDepartment ?? ""}|${s.section}|${s.year}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sec = await findCurrentSectionDoc(db, collegeId, s);
  const data = sec?.data() as { department?: string; facultyInchargeUid?: string } | undefined;
  const out = { department: data?.department || s.department, inchargeUid: data?.facultyInchargeUid || undefined };
  // The approving department is the one that owns the section. If that is neither the student's own department nor their
  // core branch, the data is inconsistent and the request goes to a department the student isn't in - make that visible.
  if (out.department !== s.department && out.department !== s.secondaryDepartment) {
    console.warn(`[studentPermissions] routing to "${out.department}" for a student of "${s.department}"${s.secondaryDepartment ? ` / "${s.secondaryDepartment}"` : ""} (section ${s.section}, year ${s.year})`);
  }
  cache.set(key, out);
  return out;
}

/** Does this login hold the HOD role for `department`? (activeOnly:false - an authorisation question about a SPECIFIC department.) */
export async function headsDepartment(db: Firestore, user: ActingUser, department: string): Promise<boolean> {
  if (!user.roles.includes("HOD")) return false;
  return canHodEditDepartment(await getHodDepartmentScope(db, user.collegeId, user.uid, { activeOnly: false }), department);
}

/** The departments this HOD may edit. */
export async function editableDepartmentsOf(db: Firestore, user: ActingUser): Promise<string[]> {
  return editableDepartmentNames(await getHodDepartmentScope(db, user.collegeId, user.uid, { activeOnly: false }));
}

export async function allDepartmentNames(db: Firestore, collegeId: string): Promise<string[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("departments").select("name").get();
  return snap.docs.map((d) => (d.data() as { name?: string }).name ?? "").filter(Boolean);
}
