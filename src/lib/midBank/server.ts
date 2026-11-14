import { getHodDepartmentScope } from "@/lib/departments/scope";
import { reviewingDepartment } from "./reviewer";
import { ownerDepartmentNames, reviewDepartmentsOf, subjectReviewNamesLive } from "@/lib/subjects/ownerDepartment";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { cachedValue } from "@/lib/firestore/sharedReads";
import type { Course, MidBankDeadline, MidBankRules, MidQuestion, MidQuestionBank, Section, Subject, SubjectOutcomes, SubjectSemesterAssignment, SubjectSyllabus, TeachingAssignment } from "@/types";
import { syllabusAsOutcomes, syllabusSubjectOf } from "@/lib/subjects/syllabus";
import { isDeadlineLocked } from "./deadline";
import { isMidBankSubject, type TeachingRow } from "./sections";
import { isAllBranches } from "./assignments";

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

/** `in` queries take 30 values: one query per 30, all sent at once (the database is far away - never one after another). */
async function inChunks<T>(values: string[], run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < values.length; i += 30) chunks.push(values.slice(i, i + 30));
  return (await Promise.all(chunks.map(run))).flat();
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
    // Only the fields used below (smaller answers from a far-away database); the curriculum filtered to the semester
    // by the database itself (plain equality filters - no index needed).
    inChunks(d.courseIds, async (ids) => (await refs.college.collection("sections").where("courseId", "in", ids).select("year", "department", "name").get()).docs),
    inChunks(d.courseIds, async (ids) => (await refs.college.collection("subjectSemesterAssignments").where("courseId", "in", ids).where("semester", "==", d.semester)
      .select("semester", "subjectId", "subjectName", "subjectCode").get()).docs),
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
  if (sections.size === 0 || subjects.size === 0) return [];
  // The master subjects and the teaching assignments are read together (neither needs the other).
  const [masters, teachDocs] = await Promise.all([
    db.getAll(...[...subjects.keys()].map((id) => refs.college.collection("subjects").doc(id))),
    inChunks([...sections.keys()], async (ids) => (await refs.college.collection("teachingAssignments").where("sectionId", "in", ids)
      .select("isPast", "sectionId", "subjectId", "subjectName", "subjectCode", "facultyId", "facultyName").get()).docs),
  ]);
  // Mid exam subjects only (the master subject's type and teaching-load tick; the semester copy's snapshot may be stale).
  for (const m of masters) if (!m.exists || !isMidBankSubject(m.data() as Subject)) subjects.delete(m.id);
  if (subjects.size === 0) return [];
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

/** `teachingFor` kept 60 s per server instance - for pages that SHOW progress / assignments (the progress list and the
 *  Assign card ask together). Writes (start, assign, save) call `teachingFor` itself. */
export function teachingForCached(db: Db, collegeId: string, d: Pick<MidBankDeadline, "courseIds" | "year" | "semester">): Promise<TeachingRow[]> {
  return cachedValue(`teachingFor/${collegeId}/${[...d.courseIds].sort().join(",")}/${d.year}/${d.semester}`, 60_000, () => teachingFor(db, collegeId, d));
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
  /** An HOD who reviews it (approves / returns): a subject department's (either, when two), else the branch's. */
  isHod: boolean;
  /** The departments whose HODs review it (`reviewDepartmentsOf`); any one of them decides. */
  reviewDepartments: string[];
  /** Of those, the one this HOD reviews it as ("" when not a reviewer). */
  hodDepartment: string;
  /** Submitted to / approved by the HOD - nobody edits it until it is returned. */
  frozen: boolean;
  /** Owner, the deadline not passed (or reopened by the Exam Cell), and not submitted / approved. */
  canWrite: boolean;
}

/** Why the owner can't write (for the 403). */
export function writeRefusal(a: Pick<BankAccess, "frozen" | "bank">): string {
  if (a.bank.withdrawn) return `Your HOD removed you as setter for this subject (${a.bank.withdrawn.byName}) - it is kept, read-only`;
  if (a.frozen) return a.bank.approval === "APPROVED"
    ? "This question bank is approved by the HOD - it can't be changed"
    : "This question bank is with the HOD for approval - withdraw it or wait for it to be returned to make changes";
  return "The deadline has passed - this question bank is locked. Ask the Exam Cell to extend it.";
}

export async function bankAccess(db: Db, session: Session, bankId: string): Promise<BankAccess | null> {
  const snap = await midBankRefs(db, session.collegeId).banks.doc(bankId).get();
  if (!snap.exists) return null;
  const bank = { id: snap.id, ...(snap.data() as Omit<MidQuestionBank, "id">) };
  const [facultyId, deadline, subject] = await Promise.all([
    resolveFacultyMemberId(db, session.collegeId, session.uid),
    loadDeadline(db, session.collegeId, bank.deadlineId),
    loadSubject(db, session.collegeId, bank.subjectId),
  ]);
  const isOwner = facultyId === bank.ownerFacultyId;
  const isIncluded = (bank.viewerFacultyIds ?? []).includes(facultyId);
  // The subject's department reviews it (a Maths bank for CSE goes to the Maths HOD); a subject with
  // none set keeps going to the branch's HOD. Only that HOD reads / decides it.
  const names = await subjectReviewNamesLive(db, session.collegeId, subject);
  const owners = ownerDepartmentNames(subject, names);
  // No Subject Department: the branch's HOD - for a paper of several branches (a group), any of their HODs.
  // With one, its HOD - except in a branch that handles its own papers (ownBranchPapers), where that branch's HOD does.
  const bankBranches = bank.branches?.length ? bank.branches : [bank.branch];
  const reviewDepartments = !owners.length ? bankBranches
    : isAllBranches(bank.branch) ? owners
    : [...new Set(bankBranches.flatMap((b) => reviewDepartmentsOf(b, subject, names)))];
  let hodDepartment = "";
  if (session.role === "HOD") {
    const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
    hodDepartment = reviewingDepartment(scope, reviewDepartments, owners.length > 0);
  }
  const isHod = !!hodDepartment;
  const locked = !deadline || isDeadlineLocked(deadline.deadline);
  // Submitted / approved, or withdrawn by the HOD (removed as setter): nobody edits it.
  const frozen = !!bank.withdrawn || bank.approval === "SUBMITTED" || bank.approval === "APPROVED";
  return {
    bank, deadline, locked, isOwner, isIncluded, isHod, reviewDepartments, hodDepartment, frozen,
    canRead: isOwner || isIncluded || isHod || MID_BANK_OVERSEERS.includes(session.role),
    // Reopened by the Exam Cell after approval: the owner edits past the deadline until it is approved again.
    canWrite: isOwner && (!locked || !!bank.reopened) && !frozen,
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

/** The Exam Cell's Mid-units exception for one subject (Mid number -> units), if any. */
export async function subjectSplitFor(db: Db, collegeId: string, subjectId: string): Promise<Record<string, number[]> | null> {
  const s = await midBankRefs(db, collegeId).college.collection("midBankSubjectSplits").doc(subjectId).get();
  return s.exists ? ((s.get("mids") as Record<string, number[]>) ?? null) : null;
}

export async function loadSubject(db: Db, collegeId: string, subjectId: string): Promise<Subject | null> {
  const s = await midBankRefs(db, collegeId).college.collection("subjects").doc(subjectId).get();
  return s.exists ? ({ id: s.id, ...(s.data() as Omit<Subject, "id">) }) : null;
}

/**
 * The units / COs / mapping a bank works to: the subject's FROZEN syllabus (`syllabus__{subjectId}` - banks and papers
 * started since the syllabus flow), else an older per-branch setup (`{subjectId}__{branchKey}`).
 */
export async function loadOutcomes(db: Db, collegeId: string, outcomesId: string): Promise<SubjectOutcomes | null> {
  const subjectId = syllabusSubjectOf(outcomesId);
  if (subjectId) {
    const s = await midBankRefs(db, collegeId).college.collection("subjectSyllabus").doc(subjectId).get();
    return syllabusAsOutcomes(s.exists ? (s.data() as SubjectSyllabus) : null);
  }
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
      // A question paper's question carries its COs (and maybe a unit) itself, not in parts.
      const paper = q as unknown as { unit?: number; cos?: string[] };
      if (typeof q.unit === "number") units.add(q.unit);
      for (const p of q.parts ?? []) for (const c of p.cos) cos.add(c);
      for (const c of paper.cos ?? []) cos.add(c);
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
    return Response.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
  }
  console.error(tag, err);
  return Response.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
}
