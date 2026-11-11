import type { Firestore } from "firebase-admin/firestore";
import { countEntered, loadExamConfig, resolveExamTypeForSubject } from "@/lib/exams/internalExamMarks";
import { sectionRoster } from "@/lib/exams/sectionRoster";
import { sheetFromPattern, type QuestionSheet } from "@/lib/exams/questionMarks";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { loadPlan } from "@/lib/midTimetable/server";
import type { CeaMarksSheet, CeaPlan, CeaSettings, ExamConfiguration, InternalExamMarksBatch, MidPaperFinal, Section, TeachingAssignment } from "@/types";
import { ceaPartOf } from "./paper";
import { ceaComponentValues, ceaSheetId, isEntered, reconcileRoster } from "./marks";
import { midOf } from "./rules";
import { CeaError, ceaRefs, loadAllCeaSettings, settingsFor } from "./server";
import { courseKeyForSubject, loadSubject } from "@/lib/midBank/server";

// Server side of CEA marks: a faculty member's sections with a CEA plan, a unit's sheet (roster, the printed CEA
// paper's questions for a with-Mid unit), and feeding the internal-marks component linked to CEA.

type Db = Firestore;
export const ceaMarksCol = (db: Db, collegeId: string) => ceaRefs(db, collegeId).college.collection("ceaMarks");

async function planAndSettings(db: Db, collegeId: string, subjectId: string): Promise<{ plan: CeaPlan; settings: CeaSettings } | null> {
  const [planSnap, subject, all] = await Promise.all([ceaRefs(db, collegeId).plans.doc(subjectId).get(), loadSubject(db, collegeId, subjectId), loadAllCeaSettings(db, collegeId)]);
  if (!planSnap.exists || !subject) return null;
  const settings = settingsFor(all, await courseKeyForSubject(db, collegeId, subject), subject.regulation);
  return settings ? { plan: planSnap.data() as CeaPlan, settings } : null;
}

/** The faculty member's current teaching assignments whose subject has a CEA plan, with each unit's sheet status. */
export async function myCeaAssignments(db: Db, collegeId: string, uid: string) {
  const me = await resolveFacultyMemberId(db, collegeId, uid);
  const college = ceaRefs(db, collegeId).college;
  const tas = (await college.collection("teachingAssignments").where("facultyId", "==", me).get()).docs
    .map((d) => ({ ...(d.data() as TeachingAssignment), id: d.id })).filter((a) => !a.isPast && a.subjectId);
  const bySubject = new Map<string, { plan: CeaPlan; settings: CeaSettings } | null>();
  for (const s of new Set(tas.map((a) => a.subjectId))) bySubject.set(s, await planAndSettings(db, collegeId, s));
  const sheets = new Map<string, CeaMarksSheet>();
  const ids = tas.filter((a) => bySubject.get(a.subjectId)).flatMap((a) => bySubject.get(a.subjectId)!.plan.units.map((u) => ceaSheetId(a.id, u.unit)));
  for (let i = 0; i < ids.length; i += 100) {
    const snaps = await db.getAll(...ids.slice(i, i + 100).map((id) => ceaMarksCol(db, collegeId).doc(id)));
    snaps.forEach((s) => { if (s.exists) sheets.set(s.id, s.data() as CeaMarksSheet); });
  }
  return tas.flatMap((a) => {
    const ps = bySubject.get(a.subjectId);
    if (!ps) return [];
    return [{
      assignmentId: a.id, subjectId: a.subjectId, subjectCode: a.subjectCode, subjectName: a.subjectName, department: a.department,
      section: a.sectionName ?? a.section ?? "", unitMarks: ps.settings.unitMarks,
      units: ps.plan.units.map((u) => {
        const s = sheets.get(ceaSheetId(a.id, u.unit));
        return { unit: u.unit, title: u.title, when: u.when, typeLabel: ps.settings.types.find((t) => t.id === u.typeId)?.label ?? u.typeId,
          status: s?.status ?? null, enteredCount: s?.enteredCount ?? 0, totalStudents: s?.totalStudents ?? 0 };
      }),
    }];
  });
}

/** The printed CEA paper of a with-Mid unit for this section's branch + year (null until the Exam Cell prints it). */
export async function ceaQuestionSheet(db: Db, collegeId: string, q: { subjectId: string; department: string; year?: number; midNumber: number }): Promise<QuestionSheet | null> {
  const choices = (await ceaRefs(db, collegeId).college.collection("midPaperChoices").where("subjectId", "==", q.subjectId).get()).docs
    .map((d) => ({ ...(d.data() as { planId: string; branch: string; final?: MidPaperFinal; at?: string }), id: d.id }))
    .filter((c) => c.final && c.branch === q.department)
    .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  for (const c of choices) {
    const plan = await loadPlan(db, collegeId, c.planId);
    if (!plan || plan.midNumber !== q.midNumber || (q.year && plan.year !== q.year)) continue;
    const part = ceaPartOf(c.final!.pattern.parts);
    if (!part) return null;
    return sheetFromPattern({ parts: [part] }, "CHOSEN", { set: c.final!.setNo, questions: c.final!.questions });
  }
  return null;
}

/** Opens (creating or re-listing a draft) the faculty member's sheet for one unit. */
export async function openCeaSheet(db: Db, collegeId: string, uid: string, byName: string, assignmentId: string, unit: number) {
  const college = ceaRefs(db, collegeId).college;
  const aSnap = await college.collection("teachingAssignments").doc(assignmentId).get();
  if (!aSnap.exists) throw new CeaError("Teaching assignment not found", 404);
  const a = aSnap.data() as TeachingAssignment;
  if (a.facultyId !== (await resolveFacultyMemberId(db, collegeId, uid)) || a.isPast) throw new CeaError("You are not assigned to teach this subject", 403);
  const ps = await planAndSettings(db, collegeId, a.subjectId);
  const pu = ps?.plan.units.find((u) => u.unit === unit);
  if (!ps || !pu) throw new CeaError("This unit has no CEA in the subject's plan", 404);
  if (!a.courseId) throw new CeaError("This subject's section isn't linked to a course - ask the HOD", 409);
  let sectionName = a.section?.trim() || "Section", year: number | undefined;
  if (a.sectionId) {
    const sec = await college.collection("sections").doc(a.sectionId).get();
    if (!sec.exists) throw new CeaError("Section not found", 404);
    sectionName = (sec.data() as Section).name; year = (sec.data() as Section).year;
  }
  const roster = await sectionRoster(college, { department: a.department, sectionName, courseId: a.courseId, year });
  const mid = midOf(pu.when);
  const sheet = mid ? await ceaQuestionSheet(db, collegeId, { subjectId: a.subjectId, department: a.department, year, midNumber: mid }) : null;
  const id = ceaSheetId(assignmentId, unit);
  const ref = ceaMarksCol(db, collegeId).doc(id);
  const at = new Date().toISOString();
  const saved = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() as CeaMarksSheet) : null;
    if (cur?.status === "SUBMITTED") return cur;
    const entries = reconcileRoster(cur?.entries ?? [], roster);
    const next: CeaMarksSheet = {
      id, assignmentId, subjectId: a.subjectId, subjectCode: a.subjectCode, subjectName: a.subjectName, department: a.department,
      ...(a.sectionId ? { sectionId: a.sectionId } : {}), sectionName, courseId: a.courseId!, ...(year != null ? { year } : {}),
      facultyId: a.facultyId, facultyName: a.facultyName ?? byName, unit, typeId: pu.typeId,
      typeLabel: ps.settings.types.find((t) => t.id === pu.typeId)?.label ?? pu.typeId, when: pu.when, unitMarks: ps.settings.unitMarks,
      ...(cur?.heldOn ? { heldOn: cur.heldOn } : {}), status: "DRAFT", entries, totalStudents: entries.length, enteredCount: entries.filter(isEntered).length,
      rev: (cur?.rev ?? 0) + (cur ? 0 : 1), updatedAt: cur?.updatedAt ?? at, updatedByName: cur?.updatedByName ?? byName,
    };
    tx.set(ref, next);
    return next;
  });
  return { sheet: saved, questionSheet: sheet };
}

/** The CEA component's value per student for an internal-marks batch (null when the config has no CEA component). */
export async function ceaValuesForBatch(db: Db, collegeId: string, batch: Pick<InternalExamMarksBatch, "assignmentId" | "subjectId">, config: Pick<ExamConfiguration, "components">) {
  const comp = config.components.find((c) => c.isActive && c.cea);
  if (!comp) return null;
  const ps = await planAndSettings(db, collegeId, batch.subjectId);
  if (!ps) return { componentId: comp.id, values: new Map<string, number | null>() };
  const snaps = await db.getAll(...ps.plan.units.map((u) => ceaMarksCol(db, collegeId).doc(ceaSheetId(batch.assignmentId, u.unit))));
  const sheets = snaps.filter((s) => s.exists).map((s) => s.data() as CeaMarksSheet);
  return { componentId: comp.id, values: ceaComponentValues(ps.plan.units.length, ps.settings.unitMarks, sheets, comp.maxMarks) };
}

/** After a CEA submit: writes the CEA component into the section's internal-marks draft (if there is one). */
export async function syncCeaIntoInternal(db: Db, collegeId: string, assignmentId: string): Promise<void> {
  const college = ceaRefs(db, collegeId).college;
  const ref = college.collection("internalExamMarks").doc(assignmentId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const batch = snap.data() as InternalExamMarksBatch;
  if (batch.status !== "DRAFT" || !batch.courseId) return;
  const examType = await resolveExamTypeForSubject(college, batch.subjectId);
  const config = await loadExamConfig(college, { courseId: batch.courseId, year: batch.year, examType, subjectId: batch.subjectId });
  if (!config) return;
  const cea = await ceaValuesForBatch(db, collegeId, { assignmentId, subjectId: batch.subjectId }, config);
  if (!cea) return;
  const entries = batch.entries.map((e) => (cea.values.has(e.studentId) ? { ...e, componentMarks: { ...e.componentMarks, [cea.componentId]: cea.values.get(e.studentId) ?? null } } : e));
  await ref.update({ entries, enteredCount: countEntered(entries, config), updatedAt: new Date() });
}

/** Whether the section's internal marks are already submitted (CEA marks then can't change). */
export async function internalSubmitted(db: Db, collegeId: string, assignmentId: string): Promise<boolean> {
  const s = await ceaRefs(db, collegeId).college.collection("internalExamMarks").doc(assignmentId).get();
  return s.exists && (s.data() as InternalExamMarksBatch).status === "SUBMITTED";
}
