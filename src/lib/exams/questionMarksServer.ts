import type { ExamConfiguration, InternalExamMarksBatch, MidQuestionBank } from "@/types";
import { loadMidSettings } from "@/lib/exams/midSettings";
import { loadSubject, midBankRefs } from "@/lib/midBank/server";
import { loadPlan } from "@/lib/midTimetable/server";
import { loadPaperQuestions, patternForSubject } from "@/lib/midPapers/server";
import { sheetFromPattern, type QuestionSheet } from "@/lib/exams/questionMarks";

type Db = FirebaseFirestore.Firestore;

/**
 * The question sheet of each component linked to a Mid (ExamConfigComponent.midNumber), for a college that prepares
 * question papers: the paper the Exam Cell chose for this subject + branch in that Mid (same year), else the
 * course's paper pattern. A component without a sheet is entered as one number, as before.
 */
export async function questionSheetsFor(db: Db, collegeId: string, batch: Pick<InternalExamMarksBatch, "subjectId" | "department" | "year">, config: Pick<ExamConfiguration, "components">): Promise<Record<string, QuestionSheet>> {
  const linked = config.components.filter((c) => c.isActive && c.midNumber);
  if (linked.length === 0) return {};
  if ((await loadMidSettings(db, collegeId)).midPreparation !== "PAPERS") return {};
  const college = midBankRefs(db, collegeId).college;
  const choices = (await college.collection("midPaperChoices").where("subjectId", "==", batch.subjectId).get()).docs
    .map((d) => d.data() as { planId: string; branch: string; bankId: string; setNo: number; at?: string })
    .filter((c) => c.branch === batch.department)
    .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  const plans = new Map<string, { midNumber: number; year: number } | null>();
  for (const c of choices) if (!plans.has(c.planId)) { const p = await loadPlan(db, collegeId, c.planId); plans.set(c.planId, p ? { midNumber: p.midNumber, year: p.year } : null); }
  const subject = await loadSubject(db, collegeId, batch.subjectId);
  const fallback = subject ? await patternForSubject(db, collegeId, subject) : null;

  const out: Record<string, QuestionSheet> = {};
  for (const comp of linked) {
    const choice = choices.find((c) => { const p = plans.get(c.planId); return p && p.midNumber === comp.midNumber && (!batch.year || p.year === batch.year); });
    let sheet = null;
    if (choice) {
      const bank = await midBankRefs(db, collegeId).banks.doc(choice.bankId).get();
      const pattern = (bank.data() as MidQuestionBank | undefined)?.pattern ?? null;
      // A part the faculty built is laid out from the chosen paper's own questions.
      const questions = pattern?.parts.some((p) => p.flexible) ? await loadPaperQuestions(db, collegeId, choice.bankId) : [];
      if (pattern) sheet = sheetFromPattern(pattern, "CHOSEN", { set: choice.setNo, questions });
    }
    // No paper chosen yet: the course pattern, when it has no faculty-decides part (else typed as one number).
    if (!sheet && fallback) sheet = sheetFromPattern(fallback, "PATTERN");
    if (sheet) out[comp.id] = sheet;
  }
  return out;
}
