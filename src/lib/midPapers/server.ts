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

/**
 * The layout a started paper would have under the Exam Cell's CURRENT pattern and units per Mid (the same reading
 * as starting one): null when the subject has no pattern now. `changed` = it differs from the paper's own copy.
 */
export async function livePaperLayout(db: Db, collegeId: string, bank: import("@/types").MidQuestionBank): Promise<{
  pattern: MidPaperPattern; units: number[]; changed: boolean; issues: { message: string }[];
} | null> {
  const { loadOutcomes, loadSubject, rulesForSubject, subjectSplitFor } = await import("@/lib/midBank/server");
  const { loadMidSettings } = await import("@/lib/exams/midSettings");
  const { paperSetupIssues } = await import("@/lib/midBank/setup");
  const { expandPattern, patternShape } = await import("./pattern");
  const subject = await loadSubject(db, collegeId, bank.subjectId);
  if (!subject || !bank.pattern) return null;
  const [pattern, rules, outcomes, exception, settings] = await Promise.all([
    patternForSubject(db, collegeId, subject), rulesForSubject(db, collegeId, subject), loadOutcomes(db, collegeId, bank.outcomesId),
    subjectSplitFor(db, collegeId, bank.subjectId), loadMidSettings(db, collegeId),
  ]);
  if (!pattern) return null;
  const setup = paperSetupIssues(subject, pattern, outcomes, outcomeSwitchesOf(bank), { midNumber: bank.midNumber, rules, exception, midCount: settings.midCount });
  const expanded = expandPattern(pattern, setup.units, setup.shared);
  const layout = (p: MidPaperPattern) => JSON.stringify(p.parts.map((x) => x.unitLayout ?? x.questions));
  const changed = patternShape(expanded) !== patternShape(bank.pattern) || layout(expanded) !== layout(bank.pattern);
  return { pattern: expanded, units: setup.units, changed, issues: setup.issues };
}

const outcomeSwitchesOf = (bank: import("@/types").MidQuestionBank) => ({
  cos: bank.outcomes?.cos !== false, poMapping: bank.outcomes?.cos !== false && bank.outcomes?.poMapping !== false, bloom: bank.outcomes?.bloom !== false,
});
