import type { Firestore } from "firebase-admin/firestore";
import type { Section, TeachingAssignment } from "@/types";
import type { MidMarksSheet } from "@/types/midMarks";
import { loadMidSettings } from "@/lib/exams/midSettings";
import { questionSheetsFor } from "@/lib/exams/questionMarksServer";
import type { QuestionSheet } from "@/lib/exams/questionMarks";
import { isFacultyEntryOpen, loadMode, modeDocId, modesCol } from "@/lib/exams/midMarksEntryServer";
import { courseKeyForSubject, loadSubject } from "@/lib/midBank/server";
import { sectionRoster } from "@/lib/exams/sectionRoster";
import { sortStudentsForList } from "@/lib/students/listOrder";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { istDateKey } from "@/lib/attendance/istTime";
import { editableDepartmentNames, getHodDepartmentScope } from "@/lib/departments/scope";
import { completeCount, MidMarksError, reconcileRoster, withinLastDate } from "./sheet";

// Server side of Faculty > Mid Marks (types/midMarks.ts): which sections a faculty member enters, where each one's
// entry stands (paper printed, opened by the Exam Cell after the exam, last date), and the sheet itself.

type Db = Firestore;
const college = (db: Db, c: string) => db.collection("colleges").doc(c);
export const midMarksSheetsCol = (db: Db, c: string) => college(db, c).collection("midMarksSheets");
export const midMarksSheetId = (assignmentId: string, mid: number) => `${assignmentId}__m${mid}`;
export const SHEET_ID_RE = /^[A-Za-z0-9_-]{1,200}__m\d{1,2}$/;

/** The Mid Marks page is on for this college (Exam Cell > Mid Configuration > Marks Entry). */
export async function assertMidMarksPage(db: Db, c: string): Promise<{ midCount: number }> {
  const s = await loadMidSettings(db, c);
  if (!s.midMarksPage) throw new MidMarksError("Mid marks entry is not turned on for this college.", 404);
  return { midCount: s.midCount || 2 };
}

/** The Exam Cell's last date for a course + Mid (YYYY-MM-DD), or null. */
export async function lastDateFor(db: Db, c: string, courseKey: string, mid: number): Promise<string | null> {
  const snap = await modesCol(db, c).doc(modeDocId(courseKey, mid)).get();
  const v = (snap.data() as { lastDate?: string } | undefined)?.lastDate;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export interface EntryState {
  /** The printed paper exists for this section's branch (else nothing to enter against). */
  hasPaper: boolean;
  /** The Exam Cell enters this Mid itself (Marks Entry = Uploaded by Exam Cell). */
  examCellMode: boolean;
  /** The Exam Cell opened faculty entry for the subject (after its exam). */
  open: boolean;
  lastDate: string | null;
  /** Can the faculty change marks now. */
  canEdit: boolean;
  /** Why not, in a sentence (empty when they can). */
  reason: string;
}

interface Ctx {
  a: TeachingAssignment & { id: string };
  section: Section & { id: string };
  courseKey: string;
}

async function contextFor(db: Db, c: string, assignmentId: string): Promise<Ctx> {
  const aSnap = await college(db, c).collection("teachingAssignments").doc(assignmentId).get();
  if (!aSnap.exists) throw new MidMarksError("Teaching assignment not found. It may have been deleted.", 404);
  const a = { ...(aSnap.data() as TeachingAssignment), id: aSnap.id };
  if (a.isPast) throw new MidMarksError("This teaching assignment is no longer current.", 409);
  if (!a.sectionId) throw new MidMarksError("This teaching assignment has no section. Ask the HOD to fix it.", 409);
  const sSnap = await college(db, c).collection("sections").doc(a.sectionId).get();
  if (!sSnap.exists) throw new MidMarksError("Section not found. It may have been deleted.", 404);
  const section = { ...(sSnap.data() as Section), id: sSnap.id };
  const subject = await loadSubject(db, c, a.subjectId);
  const courseKey = subject ? await courseKeyForSubject(db, c, subject) : "";
  return { a, section, courseKey };
}

async function paperSheet(db: Db, c: string, ctx: Ctx, mid: number): Promise<QuestionSheet | null> {
  const probe = await questionSheetsFor(db, c, { subjectId: ctx.a.subjectId, department: ctx.section.department, year: ctx.section.year, sectionId: ctx.section.id }, {
    components: [{ id: "mid", name: "", maxMarks: 1, isActive: true, midNumber: mid } as never],
  });
  const s = probe.mid;
  return s && s.source === "CHOSEN" ? s : null;
}

async function stateFor(db: Db, c: string, ctx: Ctx, mid: number, hasPaper: boolean, submitted: boolean): Promise<EntryState> {
  const [mode, open, lastDate] = await Promise.all([
    ctx.courseKey ? loadMode(db, c, ctx.courseKey, mid) : Promise.resolve("FACULTY" as const),
    isFacultyEntryOpen(db, c, ctx.courseKey, ctx.section.year, ctx.a.timetableSemester, mid, ctx.a.subjectId),
    ctx.courseKey ? lastDateFor(db, c, ctx.courseKey, mid) : Promise.resolve(null),
  ]);
  const examCellMode = mode === "EXAM_CELL";
  const reason = !hasPaper ? "The Exam Cell has not printed this subject's paper for your branch yet."
    : examCellMode ? "The Exam Cell enters this Mid's marks."
    : !open ? "Opens once the Exam Cell opens entry after the exam."
    : !withinLastDate(istDateKey(), lastDate) ? `The last date (${lastDate!.split("-").reverse().join("/")}) has passed. Ask the Exam Cell to reopen.`
    : submitted ? "Submitted. Ask the Exam Cell to reopen it for changes."
    : "";
  return { hasPaper, examCellMode, open, lastDate, canEdit: !reason, reason };
}

/** Faculty > Mid Marks list: every current section + subject the login teaches x each Mid with a printed paper. */
export async function myMidClasses(db: Db, c: string, uid: string) {
  const { midCount } = await assertMidMarksPage(db, c);
  const me = await resolveFacultyMemberId(db, c, uid);
  const tas = (await college(db, c).collection("teachingAssignments").where("facultyId", "==", me).get()).docs
    .map((d) => ({ ...(d.data() as TeachingAssignment), id: d.id }))
    .filter((a) => !a.isPast && a.sectionId && a.subjectId);
  const out: {
    assignmentId: string; subjectCode?: string; subjectName: string; sectionName: string; department: string; year?: number; midNumber: number;
    sheetId: string; status: "NOT_STARTED" | "DRAFT" | "SUBMITTED"; complete: number; total: number; paperMax: number; state: EntryState;
  }[] = [];
  for (const a of tas) {
    let ctx: Ctx;
    try { ctx = await contextFor(db, c, a.id); } catch { continue; }
    for (let mid = 1; mid <= midCount; mid++) {
      const sheet = await paperSheet(db, c, ctx, mid);
      if (!sheet) continue;
      const id = midMarksSheetId(a.id, mid);
      const saved = (await midMarksSheetsCol(db, c).doc(id).get()).data() as MidMarksSheet | undefined;
      out.push({
        assignmentId: a.id, subjectCode: a.subjectCode, subjectName: a.subjectName, sectionName: ctx.section.name, department: ctx.section.department,
        year: ctx.section.year, midNumber: mid, sheetId: id, status: saved?.status ?? "NOT_STARTED",
        complete: saved?.completeCount ?? 0, total: saved?.totalStudents ?? 0, paperMax: (saved?.sheet ?? sheet).paperMax,
        state: await stateFor(db, c, ctx, mid, true, saved?.status === "SUBMITTED"),
      });
    }
  }
  return out.sort((x, y) => x.midNumber - y.midNumber || x.subjectName.localeCompare(y.subjectName) || x.sectionName.localeCompare(y.sectionName));
}

/** The faculty member the assignment belongs to (Mid marks are entered only by them). */
export async function assertOwner(db: Db, c: string, uid: string, facultyId: string) {
  if (facultyId !== (await resolveFacultyMemberId(db, c, uid))) throw new MidMarksError("You are not assigned to teach this section.", 403);
}

/** Opens a section's sheet for a Mid: created from the printed paper, or a draft re-listed from the roster. */
export async function openSheet(db: Db, c: string, uid: string, byName: string, assignmentId: string, mid: number) {
  const { midCount } = await assertMidMarksPage(db, c);
  if (!Number.isInteger(mid) || mid < 1 || mid > midCount) throw new MidMarksError("Select a Mid.");
  const ctx = await contextFor(db, c, assignmentId);
  await assertOwner(db, c, uid, ctx.a.facultyId);
  const ref = midMarksSheetsCol(db, c).doc(midMarksSheetId(assignmentId, mid));
  const current = (await ref.get()).data() as MidMarksSheet | undefined;
  const paper = current?.sheet ?? (await paperSheet(db, c, ctx, mid));
  if (!paper) throw new MidMarksError("The Exam Cell has not printed this subject's Mid-" + mid + " paper for your branch yet.", 409);
  const state = await stateFor(db, c, ctx, mid, true, current?.status === "SUBMITTED");
  // Nothing is written while entry is closed: a saved sheet is shown as it is, an unopened one only as the paper.
  if (!state.canEdit) return { sheet: current ?? null, state, paper };

  const roster = sortStudentsForList(await sectionRoster(college(db, c), { department: ctx.section.department, sectionName: ctx.section.name, courseId: ctx.section.courseId ?? ctx.a.courseId ?? "", year: ctx.section.year }))
    .map((s) => ({ id: s.id as string, rollNumber: s.rollNumber ?? "", name: s.name ?? "" }));
  const at = new Date().toISOString();
  const sheet = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() as MidMarksSheet) : null;
    if (cur?.status === "SUBMITTED") return cur;
    const entries = reconcileRoster(paper, cur?.entries ?? [], roster);
    const next: MidMarksSheet = {
      id: ref.id, assignmentId, subjectId: ctx.a.subjectId, ...(ctx.a.subjectCode ? { subjectCode: ctx.a.subjectCode } : {}), subjectName: ctx.a.subjectName,
      department: ctx.section.department, sectionId: ctx.section.id, sectionName: ctx.section.name, courseId: ctx.section.courseId ?? ctx.a.courseId ?? "",
      courseKey: ctx.courseKey, ...(ctx.section.year != null ? { year: ctx.section.year } : {}),
      ...(ctx.a.timetableSemester != null ? { semester: ctx.a.timetableSemester } : {}), midNumber: mid,
      facultyId: ctx.a.facultyId, facultyName: ctx.a.facultyName ?? byName, sheet: paper, entries, totalStudents: entries.length,
      completeCount: completeCount(paper, entries), status: "DRAFT", rev: cur?.rev ?? 1,
      createdAt: cur?.createdAt ?? at, updatedAt: cur?.updatedAt ?? at, updatedByName: cur?.updatedByName ?? byName,
      ...(cur?.history ? { history: cur.history } : {}),
    };
    const changed = !cur || JSON.stringify(cur.entries.map((e) => e.studentId)) !== JSON.stringify(entries.map((e) => e.studentId));
    if (changed) tx.set(ref, next);
    return changed ? next : cur!;
  });
  return { sheet, state, paper };
}

/** The entry state of a saved sheet (re-checked on every save). */
export async function stateOfSheet(db: Db, c: string, sheet: MidMarksSheet): Promise<EntryState> {
  const ctx = await contextFor(db, c, sheet.assignmentId);
  return stateFor(db, c, ctx, sheet.midNumber, true, sheet.status === "SUBMITTED");
}

/** Read access: the sheet's faculty, an HOD of its department, the Exam Cell, Principal / VP, Super Admin. */
export async function assertReader(db: Db, c: string, session: { uid: string; role: string }, sheet: MidMarksSheet) {
  if (["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"].includes(session.role)) return;
  const me = await resolveFacultyMemberId(db, c, session.uid).catch(() => "");
  if (me && me === sheet.facultyId) return;
  if (session.role === "HOD" && editableDepartmentNames(await getHodDepartmentScope(db, c, session.uid)).includes(sheet.department)) return;
  throw new MidMarksError("You do not have access to this sheet.", 403);
}
