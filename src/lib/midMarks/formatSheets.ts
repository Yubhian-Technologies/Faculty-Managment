import type { Firestore } from "firebase-admin/firestore";
import type { MidFormatComponent, MidMarksEntry, MidMarksSheet, MidSectionQuestion } from "@/types/midMarks";
import { contextFor, midMarksSheetId, midMarksSheetsCol, rosterOf } from "./server";
import { formatSheetFields, sheetHasMarks } from "./formatServer";
import { completeCount, entryTotal, MidMarksError } from "./sheet";
import { keepCos, sheetFromFormat } from "./format";
import type { StudentMarks } from "./fileUpload";

// Writes a format sheet (lib/midMarks/format.ts) - the Exam Cell setting a section's questions + COs, or uploading
// its marks file. One transaction per sheet; a FROZEN sheet takes CO changes only (an upload needs a reopen first).

type Db = Firestore;

export interface WriteFormatSheet {
  assignmentId: string;
  mid: number;
  byName: string;
  components: MidFormatComponent[];
  /** Cleaned questions per QUESTIONS component. */
  questions: Record<string, MidSectionQuestion[]>;
  /** An upload: the file's students (by Regd. No) replace those students' marks; the sheet goes to SUBMITTED. */
  upload?: { students: StudentMarks[]; fileName: string };
}

export async function writeFormatSheet(db: Db, c: string, w: WriteFormatSheet): Promise<{ sheet: MidMarksSheet; created: boolean }> {
  const ctx = await contextFor(db, c, w.assignmentId);
  const roster = await rosterOf(db, c, ctx);
  const ref = midMarksSheetsCol(db, c).doc(midMarksSheetId(w.assignmentId, w.mid));
  const at = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() as MidMarksSheet) : null;
    if (cur && !cur.format) throw new MidMarksError("This section's Mid marks are entered against the printed paper, not the Mid exam format.", 409);
    // Questions: an upload brings its own (keeping the COs already set where the questions are the same).
    const questions = Object.fromEntries(Object.entries(w.questions).map(([id, qs]) => [id, w.upload ? keepCos(qs, cur?.format?.questions[id]) : qs]));
    const format = { components: w.components, questions };
    const history = (action: "UPLOADED" | "QUESTIONS_SET", reason?: string) =>
      [...(cur?.history ?? []), { at, byName: w.byName, action, ...(reason ? { reason } : {}) }].slice(-30);

    let fields: ReturnType<typeof formatSheetFields>;
    if (w.upload) {
      if (cur?.status === "FROZEN") throw new MidMarksError("Frozen. Reopen it before uploading again.", 409);
      const sheet = sheetFromFormat(format);
      const sameKeys = !!cur && cur.sheet.columns.map((x) => x.key).join() === sheet.columns.map((x) => x.key).join();
      const byRoll = new Map(w.upload.students.map((s) => [s.roll, s]));
      const curById = new Map((cur?.entries ?? []).map((e) => [e.studentId, e]));
      const missing = [...byRoll.keys()].filter((r) => !roster.some((s) => s.rollNumber.trim().toUpperCase() === r));
      if (missing.length) throw new MidMarksError(`Not in Section ${ctx.section.name}: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " ..." : ""}.`, 409);
      const entries: MidMarksEntry[] = roster.map((s) => {
        const f = byRoll.get(s.rollNumber.trim().toUpperCase());
        const prev = curById.get(s.id);
        if (!f) {
          if (prev && !sameKeys && sheetHasMarks({ entries: [prev] })) throw new MidMarksError(`${s.rollNumber} has marks on the sheet but is not in the file, and the file's questions differ. Add the student to the file.`, 409);
          return prev && sameKeys ? { ...prev, rollNumber: s.rollNumber, name: s.name } : { studentId: s.id, rollNumber: s.rollNumber, name: s.name, q: Object.fromEntries(sheet.columns.map((x) => [x.key, null])), total: null };
        }
        const e: MidMarksEntry = { studentId: s.id, rollNumber: s.rollNumber, name: s.name, q: f.absent ? Object.fromEntries(sheet.columns.map((x) => [x.key, null])) : f.q, total: null,
          ...(f.absent ? { absent: true } : {}), ...(f.abParts.length ? { abParts: f.abParts } : {}) };
        return { ...e, total: entryTotal(sheet, e) };
      });
      fields = { sheet, format, entries, totalStudents: entries.length, completeCount: completeCount(sheet, entries) };
    } else {
      fields = formatSheetFields(format, cur, roster);
    }

    const base = {
      id: ref.id, assignmentId: w.assignmentId, subjectId: ctx.a.subjectId, ...(ctx.a.subjectCode ? { subjectCode: ctx.a.subjectCode } : {}), subjectName: ctx.a.subjectName,
      department: ctx.section.department, sectionId: ctx.section.id, sectionName: ctx.section.name, courseId: ctx.section.courseId ?? ctx.a.courseId ?? "",
      courseKey: ctx.courseKey, ...(ctx.section.year != null ? { year: ctx.section.year } : {}),
      ...(ctx.a.timetableSemester != null ? { semester: ctx.a.timetableSemester } : {}), midNumber: w.mid,
      facultyId: ctx.a.facultyId, facultyName: ctx.a.facultyName ?? "",
    };
    const next: MidMarksSheet = {
      ...(cur ?? {}), ...base, ...fields,
      status: cur?.status ?? "DRAFT", rev: (cur?.rev ?? 0) + 1, createdAt: cur?.createdAt ?? at, updatedAt: at, updatedByName: w.byName,
      history: history(w.upload ? "UPLOADED" : "QUESTIONS_SET", w.upload?.fileName),
    };
    if (w.upload) {
      next.status = "SUBMITTED";
      next.submittedAt = at;
      next.enteredBy = { kind: "EXAM_CELL", byName: w.byName, at, fileName: w.upload.fileName };
      delete next.editGrant;
    }
    tx.set(ref, next);
    return { sheet: next, created: !cur };
  });
}
