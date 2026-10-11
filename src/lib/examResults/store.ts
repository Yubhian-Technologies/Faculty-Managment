// Firestore locations and lookups for semester results - server only.

import type { Firestore } from "firebase-admin/firestore";
import type { ExamResultRules } from "@/types/examResults";
import { rulesOrStarter } from "./rules";
import { rollKey, subjectKey, type ResultStudent, type ResultSubjectOption } from "./importRows";

export const RESULT_RULES_DOC_ID = "rules";

const college = (db: Firestore, collegeId: string) => db.collection("colleges").doc(collegeId);
export const rulesRef = (db: Firestore, collegeId: string) => college(db, collegeId).collection("examResultRules").doc(RESULT_RULES_DOC_ID);
export const batchesCol = (db: Firestore, collegeId: string) => college(db, collegeId).collection("semesterResultBatches");
export const recordsCol = (db: Firestore, collegeId: string) => college(db, collegeId).collection("semesterResults");
export const recordId = (batchId: string, studentId: string) => `${batchId}_${studentId}`;

export async function loadResultRules(db: Firestore, collegeId: string): Promise<{ rules: ExamResultRules; saved: boolean }> {
  const snap = await rulesRef(db, collegeId).get();
  return { rules: rulesOrStarter(snap.exists ? (snap.data() as Partial<ExamResultRules>) : null), saved: snap.exists };
}

/** The acting user's display name (the session cookie carries only the uid). */
export async function actorName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  const snap = await college(db, collegeId).collection("users").doc(uid).get();
  return (snap.data() as { name?: string } | undefined)?.name ?? "Exam Cell";
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Runs `fn` over every item, `limit` at a time. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (const group of chunks(items, limit)) out.push(...(await Promise.all(group.map(fn))));
  return out;
}

/** This college's students for the given rolls, keyed by upper-case roll. */
export async function loadStudentsByRoll(db: Firestore, collegeId: string, rolls: string[]): Promise<Map<string, ResultStudent>> {
  const wanted = [...new Set(rolls.map(rollKey).filter(Boolean))];
  const found = new Map<string, ResultStudent>();
  const toStudent = (d: FirebaseFirestore.QueryDocumentSnapshot): ResultStudent => {
    const s = d.data() as { rollNumber?: string; name?: string; department?: string; secondaryDepartment?: string; courseId?: string; regulation?: string };
    return {
      id: d.id, rollNumber: String(s.rollNumber ?? "").trim(), name: s.name ?? "", department: s.department ?? "",
      secondaryDepartment: s.secondaryDepartment, courseId: s.courseId, regulation: s.regulation,
    };
  };
  const col = college(db, collegeId).collection("students");
  const byUpper = await mapLimited(chunks(wanted, 30), 10, (part) => col.where("rollNumberUpper", "in", part).get());
  for (const snap of byUpper) for (const d of snap.docs) {
    const k = rollKey(d.get("rollNumber"));
    if (k && !found.has(k)) found.set(k, toStudent(d));
  }
  // Students saved before the upper-case roll key existed carry only `rollNumber`.
  const missing = wanted.filter((k) => !found.has(k));
  const exact = [...new Set(rolls.map((r) => String(r ?? "").trim()).filter((r) => r && missing.includes(rollKey(r))))];
  const legacy = await mapLimited(chunks(exact, 30), 10, (part) => col.where("rollNumber", "in", part).get());
  for (const snap of legacy) for (const d of snap.docs) {
    const k = rollKey(d.get("rollNumber"));
    if (k && !found.has(k)) found.set(k, toStudent(d));
  }
  return found;
}

/** This college's subjects whose college code OR university code is one of
 *  `codes`, keyed by both (upper-case). */
export async function loadSubjectsByCode(db: Firestore, collegeId: string, codes: string[]): Promise<Map<string, ResultSubjectOption[]>> {
  const variants = [...new Set(codes.flatMap((c) => {
    const t = String(c ?? "").trim();
    return t ? [t, t.toUpperCase()] : [];
  }))];
  const col = college(db, collegeId).collection("subjects");
  const parts = chunks(variants, 30);
  const snaps = await mapLimited(
    [...parts.map((p) => ({ field: "code", p })), ...parts.map((p) => ({ field: "universityCode", p }))],
    10,
    ({ field, p }) => col.where(field, "in", p).get()
  );
  const out = new Map<string, ResultSubjectOption[]>();
  const seen = new Set<string>();
  for (const snap of snaps) for (const d of snap.docs) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    const s = d.data() as { code?: string; universityCode?: string; name?: string; credits?: number; courseId?: string; regulation?: string; academicYear?: string; isActive?: boolean };
    if (s.isActive === false) continue;
    const option = {
      id: d.id, code: String(s.code ?? "").trim(), name: s.name ?? "", credits: Number(s.credits) || 0,
      ...(s.universityCode ? { universityCode: s.universityCode } : {}),
      courseId: s.courseId, regulation: s.regulation, academicYear: s.academicYear,
    };
    for (const key of new Set([subjectKey(s.code), subjectKey(s.universityCode)].filter(Boolean))) {
      out.set(key, [...(out.get(key) ?? []), option]);
    }
  }
  return out;
}
