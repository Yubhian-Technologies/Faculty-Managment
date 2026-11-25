import type { Firestore } from "firebase-admin/firestore";
import type { Subject } from "@/types";
import type { MidExamFormat, MidFormatComponent, MidMarksSheet, MidSheetFormat } from "@/types/midMarks";
import { courseKeyForSubject, loadSubject } from "@/lib/midBank/server";
import { completeCount, MidMarksError, reconcileRoster } from "./sheet";
import { sheetFromFormat } from "./format";

// Storage of the Mid exam format (lib/midMarks/format.ts):
//   colleges/{c}/midExamFormats/{courseKey}__{REG|ALL}   MidExamFormat
// A subject takes, in order: its own components on its course + regulation format, that format's components, the
// course's "ALL" format. No format = the printed-paper flow (Faculty Mid Marks against the Exam Cell's paper).

type Db = Firestore;
const college = (db: Db, c: string) => db.collection("colleges").doc(c);
export const formatsCol = (db: Db, c: string) => college(db, c).collection("midExamFormats");
export const formatDocId = (courseKey: string, regulation: string) => `${courseKey}__${(regulation || "ALL").toUpperCase()}`.replace(/[/\s]+/g, "-").slice(0, 300);

export interface SubjectFormat { format: MidExamFormat; components: MidFormatComponent[]; courseKey: string }

/** The format a subject's Mid marks follow, or null (printed-paper flow). */
export async function formatForSubject(db: Db, c: string, subjectOrId: string | Subject | null): Promise<SubjectFormat | null> {
  const subject = typeof subjectOrId === "string" ? await loadSubject(db, c, subjectOrId) : subjectOrId;
  if (!subject) return null;
  const courseKey = await courseKeyForSubject(db, c, subject);
  if (!courseKey) return null;
  const reg = String(subject.regulation ?? "").trim().toUpperCase();
  const ids = [...new Set([reg ? formatDocId(courseKey, reg) : "", formatDocId(courseKey, "ALL")].filter(Boolean))];
  const snaps = await db.getAll(...ids.map((id) => formatsCol(db, c).doc(id)));
  const doc = snaps.find((s) => s.exists);
  if (!doc) return null;
  const format = { ...(doc.data() as Omit<MidExamFormat, "id">), id: doc.id } as MidExamFormat;
  const own = format.subjectFormats?.[subject.id];
  return { format, components: own?.components ?? format.components, courseKey };
}

/** Per-request cache of formatForSubject (many sections share a subject). */
export function formatCache(db: Db, c: string) {
  const m = new Map<string, Promise<SubjectFormat | null>>();
  return (subjectId: string) => {
    if (!m.has(subjectId)) m.set(subjectId, formatForSubject(db, c, subjectId));
    return m.get(subjectId)!;
  };
}

/** Any marks on a sheet (a box filled or a student absent) - then its questions can't change. */
export const sheetHasMarks = (s: Pick<MidMarksSheet, "entries">) =>
  s.entries.some((e) => e.absent || (e.abParts?.length ?? 0) > 0 || Object.values(e.q).some((v) => v != null));

/** A format sheet's fields for a section (new, or keeping a current one's marks when the shape allows). */
export function formatSheetFields(format: MidSheetFormat, cur: MidMarksSheet | null, roster: { id: string; rollNumber: string; name: string }[]) {
  const sheet = sheetFromFormat(format);
  const keep = cur && cur.sheet.columns.map((x) => x.key).join() === sheet.columns.map((x) => x.key).join();
  if (cur && !keep && sheetHasMarks(cur)) throw new MidMarksError("Marks are already entered against other questions. The questions can't change now.", 409);
  const entries = reconcileRoster(sheet, keep ? cur!.entries : [], roster);
  return { sheet, format, entries, totalStudents: entries.length, completeCount: completeCount(sheet, entries) };
}

/** The COs of the subject's frozen syllabus (CO1, CO2 ...), else CO1-CO6. */
export async function coOptionsFor(db: Db, c: string, subjectId: string): Promise<{ id: string; statement: string }[]> {
  const s = (await college(db, c).collection("subjectSyllabus").doc(subjectId).get()).data() as { status?: string; cos?: { id: string; statement?: string }[] } | undefined;
  if (s?.status === "FROZEN" && s.cos?.length) return s.cos.map((x) => ({ id: x.id.toUpperCase(), statement: x.statement ?? "" }));
  return Array.from({ length: 6 }, (_, i) => ({ id: `CO${i + 1}`, statement: "" }));
}
