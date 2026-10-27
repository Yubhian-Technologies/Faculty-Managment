import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import type { MentoringEntry } from "@/types/mentoring";

// Where the Student Mentoring Record keeps what the mentor writes - server only.
//   students/{id}/mentoringEntries/{entryId}    one row of a table / list (recordSections.ts)
//   students/{id}/mentoringProfile/record       { overrides: { key: value } } details the mentor filled in
//   students/{id}/mentoringSemesters/{n}        a semester's subject copy + the mentor's remarks (semesterSnapshot.ts)

const studentRef = (db: Firestore, collegeId: string, studentId: string) =>
  db.collection("colleges").doc(collegeId).collection("students").doc(studentId);

export const entriesCol = (db: Firestore, collegeId: string, studentId: string) =>
  studentRef(db, collegeId, studentId).collection("mentoringEntries");

export const profileDocRef = (db: Firestore, collegeId: string, studentId: string) =>
  studentRef(db, collegeId, studentId).collection("mentoringProfile").doc("record");

type Stamp = { toDate?: () => Date } | undefined;
const iso = (t: Stamp) => t?.toDate?.().toISOString() ?? null;

export function toEntry(doc: DocumentSnapshot): MentoringEntry {
  const d = (doc.data() ?? {}) as {
    section?: string; semester?: number | null; values?: Record<string, string | boolean | string[]>;
    createdByName?: string; createdAt?: Stamp; updatedAt?: Stamp;
  };
  return {
    id: doc.id,
    section: d.section ?? "",
    semester: typeof d.semester === "number" ? d.semester : null,
    values: d.values ?? {},
    createdByName: d.createdByName ?? "",
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  };
}

/** The details the mentor filled in for fields the student's own record leaves blank. */
export async function loadProfileOverrides(db: Firestore, collegeId: string, studentId: string): Promise<Record<string, string>> {
  const snap = await profileDocRef(db, collegeId, studentId).get();
  const raw = (snap.data() as { overrides?: Record<string, unknown> } | undefined)?.overrides ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v.trim()) out[k] = v;
  return out;
}
