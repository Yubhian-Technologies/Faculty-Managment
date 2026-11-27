import type { ExamConfiguration, InternalExamMarksBatch } from "@/types";
import { courseKeyForSubject, loadSubject } from "@/lib/midBank/server";
import { resolveExamConfigForBatch } from "@/lib/exams/internalExamMarks";
import { questionSheetsFor } from "@/lib/exams/questionMarksServer";
import type { QuestionSheet } from "@/lib/exams/questionMarks";
import type { MidSheetFormat } from "@/types/midMarks";
import { coPendingCount } from "@/lib/midMarks/format";
import { dropCoveredSections } from "./midProgressRows";
import { entryStateFor, sheetFromLayout, MID_MARKS_MODES, type MidEntryState, type MidMarksLayout, type MidMarksMode } from "@/lib/exams/midMarksEntry";

// Storage behind midMarksEntry.ts:
//   colleges/{c}/midMarksEntry/{courseKey}__m{mid}                  { courseKey, courseName, midNumber, mode, updatedAt, updatedByName }
//   colleges/{c}/midMarksLayouts/{subjectId}__{branch}__m{mid}      { subjectId, branch, midNumber, questions, paperMax, ... }
//   internalExamMarks/{id}.examCellLocks[componentId]               { at, byName } - the Exam Cell submitted that Mid's marks

type Db = FirebaseFirestore.Firestore;
const college = (db: Db, c: string) => db.collection("colleges").doc(c);
const safe = (s: string) => s.replace(/[/\s]+/g, "-").slice(0, 200);

export const modeDocId = (courseKey: string, mid: number) => safe(`${courseKey}__m${mid}`);
export const layoutDocId = (subjectId: string, branch: string, mid: number) => safe(`${subjectId}__${branch}__m${mid}`);

export const modesCol = (db: Db, c: string) => college(db, c).collection("midMarksEntry");
/** colleges/{c}/midMarksOpen/{planId}__{subjectId}: { courseKey, year, semester, midNumber, subjectId, open, ... } -
 *  faculty entry of that SUBJECT's Mid marks is open; the Exam Cell opens it after that subject's exam. */
export const openCol = (db: Db, c: string) => college(db, c).collection("midMarksOpen");
export const openDocId = (planId: string, subjectId: string) => safe(`${planId}__${subjectId}`);

/** Faculty entry of the subject's Mid is open for this course + year (+ semester when known: else any open one of the year). */
export async function isFacultyEntryOpen(db: Db, c: string, courseKey: string, year: number | undefined, semester: number | undefined, mid: number, subjectId: string): Promise<boolean> {
  if (!courseKey || year == null) return false;
  const snap = await openCol(db, c).where("subjectId", "==", subjectId).where("courseKey", "==", courseKey).where("year", "==", year).where("midNumber", "==", mid).get();
  return snap.docs.some((d) => {
    const o = d.data() as { open?: boolean; semester?: number };
    return o.open === true && (semester == null || o.semester === semester);
  });
}
export const layoutsCol = (db: Db, c: string) => college(db, c).collection("midMarksLayouts");

export async function loadMode(db: Db, c: string, courseKey: string, mid: number): Promise<MidMarksMode> {
  const snap = await modesCol(db, c).doc(modeDocId(courseKey, mid)).get();
  const m = (snap.data() as { mode?: string } | undefined)?.mode;
  return MID_MARKS_MODES.includes(m as MidMarksMode) ? (m as MidMarksMode) : "FACULTY";
}

export async function loadLayout(db: Db, c: string, subjectId: string, branch: string, mid: number): Promise<MidMarksLayout | null> {
  const snap = await layoutsCol(db, c).doc(layoutDocId(subjectId, branch, mid)).get();
  const d = snap.data() as MidMarksLayout | undefined;
  return d?.questions?.length ? { questions: d.questions, paperMax: d.paperMax } : null;
}

/**
 * For one marks batch: the question sheet of each Mid-linked component (finalized paper, else the Exam Cell's
 * layout - see questionSheetsFor) and where its entry stands (who enters, open or not, locked by the Exam Cell).
 */
export async function midEntryFor(
  db: Db, c: string,
  batch: Pick<InternalExamMarksBatch, "subjectId" | "department" | "year"> & { sectionId?: string; examCellLocks?: Record<string, unknown>; assignmentId?: string; semester?: number },
  config: Pick<ExamConfiguration, "components">,
): Promise<{ sheets: Record<string, QuestionSheet>; states: Record<string, MidEntryState> }> {
  const linked = config.components.filter((x) => x.isActive && x.midNumber);
  if (!linked.length) return { sheets: {}, states: {} };
  const subject = await loadSubject(db, c, batch.subjectId);
  const courseKey = subject ? await courseKeyForSubject(db, c, subject) : "";
  const [sheets, modes] = await Promise.all([
    questionSheetsFor(db, c, batch, config),
    Promise.all(linked.map((x) => (courseKey ? loadMode(db, c, courseKey, x.midNumber!) : Promise.resolve<MidMarksMode>("FACULTY")))),
  ]);
  // Exam Cell mode: the Exam Cell's own questions + max marks (set with the upload) - never the printed paper's.
  await Promise.all(linked.map(async (x, i) => {
    if (modes[i] !== "EXAM_CELL") return;
    const layout = await loadLayout(db, c, batch.subjectId, batch.department, x.midNumber!);
    if (layout) sheets[x.id] = sheetFromLayout(layout); else delete sheets[x.id];
  }));
  // Which Mid timetable the section's marks belong to: the assignment's own semester (course-year timings).
  let semester = batch.semester;
  if (semester == null && batch.assignmentId) {
    semester = ((await college(db, c).collection("teachingAssignments").doc(batch.assignmentId).get()).data() as { timetableSemester?: number } | undefined)?.timetableSemester;
  }
  const opens = await Promise.all(linked.map((x, i) => (modes[i] === "FACULTY" ? isFacultyEntryOpen(db, c, courseKey, batch.year, semester, x.midNumber!, batch.subjectId) : Promise.resolve(true))));
  const states: Record<string, MidEntryState> = {};
  linked.forEach((x, i) => { states[x.id] = entryStateFor(x.midNumber!, modes[i], !!sheets[x.id], !!batch.examCellLocks?.[x.id], opens[i]); });
  return { sheets, states };
}

/**
 * Whether any marks are entered for Mid `mid` of a course (any section's batch, any subject): a component with that
 * midNumber (exam configurations of the course + marks categories) holding a value. Who enters can't change then.
 */
export async function midMarksExist(db: Db, c: string, courseIds: string[], mid: number): Promise<boolean> {
  if (!courseIds.length) return false;
  const ref = college(db, c);
  const compIds = new Set<string>();
  const [cats, ...cfgSnaps] = await Promise.all([
    ref.collection("examMarksCategories").get(),
    ...chunk(courseIds, 30).map((ids) => ref.collection("examConfigurations").where("courseId", "in", ids).get()),
  ]);
  for (const d of [...cats.docs, ...cfgSnaps.flatMap((s) => s.docs)]) {
    for (const comp of ((d.data() as { components?: { id: string; midNumber?: number }[] }).components ?? [])) {
      if (comp.midNumber === mid) compIds.add(comp.id);
    }
  }
  if (!compIds.size) return false;
  for (const ids of chunk(courseIds, 30)) {
    const snap = await ref.collection("internalExamMarks").where("courseId", "in", ids).get();
    for (const d of snap.docs) {
      const b = d.data() as InternalExamMarksBatch;
      if (b.entries?.some((e) => [...compIds].some((cid) => e.componentMarks?.[cid] != null || !!e.questionMarks?.[cid]))) return true;
    }
  }
  return false;
}

function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

/** Marks of Mid `mid` entered for a subject in a branch (any section): its question layout can't change then. */
export async function subjectMidMarksExist(db: Db, c: string, subjectId: string, branch: string, mid: number): Promise<boolean> {
  const ref = college(db, c);
  const snap = await ref.collection("internalExamMarks").where("subjectId", "==", subjectId).get();
  for (const d of snap.docs) {
    const b = d.data() as InternalExamMarksBatch;
    if (b.department !== branch || !b.entries?.length) continue;
    const resolved = await resolveExamConfigForBatch(db, ref, b);
    const ids = (resolved?.config.components ?? []).filter((x) => x.midNumber === mid).map((x) => x.id);
    if (b.entries.some((e) => ids.some((cid) => e.componentMarks?.[cid] != null || !!e.questionMarks?.[cid]))) return true;
  }
  return false;
}

/** The sheet a Mid's marks use for a subject + branch, and where it comes from (for the Exam Cell's overview). */
export async function sheetSourceFor(db: Db, c: string, subjectId: string, branch: string, year: number, mid: number, mode: MidMarksMode)
  : Promise<{ source: "PAPER" | "LAYOUT" | "NONE"; layout: MidMarksLayout | null; paperMax?: number; questions?: number }> {
  const layout = await loadLayout(db, c, subjectId, branch, mid);
  if (mode === "FACULTY") {
    const probe = await questionSheetsFor(db, c, { subjectId, department: branch, year }, { components: [{ id: "probe", name: "", maxMarks: 1, isActive: true, midNumber: mid } as never] });
    const sheet = probe.probe;
    if (sheet?.source === "CHOSEN") return { source: "PAPER", layout, paperMax: sheet.paperMax, questions: sheet.columns.length };
  }
  return layout ? { source: "LAYOUT", layout, paperMax: layout.paperMax, questions: layout.questions.length } : { source: "NONE", layout: null };
}

/** The subject's exam day in a Mid timetable: its latest date across the branches' timetables, else the Mid's last day. */
export async function subjectExamDay(db: Db, c: string, plan: { id: string; days?: string[] }, subjectId: string): Promise<string | null> {
  const snap = await college(db, c).collection("midTimetables").where("planId", "==", plan.id).get();
  const dates = snap.docs.flatMap((d) => ((d.data() as { slots?: { subjectId: string; date: string }[] }).slots ?? []).filter((s) => s.subjectId === subjectId).map((s) => s.date));
  return [...dates].sort().pop() ?? [...(plan.days ?? [])].sort().pop() ?? null;
}

export interface SectionProgress {
  sectionId: string; section: string; facultyId: string; facultyName: string; assignmentId: string | null;
  /** Students with this Mid's marks entered, out of the section's total. */
  entered: number; total: number;
  status: "NOT_STARTED" | "DRAFT" | "SUBMITTED" | "FROZEN";
  /** A faculty change request is waiting for the Exam Cell (Mid Marks page sheets). */
  changeRequested?: boolean;
  /** The Exam Cell locked this Mid's marks (Exam Cell mode). */
  locked: boolean;
  /** Entered on Faculty > Mid Marks (lib/midMarks): its sheet id, to open it. */
  sheetId?: string;
  /** Mid exam format sheets: question boxes still without a CO, and whether the Exam Cell uploaded the marks. */
  coPending?: number;
  formatSheet?: boolean;
  uploaded?: boolean;
}

/**
 * Per section of each subject + branch: how far this Mid's marks are (entered / total, the faculty's sheet status,
 * Exam Cell lock). Keyed `${subjectId}|${branch}`. One read per section's marks sheet plus its configuration.
 */
export async function midProgress(
  db: Db, c: string, mid: number,
  rows: { subjectId: string; branch: string; sectionId: string; sectionName: string; facultyId: string; facultyName: string }[],
): Promise<Map<string, SectionProgress[]>> {
  const ref = college(db, c);
  const subjectIds = [...new Set(rows.map((r) => r.subjectId))];
  const assignmentOf = new Map<string, string>();
  for (let i = 0; i < subjectIds.length; i += 30) {
    const snap = await ref.collection("teachingAssignments").where("subjectId", "in", subjectIds.slice(i, i + 30)).get();
    for (const d of snap.docs) {
      const a = d.data() as { isPast?: boolean; sectionId?: string; subjectId: string; facultyId?: string };
      if (a.isPast || !a.sectionId) continue;
      assignmentOf.set(`${a.subjectId}|${a.sectionId}|${a.facultyId}`, d.id);
    }
  }
  const ids = [...new Set(rows.map((r) => assignmentOf.get(`${r.subjectId}|${r.sectionId}|${r.facultyId}`)).filter((x): x is string => !!x))];
  const snaps = ids.length ? await db.getAll(...ids.map((id) => ref.collection("internalExamMarks").doc(id))) : [];
  const batches = new Map(snaps.filter((s) => s.exists).map((s) => [s.id, { ...(s.data() as InternalExamMarksBatch & { examCellLocks?: Record<string, unknown> }), id: s.id }]));
  const compOf = new Map<string, string | null>();
  await Promise.all([...batches.values()].map(async (b) => {
    const resolved = await resolveExamConfigForBatch(db, ref, b);
    compOf.set(b.id, resolved?.config.components.find((x) => x.isActive && x.midNumber === mid)?.id ?? null);
  }));
  // Faculty > Mid Marks sheets (lib/midMarks) - used for a section when one exists.
  const pageSnaps = ids.length ? await db.getAll(...ids.map((id) => ref.collection("midMarksSheets").doc(`${id}__m${mid}`))) : [];
  const pageSheets = new Map(pageSnaps.filter((s) => s.exists).map((s) => [String(s.get("assignmentId")), s.data() as { status: "DRAFT" | "SUBMITTED" | "FROZEN"; completeCount: number; totalStudents: number; changeRequest?: { status: string }; format?: MidSheetFormat; enteredBy?: unknown }]));
  const out = new Map<string, SectionProgress[]>();
  for (const r of rows) {
    const aid = assignmentOf.get(`${r.subjectId}|${r.sectionId}|${r.facultyId}`) ?? null;
    const page = aid ? pageSheets.get(aid) : undefined;
    if (page) {
      const key = `${r.subjectId}|${r.branch}`;
      const p: SectionProgress = { sectionId: r.sectionId, section: r.sectionName, facultyId: r.facultyId, facultyName: r.facultyName, assignmentId: aid,
        entered: page.completeCount, total: page.totalStudents, status: page.status, locked: false, sheetId: `${aid}__m${mid}`,
        ...(page.changeRequest?.status === "PENDING" ? { changeRequested: true } : {}),
        ...(page.format ? { formatSheet: true, coPending: coPendingCount(page.format), uploaded: !!page.enteredBy } : {}) };
      out.set(key, [...(out.get(key) ?? []), p].sort((x, y) => x.section.localeCompare(y.section)));
      continue;
    }
    const b = aid ? batches.get(aid) : undefined;
    const cid = b ? compOf.get(b.id) : null;
    const p: SectionProgress = {
      sectionId: r.sectionId, section: r.sectionName, facultyId: r.facultyId, facultyName: r.facultyName, assignmentId: aid,
      entered: b && cid ? b.entries.filter((e) => e.componentMarks?.[cid] != null).length : 0,
      total: b ? b.entries.length : 0,
      status: !b ? "NOT_STARTED" : b.status === "SUBMITTED" ? "SUBMITTED" : "DRAFT",
      locked: !!(b && cid && b.examCellLocks?.[cid]),
    };
    const key = `${r.subjectId}|${r.branch}`;
    out.set(key, [...(out.get(key) ?? []), p].sort((x, y) => x.section.localeCompare(y.section)));
  }
  // A section taught by two faculty: its marks are on one sheet - the other faculty's empty row is left out.
  for (const [k, list] of out) out.set(k, dropCoveredSections(list));
  return out;
}
