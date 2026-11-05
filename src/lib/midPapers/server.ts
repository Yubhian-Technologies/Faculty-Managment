import type { MidPaperPattern, MidPaperQuestion, Subject } from "@/types";
import { courseKeyForSubject, midBankRefs } from "@/lib/midBank/server";

// Server reads for question papers: the Exam Cell's pattern for a subject, and a paper set's questions.

type Db = FirebaseFirestore.Firestore;

export const patternsCol = (db: Db, collegeId: string) => midBankRefs(db, collegeId).college.collection("midPaperPatterns");

/** The pattern for a subject: its own regulation's, else the course's "ALL". */
export async function patternForSubject(db: Db, collegeId: string, subject: Subject): Promise<MidPaperPattern | null> {
  const key = await courseKeyForSubject(db, collegeId, subject);
  if (!key) return null;
  const snap = await patternsCol(db, collegeId).where("courseKey", "==", key).get();
  const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidPaperPattern, "id">) }));
  const reg = (subject.regulation ?? "").trim().toUpperCase();
  return all.find((p) => reg && p.regulation.toUpperCase() === reg) ?? all.find((p) => p.regulation === "ALL") ?? null;
}

export async function loadPaperQuestions(db: Db, collegeId: string, bankId: string): Promise<MidPaperQuestion[]> {
  const snap = await midBankRefs(db, collegeId).questions(bankId).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidPaperQuestion, "id">) }));
}
