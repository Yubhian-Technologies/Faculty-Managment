import { canHodEditDepartment, getHodDepartmentScope } from "@/lib/departments/scope";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import type { Course, MidBankRules, MidPaperAssignment, MidQuestion, Subject, SubjectOutcomes } from "@/types";

// Server side of the Mid Question Bank: collection refs, who may read/write a
// bank, and which Exam Cell rules apply to a subject. Writes happen in the
// route handlers (inside transactions); this file only reads.

type Db = FirebaseFirestore.Firestore;

export const midBankRefs = (db: Db, collegeId: string) => {
  const college = db.collection("colleges").doc(collegeId);
  return {
    college,
    assignments: college.collection("midPaperAssignments"),
    banks: college.collection("midQuestionBanks"),
    questions: (bankId: string) => college.collection("midQuestionBanks").doc(bankId).collection("questions"),
    outcomes: college.collection("subjectOutcomes"),
    rules: college.collection("midBankRules"),
  };
};

/** Roles that may READ a bank: its holder (any faculty-capable role), the subject's HOD, college leadership. */
export const MID_BANK_READ_ROLES = ["PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];
/** Roles that may WRITE questions (the holder only - checked per assignment). */
export const MID_BANK_WRITE_ROLES = ["PANEL_MEMBER", "HOD"];

export interface BankAccess {
  assignment: MidPaperAssignment;
  isHolder: boolean;
  isHod: boolean;
  canRead: boolean;
}

/** Loads an assignment and what the caller may do with its bank. Null when it doesn't exist. */
export async function bankAccess(db: Db, session: { uid: string; role: string; collegeId: string }, assignmentId: string): Promise<BankAccess | null> {
  const snap = await midBankRefs(db, session.collegeId).assignments.doc(assignmentId).get();
  if (!snap.exists) return null;
  const assignment = { id: snap.id, ...(snap.data() as Omit<MidPaperAssignment, "id">) };
  const facultyId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
  const isHolder = facultyId === assignment.facultyId;
  let isHod = false;
  if (session.role === "HOD") {
    const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
    isHod = canHodEditDepartment(scope, assignment.department ?? "");
  }
  const leadership = ["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"].includes(session.role);
  return { assignment, isHolder, isHod, canRead: isHolder || isHod || leadership };
}

/** The course group key of a subject (buildCourseGroups): its catalog course, else its course's name. */
export async function courseKeyForSubject(db: Db, collegeId: string, subject: Pick<Subject, "catalogId" | "courseId" | "courseName">): Promise<string> {
  if (subject.catalogId) return subject.catalogId;
  if (subject.courseId) {
    const c = await midBankRefs(db, collegeId).college.collection("courses").doc(subject.courseId).get();
    const course = c.data() as Course | undefined;
    if (course?.catalogId) return course.catalogId;
    if (course?.name) return `name:${course.name.trim().toLowerCase()}`;
  }
  return subject.courseName ? `name:${subject.courseName.trim().toLowerCase()}` : "";
}

export const rulesDocId = (courseKey: string, regulation: string) =>
  `${courseKey}__${regulation || "ALL"}`.replace(/[/\s]+/g, "-").slice(0, 300);

/** The Exam Cell rules for a subject: its own regulation's, else the course's "ALL". */
export async function rulesForSubject(db: Db, collegeId: string, subject: Subject): Promise<MidBankRules | null> {
  const key = await courseKeyForSubject(db, collegeId, subject);
  if (!key) return null;
  const snap = await midBankRefs(db, collegeId).rules.where("courseKey", "==", key).get();
  const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidBankRules, "id">) }));
  const reg = (subject.regulation ?? "").trim().toUpperCase();
  return all.find((r) => reg && r.regulation.toUpperCase() === reg) ?? all.find((r) => r.regulation === "ALL") ?? null;
}

export async function loadOutcomes(db: Db, collegeId: string, subjectId: string): Promise<SubjectOutcomes | null> {
  const snap = await midBankRefs(db, collegeId).outcomes.doc(subjectId).get();
  return snap.exists ? (snap.data() as SubjectOutcomes) : null;
}

export async function loadQuestions(db: Db, collegeId: string, bankId: string): Promise<MidQuestion[]> {
  const snap = await midBankRefs(db, collegeId).questions(bankId).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidQuestion, "id">) }));
}

/** Units and COs used by any question of any bank of this subject (both Mids). */
export async function usedOutcomeRefs(db: Db, collegeId: string, subjectId: string): Promise<{ units: Set<number>; cos: Set<string> }> {
  const refs = midBankRefs(db, collegeId);
  const banks = await refs.banks.where("subjectId", "==", subjectId).get();
  const units = new Set<number>(), cos = new Set<string>();
  for (const b of banks.docs) {
    for (const q of await loadQuestions(db, collegeId, b.id)) {
      units.add(q.unit);
      for (const p of q.parts) for (const c of p.cos) cos.add(c);
    }
  }
  return { units, cos };
}

export async function actorName(db: Db, collegeId: string, uid: string): Promise<string> {
  const s = await midBankRefs(db, collegeId).college.collection("users").doc(uid).get();
  return (s.data() as { name?: string } | undefined)?.name ?? "";
}

export function guardError(err: unknown, tag: string) {
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.error(tag, err);
  return Response.json({ error: "Internal error" }, { status: 500 });
}
