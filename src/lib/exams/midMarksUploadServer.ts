import type { ExamConfigComponent, ExamConfiguration, InternalExamMarkEntry, InternalExamMarksBatch, Section, TeachingAssignment } from "@/types";
import { courseIdsForKey, teachingFor } from "@/lib/midBank/server";
import { loadPlan } from "@/lib/midTimetable/server";
import { countEntered, loadExamConfig, resolveExamConfigForBatch, resolveExamTypeForSubject } from "@/lib/exams/internalExamMarks";
import { sectionRoster } from "@/lib/exams/sectionRoster";
import { resolveLoginUidForFacultyMember } from "@/lib/faculty/resolveFacultyMemberId";
import { scaleToComponent } from "@/lib/exams/questionMarks";
import type { MidMarksLayout } from "@/lib/exams/midMarksEntry";
import { layoutDocId, layoutsCol, loadLayout, loadMode, subjectMidMarksExist } from "@/lib/exams/midMarksEntryServer";
import { checkRows, sameLayout, toKeys, type RowCheck, type UploadRow } from "@/lib/exams/midMarksUploadRows";
import { MidMarksError } from "@/lib/exams/midMarksRoutes";

// The Exam Cell's Mid marks upload (Exam Cell mode, lib/exams/midMarksEntry.ts): one subject + branch of a Mid
// timetable - every section of it. Marks go into each section's own internal marks sheet (the faculty's, created
// here when the faculty never opened it), under the component linked to that Mid, question by question, with the
// total scaled to the component max exactly as faculty entry does. Submit locks that Mid's marks per section
// (`examCellLocks`); the faculty still submit the whole internal marks sheet as before.

type Db = FirebaseFirestore.Firestore;
const college = (db: Db, c: string) => db.collection("colleges").doc(c);

export interface Target {
  courseKey: string; courseName: string; year: number; semester: number; midNumber: number;
  subjectId: string; subjectName: string; subjectCode: string; branch: string;
  sections: { sectionId: string; sectionName: string; assignmentId: string; facultyName: string }[];
}

/** The plan's course / year / semester / Mid and the subject's sections in the branch, with their teaching assignments. */
export async function loadTarget(db: Db, c: string, planId: string, subjectId: string, branch: string): Promise<Target> {
  const plan = await loadPlan(db, c, planId);
  if (!plan) throw new MidMarksError("Mid timetable not found. It may have been deleted.", 404);
  const { ids } = await courseIdsForKey(db, c, plan.courseKey);
  const rows = (await teachingFor(db, c, { courseIds: ids, year: plan.year, semester: plan.semester }))
    .filter((r) => r.subjectId === subjectId && r.branch === branch);
  if (!rows.length) throw new MidMarksError("This subject has no sections with teaching assignments in that branch.", 404);
  const sectionIds = [...new Set(rows.map((r) => r.sectionId))];
  const taSnap = await college(db, c).collection("teachingAssignments").where("subjectId", "==", subjectId).get();
  const bySection = new Map<string, { id: string; facultyName: string }>();
  for (const d of taSnap.docs) {
    const a = d.data() as TeachingAssignment;
    if (a.isPast || !a.sectionId || !sectionIds.includes(a.sectionId) || bySection.has(a.sectionId)) continue;
    bySection.set(a.sectionId, { id: d.id, facultyName: a.facultyName ?? "" });
  }
  const sections = sectionIds
    .filter((id) => bySection.has(id))
    .map((id) => ({ sectionId: id, sectionName: rows.find((r) => r.sectionId === id)!.sectionName, assignmentId: bySection.get(id)!.id, facultyName: bySection.get(id)!.facultyName }))
    .sort((a, b) => a.sectionName.localeCompare(b.sectionName));
  return {
    courseKey: plan.courseKey, courseName: plan.courseName, year: plan.year, semester: plan.semester, midNumber: plan.midNumber,
    subjectId, subjectName: rows[0].subjectName, subjectCode: rows[0].subjectCode, branch, sections,
  };
}

export async function requireExamCellMode(db: Db, c: string, t: Pick<Target, "courseKey" | "midNumber" | "courseName">) {
  if ((await loadMode(db, c, t.courseKey, t.midNumber)) !== "EXAM_CELL") {
    throw new MidMarksError(`Mid-${t.midNumber} marks of ${t.courseName} are entered by the subject faculty. Change it in Mid Configuration › Marks first.`, 409);
  }
}

/** The section's internal marks sheet - created like the faculty page does when its faculty never opened it. */
export async function ensureBatch(db: Db, c: string, assignmentId: string): Promise<{ batch: InternalExamMarksBatch; config: ExamConfiguration }> {
  const ref = college(db, c).collection("internalExamMarks").doc(assignmentId);
  const snap = await ref.get();
  if (snap.exists) {
    const batch = { ...(snap.data() as InternalExamMarksBatch), id: snap.id };
    const resolved = await resolveExamConfigForBatch(db, college(db, c), batch);
    if (!resolved) throw new MidMarksError(`${batch.sectionName}: the internal marks configuration isn't available. Check Mid Configuration › Marks.`, 409);
    return { batch, config: resolved.config };
  }
  const aSnap = await college(db, c).collection("teachingAssignments").doc(assignmentId).get();
  const a = aSnap.data() as TeachingAssignment | undefined;
  if (!a?.sectionId || !a.courseId) throw new MidMarksError("Teaching assignment not found. It may have been deleted.", 404);
  const sec = (await college(db, c).collection("sections").doc(a.sectionId).get()).data() as Section | undefined;
  if (!sec) throw new MidMarksError("Section not found. It may have been deleted.", 404);
  const examType = await resolveExamTypeForSubject(college(db, c), a.subjectId);
  const config = await loadExamConfig(college(db, c), { courseId: a.courseId, year: sec.year, examType, subjectId: a.subjectId });
  if (!config || config.status !== "ACTIVE") throw new MidMarksError(`${sec.name}: the internal marks configuration isn't set or is inactive. Check Mid Configuration › Marks.`, 409);
  const students = await sectionRoster(college(db, c), { department: a.department, sectionName: sec.name, courseId: a.courseId, year: sec.year });
  const entries: InternalExamMarkEntry[] = students.map((s) => ({ studentId: s.id, rollNumber: s.rollNumber, name: s.name, componentMarks: {} }));
  const facultyUid = await resolveLoginUidForFacultyMember(db, c, a.facultyId);
  const now = new Date();
  const batch = {
    collegeId: c, department: a.department, assignmentId, sectionId: a.sectionId, sectionName: sec.name, year: sec.year,
    courseId: a.courseId, courseName: a.courseName ?? "", subjectId: a.subjectId, subjectName: a.subjectName, subjectCode: a.subjectCode,
    facultyId: facultyUid, facultyName: a.facultyName ?? "", status: "DRAFT" as const, entries,
    totalStudents: entries.length, enteredCount: countEntered(entries, config), submittedAt: null, createdAt: now, updatedAt: now,
  };
  // Created only if still missing (the faculty may have opened it meanwhile).
  await db.runTransaction(async (tx) => { if (!(await tx.get(ref)).exists) tx.set(ref, batch); });
  const fresh = await ref.get();
  return { batch: { ...(fresh.data() as InternalExamMarksBatch), id: fresh.id }, config };
}

export function midComponent(config: ExamConfiguration, mid: number): ExamConfigComponent | null {
  return config.components.find((x) => x.isActive && x.midNumber === mid) ?? null;
}

/** Everyone the upload can carry: each section's roster (Regd. No -> section). */
async function rosterOf(db: Db, c: string, t: Target) {
  const byRoll = new Map<string, { studentId: string; name: string; sectionIdx: number }>();
  await Promise.all(t.sections.map(async (s, i) => {
    const sec = (await college(db, c).collection("sections").doc(s.sectionId).get()).data() as Section | undefined;
    if (!sec) return;
    const list = await sectionRoster(college(db, c), { department: sec.department, sectionName: sec.name, courseId: sec.courseId, year: sec.year });
    for (const st of list) if (st.rollNumber) byRoll.set(st.rollNumber.trim().toUpperCase(), { studentId: st.id, name: st.name, sectionIdx: i });
  }));
  return byRoll;
}

export interface UploadResult {
  checks: RowCheck[];
  notInFile: { roll: string; name: string; section: string }[];
  applied?: { section: string; students: number }[];
  skipped?: { section: string; reason: string }[];
}

/** Preview (writes nothing) or apply an upload. Apply is all-or-nothing on the rows: any row error refuses it. */
export async function processUpload(db: Db, c: string, t: Target, layout: MidMarksLayout, rows: UploadRow[], apply: boolean, actor: { uid: string; name: string }): Promise<UploadResult> {
  const saved = await loadLayout(db, c, t.subjectId, t.branch, t.midNumber);
  if (saved && !sameLayout(saved, layout) && await subjectMidMarksExist(db, c, t.subjectId, t.branch, t.midNumber)) {
    throw new MidMarksError("Marks are already entered with other questions / max marks. Keep the same questions and max marks as before.", 409);
  }
  const roster = await rosterOf(db, c, t);
  const checks = checkRows(layout, rows, new Set(roster.keys()));
  const inFile = new Set(rows.map((r) => r.roll));
  const notInFile = [...roster.entries()].filter(([roll]) => !inFile.has(roll))
    .map(([roll, s]) => ({ roll, name: s.name, section: t.sections[s.sectionIdx].sectionName }));
  if (!apply) return { checks, notInFile };
  if (checks.some((x) => x.error)) throw new MidMarksError("Fix the rows with problems first - nothing was saved.", 400);

  await layoutsCol(db, c).doc(layoutDocId(t.subjectId, t.branch, t.midNumber)).set({
    subjectId: t.subjectId, subjectName: t.subjectName, branch: t.branch, midNumber: t.midNumber, ...layout,
    updatedAt: new Date(), updatedBy: actor.uid, updatedByName: actor.name,
  });

  const rowByRoll = new Map(rows.map((r) => [r.roll, r]));
  const applied: NonNullable<UploadResult["applied"]> = [];
  const skipped: NonNullable<UploadResult["skipped"]> = [];
  for (const [i, s] of t.sections.entries()) {
    const mine = [...roster.entries()].filter(([roll, st]) => st.sectionIdx === i && rowByRoll.has(roll));
    if (!mine.length) continue;
    const { config } = await ensureBatch(db, c, s.assignmentId);
    const comp = midComponent(config, t.midNumber);
    if (!comp) { skipped.push({ section: s.sectionName, reason: `No Mid-${t.midNumber} component in its marks configuration.` }); continue; }
    const ref = college(db, c).collection("internalExamMarks").doc(s.assignmentId);
    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const b = snap.data() as InternalExamMarksBatch & { examCellLocks?: Record<string, unknown> };
      if (b.status === "SUBMITTED") return "The faculty already submitted this section's internal marks.";
      if (b.examCellLocks?.[comp.id]) return "Already submitted by the Exam Cell.";
      const ids = new Set(mine.map(([, st]) => st.studentId));
      const byStudent = new Map(mine.map(([roll, st]) => [st.studentId, rowByRoll.get(roll)!]));
      const entries = b.entries.map((e) => {
        if (!ids.has(e.studentId)) return e;
        const r = byStudent.get(e.studentId)!;
        const values = r.absent ? {} : toKeys(layout, r.values);
        const total = r.absent ? 0 : Object.values(values).reduce<number>((n, v) => n + (v ?? 0), 0);
        const absentIn = { ...(e.absentIn ?? {}) };
        if (r.absent) absentIn[comp.id] = true; else delete absentIn[comp.id];
        return {
          ...e,
          componentMarks: { ...e.componentMarks, [comp.id]: r.absent ? 0 : scaleToComponent(total, layout.paperMax, comp.maxMarks) },
          questionMarks: { ...(e.questionMarks ?? {}), [comp.id]: values },
          absentIn,
        };
      });
      tx.update(ref, {
        entries, enteredCount: countEntered(entries, config), updatedAt: new Date(),
        [`examCellEntered.${comp.id}`]: { at: new Date(), byName: actor.name },
      });
      return null;
    });
    if (outcome) skipped.push({ section: s.sectionName, reason: outcome }); else applied.push({ section: s.sectionName, students: mine.length });
  }
  return { checks, notInFile, applied, skipped };
}

/** Locks the Mid's marks of every section of the subject + branch - each section needs every student entered. */
export async function submitSections(db: Db, c: string, t: Target, actor: { name: string }): Promise<{ submitted: string[]; incomplete: { section: string; missing: number }[] }> {
  const submitted: string[] = [];
  const incomplete: { section: string; missing: number }[] = [];
  for (const s of t.sections) {
    const ref = college(db, c).collection("internalExamMarks").doc(s.assignmentId);
    const snap = await ref.get();
    if (!snap.exists) { incomplete.push({ section: s.sectionName, missing: -1 }); continue; }
    const b = { ...(snap.data() as InternalExamMarksBatch & { examCellLocks?: Record<string, unknown> }), id: snap.id };
    const resolved = await resolveExamConfigForBatch(db, college(db, c), b);
    const comp = resolved ? midComponent(resolved.config, t.midNumber) : null;
    if (!comp) { incomplete.push({ section: s.sectionName, missing: -1 }); continue; }
    if (b.examCellLocks?.[comp.id]) { submitted.push(s.sectionName); continue; }
    const missing = b.entries.filter((e) => e.componentMarks?.[comp.id] == null).length;
    if (missing) { incomplete.push({ section: s.sectionName, missing }); continue; }
    await ref.update({ [`examCellLocks.${comp.id}`]: { at: new Date(), byName: actor.name }, updatedAt: new Date() });
    submitted.push(s.sectionName);
  }
  return { submitted, incomplete };
}
