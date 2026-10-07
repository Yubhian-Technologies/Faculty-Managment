import { QUALIFYING_EXAM_LABELS, type QualifiedExamEntry, type QualifyingExamType } from "@/types";

// NET / SLET / SET / GATE / Others: a faculty member may hold more than one. The FIRST exam keeps living in
// the original scalar fields (netSletSetGateOthers' qualifiedExam / pleaseSpecifyExam / examScore /
// qualifiedYear), so every record, import, export and screen written before this existed is untouched; exams
// 2+ are an ordered list beside them (additionalQualifiedExams) - the same shape UG/PG/Ph.D. already use.

export interface QualifiedExamSource {
  netSletSetGateOthers?: "YES" | "NO";
  qualifiedExam?: QualifyingExamType;
  pleaseSpecifyExam?: string;
  examScore?: string;
  qualifiedYear?: number;
  additionalQualifiedExams?: QualifiedExamEntry[];
}

export function qualifiedExamName(exam: QualifyingExamType | undefined, pleaseSpecify?: string): string {
  if (!exam) return pleaseSpecify?.trim() ?? "";
  if (exam === "OTHER") return pleaseSpecify?.trim() || QUALIFYING_EXAM_LABELS.OTHER;
  return QUALIFYING_EXAM_LABELS[exam] ?? String(exam);
}

const hasAny = (e: QualifiedExamEntry) => !!(e.exam || e.pleaseSpecifyExam?.trim() || e.examScore?.trim() || e.qualifiedYear);

// Every exam the person holds, first one included, as plain display values. Empty unless NET/SLET/... is "YES".
export function qualifiedExamList(p: QualifiedExamSource | undefined | null): { name: string; score: string; year: string }[] {
  if (!p || p.netSletSetGateOthers !== "YES") return [];
  const first: QualifiedExamEntry = { exam: p.qualifiedExam, pleaseSpecifyExam: p.pleaseSpecifyExam, examScore: p.examScore, qualifiedYear: p.qualifiedYear };
  return [first, ...(p.additionalQualifiedExams ?? [])]
    .filter(hasAny)
    .map((e) => ({ name: qualifiedExamName(e.exam, e.pleaseSpecifyExam), score: e.examScore?.trim() ?? "", year: e.qualifiedYear ? String(e.qualifiedYear) : "" }));
}
