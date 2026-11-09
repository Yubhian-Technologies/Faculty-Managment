import { getHodDepartmentScope } from "@/lib/departments/scope";
import { reviewingDepartment } from "@/lib/midBank/reviewer";
import { getDepartmentHeadUids, notify, notifyRole } from "@/lib/notify";
import { ownerDepartmentNamesLive } from "@/lib/subjects/ownerDepartment";
import type { Subject, SubjectSyllabus } from "@/types";

// Server side of the subject syllabus (lib/subjects/syllabus.ts has the rules): where it lives, who the caller is
// for it, and who is told. Academics = the ACADEMICS login (Dean Academics); Super Admin may act for them.

type Db = FirebaseFirestore.Firestore;

export const syllabusCol = (db: Db, collegeId: string) => db.collection("colleges").doc(collegeId).collection("subjectSyllabus");

export const ACADEMICS_ROLES = ["ACADEMICS", "SUPER_ADMIN"];
/** Who may read a syllabus (faculty preparing papers, the Exam Cell, leadership). */
export const SYLLABUS_READ_ROLES = ["HOD", "PANEL_MEMBER", "EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", ...ACADEMICS_ROLES];

export async function loadSyllabus(db: Db, collegeId: string, subjectId: string): Promise<SubjectSyllabus | null> {
  const s = await syllabusCol(db, collegeId).doc(subjectId).get();
  return s.exists ? (s.data() as SubjectSyllabus) : null;
}

/**
 * The caller's part: HOD of the subject's Subject Department (own department or a sub-department - never a branch
 * they only coordinate), or Academics. `owners` = the Subject Department names ([] = not set: nobody prepares yet).
 */
export async function syllabusRoleOf(db: Db, session: { uid: string; role: string; collegeId: string }, subject: Subject): Promise<{ owners: string[]; isHod: boolean; isAcademics: boolean }> {
  const owners = await ownerDepartmentNamesLive(db, session.collegeId, subject);
  const isAcademics = ACADEMICS_ROLES.includes(session.role);
  let isHod = false;
  if (session.role === "HOD" && owners.length > 0) {
    isHod = !!reviewingDepartment(await getHodDepartmentScope(db, session.collegeId, session.uid), owners, true);
  }
  return { owners, isHod, isAcademics };
}

/** The HODs of the Subject Department(s), for "frozen / returned / changed". */
export async function syllabusHodUids(db: Db, collegeId: string, owners: string[]): Promise<string[]> {
  const all = await Promise.all(owners.map((d) => getDepartmentHeadUids(db, collegeId, d)));
  return [...new Set(all.flat())];
}

export async function notifyHods(db: Db, collegeId: string, owners: string[], type: string, title: string, message: string, subjectId: string) {
  for (const uid of await syllabusHodUids(db, collegeId, owners)) {
    await notify(db, collegeId, uid, type, title, message, `/hod/subjects/syllabus/${encodeURIComponent(subjectId)}`);
  }
}

export async function notifyAcademics(db: Db, collegeId: string, type: string, title: string, message: string, subjectId: string) {
  await notifyRole(db, collegeId, "ACADEMICS", type, title, message, `/academics/syllabus-approvals/${encodeURIComponent(subjectId)}`);
}
