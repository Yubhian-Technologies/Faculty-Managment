import { canHodEditDepartment, getHodDepartmentScope } from "@/lib/departments/scope";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import type { Course, MidBankDeadline, MidBankRules, MidQuestion, MidQuestionBank, Section, Subject, SubjectOutcomes, SubjectSemesterAssignment, TeachingAssignment } from "@/types";
import { isDeadlineLocked } from "./deadline";
import { isMidBankSubject, type TeachingRow } from "./sections";

// Server side of the Mid Question Bank: collection refs, who teaches what for a
// deadline, who may read / write a bank, and which Exam Cell rules apply.
// Writes happen in the route handlers (inside transactions); this file reads.

type Db = FirebaseFirestore.Firestore;
type Session = { uid: string; role: string; collegeId: string };

export const midBankRefs = (db: Db, collegeId: string) => {
  const college = db.collection("colleges").doc(collegeId);
  return {
    college,
    deadlines: college.collection("midBankDeadlines"),
    banks: college.collection("midQuestionBanks"),
    claims: college.collection("midBankSectionClaims"),
    questions: (bankId: string) => college.collection("midQuestionBanks").doc(bankId).collection("questions"),
    outcomes: college.collection("subjectOutcomes"),
    rules: college.collection("midBankRules"),
  };
};

/** College leadership and the Exam Cell read every bank. */
export const MID_BANK_OVERSEERS = ["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];
export const MID_BANK_READ_ROLES = ["PANEL_MEMBER", "HOD", ...MID_BANK_OVERSEERS];
/** Roles that may WRITE (the bank's owner only - checked per bank). */
export const MID_BANK_WRITE_ROLES = ["PANEL_MEMBER", "HOD"];

async function inChunks<T>(values: string[], run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += 30) out.push(...(await run(values.slice(i, i + 30))));
  return out;
}

/** Every Course doc of a programme (one per department), by course group key. */
export async function courseIdsForKey(db: Db, collegeId: string, courseKey: string): Promise<{ ids: string[]; name: string; durationYears: number }> {
  const col = midBankRefs(db, collegeId).college.collection("courses");
  const snap = courseKey.startsWith("name:") ? await col.get() : await col.where("catalogId", "==", courseKey).get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Course, "id">) }))
    .filter((c) => (courseKey.startsWith("name:") ? !c.catalogId && `name:${c.name.trim().toLowerCase()}` === courseKey : true));
  return { ids: rows.map((c) => c.id), name: rows[0]?.name ?? "", durationYears: Math.max(0, ...rows.map((c) => c.durationYears ?? 0)) };
}

/**
 * Who teaches which subject in which section, for a deadline: the programme's
 * sections of that year, the subjects assigned to that semester (Academics >
 * Curriculum), and the current teaching assignments joining them.
 */
export async function teachingFor(db: Db, collegeId: string, d: Pick<MidBankDeadline, "courseIds" | "year" | "semester">): Promise<TeachingRow[]> {
  const refs = midBankRefs(db, collegeId);
  if (d.courseIds.length === 0) return [];
  const [sectionDocs, instanceDocs] = await Promise.all([
    inChunks(d.courseIds, async (ids) => (await refs.college.collection("sections").where("courseId", "in", ids).get()).docs),
    inChunks(d.courseIds, async (ids) => (await refs.college.collection("subjectSemesterAssignments").where("courseId", "in", ids).get()).docs),
  ]);
  const sections = new Map<string, Section>();
  for (const s of sectionDocs) {
    const sec = { id: s.id, ...(s.data() as Omit<Section, "id">) };
    if (Number(sec.year) === d.year) sections.set(s.id, sec);
  }
  const subjects = new Map<string, { name: string; code: string }>();
  for (const i of instanceDocs) {
    const a = i.data() as SubjectSemesterAssignment;
    if (a.semester === d.semester && a.subjectId) subjects.set(a.subjectId, { name: a.subjectName, code: a.subjectCode });
  }
  // Theory subjects only (the master subject's type; the semester copy's snapshot may be stale).
  if (subjects.size > 0) {
    const masters = await db.getAll(...[...subjects.keys()].map((id) => refs.college.collection("subjects").doc(id)));
    for (const m of masters) if (!m.exists || !isMidBankSubject((m.data() as Subject).type)) subjects.delete(m.id);
  }
  if (sections.size === 0 || subjects.size === 0) return [];
  const teachDocs = await inChunks([...sections.keys()], async (ids) => (await refs.college.collection("teachingAssignments").where("sectionId", "in", ids).get()).docs);
  const rows: TeachingRow[] = [];
  for (const t of teachDocs) {
    const ta = t.data() as TeachingAssignment;
    const sec = ta.sectionId ? sections.get(ta.sectionId) : undefined;
    const subj = subjects.get(ta.subjectId);
    if (ta.isPast || !sec || !subj) continue;
    rows.push({
      subjectId: ta.subjectId, subjectName: subj.name || ta.subjectName, subjectCode: subj.code || ta.subjectCode,
      branch: sec.department, sectionId: sec.id, sectionName: sec.name, facultyId: ta.facultyId, facultyName: ta.facultyName,
    });
  }
  return rows;
}

export async function loadDeadline(db: Db, collegeId: string, id: string): Promise<MidBankDeadline | null> {
  const s = await midBankRefs(db, collegeId).deadlines.doc(id).get();
  return s.exists ? ({ id: s.id, ...(s.data() as Omit<MidBankDeadline, "id">) }) : null;
}

export interface BankAccess {
  bank: MidQuestionBank;
  deadline: MidBankDeadline | null;
  locked: boolean;
  isOwner: boolean;
  /** Teaches a section the bank covers (read-only unless also the owner). */
  isIncluded: boolean;
  canRead: boolean;
  /** Owner, and the deadline not passed. */
  canWrite: boolean;
}

export async function bankAccess(db: Db, session: Session, bankId: string): Promise<BankAccess | null> {
  const snap = await midBankRefs(db, session.collegeId).banks.doc(bankId).get();
  if (!snap.exists) return null;
  const bank = { id: snap.id, ...(snap.data() as Omit<MidQuestionBank, "id">) };
  const [facultyId, deadline] = await Promise.all([
    resolveFacultyMemberId(db, session.collegeId, session.uid),
    loadDeadline(db, session.collegeId, bank.deadlineId),
  ]);
  const isOwner = facultyId === bank.ownerFacultyId;
  const isIncluded = (bank.viewerFacultyIds ?? []).includes(facultyId);
  let isHod = false;
  if (session.role === "HOD") isHod = canHodEditDepartment(await getHodDepartmentScope(db, session.collegeId, session.uid), bank.branch);
  const locked = !deadline || isDeadlineLocked(deadline.deadline);
  return {
    bank, deadline, locked, isOwner, isIncluded,
    canRead: isOwner || isIncluded || isHod || MID_BANK_OVERSEERS.includes(session.role),
    canWrite: isOwner && !locked,
  };
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

export async function loadSubject(db: Db, collegeId: string, subjectId: string): Promise<Subject | null> {
  const s = await midBankRefs(db, collegeId).college.collection("subjects").doc(subjectId).get();
  return s.exists ? ({ id: s.id, ...(s.data() as Omit<Subject, "id">) }) : null;
}

export async function loadOutcomes(db: Db, collegeId: string, outcomesId: string): Promise<SubjectOutcomes | null> {
  const snap = await midBankRefs(db, collegeId).outcomes.doc(outcomesId).get();
  return snap.exists ? (snap.data() as SubjectOutcomes) : null;
}

export async function loadQuestions(db: Db, collegeId: string, bankId: string): Promise<MidQuestion[]> {
  const snap = await midBankRefs(db, collegeId).questions(bankId).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidQuestion, "id">) }));
}

/** Units and COs used by any question of any bank using these outcomes (both Mids, every owner). */
export async function usedOutcomeRefs(db: Db, collegeId: string, outcomesId: string): Promise<{ units: Set<number>; cos: Set<string>; owners: Set<string> }> {
  const banks = await midBankRefs(db, collegeId).banks.where("outcomesId", "==", outcomesId).get();
  const units = new Set<number>(), cos = new Set<string>(), owners = new Set<string>();
  for (const b of banks.docs) {
    owners.add(String(b.get("ownerFacultyId")));
    for (const q of await loadQuestions(db, collegeId, b.id)) {
      units.add(q.unit);
      for (const p of q.parts) for (const c of p.cos) cos.add(c);
    }
  }
  return { units, cos, owners };
}

export async function actorName(db: Db, collegeId: string, uid: string): Promise<string> {
  const s = await midBankRefs(db, collegeId).college.collection("users").doc(uid).get();
  return (s.data() as { name?: string } | undefined)?.name ?? "";
}

/** Login uids of FacultyMember ids (for notifications). */
export async function loginUidsOf(db: Db, collegeId: string, facultyIds: string[]): Promise<Map<string, string>> {
  const col = midBankRefs(db, collegeId).college.collection("facultyMembers");
  const out = new Map<string, string>();
  const snaps = facultyIds.length ? await db.getAll(...facultyIds.map((id) => col.doc(id))) : [];
  for (const s of snaps) { const uid = s.get("userUid"); if (s.exists && uid) out.set(s.id, String(uid)); }
  return out;
}

export function guardError(err: unknown, tag: string) {
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.error(tag, err);
  return Response.json({ error: "Internal error" }, { status: 500 });
}
