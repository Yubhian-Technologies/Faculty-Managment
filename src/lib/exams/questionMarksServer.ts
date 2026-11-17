import type { ExamConfiguration, InternalExamMarksBatch, MidPaperFinal } from "@/types";
import { loadMidSettings } from "@/lib/exams/midSettings";
import { midBankRefs } from "@/lib/midBank/server";
import { loadPlan } from "@/lib/midTimetable/server";
import { sheetFromPattern, type QuestionSheet } from "@/lib/exams/questionMarks";
import { withoutCea } from "@/lib/cea/paper";
import { sheetFromLayout } from "@/lib/exams/midMarksEntry";
import { loadLayout } from "@/lib/exams/midMarksEntryServer";

type Db = FirebaseFirestore.Firestore;

/**
 * The question sheet of each component linked to a Mid (ExamConfigComponent.midNumber):
 *   1. a college that prepares question papers: the paper the Exam Cell FINALIZED (printed) for this subject +
 *      branch in that Mid (same year) - exactly what the students wrote;
 *   2. else the Exam Cell's own layout for the subject + branch + Mid (questions + max marks, midMarksEntry.ts);
 *   3. else no sheet - the faculty can't enter that Mid yet (it is never typed as one number any more).
 * A chosen but not yet printed paper, or the course's paper pattern, no longer counts: their questions can change.
 * A CEA paper printed in the same sitting (lib/cea/paper.ts) is never part of the Mid's sheet.
 */
export async function questionSheetsFor(db: Db, collegeId: string, batch: Pick<InternalExamMarksBatch, "subjectId" | "department" | "year">, config: Pick<ExamConfiguration, "components">): Promise<Record<string, QuestionSheet>> {
  const linked = config.components.filter((c) => c.isActive && c.midNumber);
  if (linked.length === 0) return {};
  const papers = (await loadMidSettings(db, collegeId)).midPreparation === "PAPERS";
  const college = midBankRefs(db, collegeId).college;
  const choices = papers
    ? (await college.collection("midPaperChoices").where("subjectId", "==", batch.subjectId).get()).docs
      .map((d) => ({ ...(d.data() as { planId: string; date: string; branch: string; at?: string; final?: MidPaperFinal }), id: d.id }))
      .filter((c) => c.branch === batch.department && c.final)
      .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")))
    : [];
  const plans = new Map<string, { midNumber: number; year: number } | null>();
  for (const c of choices) if (!plans.has(c.planId)) { const p = await loadPlan(db, collegeId, c.planId); plans.set(c.planId, p ? { midNumber: p.midNumber, year: p.year } : null); }

  const out: Record<string, QuestionSheet> = {};
  for (const comp of linked) {
    const choice = choices.find((c) => { const p = plans.get(c.planId); return p && p.midNumber === comp.midNumber && (!batch.year || p.year === batch.year); });
    let sheet: QuestionSheet | null = null;
    if (choice?.final) {
      // Finalized (printed): exactly the paper the students wrote - the frozen copy, never the live paper.
      sheet = sheetFromPattern(withoutCea(choice.final.pattern), "CHOSEN", { set: choice.final.setNo, questions: choice.final.questions });
      if (sheet) sheet = { ...sheet, paper: { choiceId: choice.id, date: choice.date } };
    }
    if (!sheet) {
      const layout = await loadLayout(db, collegeId, batch.subjectId, batch.department, comp.midNumber!);
      if (layout) sheet = sheetFromLayout(layout);
    }
    if (sheet) out[comp.id] = sheet;
  }
  return out;
}
