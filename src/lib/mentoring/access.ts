import type { Firestore } from "firebase-admin/firestore";
import { getHodDepartmentScope, type HodDepartmentScope } from "@/lib/departments/scope";
import { canHodEditDepartmentYear, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import type { StudentRecord } from "@/types";

// Who may manage / read a student's mentoring data - server only.
//
//  - The HOD of the student's department (same "in my department" test the
//    students routes use: canHodEditDepartmentYear, so a shared first year is
//    judged by whoever manages that year).
//  - The student's own mentor (StudentRecord.mentorUid == the caller's uid).
// Nobody else: Principal / VP / Office are deliberately not part of mentoring.

export interface HodStudentScope {
  scope: HodDepartmentScope;
  /** True when this HOD manages the student (their department, that year). */
  canManage: (student: Pick<StudentRecord, "department" | "year" | "courseId">) => Promise<boolean>;
}

/** The HOD's department scope plus a per-student "is this one mine" check (course lookups cached per call). */
export async function loadHodStudentScope(db: Firestore, collegeId: string, hodUid: string): Promise<HodStudentScope> {
  const scope = await getHodDepartmentScope(db, collegeId, hodUid);
  const collegeRef = db.collection("colleges").doc(collegeId);
  let departments: DepartmentYearRow[] | null = null;
  const catalogByCourse = new Map<string, string | undefined>();

  async function canManage(student: Pick<StudentRecord, "department" | "year" | "courseId">): Promise<boolean> {
    if (scope.ownDepartmentNames.length === 0) return false;
    if (!departments) {
      const snap = await collegeRef.collection("departments").get();
      departments = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentYearRow[];
    }
    let catalogId: string | undefined;
    if (student.courseId) {
      if (!catalogByCourse.has(student.courseId)) {
        const c = await collegeRef.collection("courses").doc(student.courseId).get();
        catalogByCourse.set(student.courseId, c.exists ? (c.data() as { catalogId?: string }).catalogId : undefined);
      }
      catalogId = catalogByCourse.get(student.courseId);
    }
    return canHodEditDepartmentYear(scope, departments, student.department, student.year, catalogId);
  }

  return { scope, canManage };
}

export type MentoringAccess =
  | { ok: true; via: "HOD" | "MENTOR"; student: StudentRecord }
  | { ok: false; status: 403 | 404; error: string };

/** Loads a student and decides whether `session` may see / write their mentoring data. */
export async function authorizeMentoringStudent(
  db: Firestore,
  session: { collegeId: string; uid: string; role: string },
  studentId: string
): Promise<MentoringAccess> {
  const snap = await db.collection("colleges").doc(session.collegeId).collection("students").doc(studentId).get();
  if (!snap.exists) return { ok: false, status: 404, error: "Student not found" };
  const student = { ...(snap.data() as StudentRecord), id: snap.id };

  if (student.mentorUid && student.mentorUid === session.uid) return { ok: true, via: "MENTOR", student };

  if (session.role === "HOD") {
    const { canManage } = await loadHodStudentScope(db, session.collegeId, session.uid);
    if (await canManage(student)) return { ok: true, via: "HOD", student };
  }
  return { ok: false, status: 403, error: "You are not this student's mentor" };
}
